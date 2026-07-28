// Row -> DTO mapping for core/recipes (KOK-025). Unlike core/catalog/dto.ts's toItemDto (plain and
// synchronous), toRecipeDto needs DB access to load the output item + every line item's wac/
// replacementCostMc/salePrice and the `min_margin_pct` setting, so it is async Ã¢â‚¬â€ see this module's
// callers (recipes.ts) for why every mutation/read ends by calling this rather than caching the
// theoretical cost anywhere (Doc 03 Ã‚Â§4 C-3b: these fields are LIVE, never cached, never written to
// items.wac/replacement_cost Ã¢â‚¬â€ that is C-3's job, KOK-029, and only for the default recipe).

import {
  toMilliCentavosPerUnit,
  type RecipeCostDto,
  type RecipeDto,
  type RecipeLineDto,
  type RecipeSettingsDto,
} from "@kokoro/shared";

import type { Db } from "../../db/index.js";
import type { items, recipeLines, recipes } from "../../db/schema.js";
import { getSetting } from "../settings/index.js";
import { computeRecipeMargin, computeTheoreticalCostPerOutputUnit } from "./theoretical-cost.js";

type RecipeRow = typeof recipes.$inferSelect;
type RecipeLineRow = typeof recipeLines.$inferSelect;
type ItemRow = typeof items.$inferSelect;

function toRecipeLineDto(row: RecipeLineRow): RecipeLineDto {
  return { id: row.id, itemId: row.itemId, qty: row.qty };
}

/** One query for every item this recipe touches (the output item + all line items) Ã¢â‚¬â€ never one
 * query per line, mirroring core/catalog/dto.ts's fetchAliasesForItems batching precedent. */
async function loadItemsById(db: Db, itemIds: readonly string[]): Promise<Map<string, ItemRow>> {
  const uniqueIds = [...new Set(itemIds)];
  if (uniqueIds.length === 0) return new Map();
  const rows = await db.query.items.findMany({
    where: (t, { inArray }) => inArray(t.id, uniqueIds),
  });
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Builds one RecipeCostDto on the given basis (`wac` or `replacementCostMc`, C-3b) Ã¢â‚¬â€ the pure math
 * lives entirely in theoretical-cost.ts; this only picks which item column feeds it.
 *
 * KOK-071 (ADR-017) vertical 1 moved `items.wac` to `items.wac_mc` (integer milli-centavos per
 * WHOLE unit); `items.replacement_cost` and `items.sale_price` are NOT migrated yet (later
 * verticals). `computeTheoreticalCostPerOutputUnit`'s output must stay directly comparable to
 * `salePrice` (fed straight into `computeRecipeMargin`'s subtraction below), so its scale can't
 * flip until `salePrice` also does Ã¢â‚¬â€ both will move together when that vertical lands. Until
 * then, the WAC basis converts `wacMc` back down to the old centavos-per-milli-unit convention
 * this function still expects, the inverse of the same Ãƒâ€”1,000,000 factor migration 0007 applied.
 */
function buildCostDto(
  basis: "wac" | "replacementCostMc",
  outputItem: Pick<ItemRow, "salePriceMc">,
  lineRows: readonly RecipeLineRow[],
  itemsById: ReadonlyMap<string, ItemRow>,
  expectedYieldQty: number,
): RecipeCostDto {
  const lines = lineRows.map((line) => {
    // A missing item here would mean the FK (RESTRICT) was bypassed Ã¢â‚¬â€ unreachable in practice, but
    // loadItemsById's Map lookup can't statically prove that, so this narrows defensively rather
    // than risking `undefined.wac` at runtime.
    const item = itemsById.get(line.itemId);
    const unitCost =
      basis === "wac"
        ? toMilliCentavosPerUnit(item?.wacMc ?? 0)
        : toMilliCentavosPerUnit(item?.replacementCostMc ?? 0);
    return { qty: line.qty, unitCost };
  });
  const costPerOutputUnit = computeTheoreticalCostPerOutputUnit(lines, expectedYieldQty);
  const margin = computeRecipeMargin(
    outputItem.salePriceMc === null
      ? null
      : toMilliCentavosPerUnit(outputItem.salePriceMc),
    costPerOutputUnit,
  );
  return { costPerOutputUnit, margin };
}

/** Assembles a RecipeDto, including both LIVE theoretical-cost valuations (C-3b). Async because it
 * loads the output item + every line item's current wac/replacementCostMc/salePrice. */
export async function toRecipeDto(
  db: Db,
  row: RecipeRow,
  lineRows: readonly RecipeLineRow[],
): Promise<RecipeDto> {
  const itemsById = await loadItemsById(db, [row.outputItemId, ...lineRows.map((l) => l.itemId)]);
  // Falls back to a `salePrice: null` stand-in rather than throwing: the recipe row itself is the
  // authoritative read here (getRecipe/listRecipes already resolved it), and an output item deleted
  // out from under a FK RESTRICT is unreachable Ã¢â‚¬â€ this mirrors buildCostDto's same defensive stance.
  const outputItem: Pick<ItemRow, "salePriceMc"> = itemsById.get(row.outputItemId) ?? {
    salePriceMc: null,
  };

  return {
    id: row.id,
    name: row.name,
    outputItemId: row.outputItemId,
    expectedYieldQty: row.expectedYieldQty,
    estLaborMin: row.estLaborMin,
    isDefault: row.isDefault === 1,
    isActive: row.isActive === 1,
    notes: row.notes,
    lines: lineRows.map(toRecipeLineDto),
    theoreticalCostWac: buildCostDto("wac", outputItem, lineRows, itemsById, row.expectedYieldQty),
    theoreticalCostReplacement: buildCostDto(
      "replacementCostMc",
      outputItem,
      lineRows,
      itemsById,
      row.expectedYieldQty,
    ),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** `app_settings.min_margin_pct`, riding along on every recipe response (RecipeDto's header). */
export async function getRecipeSettingsDto(db: Db): Promise<RecipeSettingsDto> {
  const raw = await getSetting(db, "min_margin_pct");
  return { minMarginPct: Number(raw) };
}

export async function fetchRecipeLines(db: Db, recipeId: string): Promise<RecipeLineRow[]> {
  return db.query.recipeLines.findMany({
    where: (t, { eq }) => eq(t.recipeId, recipeId),
  });
}
