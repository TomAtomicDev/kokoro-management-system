// Integration tests for core/catalog (KOK-011), following the Doc 11 §3 template: seed -> execute
// command -> assert event rows + audit_log entries + atomicity, run against real D1 via
// @cloudflare/vitest-pool-workers (test/setup.ts applies migrations/0001_init.sql first).
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  addItemAlias,
  createItem,
  getItem,
  listItems,
  mergeItems,
  removeItemAlias,
  setItemActive,
  updateItem,
} from "../src/core/catalog/index.js";
import { createDb } from "../src/db/index.js";

const ACTOR = "OWNER_WEB" as const;

describe("createItem", () => {
  it("creates the row with wac/replacementCost defaulted to 0 and writes an audit_log entry", async () => {
    const db = createDb(env.DB);
    const item = await createItem(
      db,
      { name: "Harina 000", kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "KG" },
      ACTOR,
    );

    expect(item.name).toBe("Harina 000");
    expect(item.wac).toBe(0);
    expect(item.replacementCost).toBe(0);
    expect(item.isActive).toBe(true);
    expect(item.aliases).toEqual([]);

    const row = await db.query.items.findFirst({ where: (t, { eq }) => eq(t.id, item.id) });
    expect(row).toMatchObject({ name: "Harina 000", kind: "RAW_MATERIAL", isActive: 1 });

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { eq, and }) => and(eq(t.entityId, item.id), eq(t.action, "create")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "item" });
  });

  it("rejects a duplicate name with CONFLICT", async () => {
    const db = createDb(env.DB);
    await createItem(
      db,
      { name: "Azúcar blanca", kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "KG" },
      ACTOR,
    );

    await expect(
      createItem(
        db,
        { name: "Azúcar blanca", kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "KG" },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("updateItem", () => {
  it("patches only the provided fields and records before/after in audit_log", async () => {
    const db = createDb(env.DB);
    const created = await createItem(
      db,
      {
        name: "Mantequilla",
        kind: "RAW_MATERIAL",
        category: "DAIRY",
        unit: "KG",
        minStockQty: 1000,
      },
      ACTOR,
    );

    const updated = await updateItem(db, { id: created.id, notes: "Comprar en Hipermaxi" }, ACTOR);

    expect(updated.notes).toBe("Comprar en Hipermaxi");
    expect(updated.minStockQty).toBe(1000); // untouched field survives the partial patch
    expect(updated.name).toBe("Mantequilla");

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { eq, and }) => and(eq(t.entityId, created.id), eq(t.action, "update")),
    });
    expect(JSON.parse(auditRow?.afterJson ?? "null")).toMatchObject({
      notes: "Comprar en Hipermaxi",
    });
  });

  it("throws NOT_FOUND for a missing id", async () => {
    const db = createDb(env.DB);
    await expect(updateItem(db, { id: "does_not_exist", notes: "x" }, ACTOR)).rejects.toMatchObject(
      {
        code: "NOT_FOUND",
      },
    );
  });
});

describe("setItemActive", () => {
  it("toggles isActive and logs activate/deactivate", async () => {
    const db = createDb(env.DB);
    const created = await createItem(
      db,
      { name: "Levadura fresca", kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "G" },
      ACTOR,
    );

    const deactivated = await setItemActive(db, { id: created.id, isActive: false }, ACTOR);
    expect(deactivated.isActive).toBe(false);

    const reactivated = await setItemActive(db, { id: created.id, isActive: true }, ACTOR);
    expect(reactivated.isActive).toBe(true);

    const auditRows = await db.query.auditLog.findMany({
      where: (t, { eq }) => eq(t.entityId, created.id),
    });
    expect(auditRows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["create", "deactivate", "activate"]),
    );
  });
});

describe("item aliases", () => {
  it("adds and removes an alias, rejecting a case-insensitive duplicate", async () => {
    const db = createDb(env.DB);
    const item = await createItem(
      db,
      { name: "Chocolate cobertura", kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "KG" },
      ACTOR,
    );

    const alias = await addItemAlias(db, { itemId: item.id, alias: "Choco" }, ACTOR);
    expect(alias.alias).toBe("Choco");

    await expect(
      addItemAlias(db, { itemId: item.id, alias: "choco" }, ACTOR), // COLLATE NOCASE
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const withAlias = await getItem(db, item.id);
    expect(withAlias.aliases).toEqual([{ id: alias.id, alias: "Choco" }]);

    await removeItemAlias(db, { aliasId: alias.id }, ACTOR);
    const withoutAlias = await getItem(db, item.id);
    expect(withoutAlias.aliases).toEqual([]);

    await expect(removeItemAlias(db, { aliasId: alias.id }, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("listItems", () => {
  it("filters by kind, category, isActive and matches on name or alias", async () => {
    const db = createDb(env.DB);
    const flour = await createItem(
      db,
      { name: "Harina integral", kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "KG" },
      ACTOR,
    );
    await addItemAlias(db, { itemId: flour.id, alias: "wholemeal" }, ACTOR);
    const box = await createItem(
      db,
      { name: "Caja de cartón", kind: "RAW_MATERIAL", category: "PACKAGING", unit: "UNIT" },
      ACTOR,
    );
    await setItemActive(db, { id: box.id, isActive: false }, ACTOR);

    const byCategory = await listItems(db, { category: "PACKAGING" });
    expect(byCategory.items.map((i) => i.id)).toEqual([box.id]);

    const onlyActive = await listItems(db, { isActive: true });
    expect(onlyActive.items.map((i) => i.id)).not.toContain(box.id);

    const onlyInactive = await listItems(db, { isActive: false });
    expect(onlyInactive.items.map((i) => i.id)).toEqual([box.id]);

    const byAliasSearch = await listItems(db, { search: "wholemeal" });
    expect(byAliasSearch.items.map((i) => i.id)).toEqual([flour.id]);

    const byNameSearch = await listItems(db, { search: "Harina" });
    expect(byNameSearch.items.map((i) => i.id)).toContain(flour.id);
  });
});

describe("mergeItems", () => {
  it("re-points aliases to the target, deactivates the source, and leaves no orphan aliases", async () => {
    const db = createDb(env.DB);
    const canonical = await createItem(
      db,
      { name: "Huevo", kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "UNIT" },
      ACTOR,
    );
    const duplicate = await createItem(
      db,
      { name: "Huevos", kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "UNIT" },
      ACTOR,
    );
    const dupAlias = await addItemAlias(db, { itemId: duplicate.id, alias: "eggs" }, ACTOR);

    const result = await mergeItems(
      db,
      { sourceItemId: duplicate.id, targetItemId: canonical.id },
      ACTOR,
    );

    expect(result.source.isActive).toBe(false);
    expect(result.target.aliases.map((a) => a.id)).toContain(dupAlias.id);
    expect(result.source.aliases).toEqual([]);

    // No orphans (INV-9): the alias row itself must now point at the target, not floating free.
    const aliasRow = await db.query.itemAliases.findFirst({
      where: (t, { eq }) => eq(t.id, dupAlias.id),
    });
    expect(aliasRow?.itemId).toBe(canonical.id);

    const auditRows = await db.query.auditLog.findMany({
      where: (t, { eq }) => eq(t.action, "merge"),
    });
    expect(auditRows.some((r) => r.entityId === duplicate.id)).toBe(true);
  });

  it("rejects merging an item into itself with VALIDATION", async () => {
    const db = createDb(env.DB);
    const item = await createItem(
      db,
      { name: "Sal", kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "KG" },
      ACTOR,
    );
    await expect(
      mergeItems(db, { sourceItemId: item.id, targetItemId: item.id }, ACTOR),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("throws NOT_FOUND when either item is missing", async () => {
    const db = createDb(env.DB);
    const item = await createItem(
      db,
      { name: "Vainilla", kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "ML" },
      ACTOR,
    );
    await expect(
      mergeItems(db, { sourceItemId: "missing", targetItemId: item.id }, ACTOR),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("batch atomicity (INV-1)", () => {
  it("a failing statement in the same batch leaves nothing persisted", async () => {
    const id = "item_atomicity_test";
    const now = "2026-07-16T10:00:00.000Z";

    await expect(
      env.DB.batch([
        env.DB.prepare(
          `INSERT INTO items (id, name, kind, category, unit, created_at, updated_at)
           VALUES (?, 'Atomicity test', 'RAW_MATERIAL', 'INGREDIENT', 'KG', ?, ?)`,
        ).bind(id, now, now),
        // This statement violates the items_kind_check CHECK constraint, so the whole batch
        // (including the otherwise-valid insert above) must roll back together.
        env.DB.prepare("UPDATE items SET kind = 'NOT_A_KIND' WHERE id = ?").bind(id),
      ]),
    ).rejects.toThrow();

    const row = await env.DB.prepare("SELECT id FROM items WHERE id = ?").bind(id).first();
    expect(row).toBeNull();
  });

  it("the same guarantee holds for an item insert paired with a rejected audit_log insert", async () => {
    // Mirrors the exact statement pair createItem() builds (item insert + audit_log insert), but
    // with the audit insert violating audit_log's actor CHECK constraint, to prove the item
    // insert ahead of it never lands either — the real D1 batch, not a mock.
    await expect(
      env.DB.batch([
        env.DB.prepare(
          `INSERT INTO items (id, name, kind, category, unit, created_at, updated_at)
           VALUES ('item_batch_reject', 'Batch reject test', 'RAW_MATERIAL', 'INGREDIENT', 'KG', ?, ?)`,
        ).bind("2026-07-16T10:00:00.000Z", "2026-07-16T10:00:00.000Z"),
        env.DB.prepare(
          `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id)
           VALUES ('audit_batch_reject', ?, 'NOT_A_REAL_ACTOR', 'create', 'item', 'item_batch_reject')`,
        ).bind("2026-07-16T10:00:00.000Z"),
      ]),
    ).rejects.toThrow();

    const row = await env.DB.prepare("SELECT id FROM items WHERE id = ?")
      .bind("item_batch_reject")
      .first();
    expect(row).toBeNull();
  });
});
