// Integration tests for core/inventory/queries.ts's `listStock`/`listKardex` (KOK-017, Doc 04 §4
// `v_stock`/`v_kardex`, Doc 07 SC-08). Follows the Doc 11 §3 template: seed real state through the
// existing command services (createItem, recordPurchase — the same seams purchasing.test.ts uses),
// then assert what the two read-only views produce, run against real D1 via
// @cloudflare/vitest-pool-workers (test/setup.ts applies migrations/0001_init.sql once per file,
// which is also where v_stock/v_kardex themselves are created).
//
// This file is distinct from test/inventory.test.ts, which covers buildStockMovementStatements /
// buildReplaceMovementsForSourceStatements (the WRITE building block) — this file never touches
// those directly except for constructing one negative-stock fixture (see the "negative stock"
// describe block below), which needs a raw EXIT_OUT movement with no matching event service yet
// (KOK-018 hasn't shipped) to drive a real balance below zero.
//
// Items get unique names per test (items.name is UNIQUE, mirrors purchasing.test.ts) so seeded
// rows never collide across tests in this file; storage is isolated per FILE, not per test, so
// listStock's "no filters" assertions always scope down to just-created itemIds rather than
// asserting on the full table.
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { beforeEach, describe, expect, it } from "vitest";

import { createItem, setItemActive } from "../src/core/catalog/index.js";
import { buildStockMovementStatements } from "../src/core/inventory/index.js";
import {
  getStockConsistencyMismatches,
  getStockValueTotal,
  listKardex,
  listStock,
} from "../src/core/inventory/queries.js";
import { recordPurchase } from "../src/core/purchasing/index.js";
import { createDb } from "../src/db/index.js";
import { financialAccounts, itemStock } from "../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;

type TestDb = ReturnType<typeof createDb>;

async function seedItem(
  db: TestDb,
  name: string,
  overrides: Partial<{
    kind: "RAW_MATERIAL" | "SEMI_FINISHED" | "FINISHED";
    category: "INGREDIENT" | "PACKAGING" | "LABEL" | "BAKERY" | "DAIRY" | "OTHER";
    unit: "G" | "KG" | "ML" | "L" | "UNIT";
    salePrice: number | null;
    minStockQty: number | null;
  }> = {},
) {
  return createItem(
    db,
    {
      name,
      kind: overrides.kind ?? "RAW_MATERIAL",
      category: overrides.category ?? "INGREDIENT",
      unit: overrides.unit ?? "KG",
      salePrice: overrides.salePrice,
      minStockQty: overrides.minStockQty,
    },
    ACTOR,
  );
}

/** Mirrors test/inventory.test.ts's identical helper — see its doc comment for why the cast is
 * needed to satisfy Drizzle's non-empty-tuple `batch()` signature for a dynamic-length array. */
async function execBatch(db: TestDb, statements: BatchItem<"sqlite">[]) {
  if (statements.length === 0) throw new Error("execBatch: empty statement list");
  return db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}

beforeEach(async () => {
  const db = createDb(env.DB);
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("listStock (Doc 04 §4 v_stock, SC-08)", () => {
  it("maps qtyOnHand/wac/stockValue/kind/category/unit/salePrice from a recorded purchase", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Stock mapping item", {
      kind: "RAW_MATERIAL",
      category: "DAIRY",
      unit: "KG",
      salePrice: 500,
    });

    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-16T10:00:00.000Z",
        businessDate: "2026-07-16",
        lines: [{ itemId: item.id, qty: 5000, lineTotal: 10000 }], // unit cost = 2
      },
      ACTOR,
    );

    const { stock } = await listStock(db);
    const row = stock.find((r) => r.itemId === item.id);
    expect(row).toMatchObject({
      itemId: item.id,
      name: "Stock mapping item",
      kind: "RAW_MATERIAL",
      category: "DAIRY",
      unit: "KG",
      wac: 2,
      salePrice: 500,
      minStockQty: null,
      qtyOnHand: 5000,
      negativeSince: null,
      stockValue: 10000, // round(5000 * 2)
      isLowStock: false,
    });
  });

  it("flags isLowStock when qtyOnHand is below minStockQty, and pins it above a normal row", async () => {
    const db = createDb(env.DB);
    const lowItem = await seedItem(db, "Low stock item — zzz sorts last alphabetically", {
      minStockQty: 10000,
    });
    const normalItem = await seedItem(db, "Aaa normal item", {});

    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-16T10:00:00.000Z",
        businessDate: "2026-07-16",
        lines: [
          { itemId: lowItem.id, qty: 2000, lineTotal: 2000 }, // below minStockQty=10000
          { itemId: normalItem.id, qty: 1000, lineTotal: 1000 },
        ],
      },
      ACTOR,
    );

    const { stock } = await listStock(db);
    const lowRow = stock.find((r) => r.itemId === lowItem.id);
    expect(lowRow?.isLowStock).toBe(true);

    const lowIndex = stock.findIndex((r) => r.itemId === lowItem.id);
    const normalIndex = stock.findIndex((r) => r.itemId === normalItem.id);
    // Despite "Low stock item..." sorting AFTER "Aaa normal item" alphabetically, the low-stock
    // flag pins it earlier in the result (SC-08: low-stock/negative rows pinned on top).
    expect(lowIndex).toBeLessThan(normalIndex);

    const { stock: filtered } = await listStock(db, { lowStockOnly: true });
    expect(filtered.every((r) => r.isLowStock)).toBe(true);
    expect(filtered.some((r) => r.itemId === lowItem.id)).toBe(true);
    expect(filtered.some((r) => r.itemId === normalItem.id)).toBe(false);
  });

  it("surfaces negativeSince for a negative balance and pins it above a low-stock row", async () => {
    const db = createDb(env.DB);
    const negativeItem = await seedItem(db, "Negative stock item");
    const lowItem = await seedItem(db, "Comparison low stock item", { minStockQty: 10000 });

    // No event service for stock exits exists yet (KOK-018) — drive the item negative directly
    // via the building block core/inventory itself uses, executed in a manual db.batch() the same
    // way test/inventory.test.ts's negative_since suite does.
    await execBatch(
      db,
      buildStockMovementStatements(db, [
        {
          itemId: negativeItem.id,
          occurredAt: "2026-07-16T10:00:00.000Z",
          businessDate: "2026-07-16",
          type: "EXIT_OUT",
          qty: -1000,
          unitCost: 0,
          sourceEventType: "test_exit",
          sourceEventId: "exit_negative_stock_test",
        },
      ]).statements,
    );
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-16T10:00:00.000Z",
        businessDate: "2026-07-16",
        lines: [{ itemId: lowItem.id, qty: 2000, lineTotal: 2000 }],
      },
      ACTOR,
    );

    const { stock } = await listStock(db);
    const negativeRow = stock.find((r) => r.itemId === negativeItem.id);
    expect(negativeRow?.qtyOnHand).toBe(-1000);
    expect(negativeRow?.negativeSince).not.toBeNull();
    expect(negativeRow?.stockValue).toBe(0); // wac never left 0 (no purchase for this item)

    const negativeIndex = stock.findIndex((r) => r.itemId === negativeItem.id);
    const lowIndex = stock.findIndex((r) => r.itemId === lowItem.id);
    expect(negativeIndex).toBeLessThan(lowIndex);

    const { stock: filtered } = await listStock(db, { negativeOnly: true });
    expect(filtered.every((r) => r.negativeSince !== null)).toBe(true);
    expect(filtered.some((r) => r.itemId === negativeItem.id)).toBe(true);
  });

  it("excludes an inactive item (v_stock's own WHERE is_active = 1)", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Inactive stock item");
    await setItemActive(db, { id: item.id, isActive: false }, ACTOR);

    const { stock } = await listStock(db);
    expect(stock.some((r) => r.itemId === item.id)).toBe(false);
  });

  it("filters by kind", async () => {
    const db = createDb(env.DB);
    const raw = await seedItem(db, "Kind filter raw item", { kind: "RAW_MATERIAL" });
    const finished = await seedItem(db, "Kind filter finished item", { kind: "FINISHED" });

    const { stock } = await listStock(db, { kind: "FINISHED" });
    expect(stock.some((r) => r.itemId === finished.id)).toBe(true);
    expect(stock.some((r) => r.itemId === raw.id)).toBe(false);
  });
});

describe("getStockValueTotal (KOK-023 dashboard aggregate, SUM(stock_value) over v_stock)", () => {
  it("increases by exactly the sum of newly purchased items' stockValue", async () => {
    const db = createDb(env.DB);
    const before = await getStockValueTotal(db);

    const itemA = await seedItem(db, "Stock value total item A");
    const itemB = await seedItem(db, "Stock value total item B");

    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-16T10:00:00.000Z",
        businessDate: "2026-07-16",
        lines: [
          { itemId: itemA.id, qty: 5000, lineTotal: 10000 }, // stockValue 10000
          { itemId: itemB.id, qty: 2000, lineTotal: 6000 }, // stockValue 6000
        ],
      },
      ACTOR,
    );

    const after = await getStockValueTotal(db);
    expect(after - before).toBe(16000);
  });

  it("excludes an inactive item, matching v_stock's own WHERE is_active = 1", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Stock value inactive item");
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-16T10:00:00.000Z",
        businessDate: "2026-07-16",
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 2000 }],
      },
      ACTOR,
    );

    const before = await getStockValueTotal(db);
    await setItemActive(db, { id: item.id, isActive: false }, ACTOR);
    const after = await getStockValueTotal(db);
    expect(before - after).toBe(2000);
  });
});

describe("listKardex (Doc 04 §4 v_kardex, SC-08's row -> drawer interaction)", () => {
  it("returns only the filtered item's movements, newest-first, with correct runningBalance progression", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Kardex item");
    const otherItem = await seedItem(db, "Kardex other item");

    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-14T10:00:00.000Z",
        businessDate: "2026-07-14",
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 1000 }],
      },
      ACTOR,
    );
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-16T10:00:00.000Z",
        businessDate: "2026-07-16",
        lines: [{ itemId: item.id, qty: 2000, lineTotal: 4000 }],
      },
      ACTOR,
    );
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-15T10:00:00.000Z",
        businessDate: "2026-07-15",
        lines: [{ itemId: otherItem.id, qty: 500, lineTotal: 500 }],
      },
      ACTOR,
    );

    const { movements } = await listKardex(db, { itemId: item.id });
    expect(movements).toHaveLength(2);
    expect(movements.every((m) => m.itemId === item.id)).toBe(true);

    // Newest-first: the 07-16 purchase (qty 2000) comes before the 07-14 one (qty 1000).
    expect(movements[0]).toMatchObject({
      businessDate: "2026-07-16",
      qty: 2000,
      runningBalance: 3000, // 1000 + 2000
    });
    expect(movements[1]).toMatchObject({
      businessDate: "2026-07-14",
      qty: 1000,
      runningBalance: 1000,
    });
  });

  it("applies fromDate/toDate/limit", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Kardex date filter item");

    for (const [businessDate, occurredAt] of [
      ["2026-07-10", "2026-07-10T10:00:00.000Z"],
      ["2026-07-12", "2026-07-12T10:00:00.000Z"],
      ["2026-07-14", "2026-07-14T10:00:00.000Z"],
      ["2026-07-16", "2026-07-16T10:00:00.000Z"],
    ] as const) {
      await recordPurchase(
        db,
        {
          accountId: "acc_bank",
          occurredAt,
          businessDate,
          lines: [{ itemId: item.id, qty: 100, lineTotal: 100 }],
        },
        ACTOR,
      );
    }

    const { movements: ranged } = await listKardex(db, {
      itemId: item.id,
      fromDate: "2026-07-12",
      toDate: "2026-07-14",
    });
    expect(ranged.map((m) => m.businessDate).sort()).toEqual(["2026-07-12", "2026-07-14"]);

    const { movements: limited } = await listKardex(db, { itemId: item.id, limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited[0]?.businessDate).toBe("2026-07-16"); // newest-first, so limit=2 keeps the latest two
    expect(limited[1]?.businessDate).toBe("2026-07-14");
  });

  it("rejects a missing itemId with VALIDATION (defensive re-check, D-2-style) instead of silently returning an empty kardex", async () => {
    const db = createDb(env.DB);
    // @ts-expect-error — itemId intentionally omitted to exercise the defensive re-check; the
    // real caller-facing 400 comes from listKardexFiltersSchema.parse() at the route layer
    // (apps/worker/src/api/inventory.ts), which this test does not exercise directly.
    await expect(listKardex(db, {})).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("getStockConsistencyMismatches (INV-5 nightly sentinel, KOK-021)", () => {
  it("reports no mismatch for an item whose item_stock still agrees with its stock_movements ledger", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Consistency happy item");
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-16T10:00:00.000Z",
        businessDate: "2026-07-16",
        lines: [{ itemId: item.id, qty: 3000, lineTotal: 3000 }],
      },
      ACTOR,
    );

    const mismatches = await getStockConsistencyMismatches(db);
    expect(mismatches.some((m) => m.itemId === item.id)).toBe(false);
  });

  it("detects a mismatch when item_stock.qtyOnHand is corrupted independently of the stock_movements ledger", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Consistency corrupted item");
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-16T10:00:00.000Z",
        businessDate: "2026-07-16",
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 1000 }],
      },
      ACTOR,
    );

    // Deliberately corrupt item_stock directly (test-only fixture, mirrors
    // test/costing-repair.test.ts's direct items.wac corruption) so it disagrees with the ledger's
    // true SUM(qty) of 1000 — no core/ command produces this state, it simulates an earlier
    // atomicity bug this sentinel exists to catch.
    await db.update(itemStock).set({ qtyOnHand: 9999 }).where(eq(itemStock.itemId, item.id));

    const mismatches = await getStockConsistencyMismatches(db);
    const row = mismatches.find((m) => m.itemId === item.id);
    expect(row).toMatchObject({ itemId: item.id, expectedQty: 1000, actualQty: 9999 });
  });
});
