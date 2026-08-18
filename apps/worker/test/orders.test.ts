// Integration tests for core/orders (KOK-033, Doc 03 UC-05…UC-08 + §5's O-1…O-3, Doc 04 §3.3/§5,
// ADR-012). Doc 11 §3 template: seed via createItem/recordPurchase/createCustomer -> run the
// transition -> assert the custom_orders row + its derived rows (financial_transactions, sales,
// sale_lines, stock_movements, item_stock) + the DERIVED liability/receivable views + audit_log,
// against real D1 via @cloudflare/vitest-pool-workers.
//
// The most discriminating assertions in this file:
//   - the FULL legal/illegal transition matrix (6 statuses × 5 transitions) is asserted by table,
//     so no illegal jump can be added silently — this is the point of a state-machine task.
//   - INV-7: a deposit is a LIABILITY, never revenue. `v_liability` is asserted directly (not the
//     `deposit_paid` column) before and after every money-moving transition, and no INCOME row of
//     a revenue category exists anywhere until delivery.
//   - O-2: delivery creates the CUSTOM_ORDER sale for the FULL agreed total with real SALE_OUT
//     movements and WAC snapshots, but books ONLY the balance as cash — the deposit is not
//     re-credited — and the liability drops to zero for that order.
//   - O-3 FORFEIT moves NO cash and writes NO new row: it recategorizes the deposit transaction in
//     place, which is what releases the liability (see core/orders' header).
import { env } from "cloudflare:test";
import type { CustomOrderStatus } from "@kokoro/shared";
import {
  toBusinessDate,
  toDatetimeLocal,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
} from "@kokoro/shared";
import { eq, inArray, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createItem } from "../src/core/catalog/index.js";
import { createCustomer } from "../src/core/customers/index.js";
import { recordExit } from "../src/core/inventory/exits.js";
import {
  assertOrderLinkable,
  cancelOrder,
  confirmOrder,
  deliverOrder,
  getOrder,
  listOrders,
  markOrderReady,
  quoteOrder,
  resolveOrderLine,
  startOrderProduction,
  undoDeliverOrder,
  undoMarkOrderReady,
  undoStartOrderProduction,
} from "../src/core/orders/index.js";
import { recordPurchase } from "../src/core/purchasing/index.js";
import { collectPayment, deleteSale, updateSale } from "../src/core/sales/index.js";
import { setSetting } from "../src/core/settings/index.js";
import { createDb } from "../src/db/index.js";
import {
  auditLog,
  customOrderLines,
  customOrders,
  financialAccounts,
  financialTransactions,
  saleLines,
  sales,
  stockMovements,
} from "../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;
const NOW = "2026-07-20T14:00:00.000Z";
const BUSINESS_DATE = "2026-07-20";

type TestDb = ReturnType<typeof createDb>;

let seq = 0;
/** Unique per call — `items.name` is UNIQUE, and every test seeds its own catalog. */
function uniqueName(prefix: string): string {
  seq += 1;
  return `${prefix} ${seq}`;
}

/** A FINISHED item carrying stock and a known WAC (6_000_000 mc per whole unit), the same
 * recordPurchase seam sales.test.ts uses. */
async function seedStockedItem(db: TestDb, qty = 10_000, lineTotal = 60_000) {
  const item = await createItem(
    db,
    { name: uniqueName("Pedido — ítem"), kind: "FINISHED", category: "BAKERY", unit: "UNIT" },
    ACTOR,
  );
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

async function seedCustomer(db: TestDb) {
  return createCustomer(db, { name: uniqueName("Cliente") }, ACTOR);
}

async function accountBalance(db: TestDb, id: string): Promise<number> {
  const row = await db.query.financialAccounts.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, id),
  });
  return row?.balance ?? 0;
}

/** The DERIVED deposit liability (ADR-012) — asserted instead of `custom_orders.deposit_paid`,
 * because the view is what the dashboard and the daily snapshot actually report. */
async function customerDeposits(db: TestDb): Promise<number> {
  const rows = await db.all<{ customer_deposits: number }>(
    sql`SELECT customer_deposits FROM v_liability`,
  );
  return rows[0]?.customer_deposits ?? 0;
}

async function receivableFor(db: TestDb, saleId: string): Promise<number | null> {
  const rows = await db.all<{ sale_id: string; total: number }>(
    sql`SELECT sale_id, total FROM v_receivables`,
  );
  return rows.find((r) => r.sale_id === saleId)?.total ?? null;
}

async function txsForOrder(db: TestDb, orderId: string) {
  return db.query.financialTransactions.findMany({
    where: (t, { and, eq: eqOp }) =>
      and(eqOp(t.sourceEventType, "custom_order"), eqOp(t.sourceEventId, orderId)),
  });
}

/** Quote → (optionally) confirm/start/ready/deliver/cancel, so a test can start from any status. */
async function seedOrderInStatus(
  db: TestDb,
  status: CustomOrderStatus,
  opts: { agreedTotal?: number; depositAmount?: number } = {},
) {
  const customer = await seedCustomer(db);
  const item = await seedStockedItem(db);
  const agreedTotal = opts.agreedTotal ?? 30_000;
  const depositAmount = opts.depositAmount ?? 15_000;

  const { order } = await quoteOrder(
    db,
    {
      customerId: customer.id,
      description: "Torta personalizada",
      agreedTotal,
      deliveryDate: BUSINESS_DATE,
      lines: [{ itemId: item.id, qty: 1000 }],
    },
    ACTOR,
  );
  if (status === "QUOTING")
    return { orderId: order.id, itemId: item.id, agreedTotal, depositAmount };

  if (status === "CANCELLED") {
    await cancelOrder(db, order.id, { occurredAt: NOW, businessDate: BUSINESS_DATE }, ACTOR);
    return { orderId: order.id, itemId: item.id, agreedTotal, depositAmount };
  }

  await confirmOrder(
    db,
    order.id,
    {
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      depositAmount,
      paymentMethod: "CASH",
      accountId: "acc_cash",
    },
    ACTOR,
  );
  if (status === "CONFIRMED")
    return { orderId: order.id, itemId: item.id, agreedTotal, depositAmount };

  await startOrderProduction(db, order.id, ACTOR);
  if (status === "IN_PRODUCTION")
    return { orderId: order.id, itemId: item.id, agreedTotal, depositAmount };

  await markOrderReady(db, order.id, ACTOR);
  if (status === "READY") return { orderId: order.id, itemId: item.id, agreedTotal, depositAmount };

  await deliverOrder(
    db,
    order.id,
    {
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      balancePaymentStatus: "PAID",
      paymentMethod: "CASH",
      accountId: "acc_cash",
    },
    ACTOR,
  );
  return { orderId: order.id, itemId: item.id, agreedTotal, depositAmount };
}

beforeEach(async () => {
  const db = createDb(env.DB);
  // custom_orders.sale_id and sales.custom_order_id reference each other with ON DELETE RESTRICT,
  // and custom_orders.deposit_tx_id pins its transaction — unlink before deleting either side.
  await db.update(customOrders).set({ saleId: null, depositTxId: null });
  await db.delete(auditLog).where(inArray(auditLog.entityType, ["custom_orders", "sales"]));
  await db.delete(stockMovements).where(eq(stockMovements.sourceEventType, "sale"));
  await db.delete(saleLines);
  await db.delete(sales);
  await db.delete(customOrderLines);
  await db.delete(customOrders);
  await db
    .delete(financialTransactions)
    .where(inArray(financialTransactions.sourceEventType, ["custom_order", "sale", "purchase"]));
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
  await setSetting(db, "default_deposit_pct", "5000");
});

// ============================================================================================
// UC-05 quote
// ============================================================================================

describe("quoteOrder (UC-05)", () => {
  it("opens the order at QUOTING with its lines, no money and no kardex", async () => {
    const db = createDb(env.DB);
    const customer = await seedCustomer(db);
    const item = await seedStockedItem(db);

    const { order } = await quoteOrder(
      db,
      {
        customerId: customer.id,
        description: "Torta de bodas 3 pisos",
        agreedTotal: 50_000,
        deliveryDate: "2026-08-01",
        deliveryPlace: "Zona Sur",
        lines: [{ itemId: item.id, qty: 2000 }, { description: "Decoración especial" }],
      },
      ACTOR,
    );

    expect(order).toMatchObject({
      status: "QUOTING",
      customerId: customer.id,
      customerName: customer.name,
      agreedTotal: 50_000,
      depositPaid: 0,
      depositTxId: null,
      saleId: null,
      balanceDue: 50_000,
    });
    expect(order.lines).toHaveLength(2);
    // O-1's default 50% of the agreed total.
    expect(order.depositRequired).toBe(25_000);

    // A quote moves no cash and no stock.
    expect(await customerDeposits(db)).toBe(0);
    expect(await accountBalance(db, "acc_cash")).toBe(0);
    const movements = await db.query.stockMovements.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventType, "sale"),
    });
    expect(movements).toHaveLength(0);

    const audit = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, order.id), eqOp(t.entityType, "custom_orders")),
    });
    expect(audit).toMatchObject({ actor: ACTOR, action: "create" });
  });

  it("derives depositRequired from the default_deposit_pct setting when present", async () => {
    const db = createDb(env.DB);
    await setSetting(db, "default_deposit_pct", "3000"); // 30%
    const customer = await seedCustomer(db);

    const { order } = await quoteOrder(
      db,
      { customerId: customer.id, description: "Pedido", agreedTotal: 20_000 },
      ACTOR,
    );
    expect(order.depositRequired).toBe(6_000);
  });

  it("leaves agreedTotal and depositRequired null when the price is not settled yet", async () => {
    const db = createDb(env.DB);
    const customer = await seedCustomer(db);
    const { order } = await quoteOrder(
      db,
      { customerId: customer.id, description: "Aún cotizando" },
      ACTOR,
    );
    expect(order.agreedTotal).toBeNull();
    expect(order.depositRequired).toBeNull();
    expect(order.balanceDue).toBeNull();
  });

  it("rejects an unknown customer", async () => {
    const db = createDb(env.DB);
    await expect(
      quoteOrder(db, { customerId: "nope", description: "Pedido" }, ACTOR),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a line with neither an item nor a description", async () => {
    const db = createDb(env.DB);
    const customer = await seedCustomer(db);
    await expect(
      quoteOrder(
        db,
        { customerId: customer.id, description: "Pedido", lines: [{ qty: 1000 }] },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects an order line pointing at a non-FINISHED item (Doc 04 §5)", async () => {
    const db = createDb(env.DB);
    const customer = await seedCustomer(db);
    const raw = await createItem(
      db,
      {
        name: uniqueName("Harina"),
        kind: "RAW_MATERIAL",
        category: "INGREDIENT",
        unit: "KG",
      },
      ACTOR,
    );
    await expect(
      quoteOrder(
        db,
        { customerId: customer.id, description: "Pedido", lines: [{ itemId: raw.id }] },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

// ============================================================================================
// UC-06 confirm — O-1 + INV-7
// ============================================================================================

describe("confirmOrder (UC-06, O-1)", () => {
  it("books the deposit as an ORDER_DEPOSIT liability, credits the account, and moves to CONFIRMED", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "QUOTING");

    const result = await confirmOrder(
      db,
      orderId,
      {
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        depositAmount: 15_000,
        paymentMethod: "CASH",
        accountId: "acc_cash",
      },
      ACTOR,
    );

    expect(result.order).toMatchObject({
      status: "CONFIRMED",
      depositPaid: 15_000,
      agreedTotal: 30_000,
      balanceDue: 15_000,
    });
    expect(result.order.depositTxId).not.toBeNull();
    expect(result.account.balance).toBe(15_000);

    // The cash physically arrived (ADR-012)...
    expect(await accountBalance(db, "acc_cash")).toBe(15_000);
    // ...but it is a LIABILITY, not revenue (INV-7), and the derived view is what says so.
    expect(await customerDeposits(db)).toBe(15_000);

    const txs = await txsForOrder(db, orderId);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      type: "INCOME",
      category: "ORDER_DEPOSIT",
      amount: 15_000,
      accountId: "acc_cash",
    });

    // INV-7 stated the other way round: no revenue-recognizing row exists anywhere yet.
    const revenue = await db.query.financialTransactions.findMany({
      where: (t, { inArray: inArrayOp }) =>
        inArrayOp(t.category, ["SALE", "ORDER_BALANCE", "OTHER_INCOME", "DEBT_COLLECTION"]),
    });
    expect(revenue).toHaveLength(0);

    const audit = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) => and(eqOp(t.entityId, orderId), eqOp(t.action, "confirm")),
    });
    expect(audit).toBeDefined();
  });

  it("accepts the agreed total at confirm time when the quote had none", async () => {
    const db = createDb(env.DB);
    const customer = await seedCustomer(db);
    const { order } = await quoteOrder(
      db,
      { customerId: customer.id, description: "Sin precio aún" },
      ACTOR,
    );

    const result = await confirmOrder(
      db,
      order.id,
      {
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        agreedTotal: 40_000,
        depositAmount: 10_000,
        paymentMethod: "BANK_QR",
        accountId: "acc_bank",
      },
      ACTOR,
    );
    expect(result.order).toMatchObject({ agreedTotal: 40_000, depositRequired: 20_000 });
  });

  it("refuses to confirm without an agreed total (Doc 04 §3.3: required to confirm)", async () => {
    const db = createDb(env.DB);
    const customer = await seedCustomer(db);
    const { order } = await quoteOrder(
      db,
      { customerId: customer.id, description: "Sin precio" },
      ACTOR,
    );

    await expect(
      confirmOrder(
        db,
        order.id,
        {
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          depositAmount: 5_000,
          paymentMethod: "CASH",
          accountId: "acc_cash",
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses a deposit of zero or less — O-1 requires a RECORDED deposit", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "QUOTING");

    await expect(
      confirmOrder(
        db,
        orderId,
        {
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          depositAmount: 0,
          paymentMethod: "CASH",
          accountId: "acc_cash",
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    // Nothing was written: still QUOTING, no liability, no cash.
    expect((await getOrder(db, orderId)).status).toBe("QUOTING");
    expect(await customerDeposits(db)).toBe(0);
    expect(await accountBalance(db, "acc_cash")).toBe(0);
  });

  it("refuses a deposit larger than the agreed total", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "QUOTING");
    await expect(
      confirmOrder(
        db,
        orderId,
        {
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          depositAmount: 30_001,
          paymentMethod: "CASH",
          accountId: "acc_cash",
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

// ============================================================================================
// Pure transitions
// ============================================================================================

describe("startOrderProduction / markOrderReady", () => {
  it("moves CONFIRMED -> IN_PRODUCTION -> READY with no money and no kardex effect", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "CONFIRMED");
    const cashBefore = await accountBalance(db, "acc_cash");
    const liabilityBefore = await customerDeposits(db);

    expect((await startOrderProduction(db, orderId, ACTOR)).order.status).toBe("IN_PRODUCTION");
    expect((await markOrderReady(db, orderId, ACTOR)).order.status).toBe("READY");

    expect(await accountBalance(db, "acc_cash")).toBe(cashBefore);
    // Still a liability: the goods have not been handed over (INV-7).
    expect(await customerDeposits(db)).toBe(liabilityBefore);
    const txs = await txsForOrder(db, orderId);
    expect(txs).toHaveLength(1); // only the deposit
  });

  it("round-trips CONFIRMED <-> IN_PRODUCTION <-> READY", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "CONFIRMED");

    await startOrderProduction(db, orderId, ACTOR);
    expect((await undoStartOrderProduction(db, orderId, ACTOR)).order.status).toBe("CONFIRMED");

    await startOrderProduction(db, orderId, ACTOR);
    await markOrderReady(db, orderId, ACTOR);
    expect((await undoMarkOrderReady(db, orderId, ACTOR)).order.status).toBe("IN_PRODUCTION");
  });
});

// ============================================================================================
// UC-07 deliver — O-2
// ============================================================================================

describe("deliverOrder (UC-07, O-2)", () => {
  it("creates the CUSTOM_ORDER sale for the full agreed total, books only the BALANCE, and releases the liability", async () => {
    const db = createDb(env.DB);
    const { orderId, itemId } = await seedOrderInStatus(db, "READY");

    const stockBefore = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, itemId),
    });
    expect(await customerDeposits(db)).toBe(15_000);
    const cashBefore = await accountBalance(db, "acc_cash");

    const result = await deliverOrder(
      db,
      orderId,
      {
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        balancePaymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
      },
      ACTOR,
    );

    // The sale is for the FULL agreed total (O-2), server-recomputed from its lines (Doc 04 §5).
    expect(result.sale).toMatchObject({
      channel: "CUSTOM_ORDER",
      customOrderId: orderId,
      total: 30_000,
      paymentStatus: "PAID",
    });
    expect(result.sale.lines).toHaveLength(1);
    expect(result.sale.lines[0]).toMatchObject({ itemId, qty: 1000, unitPriceMc: 30_000_000 });
    // WAC frozen at sale time (C-6): the seeded item's WAC is 6_000_000 milli-centavos per whole
    // unit (ADR-017; recordPurchase's rateFromTotal(60000, 10000) = 6_000_000 exactly).
    expect(result.sale.lines[0]?.unitCostSnapshotMc).toBe(6_000_000);
    expect(result.sale.total).toBe(
      totalCentavos(
        toMilliCentavosPerUnit(result.sale.lines[0]?.unitPriceMc ?? 0),
        toMilliUnits(result.sale.lines[0]?.qty ?? 0),
      ),
    );

    expect(result.order).toMatchObject({ status: "DELIVERED", saleId: result.sale.id });

    // Only the BALANCE moved cash — the deposit was banked at confirm time and is NOT re-credited.
    expect(await accountBalance(db, "acc_cash")).toBe(cashBefore + 15_000);
    expect(result.account?.balance).toBe(cashBefore + 15_000);
    const txs = await txsForOrder(db, orderId);
    expect(txs).toHaveLength(2);
    const balanceTx = txs.find((t) => t.category === "ORDER_BALANCE");
    expect(balanceTx).toMatchObject({ type: "INCOME", amount: 15_000 });

    // O-2: the deposit liability is released against the sale.
    expect(await customerDeposits(db)).toBe(0);

    // The kardex really moved (this is what a free-text-only delivery would have skipped).
    const movements = await db.query.stockMovements.findMany({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.sourceEventType, "sale"), eqOp(t.sourceEventId, result.sale.id)),
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: "SALE_OUT", qty: -1000, itemId });
    const stockAfter = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, itemId),
    });
    expect(stockAfter?.qtyOnHand).toBe((stockBefore?.qtyOnHand ?? 0) - 1000);

    // Both the order transition and the sale it created are audited.
    const orderAudit = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) => and(eqOp(t.entityId, orderId), eqOp(t.action, "deliver")),
    });
    expect(orderAudit).toBeDefined();
    const saleAudit = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, result.sale.id), eqOp(t.entityType, "sales")),
    });
    expect(saleAudit).toBeDefined();
  });

  it("leaves the balance as a receivable NET OF THE DEPOSIT when taken ON_CREDIT", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "READY");
    const cashBefore = await accountBalance(db, "acc_cash");

    const result = await deliverOrder(
      db,
      orderId,
      { occurredAt: NOW, businessDate: BUSINESS_DATE, balancePaymentStatus: "ON_CREDIT" },
      ACTOR,
    );

    expect(result.sale).toMatchObject({ paymentStatus: "ON_CREDIT", total: 30_000, paidAt: null });
    expect(result.account).toBeNull();
    // No cash moved at delivery, and no balance transaction was booked.
    expect(await accountBalance(db, "acc_cash")).toBe(cashBefore);
    const txs = await txsForOrder(db, orderId);
    expect(txs).toHaveLength(1);
    expect(txs[0]?.category).toBe("ORDER_DEPOSIT");

    // The liability is released even though the balance is unpaid: the goods are delivered.
    expect(await customerDeposits(db)).toBe(0);
    // ...and the receivable is the BALANCE (Bs 150), not the full agreed total (migration 0005) —
    // the deposit is already in the account and must not be counted as still-owed too.
    expect(await receivableFor(db, result.sale.id)).toBe(15_000);
  });

  it("collects that receivable for the balance only, never the full sale total", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "READY");
    const { sale } = await deliverOrder(
      db,
      orderId,
      { occurredAt: NOW, businessDate: BUSINESS_DATE, balancePaymentStatus: "ON_CREDIT" },
      ACTOR,
    );
    const cashBefore = await accountBalance(db, "acc_cash");

    const collected = await collectPayment(
      db,
      sale.id,
      {
        occurredAt: "2026-07-25T10:00:00.000Z",
        businessDate: "2026-07-25",
        paymentMethod: "CASH",
        accountId: "acc_cash",
      },
      ACTOR,
    );

    expect(collected.sale.paymentStatus).toBe("PAID");
    // Bs 150 (the balance), NOT Bs 300 — the deposit would otherwise be banked twice.
    expect(await accountBalance(db, "acc_cash")).toBe(cashBefore + 15_000);
    const debtTx = await db.query.financialTransactions.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.sourceEventId, sale.id), eqOp(t.category, "DEBT_COLLECTION")),
    });
    expect(debtTx?.amount).toBe(15_000);
    expect(await receivableFor(db, sale.id)).toBeNull();
  });

  it("marks a fully prepaid order PAID and books no balance transaction", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "READY", {
      agreedTotal: 30_000,
      depositAmount: 30_000,
    });
    const cashBefore = await accountBalance(db, "acc_cash");

    const result = await deliverOrder(
      db,
      orderId,
      { occurredAt: NOW, businessDate: BUSINESS_DATE, balancePaymentStatus: "ON_CREDIT" },
      ACTOR,
    );

    // Nothing is owed, so the sale is PAID whatever the caller said about the balance.
    expect(result.sale.paymentStatus).toBe("PAID");
    expect(await accountBalance(db, "acc_cash")).toBe(cashBefore);
    expect(await txsForOrder(db, orderId)).toHaveLength(1); // the deposit only
    expect(await customerDeposits(db)).toBe(0);
    expect(await receivableFor(db, result.sale.id)).toBeNull();
  });

  it("splits the agreed total across several lines with no lost centavos (D-5)", async () => {
    const db = createDb(env.DB);
    const customer = await seedCustomer(db);
    const itemA = await seedStockedItem(db);
    const itemB = await seedStockedItem(db);

    const { order } = await quoteOrder(
      db,
      {
        customerId: customer.id,
        description: "Dos productos",
        agreedTotal: 1_000, // Bs 10,00 across three equal single-unit lines
        lines: [{ itemId: itemA.id }, { itemId: itemB.id }, { itemId: itemA.id }],
      },
      ACTOR,
    );
    await confirmOrder(
      db,
      order.id,
      {
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        depositAmount: 500,
        paymentMethod: "CASH",
        accountId: "acc_cash",
      },
      ACTOR,
    );
    await startOrderProduction(db, order.id, ACTOR);
    await markOrderReady(db, order.id, ACTOR);

    const { sale } = await deliverOrder(
      db,
      order.id,
      {
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        balancePaymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
      },
      ACTOR,
    );

    expect(sale.total).toBe(1_000);
    expect(sale.lines.map((l) => l.unitPriceMc).sort((a, b) => b - a)).toEqual([
      334_000, 333_000, 333_000,
    ]);
    expect(
      sale.lines.reduce(
        (sum, line) =>
          sum + totalCentavos(toMilliCentavosPerUnit(line.unitPriceMc), toMilliUnits(line.qty)),
        0,
      ),
    ).toBe(1_000);
  });

  it("REFUSES to deliver while any line is not linked to a catalog item (the O-2 / Doc 04 §5 rule)", async () => {
    const db = createDb(env.DB);
    const customer = await seedCustomer(db);
    const item = await seedStockedItem(db);
    const { order } = await quoteOrder(
      db,
      {
        customerId: customer.id,
        description: "Con línea libre",
        agreedTotal: 30_000,
        lines: [{ itemId: item.id }, { description: "Torta artesanal sin ítem" }],
      },
      ACTOR,
    );
    await confirmOrder(
      db,
      order.id,
      {
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        depositAmount: 15_000,
        paymentMethod: "CASH",
        accountId: "acc_cash",
      },
      ACTOR,
    );
    await startOrderProduction(db, order.id, ACTOR);
    await markOrderReady(db, order.id, ACTOR);

    await expect(
      deliverOrder(
        db,
        order.id,
        {
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          balancePaymentStatus: "PAID",
          paymentMethod: "CASH",
          accountId: "acc_cash",
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Nothing was written: no sale, still READY, liability untouched.
    expect((await getOrder(db, order.id)).status).toBe("READY");
    expect(await db.query.sales.findMany()).toHaveLength(0);
    expect(await customerDeposits(db)).toBe(15_000);
  });

  it("REFUSES to deliver an order with no lines at all", async () => {
    const db = createDb(env.DB);
    const customer = await seedCustomer(db);
    const { order } = await quoteOrder(
      db,
      { customerId: customer.id, description: "Sin líneas", agreedTotal: 30_000 },
      ACTOR,
    );
    await confirmOrder(
      db,
      order.id,
      {
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        depositAmount: 15_000,
        paymentMethod: "CASH",
        accountId: "acc_cash",
      },
      ACTOR,
    );
    await startOrderProduction(db, order.id, ACTOR);
    await markOrderReady(db, order.id, ACTOR);

    await expect(
      deliverOrder(
        db,
        order.id,
        { occurredAt: NOW, businessDate: BUSINESS_DATE, balancePaymentStatus: "ON_CREDIT" },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("uses milli-centavo rates to deliver a formerly indivisible agreed total", async () => {
    const db = createDb(env.DB);
    const customer = await seedCustomer(db);
    const item = await seedStockedItem(db);
    // Bs 1,00 over a single 3-unit line: no integer centavo per-unit price yields exactly 100.
    const { order } = await quoteOrder(
      db,
      {
        customerId: customer.id,
        description: "Indivisible",
        agreedTotal: 100,
        lines: [{ itemId: item.id, qty: 3000 }],
      },
      ACTOR,
    );
    await confirmOrder(
      db,
      order.id,
      {
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        depositAmount: 50,
        paymentMethod: "CASH",
        accountId: "acc_cash",
      },
      ACTOR,
    );
    await startOrderProduction(db, order.id, ACTOR);
    await markOrderReady(db, order.id, ACTOR);

    const result = await deliverOrder(
      db,
      order.id,
      { occurredAt: NOW, businessDate: BUSINESS_DATE, balancePaymentStatus: "ON_CREDIT" },
      ACTOR,
    );
    expect(result.sale.total).toBe(100);
    expect(result.sale.lines[0]?.unitPriceMc).toBe(33_333);
  });

  it("protects the order-owned sale from being edited or deleted through core/sales", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "READY");
    const { sale } = await deliverOrder(
      db,
      orderId,
      { occurredAt: NOW, businessDate: BUSINESS_DATE, balancePaymentStatus: "ON_CREDIT" },
      ACTOR,
    );

    await expect(
      updateSale(
        db,
        sale.id,
        {
          paymentStatus: "ON_CREDIT",
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [{ itemId: sale.lines[0]?.itemId ?? "", qty: 1000, unitPriceMc: 1_000_000 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(deleteSale(db, sale.id, {}, ACTOR)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

// ============================================================================================
// UC-07 undo delivery — O-6
// ============================================================================================

describe("undoDeliverOrder (UC-07-undo, O-6)", () => {
  it("returns a same-day delivery to READY and reverses only its sale and balance effects", async () => {
    const db = createDb(env.DB);
    const { orderId, itemId, depositAmount } = await seedOrderInStatus(db, "READY");
    const stockBeforeDelivery = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, itemId),
    });
    const cashBeforeDelivery = await accountBalance(db, "acc_cash");
    const [depositTxBefore] = await txsForOrder(db, orderId);

    const delivered = await deliverOrder(
      db,
      orderId,
      {
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        balancePaymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
      },
      ACTOR,
    );
    expect(await accountBalance(db, "acc_cash")).toBe(cashBeforeDelivery + 15_000);

    const result = await undoDeliverOrder(db, orderId, { confirm: false }, ACTOR);

    expect(result.order).toMatchObject({ status: "READY", saleId: null });
    const saleRow = await db.query.sales.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, delivered.sale.id),
    });
    expect(saleRow?.deletedAt).toEqual(expect.any(String));

    const movements = await db.query.stockMovements.findMany({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.sourceEventType, "sale"), eqOp(t.sourceEventId, delivered.sale.id)),
    });
    expect(movements).toHaveLength(0);
    const stockAfterUndo = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, itemId),
    });
    expect(stockAfterUndo?.qtyOnHand).toBe(stockBeforeDelivery?.qtyOnHand);

    expect(await accountBalance(db, "acc_cash")).toBe(cashBeforeDelivery);
    const orderTxsAfter = await txsForOrder(db, orderId);
    expect(orderTxsAfter).toHaveLength(1);
    expect(orderTxsAfter[0]).toMatchObject({
      id: depositTxBefore?.id,
      category: "ORDER_DEPOSIT",
      amount: depositAmount,
      deletedAt: null,
    });
    expect(await customerDeposits(db)).toBe(depositAmount);
  });

  it("refuses after collection with the exact sales guard message and writes nothing", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "READY");
    const { sale } = await deliverOrder(
      db,
      orderId,
      { occurredAt: NOW, businessDate: BUSINESS_DATE, balancePaymentStatus: "ON_CREDIT" },
      ACTOR,
    );
    await collectPayment(
      db,
      sale.id,
      {
        occurredAt: "2026-07-25T10:00:00.000Z",
        businessDate: "2026-07-25",
        paymentMethod: "CASH",
        accountId: "acc_cash",
      },
      ACTOR,
    );
    const cashBeforeUndo = await accountBalance(db, "acc_cash");
    const auditCountBefore = (await db.query.auditLog.findMany()).length;

    await expect(undoDeliverOrder(db, orderId, { confirm: false }, ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
      message_es:
        "Esta venta ya fue cobrada; no se puede editar ni eliminar. Corrige el cobro por separado.",
    });

    expect(await getOrder(db, orderId)).toMatchObject({ status: "DELIVERED", saleId: sale.id });
    const saleAfter = await db.query.sales.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, sale.id),
    });
    expect(saleAfter).toMatchObject({ paymentStatus: "PAID", deletedAt: null });
    expect(await accountBalance(db, "acc_cash")).toBe(cashBeforeUndo);
    expect(await db.query.auditLog.findMany()).toHaveLength(auditCountBefore);
    const movements = await db.query.stockMovements.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, sale.id),
    });
    expect(movements).toHaveLength(1);
  });

  it("requires R-5 confirmation when later movements depend on a backdated delivery", async () => {
    const db = createDb(env.DB);
    const { orderId, itemId } = await seedOrderInStatus(db, "READY");
    await deliverOrder(
      db,
      orderId,
      {
        occurredAt: "2026-07-20T15:00:00.000Z",
        businessDate: BUSINESS_DATE,
        balancePaymentStatus: "ON_CREDIT",
      },
      ACTOR,
    );
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-07-21T10:00:00.000Z",
        businessDate: "2026-07-21",
        lines: [{ itemId, qty: 1000, lineTotal: 10_000 }],
      },
      ACTOR,
    );
    const laterExit = await recordExit(
      db,
      {
        itemId,
        qty: 1000,
        reason: "WASTE",
        occurredAt: "2026-07-22T10:00:00.000Z",
        businessDate: "2026-07-22",
      },
      ACTOR,
    );

    await expect(undoDeliverOrder(db, orderId, { confirm: false }, ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
      details: {
        reason: "REPLAY_CONFIRMATION_REQUIRED",
        impact: { affectedStockExitIds: [laterExit.exit.id] },
      },
    });
    expect((await getOrder(db, orderId)).status).toBe("DELIVERED");

    const result = await undoDeliverOrder(db, orderId, { confirm: true }, ACTOR);
    expect(result.order).toMatchObject({ status: "READY", saleId: null });
  });
});

// ============================================================================================
// UC-08 cancel — O-3
// ============================================================================================

describe("cancelOrder (UC-08, O-3)", () => {
  it("REFUND: books a DEPOSIT_REFUND expense, debits the account, and clears the liability", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "CONFIRMED");
    expect(await customerDeposits(db)).toBe(15_000);
    const cashBefore = await accountBalance(db, "acc_cash");

    const result = await cancelOrder(
      db,
      orderId,
      { occurredAt: NOW, businessDate: BUSINESS_DATE, resolution: "REFUND" },
      ACTOR,
    );

    expect(result.order).toMatchObject({ status: "CANCELLED", cancelResolution: "REFUND" });
    // The money genuinely left the account.
    expect(await accountBalance(db, "acc_cash")).toBe(cashBefore - 15_000);
    expect(result.account?.balance).toBe(cashBefore - 15_000);
    expect(await customerDeposits(db)).toBe(0);

    const txs = await txsForOrder(db, orderId);
    const refund = txs.find((t) => t.category === "DEPOSIT_REFUND");
    expect(refund).toMatchObject({ type: "EXPENSE", amount: 15_000, accountId: "acc_cash" });
    // The original deposit row is untouched — a refund is a second, opposite movement.
    expect(txs.find((t) => t.category === "ORDER_DEPOSIT")).toBeDefined();
  });

  it("FORFEIT: moves NO cash, writes NO new transaction, and recategorizes the deposit to OTHER_INCOME", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "CONFIRMED");
    const order = await getOrder(db, orderId);
    const depositTxId = order.depositTxId ?? "";
    const cashBefore = await accountBalance(db, "acc_cash");

    const result = await cancelOrder(
      db,
      orderId,
      { occurredAt: NOW, businessDate: BUSINESS_DATE, resolution: "FORFEIT" },
      ACTOR,
    );

    expect(result.order).toMatchObject({ status: "CANCELLED", cancelResolution: "FORFEIT" });
    // The cash is already in the account and stays there — booking a new income row would count
    // the same money twice (ADR-012).
    expect(result.account).toBeNull();
    expect(await accountBalance(db, "acc_cash")).toBe(cashBefore);

    const txs = await txsForOrder(db, orderId);
    expect(txs).toHaveLength(1);
    const tx = txs[0];
    expect(tx?.id).toBe(depositTxId); // the SAME row, not a new one
    expect(tx).toMatchObject({ type: "INCOME", category: "OTHER_INCOME", amount: 15_000 });
    // It keeps its original cash date — the historical month's category mix shifts by design.
    expect(tx?.businessDate).toBe(BUSINESS_DATE);

    // ...and that single category flip is what releases the liability, with no view change.
    expect(await customerDeposits(db)).toBe(0);
  });

  it("cancels a deposit-free quote with no resolution and no financial effect", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "QUOTING");

    const result = await cancelOrder(
      db,
      orderId,
      { occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );

    expect(result.order).toMatchObject({ status: "CANCELLED", cancelResolution: null });
    expect(result.account).toBeNull();
    expect(await txsForOrder(db, orderId)).toHaveLength(0);
    expect(await customerDeposits(db)).toBe(0);
  });

  it("requires a resolution when a deposit was taken", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "CONFIRMED");
    await expect(
      cancelOrder(db, orderId, { occurredAt: NOW, businessDate: BUSINESS_DATE }, ACTOR),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    // Untouched.
    expect((await getOrder(db, orderId)).status).toBe("CONFIRMED");
    expect(await customerDeposits(db)).toBe(15_000);
  });

  it("rejects a resolution when there is no deposit to resolve", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "QUOTING");
    await expect(
      cancelOrder(
        db,
        orderId,
        { occurredAt: NOW, businessDate: BUSINESS_DATE, resolution: "REFUND" },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refunds from a chosen account when the owner names one", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "READY");
    const bankBefore = await accountBalance(db, "acc_bank");

    await cancelOrder(
      db,
      orderId,
      {
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        resolution: "REFUND",
        accountId: "acc_bank",
      },
      ACTOR,
    );
    expect(await accountBalance(db, "acc_bank")).toBe(bankBefore - 15_000);
    expect(await customerDeposits(db)).toBe(0);
  });
});

// ============================================================================================
// resolveOrderLine (KOK-034) — attaching a catalog item to a free-text line
// ============================================================================================

/** Quotes an order with ONE free-text line (no `itemId`) at the given non-terminal status. */
async function seedOrderWithFreeTextLine(db: TestDb, status: CustomOrderStatus) {
  const customer = await seedCustomer(db);
  const { order } = await quoteOrder(
    db,
    {
      customerId: customer.id,
      description: "Torta personalizada",
      agreedTotal: 30_000,
      deliveryDate: BUSINESS_DATE,
      lines: [{ description: "Torta de chocolate, sin especificar aún" }],
    },
    ACTOR,
  );
  const lineId = (await getOrder(db, order.id)).lines[0]?.id;
  if (!lineId) throw new Error("seed line missing");

  if (status === "QUOTING") return { orderId: order.id, lineId };

  await confirmOrder(
    db,
    order.id,
    {
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      depositAmount: 15_000,
      paymentMethod: "CASH",
      accountId: "acc_cash",
    },
    ACTOR,
  );
  if (status === "CONFIRMED") return { orderId: order.id, lineId };

  await startOrderProduction(db, order.id, ACTOR);
  if (status === "IN_PRODUCTION") return { orderId: order.id, lineId };

  await markOrderReady(db, order.id, ACTOR);
  return { orderId: order.id, lineId };
}

describe("resolveOrderLine (KOK-034)", () => {
  it("attaches a catalog item to a free-text line while QUOTING", async () => {
    const db = createDb(env.DB);
    const { orderId, lineId } = await seedOrderWithFreeTextLine(db, "QUOTING");
    const item = await seedStockedItem(db);

    const { order } = await resolveOrderLine(db, orderId, lineId, { itemId: item.id }, ACTOR);
    expect(order.lines[0]?.itemId).toBe(item.id);
    // The description stays — it's the owner's original note, not overwritten by the link.
    expect(order.lines[0]?.description).toBe("Torta de chocolate, sin especificar aún");
  });

  it("writes an audit_log row", async () => {
    const db = createDb(env.DB);
    const { orderId, lineId } = await seedOrderWithFreeTextLine(db, "QUOTING");
    const item = await seedStockedItem(db);

    await resolveOrderLine(db, orderId, lineId, { itemId: item.id }, ACTOR);

    const rows = await db.query.auditLog.findMany({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityType, "custom_orders"), eqOp(t.action, "resolve_line")),
    });
    expect(rows).toHaveLength(1);
  });

  it.each(["CONFIRMED", "IN_PRODUCTION", "READY"] as const)(
    "also works while %s",
    async (status) => {
      const db = createDb(env.DB);
      const { orderId, lineId } = await seedOrderWithFreeTextLine(db, status);
      const item = await seedStockedItem(db);

      const { order } = await resolveOrderLine(db, orderId, lineId, { itemId: item.id }, ACTOR);
      expect(order.lines[0]?.itemId).toBe(item.id);
    },
  );

  it.each(["DELIVERED", "CANCELLED"] as const)("rejects once the order is %s", async (status) => {
    const db = createDb(env.DB);
    // DELIVERED requires every line linked already, so seed via the normal item-linked flow and
    // just assert the terminal-status guard rejects a (hypothetical) further resolve call on it.
    const { orderId } = await seedOrderInStatus(db, status);
    const lineRows = await db.query.customOrderLines.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.customOrderId, orderId),
    });
    const lineId = lineRows[0]?.id;
    if (!lineId) throw new Error("seed line missing");
    const item = await seedStockedItem(db);

    await expect(
      resolveOrderLine(db, orderId, lineId, { itemId: item.id }, ACTOR),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects an unknown line id", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderWithFreeTextLine(db, "QUOTING");
    const item = await seedStockedItem(db);

    await expect(
      resolveOrderLine(db, orderId, "nope", { itemId: item.id }, ACTOR),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a line id belonging to a different order", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderWithFreeTextLine(db, "QUOTING");
    const other = await seedOrderWithFreeTextLine(db, "QUOTING");
    const item = await seedStockedItem(db);

    await expect(
      resolveOrderLine(db, orderId, other.lineId, { itemId: item.id }, ACTOR),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an unknown item id", async () => {
    const db = createDb(env.DB);
    const { orderId, lineId } = await seedOrderWithFreeTextLine(db, "QUOTING");

    await expect(
      resolveOrderLine(db, orderId, lineId, { itemId: "nope" }, ACTOR),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a non-FINISHED item", async () => {
    const db = createDb(env.DB);
    const { orderId, lineId } = await seedOrderWithFreeTextLine(db, "QUOTING");
    const rawMaterial = await createItem(
      db,
      { name: uniqueName("Insumo"), kind: "RAW_MATERIAL", category: "OTHER", unit: "UNIT" },
      ACTOR,
    );

    await expect(
      resolveOrderLine(db, orderId, lineId, { itemId: rawMaterial.id }, ACTOR),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

// ============================================================================================
// The transition matrix — every legal move allowed, every illegal move a 409 (Doc 04 §5)
// ============================================================================================

const STATUSES: CustomOrderStatus[] = [
  "QUOTING",
  "CONFIRMED",
  "IN_PRODUCTION",
  "READY",
  "DELIVERED",
  "CANCELLED",
];
const TRANSITIONS = [
  "confirm",
  "start",
  "ready",
  "deliver",
  "cancel",
  "undoStart",
  "undoReady",
  "undoDeliver",
] as const;
type TransitionName = (typeof TRANSITIONS)[number];

/** Doc 03 §5's diagram, transcribed. The service's own ALLOWED_FROM must agree with this table. */
const LEGAL: Record<TransitionName, CustomOrderStatus[]> = {
  confirm: ["QUOTING"],
  start: ["CONFIRMED"],
  ready: ["IN_PRODUCTION"],
  deliver: ["READY"],
  cancel: ["QUOTING", "CONFIRMED", "IN_PRODUCTION", "READY"],
  undoStart: ["IN_PRODUCTION"],
  undoReady: ["READY"],
  undoDeliver: ["DELIVERED"],
};

async function runTransition(db: TestDb, orderId: string, transition: TransitionName) {
  switch (transition) {
    case "confirm":
      return confirmOrder(
        db,
        orderId,
        {
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          depositAmount: 15_000,
          paymentMethod: "CASH",
          accountId: "acc_cash",
        },
        ACTOR,
      );
    case "start":
      return startOrderProduction(db, orderId, ACTOR);
    case "ready":
      return markOrderReady(db, orderId, ACTOR);
    case "deliver":
      return deliverOrder(
        db,
        orderId,
        {
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          balancePaymentStatus: "PAID",
          paymentMethod: "CASH",
          accountId: "acc_cash",
        },
        ACTOR,
      );
    case "cancel": {
      const order = await getOrder(db, orderId);
      return cancelOrder(
        db,
        orderId,
        {
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          // A deposit-bearing order must resolve it; a deposit-free one must NOT send a resolution.
          resolution: order.depositPaid > 0 ? "FORFEIT" : undefined,
        },
        ACTOR,
      );
    }
    case "undoStart":
      return undoStartOrderProduction(db, orderId, ACTOR);
    case "undoReady":
      return undoMarkOrderReady(db, orderId, ACTOR);
    case "undoDeliver":
      return undoDeliverOrder(db, orderId, { confirm: false }, ACTOR);
  }
}

describe("state machine — every legal and illegal transition (Doc 03 §5 / Doc 04 §5)", () => {
  for (const transition of TRANSITIONS) {
    for (const from of STATUSES) {
      const legal = LEGAL[transition].includes(from);
      it(`${legal ? "ALLOWS" : "REJECTS"} ${transition} from ${from}`, async () => {
        const db = createDb(env.DB);
        const { orderId } = await seedOrderInStatus(db, from);

        if (legal) {
          await expect(runTransition(db, orderId, transition)).resolves.toBeDefined();
        } else {
          // A state-machine violation is a CONFLICT (409), never a silent no-op.
          await expect(runTransition(db, orderId, transition)).rejects.toMatchObject({
            code: "CONFLICT",
          });
          // ...and the order is exactly where it was.
          expect((await getOrder(db, orderId)).status).toBe(from);
        }
      });
    }
  }
});

// ============================================================================================
// Reads
// ============================================================================================

describe("getOrder / listOrders", () => {
  it("returns NOT_FOUND for an unknown order", async () => {
    const db = createDb(env.DB);
    await expect(getOrder(db, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("filters by status and sorts by delivery date with undated orders last (O-5)", async () => {
    const db = createDb(env.DB);
    const customer = await seedCustomer(db);

    await quoteOrder(
      db,
      { customerId: customer.id, description: "Sin fecha", agreedTotal: 1_000 },
      ACTOR,
    );
    await quoteOrder(
      db,
      {
        customerId: customer.id,
        description: "Tarde",
        agreedTotal: 1_000,
        deliveryDate: "2026-09-01",
      },
      ACTOR,
    );
    await quoteOrder(
      db,
      {
        customerId: customer.id,
        description: "Pronto",
        agreedTotal: 1_000,
        deliveryDate: "2026-08-01",
      },
      ACTOR,
    );

    const { orders } = await listOrders(db, { status: "QUOTING" });
    expect(orders.map((o) => o.description)).toEqual(["Pronto", "Tarde", "Sin fecha"]);
    expect(orders.every((o) => o.status === "QUOTING")).toBe(true);
    expect(orders[0]?.customerName).toBe(customer.name);
  });

  it("filters by customer", async () => {
    const db = createDb(env.DB);
    const a = await seedCustomer(db);
    const b = await seedCustomer(db);
    await quoteOrder(db, { customerId: a.id, description: "De A" }, ACTOR);
    await quoteOrder(db, { customerId: b.id, description: "De B" }, ACTOR);

    const { orders } = await listOrders(db, { customerId: b.id });
    expect(orders).toHaveLength(1);
    expect(orders[0]?.description).toBe("De B");
  });

  it("excludes terminal statuses", async () => {
    const db = createDb(env.DB);
    await seedOrderInStatus(db, "QUOTING");
    await seedOrderInStatus(db, "DELIVERED");
    await seedOrderInStatus(db, "CANCELLED");

    const { orders } = await listOrders(db, {
      excludeStatuses: ["DELIVERED", "CANCELLED"],
    });

    expect(orders).toHaveLength(1);
    expect(orders[0]?.status).toBe("QUOTING");
  });

  it("filters by creation date instead of delivery date", async () => {
    const db = createDb(env.DB);
    const customer = await seedCustomer(db);
    const first = await quoteOrder(
      db,
      {
        customerId: customer.id,
        description: "Creado hoy",
        deliveryDate: "1900-01-01",
      },
      ACTOR,
    );
    await quoteOrder(
      db,
      {
        customerId: customer.id,
        description: "También creado hoy",
        deliveryDate: "2099-12-31",
      },
      ACTOR,
    );

    const creationDate = first.order.createdAt.slice(0, 10);
    const { orders } = await listOrders(db, {
      fromDate: creationDate,
      toDate: creationDate,
    });

    expect(orders.map((order) => order.description)).toEqual(["Creado hoy", "También creado hoy"]);
  });

  it("keeps an evening La Paz order in the default business-date range", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T02:30:00.000Z"));

    try {
      const db = createDb(env.DB);
      const customer = await seedCustomer(db);
      const { order } = await quoteOrder(
        db,
        { customerId: customer.id, description: "Pedido nocturno" },
        ACTOR,
      );
      const today = toBusinessDate(new Date());
      const defaultRange = { fromDate: `${today.slice(0, 7)}-01`, toDate: today };

      expect(toDatetimeLocal(order.createdAt)).toBe("2026-07-20T22:30");
      expect(toBusinessDate(order.createdAt)).toBe(today);
      const { orders } = await listOrders(db, defaultRange);
      expect(orders.map((listedOrder) => listedOrder.id)).toContain(order.id);

      vi.setSystemTime(new Date("2026-07-21T13:30:00.000Z"));
      const nextMorning = toBusinessDate(new Date());
      const nextMorningRange = { fromDate: `${nextMorning.slice(0, 7)}-01`, toDate: nextMorning };
      const nextMorningOrders = await listOrders(db, nextMorningRange);
      expect(nextMorningOrders.orders.map((listedOrder) => listedOrder.id)).toContain(order.id);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("assertOrderLinkable", () => {
  it.each(["QUOTING", "CONFIRMED", "IN_PRODUCTION", "READY"] as const)(
    "accepts a %s order",
    async (status) => {
      const db = createDb(env.DB);
      const { orderId } = await seedOrderInStatus(db, status);

      await expect(assertOrderLinkable(db, orderId)).resolves.toBeUndefined();
    },
  );

  it.each(["DELIVERED", "CANCELLED"] as const)("rejects a %s order", async (status) => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, status);

    await expect(assertOrderLinkable(db, orderId)).rejects.toMatchObject({
      code: "VALIDATION",
      details: { id: orderId, status },
    });
  });
});

describe("payment method/account pairing (A-12)", () => {
  it("rejects CASH routed to a BANK account before confirming an order", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "QUOTING");

    await expect(
      confirmOrder(
        db,
        orderId,
        {
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          depositAmount: 15_000,
          paymentMethod: "CASH",
          accountId: "acc_bank",
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      message_es: expect.stringContaining("método de pago"),
    });

    expect((await getOrder(db, orderId)).status).toBe("QUOTING");
  });

  it("rejects CASH routed to a BANK account before delivering an order", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "READY");

    await expect(
      deliverOrder(
        db,
        orderId,
        {
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          balancePaymentStatus: "PAID",
          paymentMethod: "CASH",
          accountId: "acc_bank",
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      message_es: expect.stringContaining("método de pago"),
    });

    expect((await getOrder(db, orderId)).status).toBe("READY");
  });
});
