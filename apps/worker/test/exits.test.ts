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
import { getStockExit, listStockExits, recordExit } from "../src/core/inventory/exits.js";
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
