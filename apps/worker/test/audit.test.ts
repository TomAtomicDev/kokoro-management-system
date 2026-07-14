// buildAuditLogInsert only builds a query; this proves it actually writes the row it promises
// when included in a real db.batch(), and that it's genuinely batchable alongside another write
// (Doc 08 D-3 — the pattern every Phase 1+ service copies).
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { buildAuditLogInsert } from "../src/core/audit.js";
import { createDb, schema } from "../src/db/index.js";

describe("buildAuditLogInsert", () => {
  it("writes actor/action/entity/before/after in the same batch as another statement", async () => {
    const db = createDb(env.DB);

    await db.batch([
      db.insert(schema.customers).values({
        id: "cust_audit_test",
        name: "Cliente de prueba",
        createdAt: "2026-07-14T10:00:00.000Z",
        updatedAt: "2026-07-14T10:00:00.000Z",
      }),
      buildAuditLogInsert(db, {
        actor: "OWNER_WEB",
        action: "create",
        entityType: "customer",
        entityId: "cust_audit_test",
        before: null,
        after: { name: "Cliente de prueba" },
      }),
    ]);

    const row = await db.query.auditLog.findFirst({
      where: (t, { eq }) => eq(t.entityId, "cust_audit_test"),
    });

    expect(row).toMatchObject({
      actor: "OWNER_WEB",
      action: "create",
      entityType: "customer",
      entityId: "cust_audit_test",
      beforeJson: "null",
    });
    expect(JSON.parse(row?.afterJson ?? "null")).toEqual({ name: "Cliente de prueba" });
  });
});
