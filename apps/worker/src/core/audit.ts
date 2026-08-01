// audit_log write + read (Doc 04 §3.5). `buildAuditLogInsert` is the write helper — every core/
// service that creates/updates/deletes a business event calls this to build its audit row, and
// includes the returned query builder in the SAME db.batch() as the event write (Doc 08 D-3: one
// atomic batch per command). This function never executes on its own; it only builds the insert.
// `listAuditLogForEntity` (KOK-067) is the first read over this table — see its own comment below.

import type { AuditActor, AuditLogEntryDto } from "@kokoro/shared";
import { generateUuidV7, nowIso } from "@kokoro/shared";

import type { Db } from "../db/index.js";
import { auditLog } from "../db/schema.js";

export interface AuditEntry {
  actor: AuditActor;
  /** e.g. 'create' | 'update' | 'delete' | 'costing_repair' (Doc 04 §3.5) — free text by design. */
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/** Builds (does not execute) the audit_log insert for `entry`. Include it in the caller's db.batch(). */
export function buildAuditLogInsert(db: Db, entry: AuditEntry) {
  return db.insert(auditLog).values({
    id: generateUuidV7(),
    at: nowIso(),
    actor: entry.actor,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    beforeJson: entry.before === undefined ? null : JSON.stringify(entry.before),
    afterJson: entry.after === undefined ? null : JSON.stringify(entry.after),
  });
}

/**
 * The first audit_log READ query in the codebase (KOK-067) — reusable by every event vertical's
 * `DetailDrawer` footer, not owned by any one `core/<module>`. Ordered oldest-first (`at` ASC) so
 * a caller counting "editado N veces" or finding the original `create` row can just index in.
 * `entityType` must match whatever string that entity's own service passes to
 * `buildAuditLogInsert` (e.g. "purchases", "stock_exits" — see each core/ service's own calls;
 * these are free-text by design, not an enum, so there is nothing here to validate against).
 */
export async function listAuditLogForEntity(
  db: Db,
  entityType: string,
  entityId: string,
): Promise<AuditLogEntryDto[]> {
  const rows = await db.query.auditLog.findMany({
    where: (t, { and, eq }) => and(eq(t.entityType, entityType), eq(t.entityId, entityId)),
    orderBy: (t, { asc }) => asc(t.at),
  });
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    actor: row.actor,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
  }));
}
