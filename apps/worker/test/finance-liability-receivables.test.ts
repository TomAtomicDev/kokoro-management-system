// Integration tests for the reusable Finance/Dashboard liability and receivable summary read
// (KOK-037). Fixtures use the existing core service seams so the assertions exercise real D1 views.
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createItem } from "../src/core/catalog/index.js";
import { createCustomer } from "../src/core/customers/index.js";
import { getLiabilityReceivableSummary } from "../src/core/finance/index.js";
import {
  cancelOrder,
  confirmOrder,
  deliverOrder,
  markOrderReady,
  quoteOrder,
  startOrderProduction,
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
  depositAmount: number,
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
  return { orderId: order.id, itemId: item.id };
}

async function deliverConfirmedOrder(
  db: TestDb,
  depositAmount: number,
  balancePaymentStatus: "PAID" | "ON_CREDIT",
): Promise<void> {
  const { orderId } = await seedConfirmedOrder(db, depositAmount);
  await startOrderProduction(db, orderId, ACTOR);
  await markOrderReady(db, orderId, ACTOR);
  await deliverOrder(
    db,
    orderId,
    balancePaymentStatus === "PAID"
      ? {
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          balancePaymentStatus,
          paymentMethod: "CASH",
          accountId: "acc_cash",
        }
      : { occurredAt: NOW, businessDate: BUSINESS_DATE, balancePaymentStatus },
    ACTOR,
  );
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.update(customOrders).set({ saleId: null, depositTxId: null });
  await db.update(financialTransactions).set({ counterpartTxId: null });
  await db.delete(auditLog);
  await db.delete(saleLines);
  await db.delete(sales);
  await db.delete(customOrderLines);
  await db.delete(customOrders);
  await db.delete(financialTransactions);
  await db.delete(stockMovements);
  await db.delete(itemStock);
  await db.delete(purchaseLines);
  await db.delete(purchases);
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("getLiabilityReceivableSummary (KOK-037)", () => {
  it("returns zero for an empty state", async () => {
    const db = createDb(env.DB);

    await expect(getLiabilityReceivableSummary(db)).resolves.toEqual({
      liability: 0,
      receivablesTotal: 0,
    });
  });

  it("reports an ORDER_DEPOSIT while its order is not delivered", async () => {
    const db = createDb(env.DB);
    await seedConfirmedOrder(db, 12_000);

    await expect(getLiabilityReceivableSummary(db)).resolves.toMatchObject({
      liability: 12_000,
      receivablesTotal: 0,
    });
  });

  it("nets a delivered order's deposit_paid out of liability", async () => {
    const db = createDb(env.DB);
    await deliverConfirmedOrder(db, 12_000, "PAID");

    await expect(getLiabilityReceivableSummary(db)).resolves.toMatchObject({
      liability: 0,
      receivablesTotal: 0,
    });
  });

  it("nets a DEPOSIT_REFUND out of liability", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedConfirmedOrder(db, 12_000);
    await cancelOrder(
      db,
      orderId,
      {
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        resolution: "REFUND",
        accountId: "acc_cash",
      },
      ACTOR,
    );

    await expect(getLiabilityReceivableSummary(db)).resolves.toMatchObject({
      liability: 0,
      receivablesTotal: 0,
    });
  });

  it("sums net custom-order and plain catalog ON_CREDIT receivables", async () => {
    const db = createDb(env.DB);
    await deliverConfirmedOrder(db, 12_000, "ON_CREDIT");

    const item = await seedStockedItem(db);
    await recordSale(
      db,
      {
        paymentStatus: "ON_CREDIT",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 1000, unitPriceMc: 750_000 }],
      },
      ACTOR,
    );

    await expect(getLiabilityReceivableSummary(db)).resolves.toEqual({
      liability: 0,
      receivablesTotal: 18_750,
    });
  });
});
