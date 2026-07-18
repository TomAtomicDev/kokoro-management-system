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
import { getPurchase, listPurchases, recordPurchase } from "../src/core/purchasing/index.js";
import { createDb } from "../src/db/index.js";
import { auditLog, financialAccounts, financialTransactions, purchases } from "../src/db/schema.js";

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
