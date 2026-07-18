// Row -> DTO mapping + alias-fetch helpers shared by items.ts, aliases.ts and merge.ts. Kept
// separate so none of those three files needs to duplicate the shape of ItemDto.

import type { ItemAliasDto, ItemDto } from "@kokoro/shared";

import type { Db } from "../../db/index.js";
import type { itemAliases, items } from "../../db/schema.js";

type ItemRow = typeof items.$inferSelect;
type ItemAliasRow = typeof itemAliases.$inferSelect;

export function toAliasDto(row: ItemAliasRow): ItemAliasDto {
  return { id: row.id, alias: row.alias };
}

export function toItemDto(row: ItemRow, aliases: ItemAliasRow[]): ItemDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    category: row.category,
    unit: row.unit,
    wac: row.wac,
    replacementCost: row.replacementCost,
    replacementCostUpdatedAt: row.replacementCostUpdatedAt,
    salePrice: row.salePrice,
    minStockQty: row.minStockQty,
    isActive: row.isActive === 1,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    aliases: aliases.map(toAliasDto),
  };
}

export async function fetchAliasesForItem(db: Db, itemId: string): Promise<ItemAliasRow[]> {
  return db.query.itemAliases.findMany({
    where: (t, { eq }) => eq(t.itemId, itemId),
    orderBy: (t, { asc }) => asc(t.alias),
  });
}

/** Batches the alias lookup for a whole listItems() page instead of one query per row. */
export async function fetchAliasesForItems(
  db: Db,
  itemIds: string[],
): Promise<Map<string, ItemAliasRow[]>> {
  const map = new Map<string, ItemAliasRow[]>();
  if (itemIds.length === 0) return map;

  const rows = await db.query.itemAliases.findMany({
    where: (t, { inArray }) => inArray(t.itemId, itemIds),
    orderBy: (t, { asc }) => asc(t.alias),
  });
  for (const row of rows) {
    const list = map.get(row.itemId);
    if (list) {
      list.push(row);
    } else {
      map.set(row.itemId, [row]);
    }
  }
  return map;
}
