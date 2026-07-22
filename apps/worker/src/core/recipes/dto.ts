// Row -> DTO mapping for core/recipes (KOK-025). Unlike core/catalog/dto.ts's toItemDto (plain and
// synchronous), toRecipeDto needs DB access to load the output item + every line item's wac/
// replacementCost/salePrice and the `min_margin_pct` setting, so it is async — see this module's
// callers (recipes.ts) for why every mutation/read ends by calling this rather than caching the
// theoretical cost anywhere (Doc 03 §4 C-3b: these fields are LIVE, never cached, never written to
// items.wac/replacement_cost — that is C-3's job, KOK-029, and only for the default recipe).

import type { RecipeCostDto, RecipeDto, RecipeLineDto, RecipeSettingsDto } from "@kokoro/shared";

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

/** One query for every item this recipe touches (the output item + all line items) — never one
 * query per line, mirroring core/catalog/dto.ts's fetchAliasesForItems batching precedent. */
async function loadItemsById(db: Db, itemIds: readonly string[]): Promise<Map<string, ItemRow>> {
  const uniqueIds = [...new Set(itemIds)];
  if (uniqueIds.length === 0) return new Map();
  const rows = await db.query.items.findMany({
    where: (t, { inArray }) => inArray(t.id, uniqueIds),
  });
  return new Map(rows.map((row) => [row.id, row]));
}

/** Builds one RecipeCostDto on the given basis (`wac` or `replacementCost`, C-3b) — the pure math
 * lives entirely in theoretical-cost.ts; this only picks which item column feeds it. */
function buildCostDto(
  basis: "wac" | "replacementCost",
  outputItem: Pick<ItemRow, "salePrice">,
  lineRows: readonly RecipeLineRow[],
  itemsById: ReadonlyMap<string, ItemRow>,
  expectedYieldQty: number,
): RecipeCostDto {
  const lines = lineRows.map((line) => {
    // A missing item here would mean the FK (RESTRICT) was bypassed — unreachable in practice, but
    // loadItemsById's Map lookup can't statically prove that, so this narrows defensively rather
    // than risking `undefined.wac` at runtime.
    const item = itemsById.get(line.itemId);
    const unitCost = item ? item[basis] : 0;
    return { qty: line.qty, unitCost };
  });
  const costPerOutputUnit = computeTheoreticalCostPerOutputUnit(lines, expectedYieldQty);
  const margin = computeRecipeMargin(outputItem.salePrice, costPerOutputUnit);
  return { costPerOutputUnit, margin };
}

/** Assembles a RecipeDto, including both LIVE theoretical-cost valuations (C-3b). Async because it
 * loads the output item + every line item's current wac/replacementCost/salePrice. */
export async function toRecipeDto(
  db: Db,
  row: RecipeRow,
  lineRows: readonly RecipeLineRow[],
): Promise<RecipeDto> {
  const itemsById = await loadItemsById(db, [row.outputItemId, ...lineRows.map((l) => l.itemId)]);
  // Falls back to a `salePrice: null` stand-in rather than throwing: the recipe row itself is the
  // authoritative read here (getRecipe/listRecipes already resolved it), and an output item deleted
  // out from under a FK RESTRICT is unreachable — this mirrors buildCostDto's same defensive stance.
  const outputItem: Pick<ItemRow, "salePrice"> = itemsById.get(row.outputItemId) ?? {
    salePrice: null,
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
      "replacementCost",
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
