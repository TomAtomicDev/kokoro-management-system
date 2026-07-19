// Integration tests for core/purchasing (KOK-016, Doc 03 UC-01). Follows the Doc 11 §3 template:
// seed -> execute command -> assert event rows + kardex + WAC/replacement_cost + financial
// transaction + account balance + audit_log + atomicity, run against real D1 via
// @cloudflare/vitest-pool-workers (test/setup.ts applies migrations/0001_init.sql first, which
// seeds `financial_accounts` 'acc_bank' (BANK) and 'acc_cash' (CASH), both balance = 0, is_active
// = 1 — Doc 04 §7).
//
// Storage is isolated per test FILE, not per test (see finance.test.ts's identical note) — the
// `beforeEach` below restores the per-test guarantee this file's tests were written against: both
// seeded accounts back at balance 0, no leftover purchases/purchase-sourced transactions/audit
// rows from prior tests. Items are created fresh with a unique name per test (items.name is
// UNIQUE), so they never need resetting between tests.
import { env } from "cloudflare:test";
import { generateUuidV7 } from "@kokoro/shared";
import { eq, inArray } from "drizzle-orm";
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";

import { createItem } from "../src/core/catalog/index.js";
import { recomputeWacFromMovements } from "../src/core/costing/wac.js";
import { recordExit } from "../src/core/inventory/exits.js";
import {
  deletePurchase,
  getPurchase,
  listPurchases,
  recordPurchase,
  updatePurchase,
} from "../src/core/purchasing/index.js";
import { createDb } from "../src/db/index.js";
import {
  auditLog,
  costingAdjustments,
  financialAccounts,
  financialTransactions,
  purchases,
} from "../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;
const NOW = "2026-07-16T10:00:00.000Z";
const BUSINESS_DATE = "2026-07-16";

type TestDb = ReturnType<typeof createDb>;

async function seedItem(
  db: TestDb,
  name: string,
  kind: "RAW_MATERIAL" | "SEMI_FINISHED" | "FINISHED" = "RAW_MATERIAL",
) {
  return createItem(db, { name, kind, category: "INGREDIENT", unit: "KG" }, ACTOR);
}

/** Test-only fixture: an inactive account, mirroring finance.test.ts's identical helper. */
async function seedInactiveAccount(db: TestDb, id: string): Promise<void> {
  await db.insert(financialAccounts).values({
    id,
    name: "Cuenta inactiva",
    type: "CASH",
    openingBalance: 0,
    balance: 0,
    isActive: 0,
  });
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(auditLog).where(eq(auditLog.entityType, "purchases"));
  await db
    .delete(financialTransactions)
    .where(eq(financialTransactions.sourceEventType, "purchase"));
  // Cascades to purchase_lines (onDelete: cascade FK, schema.ts) — without this, listPurchases'
  // filter-by-accountId test would see every prior test's purchases against the same seeded
  // accounts, not just the ones it created itself.
  await db.delete(purchases);
  await db
    .delete(financialAccounts)
    .where(inArray(financialAccounts.id, ["acc_inactive_purchase_1"]));
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("recordPurchase (UC-01)", () => {
  it("records a single-line purchase: kardex movement, item_stock, WAC, replacement_cost, EXPENSE tx, account balance, audit_log", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Harina — single line");

    const result = await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 5000, lineTotal: 10000 }], // unit cost = 2
      },
      ACTOR,
    );

    expect(result.purchase.total).toBe(10000);
    expect(result.purchase.lines).toHaveLength(1);
    expect(result.purchase.lines[0]).toMatchObject({
      itemId: item.id,
      qty: 5000,
      lineTotal: 10000,
    });
    expect(result.account.balance).toBe(-10000);

    const movementRow = await db.query.stockMovements.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, result.purchase.id),
    });
    expect(movementRow).toMatchObject({
      type: "PURCHASE_IN",
      qty: 5000,
      unitCost: 2,
      sourceEventType: "purchase",
    });

    const stockRow = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockRow?.qtyOnHand).toBe(5000);

    // First-ever entry (onHand=0, wac=0) yields exactly the entry's unit cost (C-1).
    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemRow?.wac).toBe(2);
    expect(itemRow?.replacementCost).toBe(2);
    expect(itemRow?.replacementCostUpdatedAt).not.toBeNull();

    const txRow = await db.query.financialTransactions.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, result.purchase.id),
    });
    expect(txRow).toMatchObject({
      type: "EXPENSE",
      category: "SUPPLY_PURCHASE",
      amount: 10000,
      accountId: "acc_bank",
      sourceEventType: "purchase",
      sourceEventId: result.purchase.id,
    });

    const accountRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
    });
    expect(accountRow?.balance).toBe(-10000);

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, result.purchase.id), eqOp(t.action, "create")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "purchases" });
  });

  it("records a multi-line purchase across different items, updating each item's stock/WAC independently", async () => {
    const db = createDb(env.DB);
    const itemA = await seedItem(db, "Multi-line item A");
    const itemB = await seedItem(db, "Multi-line item B");

    const result = await recordPurchase(
      db,
      {
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [
          { itemId: itemA.id, qty: 2000, lineTotal: 4000 }, // unit cost 2
          { itemId: itemB.id, qty: 1000, lineTotal: 5000 }, // unit cost 5
        ],
      },
      ACTOR,
    );

    expect(result.purchase.total).toBe(9000);
    expect(result.account.balance).toBe(-9000);

    const itemARow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, itemA.id),
    });
    const itemBRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, itemB.id),
    });
    expect(itemARow?.wac).toBe(2);
    expect(itemBRow?.wac).toBe(5);

    const stockA = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, itemA.id),
    });
    const stockB = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, itemB.id),
    });
    expect(stockA?.qtyOnHand).toBe(2000);
    expect(stockB?.qtyOnHand).toBe(1000);

    const movementRows = await db.query.stockMovements.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, result.purchase.id),
    });
    expect(movementRows).toHaveLength(2);
  });

  it("threads WAC correctly across two lines for the SAME item (sequencing edge case), and replacementCost ends at the LAST line's unit cost", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Same item twice on one invoice");

    // Line 1: qty=1000 @ lineTotal=1000 -> unitCost=1. onHand starts 0/wac=0 -> after: onHand=1000, wac=1.
    // Line 2: qty=1000 @ lineTotal=3000 -> unitCost=3, applied against onHand=1000/wac=1 (the
    // AFTER-first-line state, not the pre-purchase snapshot re-used for both lines):
    // wac' = (1000*1 + 1000*3) / 2000 = 2.
    const result = await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [
          { itemId: item.id, qty: 1000, lineTotal: 1000 },
          { itemId: item.id, qty: 1000, lineTotal: 3000 },
        ],
      },
      ACTOR,
    );

    expect(result.purchase.total).toBe(4000);
    expect(result.purchase.lines).toHaveLength(2);

    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemRow?.wac).toBe(2);
    expect(itemRow?.replacementCost).toBe(3); // last line's unit cost (3), not the first line's (1)

    const stockRow = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockRow?.qtyOnHand).toBe(2000);

    // ONE items UPDATE per distinct item (not one per line) — verified indirectly: the final wac
    // reflects the SECOND line's threading, which would be wrong (wac=1, then overwritten to a
    // wac computed from the pre-purchase snapshot again) if two separate updates raced.
    const movementRows = await db.query.stockMovements.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, result.purchase.id),
    });
    expect(movementRows).toHaveLength(2);
  });

  it("updates WAC for a non-RAW_MATERIAL item but does NOT touch replacementCost (C-3 restricts that to RAW_MATERIAL)", async () => {
    const db = createDb(env.DB);
    // A FINISHED item bought as inventory (e.g. packaging bought pre-assembled) — purchases can
    // buy any item kind, but only RAW_MATERIAL gets its replacement_cost updated (C-3;
    // SEMI_FINISHED/FINISHED replacement cost is a recipe rollup, KOK-029, out of scope here).
    const item = await seedItem(db, "Finished packaging bought as stock", "FINISHED");

    await recordPurchase(
      db,
      {
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 2000 }],
      },
      ACTOR,
    );

    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemRow?.wac).toBe(2);
    expect(itemRow?.replacementCost).toBe(0); // untouched default
    expect(itemRow?.replacementCostUpdatedAt).toBeNull(); // untouched default
  });

  it("always server-recomputes total as Σ lineTotal", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Total recompute item");

    const result = await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [
          { itemId: item.id, qty: 500, lineTotal: 1000 },
          { itemId: item.id, qty: 500, lineTotal: 1500 },
        ],
      },
      ACTOR,
    );

    expect(result.purchase.total).toBe(2500);
  });

  it("a zero-total purchase (all lines free/promotional) skips the financial_transactions row entirely, leaving the account balance untouched, while still updating stock/WAC", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Zero-total purchase item");

    const result = await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 0 }], // free promotional stock
      },
      ACTOR,
    );

    expect(result.purchase.total).toBe(0);
    expect(result.account.balance).toBe(0);

    // No financial_transactions row at all — amount=0 would violate
    // financial_transactions_amount_check (amount > 0), and no cash actually moved.
    const txRow = await db.query.financialTransactions.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, result.purchase.id),
    });
    expect(txRow).toBeUndefined();

    const accountRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
    });
    expect(accountRow?.balance).toBe(0);

    // Stock/WAC/kardex are unaffected by the zero cost — they still reflect the free stock.
    const stockRow = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockRow?.qtyOnHand).toBe(1000);

    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemRow?.wac).toBe(0);
  });

  it("rejects a nonexistent account with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Nonexistent account item");

    await expect(
      recordPurchase(
        db,
        {
          accountId: "does_not_exist",
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [{ itemId: item.id, qty: 1000, lineTotal: 1000 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an inactive account with VALIDATION", async () => {
    const db = createDb(env.DB);
    await seedInactiveAccount(db, "acc_inactive_purchase_1");
    const item = await seedItem(db, "Inactive account item");

    await expect(
      recordPurchase(
        db,
        {
          accountId: "acc_inactive_purchase_1",
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [{ itemId: item.id, qty: 1000, lineTotal: 1000 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects a nonexistent item with NOT_FOUND, leaving the account balance unchanged", async () => {
    const db = createDb(env.DB);

    await expect(
      recordPurchase(
        db,
        {
          accountId: "acc_bank",
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [{ itemId: "item_does_not_exist", qty: 1000, lineTotal: 1000 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const accountRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
    });
    expect(accountRow?.balance).toBe(0);
  });

  it("rejects an empty lines array with VALIDATION (defensive re-check, D-2)", async () => {
    const db = createDb(env.DB);

    await expect(
      recordPurchase(
        db,
        {
          accountId: "acc_bank",
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

// KOK-024 D1. ADR-016 §1: the replay is owed to ANY create/edit/delete that lands behind an
// already-processed movement — a plain backdated CREATE included. Before this phase `recordPurchase`
// read `items.wac` / `item_stock.qty_on_hand` at their CURRENT value and applied C-1 regardless of
// `business_date`, with no ordering guard anywhere; these tests are that hole.
describe("recordPurchase — backdated capture: INV-11 replay guard (R-2/R-5, ADR-016)", () => {
  /**
   * The canonical scenario, numbers worked by hand (identical to costing-replay.test.ts's, so the
   * planner test and this committed-result test name the same regression from both sides).
   *
   * Recorded: P1 10 000 @ 2 (07-10) -> exit 8 000 (07-11, freezes snapshot 2) -> P2 10 000 @ 4
   * (07-12), leaving onHand 12 000 and wac 44 000/12 000 = 3.6667.
   *
   * Now 10 000 @ 10 is backdated to 07-10T12:00, BETWEEN P1 and the exit:
   *   prefix [P1] -> seed onHand 10 000, wac 2
   *   P3         -> wac (10 000·2 + 10 000·10)/20 000 = 6
   *   exit       -> consumes at 6, though it froze 2  => delta (2 − 6) × 8 000 = −32 000
   *   P2         -> wac (12 000·6 + 10 000·4)/22 000 = 112 000/22 000 = 5.0909…
   *
   * The naive pre-KOK-024 threading would instead have produced
   * (12 000·3.6667 + 10 000·10)/22 000 = 6.545…, so the assertion below discriminates the two.
   */
  it("refuses a backdated purchase landing behind an existing exit without `confirm`, carrying the impact", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Harina — compra retroactiva rechazada");

    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-10T10:00:00.000Z",
        businessDate: "2026-07-10",
        lines: [{ itemId: item.id, qty: 10_000, lineTotal: 20_000 }], // unit cost 2
      },
      ACTOR,
    );
    const exit = await recordExit(
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
        lines: [{ itemId: item.id, qty: 10_000, lineTotal: 40_000 }], // unit cost 4
      },
      ACTOR,
    );

    const balanceBefore = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
    });

    // R-5: 409 CONFLICT (Doc 08 §2) discriminated by `details.reason`, carrying the ReplayImpactDto
    // the confirmation dialog renders. NOT a new DomainErrorCode — see REPLAY_CONFIRMATION_REQUIRED.
    await expect(
      recordPurchase(
        db,
        {
          accountId: "acc_bank",
          occurredAt: "2026-07-10T12:00:00.000Z",
          businessDate: "2026-07-10",
          lines: [{ itemId: item.id, qty: 10_000, lineTotal: 100_000 }], // unit cost 10
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: {
        reason: "REPLAY_CONFIRMATION_REQUIRED",
        impact: {
          costDelta: -32_000,
          requiresConfirmation: true,
          affectedItemIds: [item.id],
          affectedStockExitIds: [exit.exit.id],
        },
      },
    });

    // Thrown BEFORE db.batch: not one row of the refused purchase exists, and no money moved.
    const movementRows = await db.query.stockMovements.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(movementRows).toHaveLength(3); // P1 + exit + P2 only
    const balanceAfter = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
    });
    expect(balanceAfter?.balance).toBe(balanceBefore?.balance);
    // Scoped to this test's own (uniquely-named) item: storage is isolated per FILE, not per test.
    expect(
      await db.select().from(costingAdjustments).where(eq(costingAdjustments.itemId, item.id)),
    ).toHaveLength(0);
  });

  it("commits the same purchase with `confirm: true`, landing the FULL-KARDEX WAC and booking the correction forward (R-4)", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Harina — compra retroactiva confirmada");

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
    const exit = await recordExit(
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

    const result = await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-10T12:00:00.000Z",
        businessDate: "2026-07-10",
        lines: [{ itemId: item.id, qty: 10_000, lineTotal: 100_000 }],
        confirm: true,
      },
      ACTOR,
    );

    // THE assertion of this phase. 5.0909… is the replay's answer; 6.545… is what the naive
    // threaded C-1 update would have written, and 3.6667 is what leaving the WAC alone would leave.
    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemRow?.wac).toBeCloseTo(112_000 / 22_000, 9);

    // ...and it equals a from-zero recompute over the whole committed kardex (R-2): whatever the
    // service and the planner each wrote, the stored cache agrees with the movements it summarizes.
    const kardex = await db.query.stockMovements.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
      orderBy: (t, { asc }) => [asc(t.occurredAt), asc(t.createdAt)],
    });
    expect(kardex).toHaveLength(4);
    expect(itemRow?.wac).toBeCloseTo(recomputeWacFromMovements(kardex), 9);

    // R-4: the correction is booked forward, and the exit's frozen snapshot is NOT rewritten.
    const adjustments = await db
      .select()
      .from(costingAdjustments)
      .where(eq(costingAdjustments.itemId, item.id));
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({
      itemId: item.id,
      triggerEventType: "purchase",
      triggerEventId: result.purchase.id,
      costDelta: -32_000,
    });
    const exitRow = await db.query.stockExits.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, exit.exit.id),
    });
    expect(exitRow?.unitCostSnapshot).toBe(2);

    // The purchase itself still behaves exactly like any other purchase (Σ lineTotal, cash out).
    expect(result.purchase.total).toBe(100_000);
    expect(result.account.balance).toBe(-160_000);
  });

  it("commits a backdated purchase with NO frozen consumer downstream WITHOUT `confirm`, still replaying the WAC", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Harina — retroactiva sin consumidores");

    // Two entries and nothing that consumed the item: INV-11 still fires (there IS a later
    // movement) but no already-reported cost is contradicted, so R-5 has nothing to confirm.
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
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-14T10:00:00.000Z",
        businessDate: "2026-07-14",
        lines: [{ itemId: item.id, qty: 10_000, lineTotal: 40_000 }],
      },
      ACTOR,
    );

    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-12T10:00:00.000Z",
        businessDate: "2026-07-12",
        lines: [{ itemId: item.id, qty: 10_000, lineTotal: 100_000 }],
      },
      ACTOR,
    );

    const kardex = await db.query.stockMovements.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
      orderBy: (t, { asc }) => [asc(t.occurredAt), asc(t.createdAt)],
    });
    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemRow?.wac).toBeCloseTo(recomputeWacFromMovements(kardex), 9);
    // Zero delta => no correction row (nothing downstream had frozen a cost).
    expect(
      await db.select().from(costingAdjustments).where(eq(costingAdjustments.itemId, item.id)),
    ).toHaveLength(0);
  });
});

// KOK-024 D1, C-3 as amended in Doc 03 §4: "last purchase unit cost" means last by `business_date`,
// not last RECORDED. Backdating last week's invoice must not roll today's replacement cost back to
// last week's price — in a high-inflation context that quietly makes C-5's margin look better than
// it is.
describe("recordPurchase — C-3 replacement_cost is last by business_date", () => {
  it("a BACKDATED purchase does not overwrite a replacement_cost set by a later-dated one; a FORWARD-dated one does", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Harina — C-3 por fecha de negocio");

    // 07-16 @ unit cost 5 — the current replacement cost.
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-16T10:00:00.000Z",
        businessDate: "2026-07-16",
        lines: [{ itemId: item.id, qty: 1_000, lineTotal: 5_000 }],
      },
      ACTOR,
    );
    const afterFirst = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(afterFirst?.replacementCost).toBe(5);

    // A backdated 07-14 invoice at unit cost 9 — captured late, but it is NOT the last price paid.
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-14T10:00:00.000Z",
        businessDate: "2026-07-14",
        lines: [{ itemId: item.id, qty: 1_000, lineTotal: 9_000 }],
      },
      ACTOR,
    );
    const afterBackdated = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(afterBackdated?.replacementCost).toBe(5); // unchanged — 07-16 is still the last date
    expect(afterBackdated?.replacementCostUpdatedAt).toBe(afterFirst?.replacementCostUpdatedAt);
    // The WAC, unlike the replacement cost, absolutely does move: it is a weighted average over
    // ALL entries, so a backdated one belongs in it (C-1 vs C-3 are different questions).
    expect(afterBackdated?.wac).toBeCloseTo(14_000 / 2_000, 9);

    // A forward-dated 07-18 invoice at unit cost 7 — this one IS the last price paid.
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-18T10:00:00.000Z",
        businessDate: "2026-07-18",
        lines: [{ itemId: item.id, qty: 1_000, lineTotal: 7_000 }],
      },
      ACTOR,
    );
    const afterForward = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(afterForward?.replacementCost).toBe(7);
  });

  it("keeps same-day capture order as the tiebreak: a second purchase on the SAME business_date still wins", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Harina — C-3 empate mismo día");

    for (const lineTotal of [5_000, 9_000]) {
      await recordPurchase(
        db,
        {
          accountId: "acc_bank",
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [{ itemId: item.id, qty: 1_000, lineTotal }],
        },
        ACTOR,
      );
    }

    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    // `>` not `>=` in the supersede check: two invoices on one day are ordered only by capture.
    expect(itemRow?.replacementCost).toBe(9);
  });
});

describe("reads: getPurchase / listPurchases", () => {
  it("getPurchase returns the purchase with its lines; NOT_FOUND for a missing id", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Read purchase item");
    const result = await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 2000 }],
      },
      ACTOR,
    );

    const fetched = await getPurchase(db, result.purchase.id);
    expect(fetched.id).toBe(result.purchase.id);
    expect(fetched.lines).toHaveLength(1);

    await expect(getPurchase(db, "does_not_exist")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("listPurchases filters by accountId and orders businessDate/createdAt desc", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "List purchase item");

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
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 1000 }],
      },
      ACTOR,
    );
    await recordPurchase(
      db,
      {
        accountId: "acc_cash",
        occurredAt: "2026-07-15T10:00:00.000Z",
        businessDate: "2026-07-15",
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 1000 }],
      },
      ACTOR,
    );

    const { purchases } = await listPurchases(db, { accountId: "acc_bank" });
    expect(purchases).toHaveLength(2);
    expect(purchases.map((p) => p.businessDate)).toEqual(["2026-07-16", "2026-07-14"]);
    expect(purchases.every((p) => p.accountId === "acc_bank")).toBe(true);
  });
});

describe("batch atomicity (INV-1)", () => {
  it("a failing statement in the same shape of batch as recordPurchase leaves the account balance and purchase rows unchanged", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Atomicity item");

    // Mirrors the statement shape recordPurchase() builds (purchase insert + account balance
    // update + a purchase_lines insert), but the purchase_lines row violates
    // purchase_lines_qty_check (qty must be > 0) — run as a raw D1 batch (not through
    // recordPurchase, whose own defensive checks would reject qty<=0 before ever reaching
    // db.batch) to prove the balance update ahead of it never lands either.
    await expect(
      env.DB.batch([
        env.DB.prepare(
          `INSERT INTO purchases (id, occurred_at, business_date, account_id, total, created_at, updated_at)
           VALUES ('purchase_atomicity_test', ?, ?, 'acc_bank', 1000, ?, ?)`,
        ).bind(NOW, BUSINESS_DATE, NOW, NOW),
        env.DB.prepare(
          "UPDATE financial_accounts SET balance = balance + -1000 WHERE id = 'acc_bank'",
        ),
        env.DB.prepare(
          `INSERT INTO purchase_lines (id, purchase_id, item_id, qty, line_total)
           VALUES ('line_atomicity_test', 'purchase_atomicity_test', ?, 0, 1000)`,
        ).bind(item.id),
      ]),
    ).rejects.toThrow();

    const purchaseRow = await env.DB.prepare(
      "SELECT id FROM purchases WHERE id = 'purchase_atomicity_test'",
    ).first();
    expect(purchaseRow).toBeNull();

    const accountRow = await env.DB.prepare(
      "SELECT balance FROM financial_accounts WHERE id = 'acc_bank'",
    ).first<{ balance: number }>();
    expect(accountRow?.balance).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Property test (Doc 11 §2, mandatory for money math per D-5/CLAUDE.md's "money math MUST
// add/extend a property-based test").
// ---------------------------------------------------------------------------

describe("property: purchase sequences keep item_stock and WAC consistent (INV-5 in miniature)", () => {
  it("∀ sequences of purchase commands against a fresh pair of items: qty_on_hand = Σ PURCHASE_IN qtys, and wac stays within [min(costs), max(costs)] of that item's entry unit costs", async () => {
    const db = createDb(env.DB);

    const lineArb = fc.record({
      itemIndex: fc.integer({ min: 0, max: 1 }),
      qty: fc.integer({ min: 1, max: 5000 }),
      lineTotal: fc.integer({ min: 0, max: 50000 }),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.array(lineArb, { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 5 }),
        async (purchaseLineGroups) => {
          // Fresh items every run (unique names, items.name is UNIQUE) so runs never interfere.
          const runId = generateUuidV7();
          const itemA = await seedItem(db, `Property item A ${runId}`);
          const itemB = await seedItem(db, `Property item B ${runId}`);
          const itemIds = [itemA.id, itemB.id] as const;

          const entryCostsByItem = new Map<string, number[]>([
            [itemA.id, []],
            [itemB.id, []],
          ]);
          const qtyByItem = new Map<string, number>([
            [itemA.id, 0],
            [itemB.id, 0],
          ]);

          for (const lines of purchaseLineGroups) {
            const commandLines = lines.map((l) => ({
              itemId: itemIds[l.itemIndex] ?? itemA.id,
              qty: l.qty,
              lineTotal: l.lineTotal,
            }));
            await recordPurchase(
              db,
              {
                accountId: "acc_bank",
                occurredAt: NOW,
                businessDate: BUSINESS_DATE,
                lines: commandLines,
              },
              ACTOR,
            );
            for (const cl of commandLines) {
              qtyByItem.set(cl.itemId, (qtyByItem.get(cl.itemId) ?? 0) + cl.qty);
              entryCostsByItem.get(cl.itemId)?.push(cl.lineTotal / cl.qty);
            }
          }

          for (const itemId of itemIds) {
            const stockRow = await db.query.itemStock.findFirst({
              where: (t, { eq: eqOp }) => eqOp(t.itemId, itemId),
            });
            expect(stockRow?.qtyOnHand ?? 0).toBe(qtyByItem.get(itemId) ?? 0);

            const costs = entryCostsByItem.get(itemId) ?? [];
            if (costs.length === 0) continue; // item never purchased this run — nothing to check.

            const itemRow = await db.query.items.findFirst({
              where: (t, { eq: eqOp }) => eqOp(t.id, itemId),
            });
            const min = Math.min(...costs);
            const max = Math.max(...costs);
            const epsilon = Math.max(1e-6, (max - min) * 1e-6 + 1e-6);
            expect(itemRow?.wac ?? 0).toBeGreaterThanOrEqual(min - epsilon);
            expect(itemRow?.wac ?? 0).toBeLessThanOrEqual(max + epsilon);
          }
        },
      ),
      { numRuns: 15 },
    );
  });
});

// ---------------------------------------------------------------------------
// KOK-024 Phase E: updatePurchase / deletePurchase (Doc 03 §7 R-1/R-3/R-4/R-5, INV-8/9/10, D-8).
//
// Mirrors test/exits.test.ts's updateStockExit/deleteStockExit section in structure and rigor, with
// the purchase-specific surface added on top: the cash side (financial_transactions + account
// balances) that exits never touch, and C-3 (replacement_cost, RAW_MATERIAL only). Every assertion
// below reads DB rows directly (stock_movements, items, financial_transactions,
// financial_accounts, costing_adjustments, audit_log, purchases), not just the returned DTO — the
// same discipline exits.test.ts's header states for exactly this reason.
// ---------------------------------------------------------------------------

async function purchaseMovements(db: TestDb, purchaseId: string) {
  return db.query.stockMovements.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, purchaseId),
  });
}

async function purchaseTx(db: TestDb, purchaseId: string) {
  return db.query.financialTransactions.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, purchaseId),
  });
}

describe("updatePurchase (R-1)", () => {
  it("descriptive-only edit (supplierName/notes) leaves the kardex byte-identical, writes no items UPDATE, no costing_adjustments row, and needs no confirmation", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Purchase edit — solo descriptivo");

    const created = await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        supplierName: "Proveedor A",
        notes: "antes",
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 2000 }], // unit cost 2
      },
      ACTOR,
    );

    const itemBefore = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemBefore?.wac).toBe(2);
    expect(itemBefore?.replacementCost).toBe(2);

    const movementsBefore = await purchaseMovements(db, created.purchase.id);
    expect(movementsBefore).toHaveLength(1);
    const movementIdBefore = movementsBefore[0]?.id;

    const updated = await updatePurchase(
      db,
      created.purchase.id,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        supplierName: "Proveedor B",
        notes: "después",
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 2000 }],
      },
      ACTOR,
    );

    expect(updated.purchase).toMatchObject({ supplierName: "Proveedor B", notes: "después" });

    // Kardex byte-identical (same qty/unitCost/dates) => NOT regenerated at all: same row, same id.
    const movementsAfter = await purchaseMovements(db, created.purchase.id);
    expect(movementsAfter).toHaveLength(1);
    expect(movementsAfter[0]?.id).toBe(movementIdBefore);

    // No `items` UPDATE at all: wac/replacementCost/replacementCostUpdatedAt/updatedAt untouched.
    const itemAfter = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemAfter?.wac).toBe(2);
    expect(itemAfter?.replacementCost).toBe(2);
    expect(itemAfter?.replacementCostUpdatedAt).toBe(itemBefore?.replacementCostUpdatedAt);
    expect(itemAfter?.updatedAt).toBe(itemBefore?.updatedAt);

    // No costing_adjustments row, and no "costing_replay" audit entry.
    expect(
      await db.select().from(costingAdjustments).where(eq(costingAdjustments.itemId, item.id)),
    ).toHaveLength(0);
    const replayAuditRow = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, created.purchase.id), eqOp(t.action, "costing_replay")),
    });
    expect(replayAuditRow).toBeUndefined();

    // Cash side is regenerated unconditionally (a genuine no-op here), so the balance is unchanged.
    const accountRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
    });
    expect(accountRow?.balance).toBe(-2000);

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, created.purchase.id), eqOp(t.action, "update")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "purchases" });
    const before = JSON.parse(auditRow?.beforeJson ?? "null");
    const after = JSON.parse(auditRow?.afterJson ?? "null");
    expect(before).toMatchObject({
      id: created.purchase.id,
      supplierName: "Proveedor A",
      notes: "antes",
    });
    expect(after).toMatchObject({
      id: created.purchase.id,
      supplierName: "Proveedor B",
      notes: "después",
    });
  });

  it("edit changing qty/unit cost with NO downstream history recomputes WAC/replacementCost automatically, no confirmation needed", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Purchase edit — qty/costo sin historial posterior");

    const created = await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 2000 }], // unit cost 2
      },
      ACTOR,
    );

    const updated = await updatePurchase(
      db,
      created.purchase.id,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 5000 }], // unit cost 5
      },
      ACTOR,
    );
    expect(updated.purchase.total).toBe(5000);

    const movements = await purchaseMovements(db, created.purchase.id);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ qty: 1000, unitCost: 5 });

    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemRow?.wac).toBe(5);
    expect(itemRow?.replacementCost).toBe(5);

    const stockRow = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockRow?.qtyOnHand).toBe(1000);

    expect(
      await db.select().from(costingAdjustments).where(eq(costingAdjustments.itemId, item.id)),
    ).toHaveLength(0);
  });

  it("edit changing a line BEFORE stock already consumed downstream requires confirmation, and commits the replayed WAC + a costing_adjustments row with confirm:true (R-4/R-5)", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Purchase edit — retroactivo con consumo posterior");

    const p1 = await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-10T10:00:00.000Z",
        businessDate: "2026-07-10",
        lines: [{ itemId: item.id, qty: 10_000, lineTotal: 20_000 }], // unit cost 2
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
        lines: [{ itemId: item.id, qty: 10_000, lineTotal: 40_000 }], // unit cost 4
      },
      ACTOR,
    );

    // Pre-edit wac = (2000*2 + 10000*4) / 12000 = 44000/12000 = 3.6667.
    const beforeEdit = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(beforeEdit?.wac).toBeCloseTo(44_000 / 12_000, 9);

    // Edits P1's own line from unit cost 2 to unit cost 10 — same dates, so this lands at the SAME
    // kardex point P1 already occupies, ahead of both exitA and P2 exactly as the analogous
    // backdated-CREATE test above does (same numbers, by design).
    const editCommand = {
      accountId: "acc_bank",
      occurredAt: "2026-07-10T10:00:00.000Z",
      businessDate: "2026-07-10",
      lines: [{ itemId: item.id, qty: 10_000, lineTotal: 100_000 }], // unit cost 10
    };

    await expect(updatePurchase(db, p1.purchase.id, editCommand, ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
      details: {
        reason: "REPLAY_CONFIRMATION_REQUIRED",
        impact: { requiresConfirmation: true, affectedStockExitIds: [exitA.exit.id] },
      },
    });

    // Thrown before db.batch: nothing about the purchase, its kardex, or the item's WAC moved.
    const purchaseRowAfterRefusal = await db.query.purchases.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, p1.purchase.id),
    });
    expect(purchaseRowAfterRefusal?.total).toBe(20_000);
    const itemAfterRefusal = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemAfterRefusal?.wac).toBeCloseTo(44_000 / 12_000, 9);
    expect(
      await db.select().from(costingAdjustments).where(eq(costingAdjustments.itemId, item.id)),
    ).toHaveLength(0);

    // Confirmed: P1@10 -> onHand 10000/wac10; exitA consumes 8000 (still freezes 2); P2 re-averages
    // (2000*10 + 10000*4) / 12000 = 60000/12000 = 5.
    const confirmed = await updatePurchase(
      db,
      p1.purchase.id,
      { ...editCommand, confirm: true },
      ACTOR,
    );
    expect(confirmed.purchase.total).toBe(100_000);

    const itemAfterConfirm = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemAfterConfirm?.wac).toBeCloseTo(5, 9);

    const kardex = await db.query.stockMovements.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
      orderBy: (t, { asc }) => [asc(t.occurredAt), asc(t.createdAt)],
    });
    expect(kardex).toHaveLength(3);
    expect(itemAfterConfirm?.wac).toBeCloseTo(recomputeWacFromMovements(kardex), 9);

    // R-4: the correction is booked forward as a costing_adjustments row, dated by the trigger
    // (this edit), and exitA's own frozen snapshot is READ, never rewritten.
    const adjustments = await db
      .select()
      .from(costingAdjustments)
      .where(eq(costingAdjustments.itemId, item.id));
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({
      itemId: item.id,
      triggerEventType: "purchase",
      triggerEventId: p1.purchase.id,
      costDelta: -64_000, // (2 - 10) * 8000
    });
    const exitRow = await db.query.stockExits.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, exitA.exit.id),
    });
    expect(exitRow?.unitCostSnapshot).toBe(2);

    // Cash: P1's tx is regenerated at the corrected total; P2's is untouched. Old total was
    // -20000 (P1) + -40000 (P2) = -60000; the corrected P1 total (-100000) replaces the old
    // (-20000) leaving -140000.
    const accountRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
    });
    expect(accountRow?.balance).toBe(-140_000);
  });

  it("edit moving the purchase to a different financial account nets exactly two account balance deltas", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Purchase edit — cambio de cuenta");

    const created = await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 4000 }],
      },
      ACTOR,
    );
    expect(created.account.balance).toBe(-4000);

    const updated = await updatePurchase(
      db,
      created.purchase.id,
      {
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 4000 }],
      },
      ACTOR,
    );

    expect(updated.purchase.accountId).toBe("acc_cash");
    expect(updated.account.id).toBe("acc_cash");
    expect(updated.account.balance).toBe(-4000);

    const bankRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
    });
    const cashRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_cash"),
    });
    expect(bankRow?.balance).toBe(0); // fully reversed, not left at some partial value
    expect(cashRow?.balance).toBe(-4000); // debited on the destination account, not double-counted

    const txRow = await purchaseTx(db, created.purchase.id);
    expect(txRow).toMatchObject({ accountId: "acc_cash", amount: 4000 });
  });

  it("rejects an unknown or already-deleted purchase with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Purchase edit — not found");
    const command = {
      accountId: "acc_bank",
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId: item.id, qty: 100, lineTotal: 200 }],
    };

    await expect(updatePurchase(db, "does_not_exist", command, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const created = await recordPurchase(db, command, ACTOR);
    await deletePurchase(db, created.purchase.id, {}, ACTOR);
    await expect(updatePurchase(db, created.purchase.id, command, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects an empty lines array with VALIDATION (defensive re-check, D-2)", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Purchase edit — lines vacío");
    const created = await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 100, lineTotal: 200 }],
      },
      ACTOR,
    );

    await expect(
      updatePurchase(
        db,
        created.purchase.id,
        {
          accountId: "acc_bank",
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("deletePurchase (R-3, D-8)", () => {
  it("delete of an untouched purchase reverses kardex/cash and recomputes WAC/replacementCost as if it never existed (no other purchase => falls back to 0)", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Purchase delete — sin consumo");

    const created = await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 2000 }], // unit cost 2
      },
      ACTOR,
    );

    await deletePurchase(db, created.purchase.id, {}, ACTOR);

    // D-8/R-3: the row survives, flagged — never hard-deleted. (PurchaseDto carries no
    // `deletedAt` field of its own — Doc 04 §3.3 keeps that column server-internal — so this is
    // read from the row directly, exactly as getPurchase/listPurchases below prove it via absence.)
    const row = await db.query.purchases.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, created.purchase.id),
    });
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.total).toBe(2000);

    // INV-9: the derived kardex rows are hard-deleted (D-8's carve-out), no orphans.
    expect(await purchaseMovements(db, created.purchase.id)).toHaveLength(0);

    const stockRow = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockRow?.qtyOnHand).toBe(0); // fully reversed

    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemRow?.wac).toBe(0); // no kardex left to average
    expect(itemRow?.replacementCost).toBe(0); // C-3: no live purchase left to name a price

    // Cash reversed entirely: no financial_transactions row survives, balance back to 0.
    expect(await purchaseTx(db, created.purchase.id)).toBeUndefined();
    const accountRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
    });
    expect(accountRow?.balance).toBe(0);

    // Invisible to both reads.
    await expect(getPurchase(db, created.purchase.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const { purchases: list } = await listPurchases(db, { accountId: "acc_bank" });
    expect(list.map((p) => p.id)).not.toContain(created.purchase.id);

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, created.purchase.id), eqOp(t.action, "delete")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "purchases" });
    const after = JSON.parse(auditRow?.afterJson ?? "null");
    expect(after.deletedAt).toEqual(expect.any(String));
  });

  it("delete of a purchase whose stock has ALREADY been consumed (INV-8) drives qty_on_hand negative, sets negative_since, and requires confirm when the replay contradicts a frozen exit", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Purchase delete — INV-8 consumo previo");

    const created = await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-10T10:00:00.000Z",
        businessDate: "2026-07-10",
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 2000 }], // unit cost 2
      },
      ACTOR,
    );
    const exit = await recordExit(
      db,
      {
        itemId: item.id,
        qty: 1000,
        reason: "WASTE",
        occurredAt: "2026-07-11T10:00:00.000Z",
        businessDate: "2026-07-11",
      },
      ACTOR,
    );

    const stockBefore = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockBefore?.qtyOnHand).toBe(0);

    // Refused without confirm: removing the only supply this exit ever consumed contradicts its
    // frozen snapshot (2) with the replayed WAC once the purchase is gone (0).
    await expect(deletePurchase(db, created.purchase.id, {}, ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
      details: {
        reason: "REPLAY_CONFIRMATION_REQUIRED",
        impact: { requiresConfirmation: true, affectedStockExitIds: [exit.exit.id] },
      },
    });
    const stillThere = await db.query.purchases.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, created.purchase.id),
    });
    expect(stillThere?.deletedAt).toBeNull();

    // INV-8: this is PERMITTED and drives qty_on_hand negative — never a blocking error.
    await deletePurchase(db, created.purchase.id, { confirm: true }, ACTOR);

    expect(await purchaseMovements(db, created.purchase.id)).toHaveLength(0);

    const stockAfter = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockAfter?.qtyOnHand).toBe(-1000);
    expect(stockAfter?.negativeSince).toEqual(expect.any(String));

    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemRow?.wac).toBe(0); // no PURCHASE_IN left to average against

    const adjustments = await db
      .select()
      .from(costingAdjustments)
      .where(eq(costingAdjustments.itemId, item.id));
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({
      itemId: item.id,
      triggerEventType: "purchase",
      triggerEventId: created.purchase.id,
      costDelta: 2000, // (frozen 2 - replayed 0) * 1000
    });

    // R-4: the exit's own frozen snapshot survives untouched.
    const exitRow = await db.query.stockExits.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, exit.exit.id),
    });
    expect(exitRow?.unitCostSnapshot).toBe(2);
  });

  it("C-3: deleting the LATER of two purchases falls the replacement_cost back to the earlier live purchase's unit cost", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Purchase delete — C-3 fallback a la anterior");

    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-10T10:00:00.000Z",
        businessDate: "2026-07-10",
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 5000 }], // unit cost 5
      },
      ACTOR,
    );
    const later = await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-14T10:00:00.000Z",
        businessDate: "2026-07-14",
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 9000 }], // unit cost 9
      },
      ACTOR,
    );

    const beforeDelete = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(beforeDelete?.replacementCost).toBe(9);

    await deletePurchase(db, later.purchase.id, {}, ACTOR);

    const afterDelete = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(afterDelete?.replacementCost).toBe(5); // falls back to the earlier LIVE purchase
    expect(afterDelete?.wac).toBe(5); // only the earlier purchase's entry remains
  });

  it("rejects an unknown or already-deleted purchase with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Purchase delete — not found");
    const created = await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 100, lineTotal: 200 }],
      },
      ACTOR,
    );

    await expect(deletePurchase(db, "does_not_exist", {}, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    await deletePurchase(db, created.purchase.id, {}, ACTOR);
    await expect(deletePurchase(db, created.purchase.id, {}, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
