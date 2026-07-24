// buildAuditLogInsert only builds a query; this proves it actually writes the row it promises
// when included in a real db.batch(), and that it's genuinely batchable alongside another write
// (Doc 08 D-3 — the pattern every Phase 1+ service copies).
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { buildAuditLogInsert, listAuditLogForEntity } from "../src/core/audit.js";
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

describe("listAuditLogForEntity", () => {
  it("returns only rows for the given entityType/entityId, oldest-first, without before/after", async () => {
    const db = createDb(env.DB);
    const entityId = "cust_audit_list_test";
    const otherId = "cust_audit_list_other";

    await db.batch([
      db.insert(schema.customers).values({
        id: entityId,
        name: "Cliente A",
        createdAt: "2026-07-14T10:00:00.000Z",
        updatedAt: "2026-07-14T10:00:00.000Z",
      }),
      db.insert(schema.customers).values({
        id: otherId,
        name: "Cliente B",
        createdAt: "2026-07-14T10:00:00.000Z",
        updatedAt: "2026-07-14T10:00:00.000Z",
      }),
      buildAuditLogInsert(db, {
        actor: "OWNER_WEB",
        action: "create",
        entityType: "customer",
        entityId,
      }),
      buildAuditLogInsert(db, {
        actor: "OWNER_WEB",
        action: "update",
        entityType: "customer",
        entityId,
      }),
      // A different entity's row must never leak into `entityId`'s result.
      buildAuditLogInsert(db, {
        actor: "OWNER_WEB",
        action: "create",
        entityType: "customer",
        entityId: otherId,
      }),
    ]);

    const entries = await listAuditLogForEntity(db, "customer", entityId);

    expect(entries.map((e) => e.action)).toEqual(["create", "update"]);
    expect(entries.every((e) => e.entityId === entityId)).toBe(true);
    // The DTO is deliberately narrower than the raw row — no before/after JSON leaks through.
    expect(Object.keys(entries[0] ?? {}).sort()).toEqual(
      ["action", "actor", "at", "entityId", "entityType", "id"].sort(),
    );
  });

  it("returns an empty array for an entity with no audit rows", async () => {
    const db = createDb(env.DB);
    const entries = await listAuditLogForEntity(db, "customer", "nonexistent");
    expect(entries).toEqual([]);
  });
});
