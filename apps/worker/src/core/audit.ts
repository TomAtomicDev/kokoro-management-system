// audit_log write helper (Doc 04 §3.5) — every core/ service that creates/updates/deletes a
// business event calls this to build its audit row, and includes the returned query builder in
// the SAME db.batch() as the event write (Doc 08 D-3: one atomic batch per command). This
// function never executes on its own; it only builds the insert.

import type { AuditActor } from "@kokoro/shared";
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
