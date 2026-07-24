// Integration tests for core/sales/index.ts (KOK-030, Doc 03 UC-03, Doc 04 §3.3 `sales`/`sale_lines`
// + §5). Follows the Doc 11 §3 template: seed via createItem/recordPurchase (the same seams
// purchasing.test.ts / exits.test.ts use) -> execute recordSale -> assert the sales row + sale_lines
// + SALE_OUT kardex + item_stock + financial side + audit_log, run against real D1 via
// @cloudflare/vitest-pool-workers.
//
// The most discriminating assertions in this file:
//   - PAID books an INCOME/SALE financial_transactions row and CREDITS the account; ON_CREDIT books
//     NEITHER (Doc 03 / Doc 04 §3.3) — the receivable is collected later (KOK-031).
//   - a sale FREEZES its unit_cost_snapshot at the item's current WAC but NEVER moves that WAC
//     (C-6 spirit / R-4). A "helpful" items.wac write on the sale path is exactly the bug guarded here.
//   - negative stock is ALLOWED (INV-8): overselling flags item_stock, it does not throw.
//   - sales.total is server-recomputed as Σ(qty × unit_price); the command has no `total` field.
//
// Storage is isolated per test FILE (mirrors exits.test.ts): the beforeEach clears sales / sale_lines
// / their movements / sale + purchase transactions / audit rows and resets both accounts to 0. Items
// get unique names per test (items.name is UNIQUE) so seeded rows never collide.
import { env } from "cloudflare:test";
import { addMoney, generateUuidV7, mulMoneyByQty } from "@kokoro/shared";
import { eq, inArray } from "drizzle-orm";
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";

import { createItem } from "../src/core/catalog/index.js";
import { recordPurchase } from "../src/core/purchasing/index.js";
import { getSale, listSales, recordSale } from "../src/core/sales/index.js";
import { createDb } from "../src/db/index.js";
import {
  auditLog,
  customers,
  financialAccounts,
  financialTransactions,
  saleLines,
  sales,
  stockMovements,
} from "../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;
const NOW = "2026-07-16T10:00:00.000Z";
const BUSINESS_DATE = "2026-07-16";

type TestDb = ReturnType<typeof createDb>;

/** A FINISHED item (the only kind a sale line may reference, Doc 04 §5). */
async function seedFinishedItem(db: TestDb, name: string) {
  return createItem(db, { name, kind: "FINISHED", category: "BAKERY", unit: "UNIT" }, ACTOR);
}

/** A FINISHED item with stock + a non-trivial WAC to snapshot from. recordPurchase does not restrict
 * item kind (findFirst, no isActive/kind check), so it is a convenient seam for giving a FINISHED
 * item a known WAC in a test — the same trick exits.test.ts uses. */
async function seedStockedFinishedItem(db: TestDb, name: string, qty: number, lineTotal: number) {
  const item = await seedFinishedItem(db, name);
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

async function accountBalance(db: TestDb, id: string): Promise<number> {
  const row = await db.query.financialAccounts.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, id),
  });
  return row?.balance ?? 0;
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(auditLog).where(eq(auditLog.entityType, "sales"));
  await db.delete(stockMovements).where(eq(stockMovements.sourceEventType, "sale"));
  await db
    .delete(financialTransactions)
    .where(inArray(financialTransactions.sourceEventType, ["sale", "purchase"]));
  await db.delete(saleLines);
  await db.delete(sales);
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("recordSale — PAID (UC-03)", () => {
  it("records a PAID sale: sales row, sale_lines, SALE_OUT movement, item_stock decrement, WAC UNCHANGED, INCOME/SALE tx, account CREDITED, paid_at set, audit_log", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Sale — paid item", 1000, 6000); // wac 6

    const itemAfterPurchase = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemAfterPurchase?.wac).toBe(6);

    const result = await recordSale(
      db,
      {
        paymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        notes: "Venta mostrador",
        lines: [{ itemId: item.id, qty: 200, unitPrice: 1000 }], // 0.2 units × Bs 10 = Bs 2.00
      },
      ACTOR,
    );

    // total = mulMoneyByQty(1000, 200) = round(1000 * 200 / 1000) = 200.
    expect(result.sale).toMatchObject({
      channel: "CATALOG",
      paymentStatus: "PAID",
      paymentMethod: "CASH",
      accountId: "acc_cash",
      total: 200,
      paidAt: NOW,
      notes: "Venta mostrador",
    });
    expect(result.sale.lines).toEqual([
      expect.objectContaining({ itemId: item.id, qty: 200, unitPrice: 1000, unitCostSnapshot: 6 }),
    ]);
    expect(result.account).toMatchObject({ id: "acc_cash", balance: 200 });

    const saleRow = await db.query.sales.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, result.sale.id),
    });
    expect(saleRow).toMatchObject({
      total: 200,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
      accountId: "acc_cash",
      paidAt: NOW,
    });

    const movementRow = await db.query.stockMovements.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, result.sale.id),
    });
    expect(movementRow).toMatchObject({
      type: "SALE_OUT",
      qty: -200,
      unitCost: 6,
      totalCost: -1200,
      sourceEventType: "sale",
    });

    const stockRow = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockRow?.qtyOnHand).toBe(800); // 1000 − 200

    // C-6 spirit: the sale must NOT have moved items.wac.
    const itemAfterSale = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemAfterSale?.wac).toBe(6);

    // The income row: INCOME / SALE, positive amount, sourced to the sale.
    const txRows = await db.query.financialTransactions.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, result.sale.id),
    });
    expect(txRows).toHaveLength(1);
    expect(txRows[0]).toMatchObject({
      type: "INCOME",
      category: "SALE",
      amount: 200,
      accountId: "acc_cash",
      sourceEventType: "sale",
    });
    expect(await accountBalance(db, "acc_cash")).toBe(200);

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, result.sale.id), eqOp(t.action, "create")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "sales" });
  });

  it("recomputes total as Σ(qty × unit_price) across multiple lines, ignoring any notion of a client total", async () => {
    const db = createDb(env.DB);
    const itemA = await seedStockedFinishedItem(db, "Sale — multiline A", 10_000, 20_000); // wac 2
    const itemB = await seedStockedFinishedItem(db, "Sale — multiline B", 10_000, 50_000); // wac 5

    const result = await recordSale(
      db,
      {
        paymentStatus: "PAID",
        paymentMethod: "BANK_QR",
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [
          { itemId: itemA.id, qty: 1500, unitPrice: 800 }, // round(800*1500/1000) = 1200
          { itemId: itemB.id, qty: 250, unitPrice: 333 }, // round(333*250/1000) = 83 (83.25 → 83)
        ],
      },
      ACTOR,
    );

    const expectedTotal = addMoney(mulMoneyByQty(800, 1500), mulMoneyByQty(333, 250));
    expect(expectedTotal).toBe(1283);
    expect(result.sale.total).toBe(1283);
    expect(result.sale.lines).toHaveLength(2);

    // Each line snapshots its own item's WAC.
    const byItem = new Map(result.sale.lines.map((l) => [l.itemId, l.unitCostSnapshot]));
    expect(byItem.get(itemA.id)).toBe(2);
    expect(byItem.get(itemB.id)).toBe(5);
  });

  it("PAID with an inactive/unknown account is rejected before any write", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Sale — bad account", 1000, 1000);

    await expect(
      recordSale(
        db,
        {
          paymentStatus: "PAID",
          paymentMethod: "CASH",
          accountId: "acc_does_not_exist",
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [{ itemId: item.id, qty: 100, unitPrice: 500 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Nothing written: no sales row for this item's would-be sale.
    const rows = await db.query.sales.findMany();
    expect(rows).toHaveLength(0);
  });
});

describe("recordSale — ON_CREDIT (UC-03, receivable)", () => {
  it("records an ON_CREDIT sale: stock leaves, but NO financial transaction, NO account movement, paid_at/method/account all null", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Sale — credit item", 1000, 4000); // wac 4

    // Balances after seeding (the seed purchase debited acc_bank) but BEFORE the sale — the
    // ON_CREDIT sale must leave BOTH exactly as they are.
    const bankBefore = await accountBalance(db, "acc_bank");
    const cashBefore = await accountBalance(db, "acc_cash");

    const result = await recordSale(
      db,
      {
        paymentStatus: "ON_CREDIT",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 300, unitPrice: 2000 }], // total 600
      },
      ACTOR,
    );

    expect(result.sale).toMatchObject({
      paymentStatus: "ON_CREDIT",
      total: 600,
      paidAt: null,
      paymentMethod: null,
      accountId: null,
    });
    expect(result.account).toBeNull();

    // Stock still leaves.
    const stockRow = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockRow?.qtyOnHand).toBe(700);

    // No cash side at all (the money arrives later via collectPayment, KOK-031).
    const txRows = await db.query.financialTransactions.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventType, "sale"),
    });
    expect(txRows).toHaveLength(0);
    expect(await accountBalance(db, "acc_bank")).toBe(bankBefore);
    expect(await accountBalance(db, "acc_cash")).toBe(cashBefore);

    // The SALE_OUT movement still froze its cost snapshot.
    const movementRow = await db.query.stockMovements.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, result.sale.id),
    });
    expect(movementRow).toMatchObject({ type: "SALE_OUT", qty: -300, unitCost: 4 });
  });
});

describe("recordSale — validation & INV-8", () => {
  it("rejects a non-FINISHED item line with VALIDATION (Doc 04 §5, service-enforced)", async () => {
    const db = createDb(env.DB);
    const raw = await createItem(
      db,
      { name: "Sale — raw material", kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "KG" },
      ACTOR,
    );
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: raw.id, qty: 1000, lineTotal: 1000 }],
      },
      ACTOR,
    );

    await expect(
      recordSale(
        db,
        {
          paymentStatus: "PAID",
          paymentMethod: "CASH",
          accountId: "acc_cash",
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [{ itemId: raw.id, qty: 100, unitPrice: 500 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects a nonexistent item with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    await expect(
      recordSale(
        db,
        {
          paymentStatus: "ON_CREDIT",
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [{ itemId: "item_does_not_exist", qty: 100, unitPrice: 500 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("INV-8: overselling drives qty_on_hand negative and flags negative_since — it is NOT an error", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Sale — oversell", 500, 2500); // wac 5, on hand 500

    const result = await recordSale(
      db,
      {
        paymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 800, unitPrice: 1000 }], // more than the 500 on hand
      },
      ACTOR,
    );
    expect(result.sale.total).toBe(800);

    const stockRow = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockRow?.qtyOnHand).toBe(-300); // 500 − 800, negative allowed
    expect(stockRow?.negativeSince).toEqual(expect.any(String)); // INV-8 flag raised
  });
});

describe("recordSale — multi-line same item (one batch, netted stock)", () => {
  it("threads two lines of the same item: two sale_lines, two SALE_OUT movements, one netted item_stock delta", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Sale — same item twice", 2000, 6000); // wac 3

    const result = await recordSale(
      db,
      {
        paymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [
          { itemId: item.id, qty: 300, unitPrice: 1000 }, // 300
          { itemId: item.id, qty: 500, unitPrice: 1200 }, // 600
        ],
      },
      ACTOR,
    );

    expect(result.sale.total).toBe(900);
    expect(result.sale.lines).toHaveLength(2);
    // Both lines snapshot the same current WAC (a sale never moves WAC mid-sale).
    expect(result.sale.lines.every((l) => l.unitCostSnapshot === 3)).toBe(true);

    const movements = await db.query.stockMovements.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, result.sale.id),
    });
    expect(movements).toHaveLength(2);

    const stockRow = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockRow?.qtyOnHand).toBe(1200); // 2000 − 300 − 500
  });
});

describe("reads: getSale / listSales", () => {
  it("getSale returns the sale with lines; NOT_FOUND for a missing id", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Read sale item", 1000, 3000);
    const result = await recordSale(
      db,
      {
        paymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 100, unitPrice: 500 }],
      },
      ACTOR,
    );

    const fetched = await getSale(db, result.sale.id);
    expect(fetched.id).toBe(result.sale.id);
    expect(fetched.lines).toHaveLength(1);

    await expect(getSale(db, "does_not_exist")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("listSales filters by paymentStatus, customerId, and date range", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "List sale item", 100_000, 100_000);
    const customerId = generateUuidV7();
    await db
      .insert(customers)
      .values({ id: customerId, name: "Cliente prueba", createdAt: NOW, updatedAt: NOW });

    // PAID on 07-14.
    await recordSale(
      db,
      {
        paymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
        occurredAt: "2026-07-14T10:00:00.000Z",
        businessDate: "2026-07-14",
        lines: [{ itemId: item.id, qty: 100, unitPrice: 500 }],
      },
      ACTOR,
    );
    // ON_CREDIT to a known customer on 07-16.
    await recordSale(
      db,
      {
        paymentStatus: "ON_CREDIT",
        customerId,
        occurredAt: "2026-07-16T10:00:00.000Z",
        businessDate: "2026-07-16",
        lines: [{ itemId: item.id, qty: 100, unitPrice: 500 }],
      },
      ACTOR,
    );

    const { sales: paid } = await listSales(db, { paymentStatus: "PAID" });
    expect(paid.every((s) => s.paymentStatus === "PAID")).toBe(true);
    expect(paid.length).toBeGreaterThanOrEqual(1);

    const { sales: credit } = await listSales(db, { paymentStatus: "ON_CREDIT" });
    expect(credit.every((s) => s.paymentStatus === "ON_CREDIT")).toBe(true);

    const { sales: byCustomer } = await listSales(db, { customerId });
    expect(byCustomer).toHaveLength(1);
    expect(byCustomer[0]?.customerId).toBe(customerId);

    const { sales: byDate } = await listSales(db, { fromDate: "2026-07-16", toDate: "2026-07-16" });
    expect(byDate.every((s) => s.businessDate === "2026-07-16")).toBe(true);
  });
});

describe("batch atomicity (INV-1)", () => {
  it("a failing sale_lines insert (qty<=0 CHECK) in the same shape of batch leaves nothing persisted", async () => {
    const db = createDb(env.DB);
    const item = await seedFinishedItem(db, "Atomicity sale item");

    // Mirrors the statement shape recordSale builds (sales insert + sale_lines insert), but the
    // sale_lines row violates sale_lines_qty_check (qty must be > 0) — run as a raw D1 batch to
    // prove the sales insert alongside it never lands either.
    await expect(
      env.DB.batch([
        env.DB.prepare(
          `INSERT INTO sales (id, occurred_at, business_date, channel, total, payment_status, created_at, updated_at)
           VALUES ('sale_atomicity_test', ?, ?, 'CATALOG', 0, 'ON_CREDIT', ?, ?)`,
        ).bind(NOW, BUSINESS_DATE, NOW, NOW),
        env.DB.prepare(
          `INSERT INTO sale_lines (id, sale_id, item_id, qty, unit_price, unit_cost_snapshot)
           VALUES ('sale_line_atomicity_test', 'sale_atomicity_test', ?, 0, 500, 0)`,
        ).bind(item.id),
      ]),
    ).rejects.toThrow();

    const saleRow = await env.DB.prepare(
      "SELECT id FROM sales WHERE id = 'sale_atomicity_test'",
    ).first();
    expect(saleRow).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Property test (Doc 11 §2, mandatory for money/stock math per D-5/CLAUDE.md).
// ---------------------------------------------------------------------------

describe("property: sale total = Σ round(qty × unit_price) and on-hand nets every line's qty", () => {
  it("∀ multi-line sales against a fixed item: stored total equals the independent Σ, no centavo lost", async () => {
    const db = createDb(env.DB);

    const lineArb = fc.record({
      qty: fc.integer({ min: 1, max: 5000 }),
      unitPrice: fc.integer({ min: 0, max: 50_000 }),
    });

    await fc.assert(
      fc.asyncProperty(fc.array(lineArb, { minLength: 1, maxLength: 8 }), async (lines) => {
        const runId = generateUuidV7();
        const item = await seedFinishedItem(db, `Property sale item ${runId}`);

        const result = await recordSale(
          db,
          {
            paymentStatus: "ON_CREDIT",
            occurredAt: NOW,
            businessDate: BUSINESS_DATE,
            lines: lines.map((l) => ({ itemId: item.id, qty: l.qty, unitPrice: l.unitPrice })),
          },
          ACTOR,
        );

        const expectedTotal = addMoney(...lines.map((l) => mulMoneyByQty(l.unitPrice, l.qty)));
        expect(result.sale.total).toBe(expectedTotal);

        const expectedOnHand = -lines.reduce((sum, l) => sum + l.qty, 0);
        const stockRow = await db.query.itemStock.findFirst({
          where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
        });
        expect(stockRow?.qtyOnHand ?? 0).toBe(expectedOnHand);
      }),
      { numRuns: 15 },
    );
  });
});
