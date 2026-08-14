import {
  type AssemblyDefinitionCostDto,
  type AssemblyDefinitionDto,
  type AssemblyDefinitionLineDto,
  type RecipeSettingsDto,
  toMilliCentavosPerUnit,
} from "@kokoro/shared";

import type { Db } from "../../db/index.js";
import type { assemblyDefinitionLines, assemblyDefinitions, items } from "../../db/schema.js";
import { computeEffectiveReplacementCost } from "../costing/replacement-cost.js";
import { getSetting } from "../settings/index.js";
import { computeAssemblyCostPerOutputUnit, computeAssemblyMargin } from "./cost-preview.js";

type AssemblyDefinitionRow = typeof assemblyDefinitions.$inferSelect;
type AssemblyDefinitionLineRow = typeof assemblyDefinitionLines.$inferSelect;
type ItemRow = typeof items.$inferSelect;

function toAssemblyDefinitionLineDto(row: AssemblyDefinitionLineRow): AssemblyDefinitionLineDto {
  return { id: row.id, itemId: row.itemId, qty: row.qty };
}

async function loadItemsById(db: Db, itemIds: readonly string[]): Promise<Map<string, ItemRow>> {
  const uniqueIds = [...new Set(itemIds)];
  if (uniqueIds.length === 0) return new Map();
  const rows = await db.query.items.findMany({
    where: (t, { inArray }) => inArray(t.id, uniqueIds),
  });
  return new Map(rows.map((row) => [row.id, row]));
}

function buildCostDto(
  basis: "wac" | "replacementCostMc",
  outputItem: Pick<ItemRow, "salePriceMc">,
  lineRows: readonly AssemblyDefinitionLineRow[],
  itemsById: ReadonlyMap<string, ItemRow>,
  outputQty: number,
): AssemblyDefinitionCostDto {
  const lines = lineRows.map((line) => {
    const item = itemsById.get(line.itemId);
    const unitCost =
      basis === "wac"
        ? toMilliCentavosPerUnit(item?.wacMc ?? 0)
        : item
          ? computeEffectiveReplacementCost(
              toMilliCentavosPerUnit(item.replacementCostMc),
              item.replacementCostUpdatedAt,
              toMilliCentavosPerUnit(item.wacMc),
            )
          : toMilliCentavosPerUnit(0);
    return { qty: line.qty, unitCost };
  });
  const costPerOutputUnit = computeAssemblyCostPerOutputUnit(lines, outputQty);
  const margin = computeAssemblyMargin(
    outputItem.salePriceMc === null ? null : toMilliCentavosPerUnit(outputItem.salePriceMc),
    costPerOutputUnit,
  );
  return { costPerOutputUnit, margin };
}

export async function toAssemblyDefinitionDto(
  db: Db,
  row: AssemblyDefinitionRow,
  lineRows: readonly AssemblyDefinitionLineRow[],
): Promise<AssemblyDefinitionDto> {
  const itemsById = await loadItemsById(db, [
    row.outputItemId,
    ...lineRows.map((line) => line.itemId),
  ]);
  const outputItem: Pick<ItemRow, "salePriceMc"> = itemsById.get(row.outputItemId) ?? {
    salePriceMc: null,
  };

  return {
    id: row.id,
    name: row.name,
    outputItemId: row.outputItemId,
    outputQty: row.outputQty,
    isDefault: row.isDefault === 1,
    isActive: row.isActive === 1,
    notes: row.notes,
    lines: lineRows.map(toAssemblyDefinitionLineDto),
    costWac: buildCostDto("wac", outputItem, lineRows, itemsById, row.outputQty),
    costReplacement: buildCostDto(
      "replacementCostMc",
      outputItem,
      lineRows,
      itemsById,
      row.outputQty,
    ),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getAssemblyDefinitionSettingsDto(db: Db): Promise<RecipeSettingsDto> {
  const raw = await getSetting(db, "min_margin_pct");
  return { minMarginPct: Number(raw) };
}

export async function fetchAssemblyDefinitionLines(
  db: Db,
  definitionId: string,
): Promise<AssemblyDefinitionLineRow[]> {
  return db.query.assemblyDefinitionLines.findMany({
    where: (t, { eq }) => eq(t.definitionId, definitionId),
  });
}
