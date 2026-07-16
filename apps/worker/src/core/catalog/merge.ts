// Merge-duplicates utility (KOK-011, Doc 07 SC-15: "re-points FKs, one-way").
//
// Scope note: item_aliases.item_id is the only FK into items that any writer service can
// populate at this point in the backlog (purchase_lines/sale_lines/recipe_lines/stock_movements/
// production_consumptions/custom_order_lines/inventory_count_lines all reference items.id in
// schema.ts too, but no core/ service writes rows into those tables yet — Phase 1+ backlog items
// KOK-012 and later). Re-pointing an FK column that can hold zero rows today would be dead code
// with nothing to test; when those services land, add their re-point statement to the same
// db.batch() below instead of writing a second migration pass over old data.
//
// The source item is deactivated, never hard-deleted (D-8): audit_log keeps full history, and a
// merge mistake is recoverable by reactivating the source and reversing the alias move by hand.

import type { AuditActor, ItemDto, MergeItemsCommand, MergeItemsResult } from "@kokoro/shared";
import { nowIso } from "@kokoro/shared";
import { eq } from "drizzle-orm";

import type { Db } from "../../db/index.js";
import { itemAliases, items } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import { notFound, validationError } from "../errors.js";
import { fetchAliasesForItem, toItemDto } from "./dto.js";

export async function mergeItems(
  db: Db,
  command: MergeItemsCommand,
  actor: AuditActor,
): Promise<MergeItemsResult> {
  if (command.sourceItemId === command.targetItemId) {
    // Defensive: mergeItemsCommandSchema already refines this, but core/ never trusts callers
    // to have validated with Zod first.
    throw validationError("No puedes fusionar un ítem consigo mismo.", { field: "targetItemId" });
  }

  const [sourceRow, targetRow] = await Promise.all([
    db.query.items.findFirst({ where: (t, { eq: eqOp }) => eqOp(t.id, command.sourceItemId) }),
    db.query.items.findFirst({ where: (t, { eq: eqOp }) => eqOp(t.id, command.targetItemId) }),
  ]);
  if (!sourceRow) {
    throw notFound("No se encontró el ítem de origen.", { id: command.sourceItemId });
  }
  if (!targetRow) {
    throw notFound("No se encontró el ítem destino.", { id: command.targetItemId });
  }

  const now = nowIso();
  const mergeNote = `Fusionado con "${targetRow.name}" el ${now}.`;
  const sourcePatch = {
    isActive: 0,
    notes: sourceRow.notes ? `${sourceRow.notes}\n${mergeNote}` : mergeNote,
    updatedAt: now,
  };
  const updatedSourceRow = { ...sourceRow, ...sourcePatch };

  await db.batch([
    db
      .update(itemAliases)
      .set({ itemId: command.targetItemId })
      .where(eq(itemAliases.itemId, command.sourceItemId)),
    db.update(items).set(sourcePatch).where(eq(items.id, command.sourceItemId)),
    buildAuditLogInsert(db, {
      actor,
      action: "merge",
      entityType: "item",
      entityId: command.sourceItemId,
      before: sourceRow,
      after: { mergedInto: command.targetItemId, isActive: false },
    }),
    buildAuditLogInsert(db, {
      actor,
      action: "merge_target",
      entityType: "item",
      entityId: command.targetItemId,
      before: null,
      after: { mergedFrom: command.sourceItemId },
    }),
  ]);

  const [targetAliases, sourceAliases] = await Promise.all([
    fetchAliasesForItem(db, command.targetItemId),
    fetchAliasesForItem(db, command.sourceItemId),
  ]);

  const target: ItemDto = toItemDto(targetRow, targetAliases);
  const source: ItemDto = toItemDto(updatedSourceRow, sourceAliases);
  return { target, source };
}
