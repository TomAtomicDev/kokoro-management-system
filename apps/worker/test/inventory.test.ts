// Integration tests for core/inventory (KOK-012), following the Doc 11 §3 template: seed -> build
// statements -> execute in a db.batch() -> assert stock_movements/item_stock state + atomicity,
// run against real D1 via @cloudflare/vitest-pool-workers (test/setup.ts applies
// migrations/0001_init.sql first).
//
// core/inventory never calls db.batch() itself (it only builds statements — see movements.ts), so
// these tests execute the returned statements the same way a future event service would: by
// pushing them into the test's own db.batch() call.
import { env } from "cloudflare:test";
import type { BatchItem } from "drizzle-orm/batch";
import { describe, expect, it } from "vitest";

import { createItem } from "../src/core/catalog/index.js";
import type { StockMovementInput } from "../src/core/inventory/index.js";
import {
  buildReplaceMovementsForSourceStatements,
  buildStockMovementStatements,
} from "../src/core/inventory/index.js";
import { createDb } from "../src/db/index.js";

const ACTOR = "OWNER_WEB" as const;

type TestDb = ReturnType<typeof createDb>;

async function seedItem(db: TestDb, name: string) {
  return createItem(db, { name, kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "KG" }, ACTOR);
}

/**
 * Executes statements built by core/inventory the way a real caller's db.batch() would: an array
 * literal with at least one explicit element type-checks against Drizzle's non-empty-tuple
 * `batch()` signature, but a bare variable-length array does not (verified against the actual
 * `drizzle-orm/d1` types before writing this module — `DrizzleD1Database.batch` requires
 * `Readonly<[U, ...U[]]>`). This cast is test-only plumbing to execute a dynamic-length
 * statements array directly; real callers won't need it because they always have at least one
 * other explicit statement (their event insert, their audit_log row) in the same literal.
 */
async function execBatch(db: TestDb, statements: BatchItem<"sqlite">[]) {
  if (statements.length === 0) throw new Error("execBatch: empty statement list");
  return db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}

function movement(
  overrides: Partial<StockMovementInput> & Pick<StockMovementInput, "itemId">,
): StockMovementInput {
  return {
    occurredAt: "2026-07-16T10:00:00.000Z",
    businessDate: "2026-07-16",
    type: "ADJUST",
    qty: 1000,
    unitCost: 100,
    sourceEventType: "test_source",
    sourceEventId: "src_1",
    ...overrides,
  };
}

function expectDomainValidationError(fn: () => unknown): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toMatchObject({ code: "VALIDATION" });
}

describe("buildStockMovementStatements — sign convention (Doc 03 §1-2, INV-9)", () => {
  const cases: Array<[StockMovementInput["type"], number, boolean]> = [
    ["PURCHASE_IN", 1000, true],
    ["PURCHASE_IN", -1000, false],
    ["PRODUCTION_IN", 1000, true],
    ["PRODUCTION_IN", -1000, false],
    ["PRODUCTION_OUT", -1000, true],
    ["PRODUCTION_OUT", 1000, false],
    ["SALE_OUT", -1000, true],
    ["SALE_OUT", 1000, false],
    ["EXIT_OUT", -1000, true],
    ["EXIT_OUT", 1000, false],
    ["ADJUST", 1000, true],
    ["ADJUST", -1000, true],
  ];

  it.each(cases)("type=%s qty=%i valid=%s", async (type, qty, valid) => {
    const db = createDb(env.DB);
    const item = await seedItem(db, `Sign test ${type} ${qty}`);
    const build = () =>
      buildStockMovementStatements(db, [movement({ itemId: item.id, type, qty })]);

    if (valid) {
      expect(() => build()).not.toThrow();
    } else {
      expectDomainValidationError(build);
    }
  });

  it("rejects qty=0 for every movement type (zero-variance is a caller bug, never silently dropped)", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Zero qty item");
    const types: StockMovementInput["type"][] = [
      "PURCHASE_IN",
      "PRODUCTION_IN",
      "PRODUCTION_OUT",
      "SALE_OUT",
      "EXIT_OUT",
      "ADJUST",
    ];
    for (const type of types) {
      expectDomainValidationError(() =>
        buildStockMovementStatements(db, [movement({ itemId: item.id, type, qty: 0 })]),
      );
    }
  });
});

describe("buildStockMovementStatements — multi-line netting", () => {
  it("nets several movements across two items into one item_stock upsert per item", async () => {
    const db = createDb(env.DB);
    const itemA = await seedItem(db, "Netting item A");
    const itemB = await seedItem(db, "Netting item B");

    const { statements } = buildStockMovementStatements(db, [
      movement({
        itemId: itemA.id,
        type: "PURCHASE_IN",
        qty: 5000,
        unitCost: 200,
        sourceEventType: "purchase",
        sourceEventId: "p1",
      }),
      movement({
        itemId: itemA.id,
        type: "SALE_OUT",
        qty: -2000,
        unitCost: 200,
        sourceEventType: "sale",
        sourceEventId: "s1",
      }),
      movement({
        itemId: itemB.id,
        type: "PURCHASE_IN",
        qty: 3000,
        unitCost: 150,
        sourceEventType: "purchase",
        sourceEventId: "p1",
      }),
    ]);

    // 3 movement inserts + 2 item_stock upserts (one per distinct item), not 3.
    expect(statements).toHaveLength(5);

    await execBatch(db, statements);

    const stockA = await db.query.itemStock.findFirst({
      where: (t, { eq }) => eq(t.itemId, itemA.id),
    });
    const stockB = await db.query.itemStock.findFirst({
      where: (t, { eq }) => eq(t.itemId, itemB.id),
    });
    expect(stockA?.qtyOnHand).toBe(3000); // 5000 - 2000
    expect(stockB?.qtyOnHand).toBe(3000);

    const movementsA = await db.query.stockMovements.findMany({
      where: (t, { eq }) => eq(t.itemId, itemA.id),
    });
    expect(movementsA).toHaveLength(2);
  });
});

describe("buildStockMovementStatements — negative_since (INV-8)", () => {
  it("sets negative_since exactly on the crossing to <0, holds it while staying negative, clears exactly on the crossing back to >=0", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Negative since item");

    // Start at 0. First movement: -1000 (crosses 0 -> -1000): negative_since must be set.
    await execBatch(
      db,
      buildStockMovementStatements(db, [
        movement({ itemId: item.id, type: "EXIT_OUT", qty: -1000, sourceEventId: "exit_1" }),
      ]).statements,
    );
    const afterFirst = await db.query.itemStock.findFirst({
      where: (t, { eq }) => eq(t.itemId, item.id),
    });
    expect(afterFirst?.qtyOnHand).toBe(-1000);
    expect(afterFirst?.negativeSince).not.toBeNull();
    const firstFlagTime = afterFirst?.negativeSince;

    // Second movement: another exit, stays negative (-1000 -> -2000): negative_since must NOT change.
    await execBatch(
      db,
      buildStockMovementStatements(db, [
        movement({ itemId: item.id, type: "EXIT_OUT", qty: -1000, sourceEventId: "exit_2" }),
      ]).statements,
    );
    const afterSecond = await db.query.itemStock.findFirst({
      where: (t, { eq }) => eq(t.itemId, item.id),
    });
    expect(afterSecond?.qtyOnHand).toBe(-2000);
    expect(afterSecond?.negativeSince).toBe(firstFlagTime);

    // Third movement: a big purchase crossing back to >=0 (-2000 -> 3000): negative_since clears.
    await execBatch(
      db,
      buildStockMovementStatements(db, [
        movement({ itemId: item.id, type: "PURCHASE_IN", qty: 5000, sourceEventId: "purchase_1" }),
      ]).statements,
    );
    const afterThird = await db.query.itemStock.findFirst({
      where: (t, { eq }) => eq(t.itemId, item.id),
    });
    expect(afterThird?.qtyOnHand).toBe(3000);
    expect(afterThird?.negativeSince).toBeNull();

    // Fourth movement: stays non-negative (3000 -> 1000): negative_since stays NULL (no-op clear).
    await execBatch(
      db,
      buildStockMovementStatements(db, [
        movement({ itemId: item.id, type: "SALE_OUT", qty: -2000, sourceEventId: "sale_1" }),
      ]).statements,
    );
    const afterFourth = await db.query.itemStock.findFirst({
      where: (t, { eq }) => eq(t.itemId, item.id),
    });
    expect(afterFourth?.qtyOnHand).toBe(1000);
    expect(afterFourth?.negativeSince).toBeNull();
  });
});

describe("buildStockMovementStatements — total_cost (Doc 04 §3.4)", () => {
  it("computes total_cost = round_half_up(qty * unit_cost), including a case requiring rounding", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Rounding item");

    // qty=1500 milli-units, unit_cost=3.333 centavos/milli-unit -> 1500*3.333 = 4999.5 -> rounds to 5000.
    const { statements } = buildStockMovementStatements(db, [
      movement({ itemId: item.id, type: "PURCHASE_IN", qty: 1500, unitCost: 3.333 }),
    ]);
    await execBatch(db, statements);

    const row = await db.query.stockMovements.findFirst({
      where: (t, { eq }) => eq(t.itemId, item.id),
    });
    expect(row?.totalCost).toBe(5000);

    // Exact (no rounding needed): qty=-2000 (SALE_OUT), unit_cost=2.5 -> -5000 exactly.
    const item2 = await seedItem(db, "Exact cost item");
    // Give it stock first so the exit doesn't need a purchase to exist first (INV-8 allows negative anyway).
    await execBatch(
      db,
      buildStockMovementStatements(db, [
        movement({
          itemId: item2.id,
          type: "SALE_OUT",
          qty: -2000,
          unitCost: 2.5,
          sourceEventId: "sale_exact",
        }),
      ]).statements,
    );
    const row2 = await db.query.stockMovements.findFirst({
      where: (t, { eq }) => eq(t.itemId, item2.id),
    });
    expect(row2?.totalCost).toBe(-5000);
  });

  it("rejects a negative unit_cost", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Negative cost item");
    expectDomainValidationError(() =>
      buildStockMovementStatements(db, [
        movement({ itemId: item.id, type: "PURCHASE_IN", qty: 1000, unitCost: -1 }),
      ]),
    );
  });
});

describe("buildReplaceMovementsForSourceStatements — idempotent regeneration (R-1, INV-9, INV-10)", () => {
  it("replacing with the same movements twice leaves item_stock and the movement set unchanged both times", async () => {
    const db = createDb(env.DB);
    const itemA = await seedItem(db, "Replace item A");
    const itemB = await seedItem(db, "Replace item B");

    const buildMovements = (): StockMovementInput[] => [
      movement({
        itemId: itemA.id,
        type: "PURCHASE_IN",
        qty: 4000,
        unitCost: 100,
        sourceEventType: "purchase",
        sourceEventId: "purchase_replace_1",
      }),
      movement({
        itemId: itemB.id,
        type: "PURCHASE_IN",
        qty: 1000,
        unitCost: 50,
        sourceEventType: "purchase",
        sourceEventId: "purchase_replace_1",
      }),
    ];

    const first = await buildReplaceMovementsForSourceStatements(
      db,
      "purchase",
      "purchase_replace_1",
      buildMovements(),
    );
    await execBatch(db, first.statements);

    const stockAAfterFirst = await db.query.itemStock.findFirst({
      where: (t, { eq }) => eq(t.itemId, itemA.id),
    });
    const stockBAfterFirst = await db.query.itemStock.findFirst({
      where: (t, { eq }) => eq(t.itemId, itemB.id),
    });
    const movementsAfterFirst = await db.query.stockMovements.findMany({
      where: (t, { and, eq }) =>
        and(eq(t.sourceEventType, "purchase"), eq(t.sourceEventId, "purchase_replace_1")),
    });
    expect(stockAAfterFirst?.qtyOnHand).toBe(4000);
    expect(stockBAfterFirst?.qtyOnHand).toBe(1000);
    expect(movementsAfterFirst).toHaveLength(2);

    // Call again with the SAME movements: must reach the exact same final state.
    const second = await buildReplaceMovementsForSourceStatements(
      db,
      "purchase",
      "purchase_replace_1",
      buildMovements(),
    );
    await execBatch(db, second.statements);

    const stockAAfterSecond = await db.query.itemStock.findFirst({
      where: (t, { eq }) => eq(t.itemId, itemA.id),
    });
    const stockBAfterSecond = await db.query.itemStock.findFirst({
      where: (t, { eq }) => eq(t.itemId, itemB.id),
    });
    const movementsAfterSecond = await db.query.stockMovements.findMany({
      where: (t, { and, eq }) =>
        and(eq(t.sourceEventType, "purchase"), eq(t.sourceEventId, "purchase_replace_1")),
    });
    expect(stockAAfterSecond?.qtyOnHand).toBe(4000);
    expect(stockBAfterSecond?.qtyOnHand).toBe(1000);
    expect(movementsAfterSecond).toHaveLength(2);
  });

  it("fully reverses an item's stock effect when it is present in the old set but absent from the new one", async () => {
    const db = createDb(env.DB);
    const itemKept = await seedItem(db, "Replace kept item");
    const itemDropped = await seedItem(db, "Replace dropped item");

    const original = await buildReplaceMovementsForSourceStatements(
      db,
      "purchase",
      "purchase_drop_1",
      [
        movement({
          itemId: itemKept.id,
          type: "PURCHASE_IN",
          qty: 2000,
          sourceEventType: "purchase",
          sourceEventId: "purchase_drop_1",
        }),
        movement({
          itemId: itemDropped.id,
          type: "PURCHASE_IN",
          qty: 6000,
          sourceEventType: "purchase",
          sourceEventId: "purchase_drop_1",
        }),
      ],
    );
    await execBatch(db, original.statements);

    const droppedBefore = await db.query.itemStock.findFirst({
      where: (t, { eq }) => eq(t.itemId, itemDropped.id),
    });
    expect(droppedBefore?.qtyOnHand).toBe(6000);

    // Edited purchase: line for itemDropped removed entirely, itemKept's qty corrected to 5000.
    const edited = await buildReplaceMovementsForSourceStatements(
      db,
      "purchase",
      "purchase_drop_1",
      [
        movement({
          itemId: itemKept.id,
          type: "PURCHASE_IN",
          qty: 5000,
          sourceEventType: "purchase",
          sourceEventId: "purchase_drop_1",
        }),
      ],
    );
    await execBatch(db, edited.statements);

    const keptAfter = await db.query.itemStock.findFirst({
      where: (t, { eq }) => eq(t.itemId, itemKept.id),
    });
    const droppedAfter = await db.query.itemStock.findFirst({
      where: (t, { eq }) => eq(t.itemId, itemDropped.id),
    });
    expect(keptAfter?.qtyOnHand).toBe(5000);
    expect(droppedAfter?.qtyOnHand).toBe(0); // fully reversed, not left at 6000 or double-counted

    const remainingMovements = await db.query.stockMovements.findMany({
      where: (t, { and, eq }) =>
        and(eq(t.sourceEventType, "purchase"), eq(t.sourceEventId, "purchase_drop_1")),
    });
    expect(remainingMovements).toHaveLength(1);
    expect(remainingMovements[0]?.itemId).toBe(itemKept.id);
  });

  it("with newMovements=[] fully reverses every item touched by the source (event deletion)", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Replace to empty item");

    const original = await buildReplaceMovementsForSourceStatements(
      db,
      "purchase",
      "purchase_delete_1",
      [
        movement({
          itemId: item.id,
          type: "PURCHASE_IN",
          qty: 7000,
          sourceEventType: "purchase",
          sourceEventId: "purchase_delete_1",
        }),
      ],
    );
    await execBatch(db, original.statements);

    const deleted = await buildReplaceMovementsForSourceStatements(
      db,
      "purchase",
      "purchase_delete_1",
      [],
    );
    await execBatch(db, deleted.statements);

    const stockAfter = await db.query.itemStock.findFirst({
      where: (t, { eq }) => eq(t.itemId, item.id),
    });
    expect(stockAfter?.qtyOnHand).toBe(0);

    const remaining = await db.query.stockMovements.findMany({
      where: (t, { and, eq }) =>
        and(eq(t.sourceEventType, "purchase"), eq(t.sourceEventId, "purchase_delete_1")),
    });
    expect(remaining).toHaveLength(0);
  });
});

describe("atomicity (INV-1)", () => {
  it("a movement referencing a non-existent item_id rolls back the whole batch, including item_stock for the other line", async () => {
    const db = createDb(env.DB);
    const validItem = await seedItem(db, "Atomicity valid item");

    const { statements } = buildStockMovementStatements(db, [
      movement({ itemId: validItem.id, type: "PURCHASE_IN", qty: 1000, sourceEventId: "atomic_1" }),
      movement({
        itemId: "item_does_not_exist",
        type: "PURCHASE_IN",
        qty: 1000,
        sourceEventId: "atomic_1",
      }),
    ]);

    await expect(execBatch(db, statements)).rejects.toThrow();

    const validItemStock = await db.query.itemStock.findFirst({
      where: (t, { eq }) => eq(t.itemId, validItem.id),
    });
    expect(validItemStock).toBeUndefined();

    const movementsForValidItem = await db.query.stockMovements.findMany({
      where: (t, { eq }) => eq(t.itemId, validItem.id),
    });
    expect(movementsForValidItem).toHaveLength(0);
  });
});
