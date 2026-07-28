// core/costing — C-5 margin math + price-suggestion (KOK-035, Doc 03 §4 C-5, Doc 07 SC-12) and the
// read query that assembles SC-12's table (`listPriceHealth`).
//
// `v_price_health` (migrations/0001_init.sql) is NOT used here: it originally had `margin_wac_bp`/
// `margin_repl_bp`/`margin_repl_pct` columns computing `sale_price − wac` directly in SQL, but
// `sale_price` is centavos per WHOLE unit while `items.wac`/`items.replacement_cost` are centavos
// per MILLI-unit (core/costing/wac.ts's header; confirmed by SaleForm.tsx's `unitPrice / 1000 <
// item.replacementCost` below-replacement-cost check) — a ~1000x unit mismatch that would make
// every FINISHED item look like it has a ~100% margin. Those three columns were removed (KOK-069,
// migration 0006, Doc 04 §4) rather than fixed in SQL, since this file already computes margins
// correctly in application code and nothing else consumed them. `v_price_health` still supplies
// nothing this function needs beyond `items` itself, so this queries `items` directly.
//
// Same "plain, synchronous, DB-free" convention as wac.ts/replacement-cost.ts for the pure math —
// `computePriceMargin`/`computePriceSuggested` take no `Db` and are directly usable by fast-check
// property tests (Doc 11 §2, D-5: this touches money math).

import type { PriceHealthRowDto, PriceMarginDto } from "@kokoro/shared";
import { roundHalfUpToInt, subMoney } from "@kokoro/shared";

import type { Db } from "../../db/index.js";
import { validationError } from "../errors.js";
import { getSetting } from "../settings/index.js";

function assertSafeIntegerInput(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw validationError(`${label} debe ser un entero seguro.`, { [label]: value });
  }
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw validationError(`${label} debe ser un número finito no negativo.`, { [label]: value });
  }
}

/**
 * C-5: `margin = price − cost`, and `margin / price` as basis points. `costPerMilliUnit` is a
 * per-MILLI-unit float (the `items.wac`/`items.replacementCost` convention) — converted to a
 * per-WHOLE-unit centavos amount (rounded half-up, the one rounding step, D-5) before subtracting
 * from `salePrice` (already per-whole-unit centavos). Returns `null` when there is nothing
 * meaningful to compare against: no sale price set yet, or a sale price of exactly zero (mirrors
 * `computeRecipeMargin`'s identical precedent in core/recipes/theoretical-cost.ts).
 */
export function computePriceMargin(
  salePrice: number | null,
  costPerMilliUnit: number,
): PriceMarginDto | null {
  if (salePrice === null || salePrice === 0) return null;
  assertSafeIntegerInput(salePrice, "salePrice");
  assertFiniteNonNegative(costPerMilliUnit, "costPerMilliUnit");

  const costPerUnit = roundHalfUpToInt(costPerMilliUnit * 1000);
  const amount = subMoney(salePrice, costPerUnit);
  const pctBasisPoints = roundHalfUpToInt((amount * 10000) / salePrice);
  return { amount, pctBasisPoints };
}

/**
 * Doc 07 SC-12: `price_suggested = replacement_cost / (1 − min_margin_pct)` — the price at which
 * `margin_replacement_pct` exactly equals the target. `replacementCostPerMilliUnit` uses the same
 * per-MILLI-unit convention as `items.replacementCost`; converted to per-WHOLE-unit before the
 * division. Returns `null` when replacement cost is 0 (nothing to mark up from yet — e.g. a
 * FINISHED item whose default-recipe C-3 refresh (KOK-029) hasn't run).
 */
export function computePriceSuggested(
  replacementCostPerMilliUnit: number,
  minMarginPctBp: number,
): number | null {
  assertFiniteNonNegative(replacementCostPerMilliUnit, "replacementCostPerMilliUnit");
  assertSafeIntegerInput(minMarginPctBp, "minMarginPctBp");
  if (minMarginPctBp >= 10000) {
    throw validationError("El margen objetivo debe ser menor al 100%.", { minMarginPctBp });
  }
  if (replacementCostPerMilliUnit === 0) return null;

  const replacementCostPerUnit = replacementCostPerMilliUnit * 1000; // unrounded intermediate.
  return roundHalfUpToInt(replacementCostPerUnit / (1 - minMarginPctBp / 10000));
}

interface PriceHealthItemRow {
  id: string;
  name: string;
  wacMc: number;
  replacementCost: number;
  replacementCostUpdatedAt: string | null;
  salePrice: number | null;
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
      replacementCost: true,
      replacementCostUpdatedAt: true,
      salePrice: true,
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

  const minMarginPctRaw = await getSetting(db, "min_margin_pct");
  const minMarginPct = Number(minMarginPctRaw ?? 0);

  const rows: PriceHealthRowDto[] = itemRows.map((row) => {
    // KOK-071 (ADR-017) vertical 1 moved `items.wac` to `items.wac_mc` (integer milli-centavos per
    // WHOLE unit); `items.replacement_cost`/`items.sale_price` are not migrated yet (later
    // verticals), and `PriceHealthRowDto.wac`/`computePriceMargin` still expect the old
    // centavos-per-milli-unit scale to stay comparable to those unmigrated fields. This divides
    // `wacMc` back down by the same ×1,000,000 factor migration 0007 applied — both this bridge
    // and the DTO's scale will flip together once `sale_price`/`replacement_cost` migrate.
    const wac = row.wacMc / 1_000_000;
    return {
      itemId: row.id,
      name: row.name,
      salePrice: row.salePrice,
      wac,
      replacementCost: row.replacementCost,
      replacementCostUpdatedAt: row.replacementCostUpdatedAt,
      marginWac: computePriceMargin(row.salePrice, wac),
      marginReplacement: computePriceMargin(row.salePrice, row.replacementCost),
      priceSuggested: computePriceSuggested(row.replacementCost, minMarginPct),
      lastPriceChangeAt: lastChangeByItemId.get(row.id) ?? null,
    };
  });

  return { rows, minMarginPct };
}
