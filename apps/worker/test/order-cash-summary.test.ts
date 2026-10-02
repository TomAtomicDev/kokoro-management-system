// Integration tests for the reusable Finance/Dashboard order cash and receivable summary read
// (KOK-207). Fixtures use core service seams so assertions exercise real D1 projections.
import { env } from "cloudflare:test";
import { listReceivablesQuerySchema } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createItem } from "../src/core/catalog/index.js";
import { createCustomer } from "../src/core/customers/index.js";
import {
  deleteTransaction,
  getOrderCashReceivableSummary,
  listGroupedReceivables,
  recordTransaction,
  restoreTransaction,
} from "../src/core/finance/index.js";
import { getOrderFinanceProjection } from "../src/core/finance/order-balances.js";
import {
  cancelOrder,
  confirmOrder,
  deliverOrder,
  markOrderReady,
  quoteOrder,
  startOrderProduction,
  undoDeliverOrder,
} from "../src/core/orders/index.js";
import { recordPurchase } from "../src/core/purchasing/index.js";
import { recordSale } from "../src/core/sales/index.js";
import { createDb } from "../src/db/index.js";
import {
  auditLog,
  customOrderLines,
  customOrders,
  financialAccounts,
  financialTransactions,
  itemStock,
  purchaseLines,
  purchases,
  saleLines,
  sales,
  stockMovements,
} from "../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;
const NOW = "2026-07-20T14:00:00.000Z";
const BUSINESS_DATE = "2026-07-20";

type TestDb = ReturnType<typeof createDb>;

let sequence = 0;
function uniqueName(prefix: string): string {
  sequence += 1;
  return `${prefix} ${sequence}`;
}

async function seedStockedItem(db: TestDb) {
  const item = await createItem(
    db,
    {
      name: uniqueName("Liability receivable item"),
      kind: "FINISHED",
      category: "BAKERY",
      unit: "UNIT",
    },
    ACTOR,
  );
  await recordPurchase(
    db,
    {
      accountId: "acc_bank",
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId: item.id, qty: 10_000, lineTotal: 60_000 }],
    },
    ACTOR,
  );
  return item;
}

async function seedConfirmedOrder(
  db: TestDb,
  agreedTotal = 30_000,
): Promise<{ orderId: string; itemId: string }> {
  const customer = await createCustomer(
    db,
    { name: uniqueName("Liability receivable customer") },
    ACTOR,
  );
  const item = await seedStockedItem(db);
  const { order } = await quoteOrder(
    db,
    {
      customerId: customer.id,
      description: "Pedido para resumen financiero",
      agreedTotal,
      deliveryDate: BUSINESS_DATE,
      lines: [{ itemId: item.id, qty: 1000 }],
    },
    ACTOR,
  );
  await confirmOrder(db, order.id, {}, ACTOR);
  return { orderId: order.id, itemId: item.id };
}

async function deliverConfirmedOrder(db: TestDb): Promise<void> {
  const { orderId } = await seedConfirmedOrder(db);
  await startOrderProduction(db, orderId, ACTOR);
  await markOrderReady(db, orderId, ACTOR);
  await deliverOrder(db, orderId, { occurredAt: NOW, businessDate: BUSINESS_DATE }, ACTOR);
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.update(customOrders).set({ saleId: null, depositTxId: null });
  await db.update(financialTransactions).set({ counterpartTxId: null });
  await db.delete(auditLog);
  await db.delete(saleLines);
  await db.delete(sales);
  await db.delete(customOrderLines);
  await db.delete(purchaseLines);
  await db.delete(purchases);
  await db.delete(financialTransactions);
  await db.delete(customOrders);
  await db.delete(stockMovements);
  await db.delete(itemStock);
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("getOrderCashReceivableSummary (KOK-207)", () => {
  it("returns zero for an empty state", async () => {
    const db = createDb(env.DB);

    await expect(getOrderCashReceivableSummary(db)).resolves.toEqual({
      preDeliveryOrderCashExposure: 0,
      receivablesTotal: 0,
    });
  });

  it("does not manufacture cash exposure or a receivable when confirming an unpaid order", async () => {
    const db = createDb(env.DB);
    await seedConfirmedOrder(db);

    await expect(getOrderCashReceivableSummary(db)).resolves.toMatchObject({
      preDeliveryOrderCashExposure: 0,
      receivablesTotal: 0,
    });
  });

  it("keeps delivery cash-free", async () => {
    const db = createDb(env.DB);
    await deliverConfirmedOrder(db);

    await expect(getOrderCashReceivableSummary(db)).resolves.toMatchObject({
      preDeliveryOrderCashExposure: 0,
      receivablesTotal: 30_000,
    });
  });

  it("cancels without creating a refund or other finance effect", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedConfirmedOrder(db);
    await recordTransaction(
      db,
      {
        customOrderId: orderId,
        accountId: "acc_cash",
        type: "INCOME",
        category: "ORDER_DEPOSIT",
        amount: 1_000,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
      },
      ACTOR,
    );
    await cancelOrder(db, orderId, {}, ACTOR);

    await expect(getOrderCashReceivableSummary(db)).resolves.toMatchObject({
      preDeliveryOrderCashExposure: 0,
      receivablesTotal: 0,
    });
    const cashAccount = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_cash"),
    });
    expect(cashAccount?.balance).toBe(1_000);
  });

  it("preserves catalog-sale receivables", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedItem(db);
    const result = await recordSale(
      db,
      {
        paymentStatus: "ON_CREDIT",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 1000, unitPriceMc: 750_000 }],
      },
      ACTOR,
    );

    await expect(getOrderCashReceivableSummary(db)).resolves.toMatchObject({
      preDeliveryOrderCashExposure: 0,
      receivablesTotal: result.sale.total,
    });
  });

  it("floors exposure per order and ignores other order-linked income and expenses", async () => {
    const db = createDb(env.DB);
    const first = await seedConfirmedOrder(db, 5_000);
    const second = await seedConfirmedOrder(db, 4_000);
    const recordOrderCash = async (
      customOrderId: string,
      type: "INCOME" | "EXPENSE",
      category:
        | "ORDER_DEPOSIT"
        | "ORDER_BALANCE"
        | "ORDER_REFUND"
        | "OTHER_INCOME"
        | "OTHER_EXPENSE",
      amount: number,
    ) =>
      recordTransaction(
        db,
        {
          customOrderId,
          accountId: "acc_cash",
          type,
          category,
          amount,
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
        },
        ACTOR,
      );

    await recordOrderCash(first.orderId, "INCOME", "ORDER_DEPOSIT", 1_000);
    await recordOrderCash(first.orderId, "EXPENSE", "ORDER_REFUND", 1_500);
    await recordOrderCash(first.orderId, "INCOME", "OTHER_INCOME", 9_000);
    await recordOrderCash(first.orderId, "EXPENSE", "OTHER_EXPENSE", 700);
    await recordOrderCash(second.orderId, "INCOME", "ORDER_BALANCE", 2_000);

    await expect(getOrderCashReceivableSummary(db)).resolves.toEqual({
      // First order's refund excess is floored at zero; it cannot net the second order's 2,000.
      preDeliveryOrderCashExposure: 2_000,
      receivablesTotal: 0,
    });
    const projection = await getOrderFinanceProjection(db);
    expect(projection.balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orderId: first.orderId, expected: 4_000, excess: 0 }),
        expect.objectContaining({ orderId: second.orderId, expected: 2_000, excess: 0 }),
      ]),
    );
  });

  it("keeps debt independent from refunds and other cash through delivery and undo", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedConfirmedOrder(db, 30_000);
    const recordOrderCash = async (
      type: "INCOME" | "EXPENSE",
      category:
        | "ORDER_DEPOSIT"
        | "ORDER_BALANCE"
        | "ORDER_REFUND"
        | "OTHER_INCOME"
        | "OTHER_EXPENSE",
      amount: number,
    ) =>
      recordTransaction(
        db,
        {
          customOrderId: orderId,
          accountId: "acc_cash",
          type,
          category,
          amount,
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
        },
        ACTOR,
      );

    await recordOrderCash("INCOME", "ORDER_DEPOSIT", 8_000);
    await recordOrderCash("INCOME", "ORDER_BALANCE", 5_000);
    await recordOrderCash("EXPENSE", "ORDER_REFUND", 2_000);
    await recordOrderCash("INCOME", "OTHER_INCOME", 900);
    await recordOrderCash("EXPENSE", "OTHER_EXPENSE", 800);
    const accountBeforeDelivery = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_cash"),
    });
    expect(accountBeforeDelivery?.balance).toBe(11_100);
    const transactionsBeforeDelivery = await db.query.financialTransactions.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.customOrderId, orderId),
    });

    await expect(getOrderCashReceivableSummary(db)).resolves.toEqual({
      preDeliveryOrderCashExposure: 11_000,
      receivablesTotal: 0,
    });
    await startOrderProduction(db, orderId, ACTOR);
    await markOrderReady(db, orderId, ACTOR);
    await deliverOrder(db, orderId, { occurredAt: NOW, businessDate: BUSINESS_DATE }, ACTOR);
    await expect(getOrderCashReceivableSummary(db)).resolves.toEqual({
      preDeliveryOrderCashExposure: 0,
      // The refund, other income and expense do not settle/reinstate customer debt.
      receivablesTotal: 17_000,
    });

    await undoDeliverOrder(db, orderId, {}, ACTOR);
    await expect(getOrderCashReceivableSummary(db)).resolves.toEqual({
      preDeliveryOrderCashExposure: 11_000,
      receivablesTotal: 0,
    });
    const accountAfterUndo = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_cash"),
    });
    expect(accountAfterUndo?.balance).toBe(accountBeforeDelivery?.balance);
    const transactionsAfterUndo = await db.query.financialTransactions.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.customOrderId, orderId),
    });
    expect(transactionsAfterUndo.sort((left, right) => left.id.localeCompare(right.id))).toEqual(
      transactionsBeforeDelivery.sort((left, right) => left.id.localeCompare(right.id)),
    );
  });

  it("uses only active qualifying receipts after a finance soft-delete and restore", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedConfirmedOrder(db, 10_000);
    const receipt = await recordTransaction(
      db,
      {
        customOrderId: orderId,
        accountId: "acc_cash",
        type: "INCOME",
        category: "ORDER_BALANCE",
        amount: 4_000,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
      },
      ACTOR,
    );
    await startOrderProduction(db, orderId, ACTOR);
    await markOrderReady(db, orderId, ACTOR);
    await deliverOrder(db, orderId, { occurredAt: NOW, businessDate: BUSINESS_DATE }, ACTOR);

    await expect(getOrderCashReceivableSummary(db)).resolves.toMatchObject({
      receivablesTotal: 6_000,
      preDeliveryOrderCashExposure: 0,
    });
    await deleteTransaction(db, receipt.transaction.id, {}, ACTOR);
    await expect(getOrderCashReceivableSummary(db)).resolves.toMatchObject({
      receivablesTotal: 10_000,
      preDeliveryOrderCashExposure: 0,
    });
    await restoreTransaction(db, receipt.transaction.id, {}, ACTOR);
    await expect(getOrderCashReceivableSummary(db)).resolves.toMatchObject({
      receivablesTotal: 6_000,
      preDeliveryOrderCashExposure: 0,
    });
  });

  it("keeps delivered overpayment separate and does not emit a zero-debt receivable", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedConfirmedOrder(db, 10_000);
    await recordTransaction(
      db,
      {
        customOrderId: orderId,
        accountId: "acc_cash",
        type: "INCOME",
        category: "ORDER_BALANCE",
        amount: 12_000,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
      },
      ACTOR,
    );
    await startOrderProduction(db, orderId, ACTOR);
    await markOrderReady(db, orderId, ACTOR);
    await deliverOrder(db, orderId, { occurredAt: NOW, businessDate: BUSINESS_DATE }, ACTOR);

    const projection = await getOrderFinanceProjection(db);
    expect(projection.balances.find((balance) => balance.orderId === orderId)).toEqual({
      orderId,
      status: "DELIVERED",
      customerAmount: 10_000,
      qualifyingReceipts: 12_000,
      expected: 0,
      excess: 2_000,
    });
    expect(
      projection.receivables.some((receivable) => receivable.receivable.customOrderId === orderId),
    ).toBe(false);
    await expect(getOrderCashReceivableSummary(db)).resolves.toMatchObject({
      receivablesTotal: 0,
      preDeliveryOrderCashExposure: 0,
    });
  });

  it("reads cash projection rows beyond the historical 500-order board page", async () => {
    const db = createDb(env.DB);
    const customer = await createCustomer(
      db,
      { name: uniqueName("Order projection page-boundary customer") },
      ACTOR,
    );
    const item = await createItem(
      db,
      {
        name: uniqueName("Order projection page-boundary item"),
        kind: "FINISHED",
        category: "BAKERY",
        unit: "UNIT",
      },
      ACTOR,
    );
    let lastOrderId = "";
    for (let index = 0; index < 501; index += 1) {
      const { order } = await quoteOrder(
        db,
        {
          customerId: customer.id,
          description: uniqueName(`Projection order ${index}`),
          ...(index === 500
            ? { agreedTotal: 2_500, lines: [{ itemId: item.id, qty: 1_000 }] }
            : {}),
        },
        ACTOR,
      );
      lastOrderId = order.id;
      if (index === 500) {
        await confirmOrder(db, order.id, {}, ACTOR);
        await startOrderProduction(db, order.id, ACTOR);
        await markOrderReady(db, order.id, ACTOR);
        await deliverOrder(db, order.id, { occurredAt: NOW, businessDate: BUSINESS_DATE }, ACTOR);
      }
    }

    await expect(getOrderCashReceivableSummary(db)).resolves.toEqual({
      preDeliveryOrderCashExposure: 0,
      receivablesTotal: 2_500,
    });
    const grouped = await listGroupedReceivables(db, listReceivablesQuerySchema.parse({}));
    expect(grouped.globalSummary.receivablesTotal).toBe(2_500);
    expect(
      grouped.groups
        .flatMap((group) => group.receivables)
        .some(
          (receivable) =>
            receivable.sourceType === "CUSTOM_ORDER" && receivable.customOrderId === lastOrderId,
        ),
    ).toBe(true);
  }, 90_000);
});
