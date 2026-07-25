// Integration tests for core/customers (KOK-032), following the Doc 11 §3 template: seed ->
// execute command -> assert row + audit_log entry + atomicity, run against real D1 via
// @cloudflare/vitest-pool-workers (test/setup.ts applies migrations/0001_init.sql first).
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
} from "../src/core/customers/index.js";
import { createDb } from "../src/db/index.js";

const ACTOR = "OWNER_WEB" as const;

describe("createCustomer", () => {
  it("creates the row with phone/notes null when omitted and writes an audit_log entry", async () => {
    const db = createDb(env.DB);
    const customer = await createCustomer(db, { name: "María Quispe" }, ACTOR);

    expect(customer.name).toBe("María Quispe");
    expect(customer.phone).toBeNull();
    expect(customer.notes).toBeNull();

    const row = await db.query.customers.findFirst({ where: (t, { eq }) => eq(t.id, customer.id) });
    expect(row).toMatchObject({ name: "María Quispe" });

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { eq, and }) => and(eq(t.entityId, customer.id), eq(t.action, "create")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "customer" });
  });

  it("allows duplicate names (no CRM/uniqueness ambitions, Doc 04 §3.3 has no UNIQUE on name)", async () => {
    const db = createDb(env.DB);
    await createCustomer(db, { name: "Juan Pérez" }, ACTOR);
    const second = await createCustomer(db, { name: "Juan Pérez" }, ACTOR);
    expect(second.name).toBe("Juan Pérez");
  });
});

describe("updateCustomer", () => {
  it("patches only the provided fields and records before/after in audit_log", async () => {
    const db = createDb(env.DB);
    const created = await createCustomer(db, { name: "Rosa Flores", phone: "70011122" }, ACTOR);

    const updated = await updateCustomer(db, { id: created.id, notes: "Pide sin azúcar" }, ACTOR);

    expect(updated.notes).toBe("Pide sin azúcar");
    expect(updated.phone).toBe("70011122"); // untouched field survives the partial patch
    expect(updated.name).toBe("Rosa Flores");

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { eq, and }) => and(eq(t.entityId, created.id), eq(t.action, "update")),
    });
    expect(JSON.parse(auditRow?.afterJson ?? "null")).toMatchObject({
      notes: "Pide sin azúcar",
    });
  });

  it("throws NOT_FOUND for a missing id", async () => {
    const db = createDb(env.DB);
    await expect(
      updateCustomer(db, { id: "does_not_exist", notes: "x" }, ACTOR),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("getCustomer", () => {
  it("throws NOT_FOUND for a missing id", async () => {
    const db = createDb(env.DB);
    await expect(getCustomer(db, "does_not_exist")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("listCustomers", () => {
  it("matches search on name or phone, case-insensitively via LIKE", async () => {
    const db = createDb(env.DB);
    await createCustomer(db, { name: "Ana Torrez", phone: "77712345" }, ACTOR);
    await createCustomer(db, { name: "Beto Vargas", phone: "60099887" }, ACTOR);

    const byName = await listCustomers(db, { search: "ana" });
    expect(byName.customers.map((c) => c.name)).toEqual(["Ana Torrez"]);

    const byPhone = await listCustomers(db, { search: "600998" });
    expect(byPhone.customers.map((c) => c.name)).toEqual(["Beto Vargas"]);

    const all = await listCustomers(db, {});
    expect(all.customers.length).toBeGreaterThanOrEqual(2);
  });
});
