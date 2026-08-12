// Integration tests for core/sales/index.ts (KOK-030/KOK-031, Doc 03 UC-03/UC-04, Doc 04 §3.3
// `sales`/`sale_lines` + §5). Follows the Doc 11 §3 template: seed via createItem/recordPurchase
// (the same seams purchasing.test.ts / exits.test.ts use) -> execute recordSale -> assert the
// sales row + sale_lines + SALE_OUT kardex + item_stock + financial side + audit_log, run against
// real D1 via @cloudflare/vitest-pool-workers.
//
// The most discriminating assertions in this file:
//   - PAID books an INCOME/SALE financial_transactions row and CREDITS the account; ON_CREDIT books
//     NEITHER (Doc 03 / Doc 04 §3.3) — the receivable is collected later via collectPayment.
//   - collectPayment (UC-04, KOK-031) flips ON_CREDIT -> PAID, books an INCOME/DEBT_COLLECTION row
//     (not SALE — that category is reserved for cash collected at sale time), and only a sale
//     already ON_CREDIT may be collected (re-collecting a PAID sale is a CONFLICT, not a no-op).
//   - a sale FREEZES its unit_cost_snapshot_mc at the item's current WAC but NEVER moves that WAC
//     (C-6 spirit / R-4). A "helpful" items.wac_mc write on the sale path is exactly the bug guarded here.
//   - negative stock is ALLOWED (INV-8): overselling flags item_stock, it does not throw.
//   - sales.total is server-recomputed as Σ(qty × unit_price_mc); the command has no `total` field.
//
// Storage is isolated per test FILE (mirrors exits.test.ts): the beforeEach clears sales / sale_lines
// / their movements / sale + purchase transactions / audit rows and resets both accounts to 0. Items
// get unique names per test (items.name is UNIQUE) so seeded rows never collide.
import { env } from "cloudflare:test";
import {
  addMoney,
  generateUuidV7,
  toCentavos,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
} from "@kokoro/shared";
import { eq, inArray } from "drizzle-orm";
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";

import { createItem } from "../src/core/catalog/index.js";
import { recordExit } from "../src/core/inventory/exits.js";
import { recordPurchase } from "../src/core/purchasing/index.js";
import {
  collectPayment,
  deleteSale,
  getSale,
  listReceivables,
  listSales,
  previewSaleImpact,
  recordSale,
  restoreSale,
  updateSale,
} from "../src/core/sales/index.js";
import { createDb } from "../src/db/index.js";
import {
  auditLog,
  costingAdjustments,
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

/** A FINISHED item (one of the two kinds a catalog sale line may reference, Doc 04 §5). */
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
    expect(itemAfterPurchase?.wacMc).toBe(6_000_000);

    const result = await recordSale(
      db,
      {
        paymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        notes: "Venta mostrador",
        lines: [{ itemId: item.id, qty: 200, unitPriceMc: 1_000_000 }], // 0.2 units × Bs 10 = Bs 2.00
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
      expect.objectContaining({
        itemId: item.id,
        qty: 200,
        unitPriceMc: 1_000_000,
        unitCostSnapshotMc: 6_000_000,
      }),
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
      unitCostMc: 6_000_000,
      totalCost: -1200,
      sourceEventType: "sale",
    });

    const stockRow = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockRow?.qtyOnHand).toBe(800); // 1000 − 200

    // C-6 spirit: the sale must NOT have moved items.wac_mc.
    const itemAfterSale = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemAfterSale?.wacMc).toBe(6_000_000);

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

  it("recomputes total as Σ(qty × unit_price_mc) across multiple lines, ignoring any notion of a client total", async () => {
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
          { itemId: itemA.id, qty: 1500, unitPriceMc: 800_000 }, // round(800*1500/1000) = 1200
          { itemId: itemB.id, qty: 250, unitPriceMc: 333_000 }, // round(333*250/1000) = 83 (83.25 → 83)
        ],
      },
      ACTOR,
    );

    const expectedTotal = addMoney(
      totalCentavos(toMilliCentavosPerUnit(800_000), toMilliUnits(1500)),
      totalCentavos(toMilliCentavosPerUnit(333_000), toMilliUnits(250)),
    );
    expect(expectedTotal).toBe(1283);
    expect(result.sale.total).toBe(1283);
    expect(result.sale.lines).toHaveLength(2);

    // Each line snapshots its own item's WAC.
    const byItem = new Map(result.sale.lines.map((l) => [l.itemId, l.unitCostSnapshotMc]));
    expect(byItem.get(itemA.id)).toBe(2_000_000);
    expect(byItem.get(itemB.id)).toBe(5_000_000);
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
          lines: [{ itemId: item.id, qty: 100, unitPriceMc: 500_000 }],
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
        lines: [{ itemId: item.id, qty: 300, unitPriceMc: 2_000_000 }], // total 600
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
    expect(movementRow).toMatchObject({ type: "SALE_OUT", qty: -300, unitCostMc: 4_000_000 });
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
          lines: [{ itemId: raw.id, qty: 100, unitPriceMc: 500_000 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      message_es: "Solo se pueden vender ítems terminados (FINISHED) o de empaque (PACKAGING).",
    });
  });

  it("accepts FINISHED and PACKAGING lines, freezing each WAC and charging only the finished line", async () => {
    const db = createDb(env.DB);
    const finished = await seedStockedFinishedItem(
      db,
      "Sale — finished with packaging",
      1000,
      6000,
    );
    const packaging = await createItem(
      db,
      {
        name: "Sale — packaging line",
        kind: "PACKAGING",
        category: "NOT_EATABLE",
        unit: "UNIT",
        minStockQty: 0,
      },
      ACTOR,
    );
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: packaging.id, qty: 1000, lineTotal: 2000 }],
      },
      ACTOR,
    );

    const result = await recordSale(
      db,
      {
        paymentStatus: "ON_CREDIT",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [
          { itemId: finished.id, qty: 200, unitPriceMc: 1_000_000 },
          { itemId: packaging.id, qty: 200, unitPriceMc: 0 },
        ],
      },
      ACTOR,
    );

    expect(result.sale.total).toBe(200);
    expect(result.sale.lines).toEqual([
      expect.objectContaining({
        itemId: finished.id,
        unitCostSnapshotMc: 6_000_000,
        unitPriceMc: 1_000_000,
      }),
      expect.objectContaining({
        itemId: packaging.id,
        unitCostSnapshotMc: 2_000_000,
        unitPriceMc: 0,
      }),
    ]);

    const movementRows = await db.query.stockMovements.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, result.sale.id),
    });
    expect(movementRows).toHaveLength(2);
    expect(movementRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: finished.id,
          type: "SALE_OUT",
          qty: -200,
          unitCostMc: 6_000_000,
        }),
        expect.objectContaining({
          itemId: packaging.id,
          type: "SALE_OUT",
          qty: -200,
          unitCostMc: 2_000_000,
        }),
      ]),
    );
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
          lines: [{ itemId: "item_does_not_exist", qty: 100, unitPriceMc: 500_000 }],
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
        lines: [{ itemId: item.id, qty: 800, unitPriceMc: 1_000_000 }], // more than the 500 on hand
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
          { itemId: item.id, qty: 300, unitPriceMc: 1_000_000 }, // 300
          { itemId: item.id, qty: 500, unitPriceMc: 1_200_000 }, // 600
        ],
      },
      ACTOR,
    );

    expect(result.sale.total).toBe(900);
    expect(result.sale.lines).toHaveLength(2);
    // Both lines snapshot the same current WAC (a sale never moves WAC mid-sale).
    expect(result.sale.lines.every((l) => l.unitCostSnapshotMc === 3_000_000)).toBe(true);

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
        lines: [{ itemId: item.id, qty: 100, unitPriceMc: 500_000 }],
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
        lines: [{ itemId: item.id, qty: 100, unitPriceMc: 500_000 }],
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
        lines: [{ itemId: item.id, qty: 100, unitPriceMc: 500_000 }],
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

describe("collectPayment (UC-04, KOK-031)", () => {
  it("collects a receivable: sale becomes PAID, paid_at/method/account set, DEBT_COLLECTION income booked, account credited, audit_log row", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Collect — happy path", 1000, 4000); // wac 4
    const sale = await recordSale(
      db,
      {
        paymentStatus: "ON_CREDIT",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 300, unitPriceMc: 2_000_000 }], // total 600
      },
      ACTOR,
    );

    const collectedAt = "2026-07-20T09:00:00.000Z";
    const result = await collectPayment(
      db,
      sale.sale.id,
      {
        occurredAt: collectedAt,
        businessDate: "2026-07-20",
        paymentMethod: "CASH",
        accountId: "acc_cash",
      },
      ACTOR,
    );

    expect(result.sale).toMatchObject({
      paymentStatus: "PAID",
      paidAt: collectedAt,
      paymentMethod: "CASH",
      accountId: "acc_cash",
      total: 600,
    });
    expect(result.account).toMatchObject({ id: "acc_cash", balance: 600 });

    const saleRow = await db.query.sales.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, sale.sale.id),
    });
    expect(saleRow).toMatchObject({
      paymentStatus: "PAID",
      paidAt: collectedAt,
      paymentMethod: "CASH",
      accountId: "acc_cash",
    });

    const txRows = await db.query.financialTransactions.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, sale.sale.id),
    });
    expect(txRows).toHaveLength(1);
    expect(txRows[0]).toMatchObject({
      type: "INCOME",
      category: "DEBT_COLLECTION",
      amount: 600,
      accountId: "acc_cash",
      sourceEventType: "sale",
    });
    expect(await accountBalance(db, "acc_cash")).toBe(600);

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, sale.sale.id), eqOp(t.action, "collect_payment")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "sales" });
  });

  it("rejects collecting an already-PAID sale with CONFLICT", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Collect — already paid", 1000, 3000);
    const sale = await recordSale(
      db,
      {
        paymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 100, unitPriceMc: 500_000 }],
      },
      ACTOR,
    );

    await expect(
      collectPayment(
        db,
        sale.sale.id,
        {
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          paymentMethod: "CASH",
          accountId: "acc_cash",
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects an unknown sale with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    await expect(
      collectPayment(
        db,
        "sale_does_not_exist",
        {
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          paymentMethod: "CASH",
          accountId: "acc_cash",
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an inactive/unknown account before any write, leaving the sale untouched", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Collect — bad account", 1000, 3000);
    const sale = await recordSale(
      db,
      {
        paymentStatus: "ON_CREDIT",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 100, unitPriceMc: 500_000 }],
      },
      ACTOR,
    );

    await expect(
      collectPayment(
        db,
        sale.sale.id,
        {
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          paymentMethod: "CASH",
          accountId: "acc_does_not_exist",
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const saleRow = await db.query.sales.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, sale.sale.id),
    });
    expect(saleRow?.paymentStatus).toBe("ON_CREDIT");
  });

  it("a zero-total ON_CREDIT sale (all-giveaway lines) is marked PAID but books no financial transaction", async () => {
    const db = createDb(env.DB);
    const item = await seedFinishedItem(db, "Collect — zero total");
    const sale = await recordSale(
      db,
      {
        paymentStatus: "ON_CREDIT",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 100, unitPriceMc: 0 }],
      },
      ACTOR,
    );
    expect(sale.sale.total).toBe(0);

    const before = await accountBalance(db, "acc_cash");
    const result = await collectPayment(
      db,
      sale.sale.id,
      {
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        paymentMethod: "CASH",
        accountId: "acc_cash",
      },
      ACTOR,
    );

    expect(result.sale.paymentStatus).toBe("PAID");
    expect(result.account.balance).toBe(before);

    const txRows = await db.query.financialTransactions.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, sale.sale.id),
    });
    expect(txRows).toHaveLength(0);
  });
});

describe("listReceivables (v_receivables, KOK-031)", () => {
  it("returns only non-deleted ON_CREDIT sales with days_outstanding, excludes PAID sales", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Receivables — list", 1000, 2000);

    const credit = await recordSale(
      db,
      {
        paymentStatus: "ON_CREDIT",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 100, unitPriceMc: 500_000 }],
      },
      ACTOR,
    );
    await recordSale(
      db,
      {
        paymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 100, unitPriceMc: 500_000 }],
      },
      ACTOR,
    );

    const { receivables } = await listReceivables(db);
    const row = receivables.find((r) => r.saleId === credit.sale.id);
    expect(row).toMatchObject({ total: 50, channel: "CATALOG" });
    expect(typeof row?.daysOutstanding).toBe("number");
  });

  it("a collected receivable disappears from listReceivables", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Receivables — collected", 1000, 2000);
    const sale = await recordSale(
      db,
      {
        paymentStatus: "ON_CREDIT",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 100, unitPriceMc: 500_000 }],
      },
      ACTOR,
    );

    await collectPayment(
      db,
      sale.sale.id,
      {
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        paymentMethod: "CASH",
        accountId: "acc_cash",
      },
      ACTOR,
    );

    const { receivables } = await listReceivables(db);
    expect(receivables.some((r) => r.saleId === sale.sale.id)).toBe(false);
  });
});

describe("recordSale — backdated capture: INV-11 replay guard (R-2/R-5, ADR-016, KOK-064)", () => {
  /**
   * Identical numbers to exits.test.ts's canonical backdated scenario — a sale is stock-wise the
   * same OUT-movement mechanism as an exit, so the same math discriminates the replay from a naive
   * no-op: P1 10 000 @ 2 (07-10) -> exit A 8 000 (07-11, freezes 2) -> P2 10 000 @ 4 (07-12),
   * leaving wac 44 000/12 000 = 3.6667. A sale of 8 000 backdated to 07-10T12:00 (BEFORE exit A):
   *   prefix [P1] -> onHand 10 000, wac 2
   *   new sale    -> onHand  2 000, wac 2 (C-6: a sale never moves the WAC)
   *   exit A      -> onHand −6 000, wac 2
   *   P2          -> wac (max(−6 000,0)·2 + 10 000·4) / 10 000 = 4, NOT 3.6667
   * Exit A's frozen snapshot (2) is unchanged by the replay (also 2), so costDelta is 0 — but exit A
   * IS found downstream of the touched point, which is what makes R-5 demand confirmation anyway.
   */
  async function seedBackdatedSaleScenario(db: TestDb, itemName: string) {
    const item = await seedFinishedItem(db, itemName);
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

  const BACKDATED_SALE = {
    paymentStatus: "ON_CREDIT" as const,
    occurredAt: "2026-07-10T12:00:00.000Z",
    businessDate: "2026-07-10",
  };

  it("refuses a backdated sale landing behind an existing exit without `confirm`, writing nothing", async () => {
    const db = createDb(env.DB);
    const { item, exitA } = await seedBackdatedSaleScenario(db, "Venta retroactiva rechazada");

    await expect(
      recordSale(
        db,
        { ...BACKDATED_SALE, lines: [{ itemId: item.id, qty: 8_000, unitPriceMc: 1_000_000 }] },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: {
        reason: "REPLAY_CONFIRMATION_REQUIRED",
        impact: { requiresConfirmation: true, affectedStockExitIds: [exitA.exit.id] },
      },
    });

    // Thrown BEFORE db.batch: no sale row at all (beforeEach clears `sales` before this test runs),
    // no SALE_OUT movement, stored WAC untouched.
    expect(await db.query.sales.findMany()).toHaveLength(0);
    const movementRows = await db.query.stockMovements.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(movementRows).toHaveLength(3); // P1 + exitA + P2 only
    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    // (2000·2 000 000 + 10000·4 000 000)/12000 = 3 666 666.667 -> 3 666 667.
    expect(itemRow?.wacMc).toBe(3_666_667);
  });

  it("commits the same sale with `confirm: true`, replaying the later purchase's WAC without booking a WAC of its own (C-6)", async () => {
    const db = createDb(env.DB);
    const { item } = await seedBackdatedSaleScenario(db, "Venta retroactiva confirmada");

    const result = await recordSale(
      db,
      {
        ...BACKDATED_SALE,
        confirm: true,
        lines: [{ itemId: item.id, qty: 8_000, unitPriceMc: 1_000_000 }],
      },
      ACTOR,
    );

    // C-6: valued at the item's CURRENT wac at capture time (3.6667, before this replay lands) ->
    // 3 666 667 mc (same arithmetic as the refusal test above).
    expect(result.sale.lines[0]?.unitCostSnapshotMc).toBe(3_666_667);
    // ON_CREDIT: no cash side.
    expect(result.account).toBeNull();

    // The replay moved P2's re-averaging exactly like a backdated exit would (this sale itself
    // books no WAC — it only changes the on-hand weight P2 later folds against).
    const kardex = await db.query.stockMovements.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
      orderBy: (t, { asc }) => [asc(t.occurredAt), asc(t.createdAt)],
    });
    expect(kardex).toHaveLength(4);
    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    // max(-6000,0)·2 000 000 + 10000·4 000 000 = 40 000 000 000, /10000 = 4 000 000 exactly.
    expect(itemRow?.wacMc).toBe(4_000_000);
  });
});

describe("updateSale (R-1, KOK-064)", () => {
  it("descriptive-only edit (customerId/notes) leaves the kardex byte-identical and needs no confirmation", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Venta — edición descriptiva", 1000, 4000); // wac 4
    const customerId = generateUuidV7();
    await db
      .insert(customers)
      .values({ id: customerId, name: "Cliente edición", createdAt: NOW, updatedAt: NOW });

    const created = await recordSale(
      db,
      {
        paymentStatus: "ON_CREDIT",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 300, unitPriceMc: 2_000_000 }],
      },
      ACTOR,
    );

    const movementBefore = await db.query.stockMovements.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, created.sale.id),
    });

    const result = await updateSale(
      db,
      created.sale.id,
      {
        paymentStatus: "ON_CREDIT",
        customerId,
        notes: "Nota agregada",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 300, unitPriceMc: 2_000_000 }],
      },
      ACTOR,
    );

    expect(result.sale.customerId).toBe(customerId);
    expect(result.sale.notes).toBe("Nota agregada");

    // kardexUnchanged skip: the movement row is byte-identical (same id/created_at), never replaced.
    const movementAfter = await db.query.stockMovements.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, created.sale.id),
    });
    expect(movementAfter).toMatchObject({
      id: movementBefore?.id,
      createdAt: movementBefore?.createdAt,
    });

    expect(
      await db.select().from(costingAdjustments).where(eq(costingAdjustments.itemId, item.id)),
    ).toHaveLength(0);
  });

  it("edit changing qty/price recomputes total and re-snapshots at the item's CURRENT wac", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Venta — edición de cantidad", 1000, 4000); // wac 4

    const created = await recordSale(
      db,
      {
        paymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 300, unitPriceMc: 2_000_000 }], // total 600
      },
      ACTOR,
    );

    const result = await updateSale(
      db,
      created.sale.id,
      {
        paymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 500, unitPriceMc: 2_000_000 }], // total 1000
      },
      ACTOR,
    );

    expect(result.sale.total).toBe(1000);
    expect(result.sale.lines[0]).toMatchObject({ qty: 500, unitCostSnapshotMc: 4_000_000 });
    expect(result.account).toMatchObject({ id: "acc_cash", balance: 1000 });

    const stockRow = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockRow?.qtyOnHand).toBe(500); // 1000 - 500, not 1000 - 300 - 500
  });

  it("edit moving a PAID sale to a different account nets exactly two account balance deltas", async () => {
    const db = createDb(env.DB);
    // seedStockedFinishedItem debits acc_bank via its own seed purchase — capture the baseline
    // AFTER seeding so this test's assertions are about the EDIT's own net effect, not that seed.
    const item = await seedStockedFinishedItem(db, "Venta — cambio de cuenta", 1000, 4000);
    const bankBaseline = await accountBalance(db, "acc_bank");

    const created = await recordSale(
      db,
      {
        paymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 100, unitPriceMc: 2_000_000 }], // total 200
      },
      ACTOR,
    );
    expect(await accountBalance(db, "acc_cash")).toBe(200);

    const result = await updateSale(
      db,
      created.sale.id,
      {
        paymentStatus: "PAID",
        paymentMethod: "BANK_QR",
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 100, unitPriceMc: 2_000_000 }],
      },
      ACTOR,
    );

    expect(result.account).toMatchObject({ id: "acc_bank", balance: bankBaseline + 200 });
    expect(await accountBalance(db, "acc_cash")).toBe(0); // reversed
    expect(await accountBalance(db, "acc_bank")).toBe(bankBaseline + 200); // new effect
  });

  it("refuses (409 CONFLICT) editing a sale that has already been collected via collectPayment", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Venta — edición tras cobro", 1000, 4000);

    const created = await recordSale(
      db,
      {
        paymentStatus: "ON_CREDIT",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 100, unitPriceMc: 2_000_000 }],
      },
      ACTOR,
    );
    await collectPayment(
      db,
      created.sale.id,
      {
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        paymentMethod: "CASH",
        accountId: "acc_cash",
      },
      ACTOR,
    );

    await expect(
      updateSale(
        db,
        created.sale.id,
        {
          paymentStatus: "ON_CREDIT",
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          notes: "intento de edición",
          lines: [{ itemId: item.id, qty: 100, unitPriceMc: 2_000_000 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Untouched: still PAID via the original DEBT_COLLECTION transaction.
    const saleRow = await db.query.sales.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, created.sale.id),
    });
    expect(saleRow?.notes).toBeNull();
    const txRows = await db.query.financialTransactions.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, created.sale.id),
    });
    expect(txRows).toHaveLength(1);
    expect(txRows[0]).toMatchObject({ category: "DEBT_COLLECTION" });
  });

  it("rejects an unknown or already-deleted sale with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    await expect(
      updateSale(
        db,
        "sale_does_not_exist",
        {
          paymentStatus: "ON_CREDIT",
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [{ itemId: "irrelevant", qty: 1, unitPriceMc: 1_000 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("deleteSale (R-3, D-8, KOK-064)", () => {
  it("soft-deletes a PAID sale: kardex reversed, item_stock netted back, cash reversed, deleted_at set", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Venta — eliminación", 1000, 4000);

    const created = await recordSale(
      db,
      {
        paymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 300, unitPriceMc: 2_000_000 }], // total 600
      },
      ACTOR,
    );
    expect(await accountBalance(db, "acc_cash")).toBe(600);

    const result = await deleteSale(db, created.sale.id, {}, ACTOR);

    expect(result.sale.total).toBe(600);
    expect(result.account).toMatchObject({ id: "acc_cash", balance: 0 });

    const movementRows = await db.query.stockMovements.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, created.sale.id),
    });
    expect(movementRows).toHaveLength(0);
    const stockRow = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockRow?.qtyOnHand).toBe(1000); // fully reversed

    const saleRow = await db.query.sales.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, created.sale.id),
    });
    expect(saleRow?.deletedAt).toEqual(expect.any(String));

    await expect(getSale(db, created.sale.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses (409 CONFLICT) deleting a sale that has already been collected via collectPayment", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Venta — eliminación tras cobro", 1000, 4000);

    const created = await recordSale(
      db,
      {
        paymentStatus: "ON_CREDIT",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 100, unitPriceMc: 2_000_000 }],
      },
      ACTOR,
    );
    await collectPayment(
      db,
      created.sale.id,
      {
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        paymentMethod: "CASH",
        accountId: "acc_cash",
      },
      ACTOR,
    );

    await expect(deleteSale(db, created.sale.id, {}, ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
    });

    const saleRow = await db.query.sales.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, created.sale.id),
    });
    expect(saleRow?.deletedAt).toBeNull();
  });

  it("rejects an unknown or already-deleted sale with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    await expect(deleteSale(db, "sale_does_not_exist", {}, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("restoreSale (Doc 06 principle 6 — 'Deshacer', KOK-064)", () => {
  it("restores a sale that touched nothing downstream: kardex/cash come back, and the STORED unit_cost_snapshot is reused verbatim even after the item's wac has since moved", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Venta — restaurar", 1000, 4000); // wac 4

    const created = await recordSale(
      db,
      {
        paymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 300, unitPriceMc: 2_000_000 }],
      },
      ACTOR,
    );
    expect(created.sale.lines[0]?.unitCostSnapshotMc).toBe(4_000_000);

    await deleteSale(db, created.sale.id, {}, ACTOR);
    expect(await accountBalance(db, "acc_cash")).toBe(0);

    // The item's wac moves AFTER the delete, while the sale is gone — a restore must not re-price
    // against this new value (C-6/R-4's spirit: undo brings back exactly what was deleted). This
    // ALSO means re-inserting the sale's historical (07-16) movement now lands BEFORE this new
    // (07-20) purchase in the kardex, so the restore itself requires R-5 confirmation (mirrors
    // restoreStockExit's identical "superseded by intervening history" case).
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-20T10:00:00.000Z",
        businessDate: "2026-07-20",
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 10_000 }], // unit cost 10
      },
      ACTOR,
    );
    const itemAfterPurchase = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemAfterPurchase?.wacMc).not.toBe(4_000_000);

    await expect(restoreSale(db, created.sale.id, {}, ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "REPLAY_CONFIRMATION_REQUIRED" },
    });

    const restored = await restoreSale(db, created.sale.id, { confirm: true }, ACTOR);

    expect(restored.sale.lines[0]?.unitCostSnapshotMc).toBe(4_000_000); // NOT the new current wac
    expect(restored.account).toMatchObject({ id: "acc_cash", balance: 600 });

    const movementRows = await db.query.stockMovements.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, created.sale.id),
    });
    expect(movementRows).toHaveLength(1);
    expect(movementRows[0]).toMatchObject({ type: "SALE_OUT", qty: -300, unitCostMc: 4_000_000 });

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, created.sale.id), eqOp(t.action, "restore")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "sales" });
  });

  it("rejects an id that does not exist or is not currently deleted with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Venta — restaurar id inválido", 1000, 4000);
    const created = await recordSale(
      db,
      {
        paymentStatus: "ON_CREDIT",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 100, unitPriceMc: 2_000_000 }],
      },
      ACTOR,
    );

    // Not deleted yet.
    await expect(restoreSale(db, created.sale.id, {}, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(restoreSale(db, "sale_does_not_exist", {}, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("previewSaleImpact (dry run: identical planner to the mutations, no write, KOK-064)", () => {
  it("op=create: matches the impact recordSale itself would refuse with, and writes nothing", async () => {
    const db = createDb(env.DB);
    const item = await seedFinishedItem(db, "Preview — create");
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

    const command = {
      paymentStatus: "ON_CREDIT" as const,
      occurredAt: "2026-07-10T12:00:00.000Z",
      businessDate: "2026-07-10",
      lines: [{ itemId: item.id, qty: 5_000, unitPriceMc: 1_000_000 }],
    };

    const impact = await previewSaleImpact(db, { op: "create", command });
    expect(impact).toMatchObject({
      requiresConfirmation: true,
      affectedStockExitIds: [exitA.exit.id],
    });

    await expect(recordSale(db, command, ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
      details: { impact },
    });
    // Preview never writes, and the real mutation it previewed also refused before writing.
    expect(await db.query.sales.findMany()).toHaveLength(0);
  });

  it("op=update: matches the impact updateSale itself would refuse with", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Preview — update", 1000, 4000);
    const created = await recordSale(
      db,
      {
        paymentStatus: "ON_CREDIT",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 100, unitPriceMc: 2_000_000 }],
      },
      ACTOR,
    );

    const command = {
      paymentStatus: "ON_CREDIT" as const,
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId: item.id, qty: 200, unitPriceMc: 2_000_000 }],
    };

    const impact = await previewSaleImpact(db, { op: "update", id: created.sale.id, command });
    expect(impact).toMatchObject({ requiresConfirmation: false, costDelta: 0 });

    // Preview never writes.
    const saleRow = await db.query.sales.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, created.sale.id),
    });
    expect(saleRow?.total).toBe(200); // unchanged from creation
  });
});

describe("property: collectPayment credits the account by exactly the sale's total, no lost centavos", () => {
  it("∀ ON_CREDIT sales collected against a fixed account: balance increases by exactly total", async () => {
    const db = createDb(env.DB);

    const lineArb = fc.record({
      qty: fc.integer({ min: 1, max: 5000 }),
      unitPriceMc: fc.integer({ min: 0, max: 50_000_000 }),
    });

    await fc.assert(
      fc.asyncProperty(fc.array(lineArb, { minLength: 1, maxLength: 8 }), async (lines) => {
        const runId = generateUuidV7();
        const item = await seedFinishedItem(db, `Property collect item ${runId}`);

        const sale = await recordSale(
          db,
          {
            paymentStatus: "ON_CREDIT",
            occurredAt: NOW,
            businessDate: BUSINESS_DATE,
            lines: lines.map((l) => ({ itemId: item.id, qty: l.qty, unitPriceMc: l.unitPriceMc })),
          },
          ACTOR,
        );

        const before = await accountBalance(db, "acc_cash");
        const result = await collectPayment(
          db,
          sale.sale.id,
          {
            occurredAt: NOW,
            businessDate: BUSINESS_DATE,
            paymentMethod: "CASH",
            accountId: "acc_cash",
          },
          ACTOR,
        );

        expect(result.account.balance).toBe(
          addMoney(toCentavos(before), toCentavos(sale.sale.total)),
        );
        expect(await accountBalance(db, "acc_cash")).toBe(
          addMoney(toCentavos(before), toCentavos(sale.sale.total)),
        );
      }),
      { numRuns: 15 },
    );
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
          `INSERT INTO sale_lines (id, sale_id, item_id, qty, unit_price_mc, unit_cost_snapshot_mc)
           VALUES ('sale_line_atomicity_test', 'sale_atomicity_test', ?, 0, 500000, 0)`,
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

describe("property: sale total = Σ round(qty × unit_price_mc) and on-hand nets every line's qty", () => {
  it("∀ multi-line sales against a fixed item: stored total equals the independent Σ, no centavo lost", async () => {
    const db = createDb(env.DB);

    const lineArb = fc.record({
      qty: fc.integer({ min: 1, max: 5000 }),
      unitPriceMc: fc.integer({ min: 0, max: 50_000_000 }),
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
            lines: lines.map((l) => ({ itemId: item.id, qty: l.qty, unitPriceMc: l.unitPriceMc })),
          },
          ACTOR,
        );

        const expectedTotal = addMoney(
          ...lines.map((l) =>
            totalCentavos(toMilliCentavosPerUnit(l.unitPriceMc), toMilliUnits(l.qty)),
          ),
        );
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

describe("payment method/account pairing (A-12)", () => {
  it("rejects CASH routed to a BANK account before recording a sale", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Pairing — sale", 1000, 4000);

    await expect(
      recordSale(
        db,
        {
          paymentStatus: "PAID",
          paymentMethod: "CASH",
          accountId: "acc_bank",
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [{ itemId: item.id, qty: 100, unitPriceMc: 2_000_000 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      message_es: expect.stringContaining("método de pago"),
    });
  });

  it("rejects CASH routed to a BANK account when collecting a receivable", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedFinishedItem(db, "Pairing — collection", 1000, 4000);
    const sale = await recordSale(
      db,
      {
        paymentStatus: "ON_CREDIT",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 100, unitPriceMc: 2_000_000 }],
      },
      ACTOR,
    );

    await expect(
      collectPayment(
        db,
        sale.sale.id,
        {
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          paymentMethod: "CASH",
          accountId: "acc_bank",
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      message_es: expect.stringContaining("método de pago"),
    });
  });
});
