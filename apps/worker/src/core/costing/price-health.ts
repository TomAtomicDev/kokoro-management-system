// core/costing — C-5 margin math + price suggestion (KOK-035, Doc 03 §4 C-5,
// Doc 07 SC-12) and the read query that assembles SC-12's table.
//
// `sale_price_mc`, `wac_mc`, and `replacement_cost_mc` all share one `MilliCentavosPerUnit` scale
// (ADR-017), so margin arithmetic over them is dimensionally valid. Margins are nonetheless
// computed here in application code through `totalCentavos` rather than in a SQL view, so the
// arithmetic sits where the property tests can reach it; `v_price_health` supplies no additional
// data, so `listPriceHealth` queries `items` directly.
//
// Same "plain, synchronous, DB-free" convention as wac.ts/replacement-cost.ts for the pure math —
// `computePriceMargin`/`computePriceSuggested` take no `Db` and are directly usable by fast-check
// property tests (Doc 11 §2, D-5: this touches money math). The margin arithmetic itself lives in
// `@kokoro/shared`'s `computeMarginBasisPoints` (KOK-036) so the web app's SC-03 live-preview badge
// can reuse the exact tested formula instead of re-deriving it; this function only adds the
// command-level input validation and null/zero-price early-outs a DomainError boundary needs.

import type { PriceHealthRowDto, PriceMarginDto, PricingSettingsDto } from "@kokoro/shared";
import {
  computeMarginBasisPoints,
  type MilliCentavosPerUnit,
  roundHalfUpToInt,
  toMilliCentavosPerUnit,
  totalCentavos,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";

import type { Db } from "../../db/index.js";
import { validationError } from "../errors.js";
import { getSetting } from "../settings/index.js";

function assertSafeIntegerInput(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw validationError(`${label} debe ser un entero seguro.`, { [label]: value });
  }
}

/**
 * C-5: `margin = price − cost`, and `margin / price` as basis points. Returns `null` when there is
 * nothing meaningful to compare against: no sale price set yet, or a sale price of exactly zero
 * (mirrors `computeRecipeMargin`'s identical precedent in core/recipes/theoretical-cost.ts).
 */
export function computePriceMargin(
  salePriceMc: MilliCentavosPerUnit | null,
  costMc: MilliCentavosPerUnit,
): PriceMarginDto | null {
  if (salePriceMc === null || salePriceMc === 0) return null;
  assertSafeIntegerInput(salePriceMc, "salePriceMc");
  if (totalCentavos(salePriceMc, WHOLE_UNIT_MILLI_UNITS) === 0) return null;
  return computeMarginBasisPoints(salePriceMc, costMc);
}

/**
 * Doc 07 SC-12: `price_suggested = replacement_cost / (1 − min_margin_pct)` — the price at which
 * `margin_replacement_pct` exactly equals the target. The stored `_mc` rate is converted to a
 * whole-unit centavo amount before the division. Returns `null` when replacement cost is 0
 * (nothing to mark up from yet — e.g. a FINISHED item whose default-recipe C-3 refresh (KOK-029)
 * hasn't run).
 */
export function computePriceSuggested(
  replacementCostMc: MilliCentavosPerUnit,
  minMarginPctBp: number,
): number | null {
  assertSafeIntegerInput(minMarginPctBp, "minMarginPctBp");
  if (minMarginPctBp >= 10000) {
    throw validationError("El margen objetivo debe ser menor al 100%.", { minMarginPctBp });
  }
  assertSafeIntegerInput(replacementCostMc, "replacementCostMc");
  if (replacementCostMc < 0) {
    throw validationError("El costo de reemplazo debe ser un entero no negativo.", {
      replacementCostMc,
    });
  }
  if (replacementCostMc === 0) return null;

  const replacementCostMcPerUnit = totalCentavos(replacementCostMc, WHOLE_UNIT_MILLI_UNITS);
  return roundHalfUpToInt(replacementCostMcPerUnit / (1 - minMarginPctBp / 10000));
}

/** `app_settings.min_margin_pct`, exposed on its own (`GET /pricing-settings`, KOK-036) for
 * screens that need only the C-5 threshold — mirrors `core/recipes/dto.ts`'s
 * `getRecipeSettingsDto` precedent. `listPriceHealth` below reuses this rather than re-reading
 * the setting inline. */
export async function getPricingSettingsDto(db: Db): Promise<PricingSettingsDto> {
  const raw = await getSetting(db, "min_margin_pct");
  return { minMarginPct: Number(raw ?? 0) };
}

interface PriceHealthItemRow {
  id: string;
  name: string;
  wacMc: number;
  replacementCostMc: number;
  replacementCostUpdatedAt: string | null;
  salePriceMc: number | null;
}

/**
 * SC-12's table: every active FINISHED item (mirrors `v_price_health`'s own WHERE clause) with its
 * C-5 margins, C-3 price suggestion, and the effective date of its most recent `price_history` row.
 * `min_margin_pct` rides along on the result (mirrors `core/recipes/dto.ts`'s
 * `getRecipeSettingsDto` precedent) so no `MarginBadge` consumer hardcodes the threshold.
 */
export async function listPriceHealth(
  db: Db,
): Promise<{ rows: PriceHealthRowDto[]; minMarginPct: number }> {
  const itemRows: PriceHealthItemRow[] = await db.query.items.findMany({
    where: (t, { and, eq }) => and(eq(t.kind, "FINISHED"), eq(t.isActive, 1)),
    orderBy: (t, { asc }) => asc(t.name),
    columns: {
      id: true,
      name: true,
      wacMc: true,
      replacementCostMc: true,
      replacementCostUpdatedAt: true,
      salePriceMc: true,
    },
  });

  const itemIds = itemRows.map((row) => row.id);
  const lastChangeByItemId = new Map<string, string>();
  if (itemIds.length > 0) {
    // Newest-first per item (`effective_from DESC`, UUIDv7 `id DESC` tiebreak — price_history has
    // no `created_at`, so id's own chronological ordering breaks same-business-date ties, mirroring
    // the kardex view's `occurred_at DESC, created_at DESC, id DESC` precedent).
    const historyRows = await db.query.priceHistory.findMany({
      where: (t, { inArray: inArrayOp }) => inArrayOp(t.itemId, itemIds),
      orderBy: (t, { desc }) => [desc(t.effectiveFrom), desc(t.id)],
      columns: { itemId: true, effectiveFrom: true },
    });
    for (const row of historyRows) {
      if (!lastChangeByItemId.has(row.itemId)) {
        lastChangeByItemId.set(row.itemId, row.effectiveFrom);
      }
    }
  }

  const { minMarginPct } = await getPricingSettingsDto(db);

  const rows: PriceHealthRowDto[] = itemRows.map((row) => {
    return {
      itemId: row.id,
      name: row.name,
      salePriceMc: row.salePriceMc === null ? null : toMilliCentavosPerUnit(row.salePriceMc),
      wacMc: row.wacMc,
      replacementCostMc: row.replacementCostMc,
      replacementCostUpdatedAt: row.replacementCostUpdatedAt,
      marginWac: computePriceMargin(
        row.salePriceMc === null ? null : toMilliCentavosPerUnit(row.salePriceMc),
        toMilliCentavosPerUnit(row.wacMc),
      ),
      marginReplacement: computePriceMargin(
        row.salePriceMc === null ? null : toMilliCentavosPerUnit(row.salePriceMc),
        toMilliCentavosPerUnit(row.replacementCostMc),
      ),
      priceSuggested: computePriceSuggested(
        toMilliCentavosPerUnit(row.replacementCostMc),
        minMarginPct,
      ),
      lastPriceChangeAt: lastChangeByItemId.get(row.id) ?? null,
    };
  });

  return { rows, minMarginPct };
}
