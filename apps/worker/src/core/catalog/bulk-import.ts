// core/catalog/bulk-import — onboarding wizard's catalog step (KOK-020, Doc 07 steps 1-5).
// `bulkCreateItems` mirrors `createItem`'s row shape exactly (see items.ts) for every item in the
// command, but ALL validation happens BEFORE any `db.batch()` call: this is the simplest correct
// way to get "one bad item rejects the whole batch" atomicity (D-3) without partial-failure
// gymnastics at the DB level — if any item is invalid, db.batch() is never called at all, so
// nothing is written.

import type { AuditActor, BulkCreateItemsCommand, BulkCreateItemsResult } from "@kokoro/shared";
import { generateUuidV7, nowIso } from "@kokoro/shared";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { items } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import { conflict } from "../errors.js";
import { toItemDto } from "./dto.js";
import { findItemRowByName } from "./items.js";

type Statement = BatchItem<"sqlite">;
type ItemRow = typeof items.$inferSelect;

/** UC-onboarding: create N catalog items in one atomic batch (D-3). Validates every item's name
 * against (a) existing DB rows and (b) the rest of `command.items` BEFORE writing anything — the
 * first offending item throws ONE conflict() and aborts the whole call. */
export async function bulkCreateItems(
  db: Db,
  command: BulkCreateItemsCommand,
  actor: AuditActor,
): Promise<BulkCreateItemsResult> {
  const seenNames = new Set<string>();
  for (const item of command.items) {
    if (seenNames.has(item.name)) {
      throw conflict(`El nombre "${item.name}" aparece más de una vez en el lote.`, {
        field: "name",
        name: item.name,
      });
    }
    seenNames.add(item.name);

    const duplicate = await findItemRowByName(db, item.name);
    if (duplicate) {
      throw conflict(`Ya existe un ítem llamado "${item.name}".`, {
        field: "name",
        name: item.name,
      });
    }
  }

  const now = nowIso();
  const rows: ItemRow[] = command.items.map((item) => ({
    id: generateUuidV7(),
    name: item.name,
    kind: item.kind,
    category: item.category,
    unit: item.unit,
    wac: 0,
    replacementCost: 0,
    replacementCostUpdatedAt: null,
    salePrice: item.salePrice ?? null,
    minStockQty: item.minStockQty ?? null,
    isActive: 1,
    notes: item.notes ?? null,
    createdAt: now,
    updatedAt: now,
  }));

  const statements: Statement[] = [
    ...rows.map((row) => db.insert(items).values(row)),
    // N independent catalog entries, not one linked owner action (contrast
    // core/finance/accounts.ts's setOpeningBalances) — one audit row per item, mirroring
    // createItem's own per-item audit granularity.
    ...rows.map((row) =>
      buildAuditLogInsert(db, {
        actor,
        action: "create",
        entityType: "item",
        entityId: row.id,
        before: null,
        after: row,
      }),
    ),
  ];

  // `statements` always has at least 2 entries (bulkCreateItemsCommandSchema's `.min(1)` on
  // `items` guarantees at least one insert + one audit insert), so it is never empty — same
  // non-empty-tuple cast technique as every other dynamic-length batch in this codebase.
  await db.batch(statements as [Statement, ...Statement[]]);

  return { items: rows.map((row) => toItemDto(row, [])) };
}
