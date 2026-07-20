// Integration tests for core/inventory/exits.ts / waste.ts (KOK-018, Doc 03 §3 UC-09, Doc 04 §3.3
// `stock_exits` / §4 `v_waste`). Follows the Doc 11 §3 template: seed via createItem/recordPurchase
// (the same seams purchasing.test.ts and inventory-queries.test.ts use) -> execute recordExit ->
// assert the stock_exits row + kardex movement + item_stock + audit_log, run against real D1 via
// @cloudflare/vitest-pool-workers.
//
// The single most important assertion in this file (C-6, "the invisible cost", Doc 03 §3): an
// exit is valued at the item's CURRENT WAC but NEVER mutates that WAC and NEVER creates a
// financial_transactions row. Both are asserted explicitly below so a future "helpful" change that
// adds either back is caught immediately.
//
// Storage is isolated per test FILE, not per test (mirrors purchasing.test.ts's identical note) —
// the `beforeEach` below clears stock_exits/its movements/audit rows and resets both seeded
// accounts to balance 0. Items get unique names per test (items.name is UNIQUE) so seeded rows
// never collide across tests.
import { env } from "cloudflare:test";
import type { StockExitReason } from "@kokoro/shared";
import { generateUuidV7 } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";

import { createItem } from "../src/core/catalog/index.js";
import { recomputeWacFromMovements } from "../src/core/costing/wac.js";
import {
  deleteStockExit,
  getStockExit,
  listStockExits,
  previewStockExitImpact,
  recordExit,
  restoreStockExit,
  updateStockExit,
} from "../src/core/inventory/exits.js";
import { listWasteSummary } from "../src/core/inventory/waste.js";
import { recordPurchase } from "../src/core/purchasing/index.js";
import { createDb } from "../src/db/index.js";
import {
  auditLog,
  financialAccounts,
  financialTransactions,
  stockExits,
  stockMovements,
} from "../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;
const NOW = "2026-07-16T10:00:00.000Z";
const BUSINESS_DATE = "2026-07-16";

type TestDb = ReturnType<typeof createDb>;

async function seedItem(db: TestDb, name: string) {
  return createItem(db, { name, kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "KG" }, ACTOR);
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(auditLog).where(eq(auditLog.entityType, "stock_exits"));
  await db.delete(stockMovements).where(eq(stockMovements.sourceEventType, "stock_exit"));
  await db
    .delete(financialTransactions)
    .where(eq(financialTransactions.sourceEventType, "purchase"));
  await db.delete(stockExits);
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("recordExit (UC-09)", () => {
  it("records an exit valued at current WAC: stock_exits row, EXIT_OUT movement, item_stock decrement, WAC UNCHANGED, ZERO financial_transactions, audit_log", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Exit — WAC threading item");

    // Two purchases at different unit costs so WAC ends at a NON-trivial value (2), making the
    // "WAC unchanged by the exit" assertion below actually discriminating (a bug that silently
    // re-derives WAC from qty/cost some other way would very likely land on a different number).
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 1000 }], // unit cost 1
      },
      ACTOR,
    );
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 3000 }], // unit cost 3
      },
      ACTOR,
    );
    // wac = (1000*1 + 1000*3) / 2000 = 2.
    const itemAfterPurchases = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemAfterPurchases?.wac).toBe(2);

    const result = await recordExit(
      db,
      {
        itemId: item.id,
        qty: 500,
        reason: "WASTE",
        notes: "Se cayó al piso",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
      },
      ACTOR,
    );

    expect(result.exit).toMatchObject({
      itemId: item.id,
      qty: 500,
      reason: "WASTE",
      unitCostSnapshot: 2,
      sessionId: null,
      notes: "Se cayó al piso",
    });

    const exitRow = await db.query.stockExits.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, result.exit.id),
    });
    expect(exitRow).toMatchObject({ qty: 500, reason: "WASTE", unitCostSnapshot: 2 });

    const movementRow = await db.query.stockMovements.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, result.exit.id),
    });
    expect(movementRow).toMatchObject({
      type: "EXIT_OUT",
      qty: -500,
      unitCost: 2,
      totalCost: -1000,
      sourceEventType: "stock_exit",
    });

    const stockRow = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockRow?.qtyOnHand).toBe(1500); // 2000 - 500

    // C-6: the exit must NOT have changed items.wac, even though it removed stock.
    const itemAfterExit = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemAfterExit?.wac).toBe(2);

    // C-6 "invisible cost": no financial_transactions row was created for this exit.
    const exitTxRows = await db.query.financialTransactions.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventType, "stock_exit"),
    });
    expect(exitTxRows).toHaveLength(0);

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, result.exit.id), eqOp(t.action, "create")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "stock_exits" });
  });

  it.each([
    ["WASTE" as const],
    ["SELF_CONSUMPTION" as const],
    ["GIFT_SAMPLE" as const],
    ["SPOILAGE" as const],
    ["OTHER" as const],
  ])("accepts reason=%s", async (reason) => {
    const db = createDb(env.DB);
    const item = await seedItem(db, `Exit reason item ${reason}`);
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 1000 }],
      },
      ACTOR,
    );

    const result = await recordExit(
      db,
      { itemId: item.id, qty: 100, reason, occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );
    expect(result.exit.reason).toBe(reason);
  });

  it("rejects a nonexistent item with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    await expect(
      recordExit(
        db,
        {
          itemId: "item_does_not_exist",
          qty: 100,
          reason: "WASTE",
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects qty<=0 with VALIDATION (defensive re-check, D-2)", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Exit qty<=0 item");

    await expect(
      recordExit(
        db,
        {
          // qty: 0 is intentionally invalid to exercise the defensive re-check (Zod's own type is
          // just `number`, so no @ts-expect-error is needed here — the real caller-facing 400
          // comes from recordStockExitCommandSchema.parse()'s `.positive()` at the route layer).
          itemId: item.id,
          qty: 0,
          reason: "WASTE",
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

// KOK-024 D2. ADR-016 §1 applies the replay to ANY movement-affecting create that lands behind an
// already-processed movement, exits included. An exit books no WAC of its own (C-6) — but it does
// change `on_hand` at the point it lands, and `on_hand` is the WEIGHT in C-1's
// `(max(on_hand,0)·wac + q·c) / (max(on_hand,0) + q)`, so every entry recorded after a backdated
// exit re-averages differently. That downstream movement is what the guard is for.
describe("recordExit — backdated capture: INV-11 replay guard (R-2/R-5, ADR-016)", () => {
  /**
   * Recorded: P1 10 000 @ 2 (07-10) -> exit A 8 000 (07-11, freezes 2) -> P2 10 000 @ 4 (07-12),
   * leaving onHand 12 000, wac 44 000/12 000 = 3.6667.
   *
   * A second exit of 8 000 is now backdated to 07-10T12:00, i.e. BEFORE exit A:
   *   prefix [P1]  -> onHand 10 000, wac 2
   *   new exit     -> onHand  2 000, wac 2 (C-6: an exit never moves the WAC)
   *   exit A       -> onHand −6 000, wac 2
   *   P2           -> wac (max(−6 000,0)·2 + 10 000·4) / (0 + 10 000) = 4, NOT 3.6667
   * So the backdated exit moved a LATER purchase's WAC without ever having a WAC of its own —
   * exactly the C-6-compatible mechanism this guard exists for. Exit A's frozen snapshot is
   * contradicted (it consumed at a replayed 2 as well, so the delta is 0, but it IS touched),
   * which is what makes R-5 demand confirmation.
   */
  async function seedBackdatedExitScenario(db: TestDb, itemName: string) {
    const item = await seedItem(db, itemName);
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-10T10:00:00.000Z",
        businessDate: "2026-07-10",
        lines: [{ itemId: item.id, qty: 10_000, lineTotal: 20_000 }],
      },
      ACTOR,
    );
    const exitA = await recordExit(
      db,
      {
        itemId: item.id,
        qty: 8_000,
        reason: "WASTE",
        occurredAt: "2026-07-11T10:00:00.000Z",
        businessDate: "2026-07-11",
      },
      ACTOR,
    );
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-12T10:00:00.000Z",
        businessDate: "2026-07-12",
        lines: [{ itemId: item.id, qty: 10_000, lineTotal: 40_000 }],
      },
      ACTOR,
    );
    return { item, exitA };
  }

  const BACKDATED_EXIT = {
    qty: 8_000,
    reason: "WASTE" as const,
    occurredAt: "2026-07-10T12:00:00.000Z",
    businessDate: "2026-07-10",
  };

  it("refuses a backdated exit without `confirm`, writing nothing", async () => {
    const db = createDb(env.DB);
    const { item, exitA } = await seedBackdatedExitScenario(db, "Salida retroactiva rechazada");

    await expect(
      recordExit(db, { itemId: item.id, ...BACKDATED_EXIT }, ACTOR),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: {
        reason: "REPLAY_CONFIRMATION_REQUIRED",
        impact: { requiresConfirmation: true, affectedStockExitIds: [exitA.exit.id] },
      },
    });

    // Thrown before db.batch: no second stock_exits row, no second EXIT_OUT movement, and the
    // stored WAC is untouched.
    const exitRows = await db.query.stockExits.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(exitRows).toHaveLength(1);
    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemRow?.wac).toBeCloseTo(44_000 / 12_000, 9);
  });

  it("commits with `confirm: true` and C-6 still holds verbatim: no financial transaction, and the exit itself books no WAC", async () => {
    const db = createDb(env.DB);
    const { item } = await seedBackdatedExitScenario(db, "Salida retroactiva confirmada");

    const wacAtCaptureTime = 44_000 / 12_000;
    const result = await recordExit(
      db,
      { itemId: item.id, ...BACKDATED_EXIT, confirm: true },
      ACTOR,
    );

    // C-6 half 1: the exit is VALUED at the item's current WAC, snapshotted onto its own row.
    expect(result.exit.unitCostSnapshot).toBeCloseTo(wacAtCaptureTime, 9);
    // C-6 half 2: NO financial_transactions row, ever — the cost was paid at purchase time.
    const exitTxRows = await db.query.financialTransactions.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventType, "stock_exit"),
    });
    expect(exitTxRows).toHaveLength(0);

    // C-6 half 3, the subtle one: the WAC did move — but NOT because this exit booked one. It
    // moved because the later 07-12 purchase now re-averages against a different on-hand weight
    // (C-1). The proof is that the new value is the from-zero recompute of the whole kardex, in
    // which the EXIT_OUT rows contribute qty only and never a cost.
    const kardex = await db.query.stockMovements.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
      orderBy: (t, { asc }) => [asc(t.occurredAt), asc(t.createdAt)],
    });
    expect(kardex).toHaveLength(4);
    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemRow?.wac).toBeCloseTo(4, 9);
    expect(itemRow?.wac).toBeCloseTo(recomputeWacFromMovements(kardex), 9);
  });
});

describe("reads: getStockExit / listStockExits", () => {
  it("getStockExit returns the exit; NOT_FOUND for a missing id", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Read exit item");
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 1000 }],
      },
      ACTOR,
    );
    const result = await recordExit(
      db,
      { itemId: item.id, qty: 100, reason: "WASTE", occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );

    const fetched = await getStockExit(db, result.exit.id);
    expect(fetched.id).toBe(result.exit.id);

    await expect(getStockExit(db, "does_not_exist")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("listStockExits filters by itemId, reason, and date range", async () => {
    const db = createDb(env.DB);
    const itemA = await seedItem(db, "List exit item A");
    const itemB = await seedItem(db, "List exit item B");
    for (const item of [itemA, itemB]) {
      await recordPurchase(
        db,
        {
          accountId: "acc_bank",
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [{ itemId: item.id, qty: 10000, lineTotal: 10000 }],
        },
        ACTOR,
      );
    }

    await recordExit(
      db,
      {
        itemId: itemA.id,
        qty: 100,
        reason: "WASTE",
        occurredAt: "2026-07-14T10:00:00.000Z",
        businessDate: "2026-07-14",
      },
      ACTOR,
    );
    await recordExit(
      db,
      {
        itemId: itemA.id,
        qty: 100,
        reason: "SPOILAGE",
        occurredAt: "2026-07-16T10:00:00.000Z",
        businessDate: "2026-07-16",
      },
      ACTOR,
    );
    await recordExit(
      db,
      {
        itemId: itemB.id,
        qty: 100,
        reason: "WASTE",
        occurredAt: "2026-07-15T10:00:00.000Z",
        businessDate: "2026-07-15",
      },
      ACTOR,
    );

    const { exits: byItem } = await listStockExits(db, { itemId: itemA.id });
    expect(byItem).toHaveLength(2);
    expect(byItem.every((e) => e.itemId === itemA.id)).toBe(true);

    const { exits: byReason } = await listStockExits(db, { reason: "WASTE" });
    expect(byReason).toHaveLength(2);
    expect(byReason.every((e) => e.reason === "WASTE")).toBe(true);

    const { exits: byDate } = await listStockExits(db, {
      fromDate: "2026-07-15",
      toDate: "2026-07-16",
    });
    expect(byDate).toHaveLength(2);
    expect(byDate.map((e) => e.businessDate).sort()).toEqual(["2026-07-15", "2026-07-16"]);
  });
});

describe("listWasteSummary (Doc 04 §4 v_waste)", () => {
  it("groups by month/reason and sums totalCost, newest-month-first then largest-cost-first", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Waste summary item");
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 100000, lineTotal: 200000 }], // unit cost = 2
      },
      ACTOR,
    );

    // July: two WASTE exits (100 + 200 qty @ cost 2 = 200 + 400 = 600 total) and one SPOILAGE
    // exit (50 qty @ cost 2 = 100 total).
    await recordExit(
      db,
      { itemId: item.id, qty: 100, reason: "WASTE", occurredAt: NOW, businessDate: "2026-07-10" },
      ACTOR,
    );
    await recordExit(
      db,
      { itemId: item.id, qty: 200, reason: "WASTE", occurredAt: NOW, businessDate: "2026-07-16" },
      ACTOR,
    );
    await recordExit(
      db,
      {
        itemId: item.id,
        qty: 50,
        reason: "SPOILAGE",
        occurredAt: NOW,
        businessDate: "2026-07-12",
      },
      ACTOR,
    );
    // June: one GIFT_SAMPLE exit (10 qty @ cost 2 = 20 total) — an earlier month, should sort
    // after every July row regardless of its own cost.
    await recordExit(
      db,
      {
        itemId: item.id,
        qty: 10,
        reason: "GIFT_SAMPLE",
        occurredAt: NOW,
        businessDate: "2026-06-20",
      },
      ACTOR,
    );

    const { summary } = await listWasteSummary(db);
    const julyRows = summary.filter((r) => r.month === "2026-07");
    const juneRows = summary.filter((r) => r.month === "2026-06");

    expect(julyRows).toEqual([
      { month: "2026-07", reason: "WASTE", exitCount: 2, totalCost: 600 },
      { month: "2026-07", reason: "SPOILAGE", exitCount: 1, totalCost: 100 },
    ]);
    expect(juneRows).toEqual([
      { month: "2026-06", reason: "GIFT_SAMPLE", exitCount: 1, totalCost: 20 },
    ]);

    // Newest month first overall.
    const monthOrder = summary.map((r) => r.month);
    expect(monthOrder.indexOf("2026-07")).toBeLessThan(monthOrder.indexOf("2026-06"));

    const { summary: filtered } = await listWasteSummary(db, {
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
    });
    expect(filtered.every((r) => r.month === "2026-07")).toBe(true);
  });
});

describe("batch atomicity (INV-1)", () => {
  it("a failing stock_exits insert (qty<=0 CHECK) in the same shape of batch as recordExit leaves nothing persisted", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Atomicity exit item");

    // Mirrors the statement shape recordExit() builds (stock_exits insert + EXIT_OUT movement
    // insert), but the stock_exits row violates stock_exits_qty_check (qty must be > 0) — run as
    // a raw D1 batch (not through recordExit, whose own defensive check would reject qty<=0
    // before ever reaching db.batch) to prove the movement insert alongside it never lands
    // either.
    await expect(
      env.DB.batch([
        env.DB.prepare(
          `INSERT INTO stock_exits (id, occurred_at, business_date, item_id, qty, reason, unit_cost_snapshot, created_at, updated_at)
           VALUES ('exit_atomicity_test', ?, ?, ?, 0, 'WASTE', 0, ?, ?)`,
        ).bind(NOW, BUSINESS_DATE, item.id, NOW, NOW),
        env.DB.prepare(
          `INSERT INTO stock_movements (id, occurred_at, business_date, item_id, type, qty, unit_cost, total_cost, source_event_type, source_event_id, created_at)
           VALUES ('movement_atomicity_test', ?, ?, ?, 'EXIT_OUT', -1000, 0, 0, 'stock_exit', 'exit_atomicity_test', ?)`,
        ).bind(NOW, BUSINESS_DATE, item.id, NOW),
      ]),
    ).rejects.toThrow();

    const exitRow = await env.DB.prepare(
      "SELECT id FROM stock_exits WHERE id = 'exit_atomicity_test'",
    ).first();
    expect(exitRow).toBeNull();

    const movementRow = await env.DB.prepare(
      "SELECT id FROM stock_movements WHERE id = 'movement_atomicity_test'",
    ).first();
    expect(movementRow).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Property test (Doc 11 §2, mandatory for money/stock math per D-5/CLAUDE.md).
// ---------------------------------------------------------------------------

describe("property: mixed purchase/exit sequences keep item_stock consistent (INV-5 in miniature)", () => {
  it("∀ sequences of purchase and exit commands against a fixed item: qty_on_hand = Σ PURCHASE_IN qtys - Σ EXIT_OUT qtys", async () => {
    const db = createDb(env.DB);

    const purchaseArb = fc.record({
      op: fc.constant("purchase" as const),
      qty: fc.integer({ min: 1, max: 5000 }),
      lineTotal: fc.integer({ min: 0, max: 50000 }),
    });
    const exitArb = fc.record({
      op: fc.constant("exit" as const),
      qty: fc.integer({ min: 1, max: 3000 }),
      reason: fc.constantFrom<StockExitReason>(
        "WASTE",
        "SELF_CONSUMPTION",
        "GIFT_SAMPLE",
        "SPOILAGE",
        "OTHER",
      ),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.oneof(purchaseArb, exitArb), { minLength: 1, maxLength: 10 }),
        async (ops) => {
          // Fresh item every run (unique name, items.name is UNIQUE) so runs never interfere.
          const runId = generateUuidV7();
          const item = await seedItem(db, `Property mixed item ${runId}`);

          let expectedOnHand = 0;
          for (const op of ops) {
            if (op.op === "purchase") {
              await recordPurchase(
                db,
                {
                  accountId: "acc_bank",
                  occurredAt: NOW,
                  businessDate: BUSINESS_DATE,
                  lines: [{ itemId: item.id, qty: op.qty, lineTotal: op.lineTotal }],
                },
                ACTOR,
              );
              expectedOnHand += op.qty;
            } else {
              await recordExit(
                db,
                {
                  itemId: item.id,
                  qty: op.qty,
                  reason: op.reason,
                  occurredAt: NOW,
                  businessDate: BUSINESS_DATE,
                },
                ACTOR,
              );
              expectedOnHand -= op.qty;
            }
          }

          const stockRow = await db.query.itemStock.findFirst({
            where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
          });
          expect(stockRow?.qtyOnHand ?? 0).toBe(expectedOnHand);
        },
      ),
      { numRuns: 15 },
    );
  });
});

// ---------------------------------------------------------------------------
// KOK-024 Phase E: updateStockExit / deleteStockExit (Doc 03 §7 R-1/R-3/R-4/R-5, INV-9/10, D-8).
//
// The C-6 assertions from the create path are repeated deliberately on BOTH correction paths: the
// easiest way to reintroduce the "invisible cost" bug is to add a financial reversal to a delete,
// or an `items.wac` write to an edit, on the reasonable-sounding grounds that a correction must
// "undo" something. Neither exists to undo.
// ---------------------------------------------------------------------------

/** Seeds an item plus one purchase, so it has stock and a non-trivial WAC to snapshot from. */
async function seedPurchasedItem(db: TestDb, name: string, qty: number, lineTotal: number) {
  const item = await seedItem(db, name);
  await recordPurchase(
    db,
    {
      accountId: "acc_bank",
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId: item.id, qty, lineTotal }],
    },
    ACTOR,
  );
  return item;
}

async function exitMovements(db: TestDb, exitId: string) {
  return db.query.stockMovements.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, exitId),
  });
}

describe("updateStockExit (R-1)", () => {
  it("edit changing qty: kardex and item_stock are regenerated, and C-6 still holds (no financial transaction, no WAC write, snapshot preserved)", async () => {
    const db = createDb(env.DB);
    const item = await seedPurchasedItem(db, "Exit edit — qty", 2000, 4000); // wac 2

    const created = await recordExit(
      db,
      {
        itemId: item.id,
        qty: 500,
        reason: "WASTE",
        notes: "Estimado inicial",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
      },
      ACTOR,
    );
    expect(created.exit.unitCostSnapshot).toBe(2);

    const updated = await updateStockExit(
      db,
      created.exit.id,
      {
        itemId: item.id,
        qty: 800,
        reason: "WASTE",
        notes: "Pesado de verdad: 800",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
      },
      ACTOR,
    );

    expect(updated.exit).toMatchObject({
      id: created.exit.id,
      qty: 800,
      notes: "Pesado de verdad: 800",
      // Same item, so the frozen valuation survives the edit (module header's policy / R-4 spirit).
      unitCostSnapshot: 2,
    });

    const exitRow = await db.query.stockExits.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, created.exit.id),
    });
    expect(exitRow).toMatchObject({ qty: 800, unitCostSnapshot: 2, deletedAt: null });

    // INV-9: exactly ONE derived movement for this source — regenerated, never appended to.
    const movements = await exitMovements(db, created.exit.id);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      type: "EXIT_OUT",
      itemId: item.id,
      qty: -800,
      unitCost: 2,
      totalCost: -1600,
    });

    const stockRow = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockRow?.qtyOnHand).toBe(1200); // 2000 − 800, NOT 2000 − 500 − 800

    // C-6, both halves, on the edit path.
    const itemAfter = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemAfter?.wac).toBe(2);
    const exitTxRows = await db.query.financialTransactions.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventType, "stock_exit"),
    });
    expect(exitTxRows).toHaveLength(0);
  });

  it("edit changing item_id RE-SNAPSHOTS at the new item's WAC, and moves the stock effect between the two items", async () => {
    const db = createDb(env.DB);
    const itemA = await seedPurchasedItem(db, "Exit edit — item A", 2000, 4000); // wac 2
    const itemB = await seedPurchasedItem(db, "Exit edit — item B", 1000, 5000); // wac 5

    const created = await recordExit(
      db,
      {
        itemId: itemA.id,
        qty: 500,
        reason: "SPOILAGE",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
      },
      ACTOR,
    );
    expect(created.exit.unitCostSnapshot).toBe(2);

    const updated = await updateStockExit(
      db,
      created.exit.id,
      {
        itemId: itemB.id,
        qty: 500,
        reason: "SPOILAGE",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
      },
      ACTOR,
    );

    // The old snapshot was a price per milli-unit of a DIFFERENT item — meaningless here.
    expect(updated.exit).toMatchObject({ itemId: itemB.id, unitCostSnapshot: 5 });

    const movements = await exitMovements(db, created.exit.id);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ itemId: itemB.id, qty: -500, unitCost: 5 });

    const stockA = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, itemA.id),
    });
    const stockB = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, itemB.id),
    });
    expect(stockA?.qtyOnHand).toBe(2000); // fully reversed on the item it left
    expect(stockB?.qtyOnHand).toBe(500); // 1000 − 500 on the item it moved to

    // C-6: neither item's WAC was touched by the exit moving between them.
    const itemARow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, itemA.id),
    });
    const itemBRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, itemB.id),
    });
    expect(itemARow?.wac).toBe(2);
    expect(itemBRow?.wac).toBe(5);
  });

  it("edit changing ONLY qty preserves the original snapshot even after the item's WAC has moved since", async () => {
    const db = createDb(env.DB);
    const item = await seedPurchasedItem(db, "Exit edit — snapshot preservation", 1000, 1000); // wac 1

    const created = await recordExit(
      db,
      { itemId: item.id, qty: 100, reason: "WASTE", occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );
    expect(created.exit.unitCostSnapshot).toBe(1);

    // A later purchase moves the WAC well away from the frozen snapshot.
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-17T10:00:00.000Z",
        businessDate: "2026-07-17",
        lines: [{ itemId: item.id, qty: 900, lineTotal: 9000 }],
      },
      ACTOR,
    );
    const movedWac = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(movedWac?.wac).not.toBe(1);

    const updated = await updateStockExit(
      db,
      created.exit.id,
      {
        itemId: item.id,
        qty: 150,
        reason: "WASTE",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        // Backdated relative to the 07-17 purchase, so the replay guard is in play — confirmed
        // here because this test is about the SNAPSHOT policy, not about R-5.
        confirm: true,
      },
      ACTOR,
    );

    // Re-valuing a past day at today's WAC is exactly what R-4's spirit forbids.
    expect(updated.exit.unitCostSnapshot).toBe(1);
    expect(updated.exit.qty).toBe(150);
  });

  it("leaves a complete before/after audit_log row (INV-9/10)", async () => {
    const db = createDb(env.DB);
    const item = await seedPurchasedItem(db, "Exit edit — audit", 2000, 4000);

    const created = await recordExit(
      db,
      {
        itemId: item.id,
        qty: 300,
        reason: "WASTE",
        notes: "antes",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
      },
      ACTOR,
    );
    await updateStockExit(
      db,
      created.exit.id,
      {
        itemId: item.id,
        qty: 700,
        reason: "GIFT_SAMPLE",
        notes: "después",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
      },
      ACTOR,
    );

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, created.exit.id), eqOp(t.action, "update")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "stock_exits" });
    const before = JSON.parse(auditRow?.beforeJson ?? "null");
    const after = JSON.parse(auditRow?.afterJson ?? "null");
    expect(before).toMatchObject({
      id: created.exit.id,
      qty: 300,
      reason: "WASTE",
      notes: "antes",
    });
    expect(after).toMatchObject({
      id: created.exit.id,
      qty: 700,
      reason: "GIFT_SAMPLE",
      notes: "después",
    });
  });

  it("rejects an unknown or already-deleted exit with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    const item = await seedPurchasedItem(db, "Exit edit — not found", 1000, 1000);
    const command = {
      itemId: item.id,
      qty: 100,
      reason: "WASTE" as const,
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
    };

    await expect(updateStockExit(db, "does_not_exist", command, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const created = await recordExit(db, command, ACTOR);
    await deleteStockExit(db, created.exit.id, {}, ACTOR);
    await expect(updateStockExit(db, created.exit.id, command, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("deleteStockExit (R-3, D-8)", () => {
  it("soft-deletes: stock effect reversed, deleted_at set, derived movements gone with no orphans, absent from reads", async () => {
    const db = createDb(env.DB);
    const item = await seedPurchasedItem(db, "Exit delete — reversal", 2000, 4000);

    const created = await recordExit(
      db,
      { itemId: item.id, qty: 500, reason: "WASTE", occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );
    const stockBefore = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockBefore?.qtyOnHand).toBe(1500);

    const result = await deleteStockExit(db, created.exit.id, { confirm: false }, ACTOR);
    expect(result.deletedAt).toEqual(expect.any(String));

    // D-8/R-3: the row is still there, flagged — never hard-deleted.
    const row = await db.query.stockExits.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, created.exit.id),
    });
    expect(row?.deletedAt).toBe(result.deletedAt);
    expect(row?.qty).toBe(500);

    // INV-9: the derived kardex rows ARE hard-deleted (D-8's carve-out) and leave no orphans.
    expect(await exitMovements(db, created.exit.id)).toHaveLength(0);

    const stockAfter = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockAfter?.qtyOnHand).toBe(2000); // fully reversed

    // C-6 on the delete path: nothing financial to reverse, and the WAC is untouched.
    const itemAfter = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemAfter?.wac).toBe(2);
    const exitTxRows = await db.query.financialTransactions.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventType, "stock_exit"),
    });
    expect(exitTxRows).toHaveLength(0);

    // Invisible to both reads.
    await expect(getStockExit(db, created.exit.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { exits } = await listStockExits(db, { itemId: item.id });
    expect(exits.map((e) => e.id)).not.toContain(created.exit.id);
  });

  it("leaves a complete before/after audit_log row, and refuses a second delete with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    const item = await seedPurchasedItem(db, "Exit delete — audit", 1000, 2000);

    const created = await recordExit(
      db,
      {
        itemId: item.id,
        qty: 250,
        reason: "SELF_CONSUMPTION",
        notes: "para la casa",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
      },
      ACTOR,
    );
    await deleteStockExit(db, created.exit.id, {}, ACTOR);

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, created.exit.id), eqOp(t.action, "delete")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "stock_exits" });
    const before = JSON.parse(auditRow?.beforeJson ?? "null");
    const after = JSON.parse(auditRow?.afterJson ?? "null");
    expect(before).toMatchObject({ id: created.exit.id, qty: 250, deletedAt: null });
    expect(after).toMatchObject({ id: created.exit.id, qty: 250 });
    expect(after.deletedAt).toEqual(expect.any(String));

    await expect(deleteStockExit(db, created.exit.id, {}, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("updateStockExit / deleteStockExit — backdated: R-5 confirmation (ADR-016)", () => {
  /**
   * P1 10 000 @ 2 (07-10) -> exit A 8 000 (07-11, freezes 2) -> P2 10 000 @ 4 (07-12).
   * Editing or deleting exit A therefore lands BEHIND P2: P2's WAC was averaged against the
   * on-hand weight exit A left, so changing exit A re-weights C-1 for P2 (INV-11). Exit A's own
   * frozen snapshot is among the ones the replay contradicts, which is what makes R-5 demand
   * confirmation before the correction is booked.
   */
  async function seedBackdatedEditScenario(db: TestDb, itemName: string) {
    const item = await seedItem(db, itemName);
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-10T10:00:00.000Z",
        businessDate: "2026-07-10",
        lines: [{ itemId: item.id, qty: 10_000, lineTotal: 20_000 }],
      },
      ACTOR,
    );
    const exitA = await recordExit(
      db,
      {
        itemId: item.id,
        qty: 8_000,
        reason: "WASTE",
        occurredAt: "2026-07-11T10:00:00.000Z",
        businessDate: "2026-07-11",
      },
      ACTOR,
    );
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-12T10:00:00.000Z",
        businessDate: "2026-07-12",
        lines: [{ itemId: item.id, qty: 10_000, lineTotal: 40_000 }],
      },
      ACTOR,
    );
    return { item, exitA };
  }

  const EDIT = {
    qty: 4_000,
    reason: "WASTE" as const,
    occurredAt: "2026-07-11T10:00:00.000Z",
    businessDate: "2026-07-11",
  };

  it("refuses a backdated EDIT without `confirm`, writing nothing", async () => {
    const db = createDb(env.DB);
    const { item, exitA } = await seedBackdatedEditScenario(db, "Edición retroactiva rechazada");

    await expect(
      updateStockExit(db, exitA.exit.id, { itemId: item.id, ...EDIT }, ACTOR),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: {
        reason: "REPLAY_CONFIRMATION_REQUIRED",
        impact: { requiresConfirmation: true },
      },
    });

    // Thrown before db.batch: the exit, its movement, and the stored WAC are all untouched.
    const row = await db.query.stockExits.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, exitA.exit.id),
    });
    expect(row?.qty).toBe(8_000);
    const movements = await exitMovements(db, exitA.exit.id);
    expect(movements).toHaveLength(1);
    expect(movements[0]?.qty).toBe(-8_000);
    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemRow?.wac).toBeCloseTo(44_000 / 12_000, 9);
  });

  it("commits the backdated EDIT with `confirm: true`, replaying the later purchase's WAC", async () => {
    const db = createDb(env.DB);
    const { item, exitA } = await seedBackdatedEditScenario(db, "Edición retroactiva confirmada");

    const updated = await updateStockExit(
      db,
      exitA.exit.id,
      { itemId: item.id, ...EDIT, confirm: true },
      ACTOR,
    );
    expect(updated.exit.qty).toBe(4_000);
    // R-4: this exit's own frozen snapshot survives its qty edit (same item).
    expect(updated.exit.unitCostSnapshot).toBe(2);

    const stockRow = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockRow?.qtyOnHand).toBe(16_000); // 20 000 − 4 000

    // P2 now re-averages against on-hand 6 000 @ 2 instead of 2 000 @ 2:
    // (6 000·2 + 10 000·4) / 16 000 = 3.25 — and that is exactly the from-zero recompute.
    const kardex = await db.query.stockMovements.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
      orderBy: (t, { asc }) => [asc(t.occurredAt), asc(t.createdAt)],
    });
    expect(kardex).toHaveLength(3);
    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemRow?.wac).toBeCloseTo(3.25, 9);
    expect(itemRow?.wac).toBeCloseTo(recomputeWacFromMovements(kardex), 9);

    // C-6 survives the replay: still not one financial transaction from an exit.
    const exitTxRows = await db.query.financialTransactions.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventType, "stock_exit"),
    });
    expect(exitTxRows).toHaveLength(0);
  });

  /**
   * R-5's precondition is a frozen consumer AFTER the touched point, not backdating as such
   * ("...whose replay would touch sales or production runs already recorded after the touched
   * point"). Deleting exit A removes the only EXIT_OUT from the projected kardex, so the suffix
   * holds nothing but P2 — the WAC moves (3.667 -> 3) but no reported cost is contradicted, and
   * replay.ts treats that as a silent internal correction. Asserted explicitly so that this is a
   * recorded reading of R-5 rather than an accident nobody noticed.
   */
  it("commits a backdated DELETE without `confirm` when NOTHING frozen sits after the touched point", async () => {
    const db = createDb(env.DB);
    const { item, exitA } = await seedBackdatedEditScenario(db, "Borrado retroactivo sin consumo");

    await deleteStockExit(db, exitA.exit.id, {}, ACTOR);

    const deleted = await db.query.stockExits.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, exitA.exit.id),
    });
    expect(deleted?.deletedAt).toEqual(expect.any(String));
    expect(await exitMovements(db, exitA.exit.id)).toHaveLength(0);

    // With the exit gone, P2 averages against the full 10 000 @ 2 that P1 left.
    const kardex = await db.query.stockMovements.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
      orderBy: (t, { asc }) => [asc(t.occurredAt), asc(t.createdAt)],
    });
    expect(kardex).toHaveLength(2);
    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemRow?.wac).toBeCloseTo(3, 9); // (10 000·2 + 10 000·4) / 20 000
    expect(itemRow?.wac).toBeCloseTo(recomputeWacFromMovements(kardex), 9);
  });

  it("refuses a backdated DELETE that contradicts a LATER exit's frozen snapshot, and commits it with `confirm: true` without rewriting that snapshot (R-4)", async () => {
    const db = createDb(env.DB);
    const { item, exitA } = await seedBackdatedEditScenario(db, "Borrado retroactivo con consumo");

    // Exit B sits AFTER P2 and froze its cost at the WAC of the moment, 44 000/12 000 = 3.6667.
    // Deleting exit A re-weights P2 (on-hand 10 000 instead of 2 000), so the cost exit B was
    // reported at no longer matches the replay — that is the number R-5 wants acknowledged.
    const exitB = await recordExit(
      db,
      {
        itemId: item.id,
        qty: 1_000,
        reason: "SPOILAGE",
        occurredAt: "2026-07-13T10:00:00.000Z",
        businessDate: "2026-07-13",
      },
      ACTOR,
    );
    expect(exitB.exit.unitCostSnapshot).toBeCloseTo(44_000 / 12_000, 9);

    await expect(deleteStockExit(db, exitA.exit.id, {}, ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
      details: {
        reason: "REPLAY_CONFIRMATION_REQUIRED",
        impact: { requiresConfirmation: true, affectedStockExitIds: [exitB.exit.id] },
      },
    });
    const stillThere = await db.query.stockExits.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, exitA.exit.id),
    });
    expect(stillThere?.deletedAt).toBeNull();

    await deleteStockExit(db, exitA.exit.id, { confirm: true }, ACTOR);

    expect(await exitMovements(db, exitA.exit.id)).toHaveLength(0);
    const stockRow = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockRow?.qtyOnHand).toBe(19_000); // 20 000 − exit B's 1 000

    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemRow?.wac).toBeCloseTo(3, 9);

    // R-4, the whole point: exit B's frozen snapshot is READ by the replay and never rewritten.
    const exitBRow = await db.query.stockExits.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, exitB.exit.id),
    });
    expect(exitBRow?.unitCostSnapshot).toBeCloseTo(44_000 / 12_000, 9);
  });
});

// ---------------------------------------------------------------------------
// KOK-024 Phase F: previewStockExitImpact (dry run) + restoreStockExit (undo).
//
// previewStockExitImpact's one job is to run the EXACT same planner the corresponding mutation
// would — replay.ts's own module header says so ("the preview and the mutation it previews must
// run the exact same planner, or the preview is a lie with a UI around it"). The tests below prove
// that literally: they call the preview AND the real mutation against identical, unmodified state
// and assert the returned/thrown impacts are `toEqual`, not just individually plausible.
// ---------------------------------------------------------------------------

/**
 * P1 10 000 @ 2 (07-10) -> exit A 8 000 (07-11, freezes 2) -> P2 10 000 @ 4 (07-12). Same shape as
 * the backdated-replay scenarios above, reused here (not imported — those helpers are local to
 * their own `describe` closures) so the preview/mutation comparisons below have a known-touchy
 * kardex to disturb.
 */
async function seedReplayScenario(db: TestDb, itemName: string) {
  const item = await seedItem(db, itemName);
  await recordPurchase(
    db,
    {
      accountId: "acc_bank",
      occurredAt: "2026-07-10T10:00:00.000Z",
      businessDate: "2026-07-10",
      lines: [{ itemId: item.id, qty: 10_000, lineTotal: 20_000 }],
    },
    ACTOR,
  );
  const exitA = await recordExit(
    db,
    {
      itemId: item.id,
      qty: 8_000,
      reason: "WASTE",
      occurredAt: "2026-07-11T10:00:00.000Z",
      businessDate: "2026-07-11",
    },
    ACTOR,
  );
  await recordPurchase(
    db,
    {
      accountId: "acc_bank",
      occurredAt: "2026-07-12T10:00:00.000Z",
      businessDate: "2026-07-12",
      lines: [{ itemId: item.id, qty: 10_000, lineTotal: 40_000 }],
    },
    ACTOR,
  );
  return { item, exitA };
}

/** Pulls `details.impact` off a rejected DomainError-shaped value without a hand-rolled type. */
function impactOf(err: unknown): unknown {
  return (err as { details?: { impact?: unknown } }).details?.impact;
}

describe("previewStockExitImpact (dry run: identical planner to the mutations, no write)", () => {
  it("op=create: matches the impact recordExit itself would refuse with, and writes nothing", async () => {
    const db = createDb(env.DB);
    const { item, exitA } = await seedReplayScenario(db, "Preview create");

    const command = {
      itemId: item.id,
      qty: 8_000,
      reason: "WASTE" as const,
      occurredAt: "2026-07-10T12:00:00.000Z",
      businessDate: "2026-07-10",
    };

    const previewImpact = await previewStockExitImpact(db, { op: "create", command });

    let mutationImpact: unknown;
    try {
      await recordExit(db, command, ACTOR);
      throw new Error("expected recordExit to require confirmation");
    } catch (err) {
      mutationImpact = impactOf(err);
    }

    expect(previewImpact).toEqual(mutationImpact);
    expect(previewImpact.requiresConfirmation).toBe(true);
    expect(previewImpact.affectedStockExitIds).toEqual([exitA.exit.id]);

    // The preview wrote nothing: still exactly the one exit seeded above.
    const exitRows = await db.query.stockExits.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(exitRows).toHaveLength(1);
  });

  it("op=update: matches the impact updateStockExit itself would refuse with, and writes nothing", async () => {
    const db = createDb(env.DB);
    const { exitA } = await seedReplayScenario(db, "Preview update");

    const command = {
      itemId: exitA.exit.itemId,
      qty: 4_000,
      reason: "WASTE" as const,
      occurredAt: "2026-07-11T10:00:00.000Z",
      businessDate: "2026-07-11",
    };

    const previewImpact = await previewStockExitImpact(db, {
      op: "update",
      id: exitA.exit.id,
      command,
    });

    let mutationImpact: unknown;
    try {
      await updateStockExit(db, exitA.exit.id, command, ACTOR);
      throw new Error("expected updateStockExit to require confirmation");
    } catch (err) {
      mutationImpact = impactOf(err);
    }

    expect(previewImpact).toEqual(mutationImpact);
    expect(previewImpact.requiresConfirmation).toBe(true);

    // The preview wrote nothing: exitA is still at its ORIGINAL qty.
    const row = await db.query.stockExits.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, exitA.exit.id),
    });
    expect(row?.qty).toBe(8_000);
  });

  it("op=delete: matches the impact deleteStockExit itself would refuse with, and writes nothing", async () => {
    const db = createDb(env.DB);
    const { item, exitA } = await seedReplayScenario(db, "Preview delete");
    // A later exit whose frozen cost the deletion would disturb (R-5's precondition).
    const exitB = await recordExit(
      db,
      {
        itemId: item.id,
        qty: 1_000,
        reason: "SPOILAGE",
        occurredAt: "2026-07-13T10:00:00.000Z",
        businessDate: "2026-07-13",
      },
      ACTOR,
    );

    const previewImpact = await previewStockExitImpact(db, { op: "delete", id: exitA.exit.id });

    let mutationImpact: unknown;
    try {
      await deleteStockExit(db, exitA.exit.id, {}, ACTOR);
      throw new Error("expected deleteStockExit to require confirmation");
    } catch (err) {
      mutationImpact = impactOf(err);
    }

    expect(previewImpact).toEqual(mutationImpact);
    expect(previewImpact.requiresConfirmation).toBe(true);
    expect(previewImpact.affectedStockExitIds).toEqual([exitB.exit.id]);

    // The preview wrote nothing: exitA is still live.
    const row = await db.query.stockExits.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, exitA.exit.id),
    });
    expect(row?.deletedAt).toBeNull();
  });
});

describe("restoreStockExit (KOK-024 Phase F — server side of the 'Deshacer' undo toast, D-8/R-3)", () => {
  it("restores an exit that touched nothing downstream: kardex returns with the SAME snapshot (no re-pricing), reads see it again, audit action='restore'", async () => {
    const db = createDb(env.DB);
    const item = await seedPurchasedItem(db, "Exit restore — plain", 2000, 4000); // wac 2

    const created = await recordExit(
      db,
      { itemId: item.id, qty: 500, reason: "WASTE", occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );
    expect(created.exit.unitCostSnapshot).toBe(2);

    await deleteStockExit(db, created.exit.id, {}, ACTOR);
    expect(await exitMovements(db, created.exit.id)).toHaveLength(0);
    const stockAfterDelete = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockAfterDelete?.qtyOnHand).toBe(2000);

    const restored = await restoreStockExit(db, created.exit.id, {}, ACTOR);

    expect(restored.exit).toMatchObject({
      id: created.exit.id,
      qty: 500,
      // Reused verbatim — never re-snapshotted at today's WAC (C-6/R-4 spirit).
      unitCostSnapshot: 2,
    });

    const row = await db.query.stockExits.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, created.exit.id),
    });
    expect(row).toMatchObject({ deletedAt: null, qty: 500, unitCostSnapshot: 2 });

    // INV-9: exactly ONE regenerated movement, valued at the reused snapshot.
    const movements = await exitMovements(db, created.exit.id);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: "EXIT_OUT", qty: -500, unitCost: 2 });

    const stockAfterRestore = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockAfterRestore?.qtyOnHand).toBe(1500); // reversed back down, same as the original exit

    // No replay was needed (nothing sits after the restored point), so items.wac is untouched.
    const itemAfter = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemAfter?.wac).toBe(2);

    // Visible to reads again.
    const fetched = await getStockExit(db, created.exit.id);
    expect(fetched.id).toBe(created.exit.id);
    const { exits } = await listStockExits(db, { itemId: item.id });
    expect(exits.map((e) => e.id)).toContain(created.exit.id);

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, created.exit.id), eqOp(t.action, "restore")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "stock_exits" });
  });

  it("refuses to restore an exit whose kardex position was superseded by intervening history, and commits with confirm: true without rewriting a later exit's frozen snapshot (R-4/R-5)", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Exit restore — superseded");

    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-10T10:00:00.000Z",
        businessDate: "2026-07-10",
        lines: [{ itemId: item.id, qty: 10_000, lineTotal: 20_000 }], // wac 2
      },
      ACTOR,
    );
    const exitA = await recordExit(
      db,
      {
        itemId: item.id,
        qty: 8_000,
        reason: "WASTE",
        occurredAt: "2026-07-11T10:00:00.000Z",
        businessDate: "2026-07-11",
      },
      ACTOR,
    );
    expect(exitA.exit.unitCostSnapshot).toBe(2);
    await deleteStockExit(db, exitA.exit.id, {}, ACTOR);

    // Intervening history recorded WHILE exit A was deleted.
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-12T10:00:00.000Z",
        businessDate: "2026-07-12",
        lines: [{ itemId: item.id, qty: 10_000, lineTotal: 40_000 }],
      },
      ACTOR,
    );
    const exitB = await recordExit(
      db,
      {
        itemId: item.id,
        qty: 1_000,
        reason: "SPOILAGE",
        occurredAt: "2026-07-13T10:00:00.000Z",
        businessDate: "2026-07-13",
      },
      ACTOR,
    );
    // Current WAC after P1/P2 with exit A absent: (10 000·2 + 10 000·4) / 20 000 = 3.
    expect(exitB.exit.unitCostSnapshot).toBe(3);

    await expect(restoreStockExit(db, exitA.exit.id, {}, ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "REPLAY_CONFIRMATION_REQUIRED", impact: { requiresConfirmation: true } },
    });

    // Thrown before db.batch: still soft-deleted, kardex untouched.
    const stillDeleted = await db.query.stockExits.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, exitA.exit.id),
    });
    expect(stillDeleted?.deletedAt).not.toBeNull();
    expect(await exitMovements(db, exitA.exit.id)).toHaveLength(0);

    const restored = await restoreStockExit(db, exitA.exit.id, { confirm: true }, ACTOR);
    expect(restored.exit).toMatchObject({ id: exitA.exit.id, qty: 8_000, unitCostSnapshot: 2 });

    const row = await db.query.stockExits.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, exitA.exit.id),
    });
    expect(row?.deletedAt).toBeNull();

    const movements = await exitMovements(db, exitA.exit.id);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ qty: -8_000, unitCost: 2 });

    const stockRow = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockRow?.qtyOnHand).toBe(11_000); // 10 000 − 8 000 + 10 000 − 1 000

    // The re-inserted exit A now sits BEFORE P2 again, so P2 re-averages against the smaller
    // on-hand weight exit A leaves: (2 000·2 + 10 000·4) / 12 000 = 44 000/12 000.
    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemRow?.wac).toBeCloseTo(44_000 / 12_000, 9);

    // R-4, the whole point: exit B's frozen snapshot is READ by the replay and never rewritten.
    const exitBRow = await db.query.stockExits.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, exitB.exit.id),
    });
    expect(exitBRow?.unitCostSnapshot).toBe(3);
  });

  it("rejects an id that does not exist or is not currently deleted with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    const item = await seedPurchasedItem(db, "Exit restore — not found", 1000, 1000);

    await expect(restoreStockExit(db, "does_not_exist", {}, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const created = await recordExit(
      db,
      { itemId: item.id, qty: 100, reason: "WASTE", occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );
    // Currently LIVE (never deleted) — nothing to restore.
    await expect(restoreStockExit(db, created.exit.id, {}, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
