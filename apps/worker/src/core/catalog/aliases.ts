// Item alias CRUD (KOK-011, Doc 04 §3.1 — "NL matching for the assistant"). item_aliases.alias
// is COLLATE NOCASE at the DDL level, so equality lookups below are case-insensitive without any
// manual lower()-ing.

import type {
  AddItemAliasCommand,
  AuditActor,
  ItemAliasDto,
  RemoveItemAliasCommand,
} from "@kokoro/shared";
import { generateUuidV7 } from "@kokoro/shared";
import { eq } from "drizzle-orm";

import type { Db } from "../../db/index.js";
import { itemAliases } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import { conflict, notFound } from "../errors.js";
import { toAliasDto } from "./dto.js";

export async function addItemAlias(
  db: Db,
  command: AddItemAliasCommand,
  actor: AuditActor,
): Promise<ItemAliasDto> {
  const item = await db.query.items.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, command.itemId),
  });
  if (!item) {
    throw notFound("No se encontró el ítem.", { id: command.itemId });
  }

  const existingAlias = await db.query.itemAliases.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.alias, command.alias),
  });
  if (existingAlias) {
    throw conflict(`El alias "${command.alias}" ya está en uso.`, { field: "alias" });
  }

  const row = { id: generateUuidV7(), itemId: command.itemId, alias: command.alias };

  await db.batch([
    db.insert(itemAliases).values(row),
    buildAuditLogInsert(db, {
      actor,
      action: "add_alias",
      entityType: "item_alias",
      entityId: row.id,
      before: null,
      after: row,
    }),
  ]);

  return toAliasDto(row);
}

export async function removeItemAlias(
  db: Db,
  command: RemoveItemAliasCommand,
  actor: AuditActor,
): Promise<void> {
  const existingAlias = await db.query.itemAliases.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, command.aliasId),
  });
  if (!existingAlias) {
    throw notFound("No se encontró el alias.", { id: command.aliasId });
  }

  await db.batch([
    db.delete(itemAliases).where(eq(itemAliases.id, command.aliasId)),
    buildAuditLogInsert(db, {
      actor,
      action: "remove_alias",
      entityType: "item_alias",
      entityId: command.aliasId,
      before: existingAlias,
      after: null,
    }),
  ]);
}
