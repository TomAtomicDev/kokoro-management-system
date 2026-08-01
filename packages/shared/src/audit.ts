// Read-only DTO for audit_log (Doc 04 §3.5, KOK-067). This is the first audit_log READ contract
// in the codebase — the write path (core/audit.ts's buildAuditLogInsert/AuditEntry) is untouched
// per the guardrail forbidding audit_log write-path edits. No `before`/`after` here: the only
// consumer today is DetailDrawer's "editado N veces" footer, which needs counts and timestamps,
// not the raw before/after JSON blobs core/ services log for their own diagnostic purposes.

import { z } from "zod";

import { auditActorSchema } from "./enums.js";

export const auditLogEntryDtoSchema = z.object({
  id: z.string(),
  at: z.string(),
  actor: auditActorSchema,
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
});
export type AuditLogEntryDto = z.infer<typeof auditLogEntryDtoSchema>;

export interface ListAuditLogResult {
  entries: AuditLogEntryDto[];
}
