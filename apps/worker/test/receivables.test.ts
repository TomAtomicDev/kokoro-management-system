// Integration coverage for KOK-197's grouped receivables read against the real v_receivables view.
import { env } from "cloudflare:test";
import {
  addMoney,
  listReceivablesQuerySchema,
  rateFromTotal,
  toCentavos,
  toMilliUnits,
} from "@kokoro/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createItem } from "../src/core/catalog/index.js";
import { createCustomer } from "../src/core/customers/index.js";
import {
  getLiabilityReceivableSummary,
  listGroupedReceivables,
} from "../src/core/finance/index.js";
import {
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
const PURCHASE_AT = "2026-07-01T12:00:00.000Z";
const PURCHASE_DATE = "2026-07-01";

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
      name: uniqueName("Receivable item"),
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
      occurredAt: PURCHASE_AT,
      businessDate: PURCHASE_DATE,
      lines: [{ itemId: item.id, qty: 100_000, lineTotal: 600_000 }],
    },
    ACTOR,
  );
  return item;
}

async function recordCreditSale(
  db: TestDb,
  itemId: string,
  amount: number,
  occurredAt: string,
  customerId?: string,
) {
  return recordSale(
    db,
    {
      paymentStatus: "ON_CREDIT",
      ...(customerId ? { customerId } : {}),
      occurredAt,
      businessDate: occurredAt.slice(0, 10),
      lines: [
        { itemId, qty: 1_000, unitPriceMc: rateFromTotal(toCentavos(amount), toMilliUnits(1_000)) },
      ],
    },
    ACTOR,
  );
}

async function recordDeliveredOrder(
  db: TestDb,
  customerId: string,
  itemId: string,
  agreedTotal: number,
  depositAmount: number,
  occurredAt: string,
) {
  const { order } = await quoteOrder(
    db,
    {
      customerId,
      description: uniqueName("Receivable order"),
      agreedTotal,
      lines: [{ itemId, qty: 1_000 }],
    },
    ACTOR,
  );
  const paymentFields = {
    occurredAt,
    businessDate: occurredAt.slice(0, 10),
    depositAmount,
  };

  if (depositAmount === 0) {
    await confirmOrder(db, order.id, { ...paymentFields, acceptNoDepositRisk: true }, ACTOR);
  } else {
    await confirmOrder(
      db,
      order.id,
      { ...paymentFields, paymentMethod: "CASH", accountId: "acc_cash" },
      ACTOR,
    );
  }

  await startOrderProduction(db, order.id, ACTOR);
  await markOrderReady(db, order.id, ACTOR);
  const delivered = await deliverOrder(
    db,
    order.id,
    {
      occurredAt,
      businessDate: occurredAt.slice(0, 10),
      balancePaymentStatus: "ON_CREDIT",
      acceptCreditRisk: true,
    },
    ACTOR,
  );
  return { orderId: order.id, sale: delivered.sale };
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

describe("listGroupedReceivables (KOK-197)", () => {
  it("returns net sales in customer groups and keeps the global summary independent of filters and pages", async () => {
    const db = createDb(env.DB);
    const item = await seedStockedItem(db);
    const customerA = await createCustomer(
      db,
      { name: uniqueName("A receivable customer") },
      ACTOR,
    );
    const customerB = await createCustomer(
      db,
      { name: uniqueName("B receivable customer") },
      ACTOR,
    );

    const olderA = await recordCreditSale(
      db,
      item.id,
      2_000,
      "2026-08-01T12:00:00.000Z",
      customerA.id,
    );
    const olderB = await recordCreditSale(
      db,
      item.id,
      5_000,
      "2026-08-01T12:00:00.000Z",
      customerB.id,
    );
    const noCustomerOlder = await recordCreditSale(db, item.id, 7_000, "2026-08-01T12:00:00.000Z");
    const depositedOrder = await recordDeliveredOrder(
      db,
      customerA.id,
      item.id,
      30_000,
      10_000,
      "2026-09-01T12:00:00.000Z",
    );
    const recentA = await recordCreditSale(
      db,
      item.id,
      3_000,
      "2026-09-28T12:00:00.000Z",
      customerA.id,
    );
    const noCustomerRecent = await recordCreditSale(db, item.id, 8_000, "2026-09-29T12:00:00.000Z");
    const zeroDepositOrder = await recordDeliveredOrder(
      db,
      customerB.id,
      item.id,
      12_000,
      0,
      "2026-09-29T12:00:00.000Z",
    );

    const result = await listGroupedReceivables(
      db,
      listReceivablesQuerySchema.parse({ pageSize: 100 }),
    );
    expect(result.globalSummary).toEqual({
      receivablesTotal: 57_000,
      debtorCount: 2,
      pendingSaleCount: 7,
    });
    expect((await getLiabilityReceivableSummary(db)).receivablesTotal).toBe(
      result.globalSummary.receivablesTotal,
    );
    expect(result.groups).toHaveLength(3);
    expect(addMoney(...result.groups.map((group) => toCentavos(group.outstandingTotal)))).toBe(
      result.globalSummary.receivablesTotal,
    );
    expect(result.pagination).toMatchObject({ totalGroups: 3, totalPages: 1, hasNextPage: false });

    const groupA = result.groups.find(
      (group) => group.groupType === "CUSTOMER" && group.customerId === customerA.id,
    );
    expect(groupA).toMatchObject({ outstandingTotal: 25_000, pendingSaleCount: 3 });
    const depositedSale = groupA?.sales.find((sale) => sale.saleId === depositedOrder.sale.id);
    expect(depositedSale).toMatchObject({
      code: depositedOrder.sale.code,
      occurredAt: "2026-09-01T12:00:00.000Z",
      businessDate: "2026-09-01",
      channel: "CUSTOM_ORDER",
      saleTotal: 30_000,
      depositApplied: 10_000,
      outstandingAmount: 20_000,
      customOrderId: depositedOrder.orderId,
    });
    expect(depositedSale?.ageDays).toBeGreaterThanOrEqual(0);

    const zeroDepositSale = result.groups
      .flatMap((group) => group.sales)
      .find((sale) => sale.saleId === zeroDepositOrder.sale.id);
    expect(zeroDepositSale).toMatchObject({
      saleTotal: 12_000,
      depositApplied: 0,
      outstandingAmount: 12_000,
    });

    const noCustomerGroup = result.groups.find((group) => group.groupType === "NO_CUSTOMER");
    expect(noCustomerGroup).toMatchObject({ outstandingTotal: 15_000, pendingSaleCount: 2 });
    expect(noCustomerGroup?.sales.map((sale) => sale.saleId)).toEqual(
      expect.arrayContaining([noCustomerOlder.sale.id, noCustomerRecent.sale.id]),
    );

    const searchByCustomer = await listGroupedReceivables(
      db,
      listReceivablesQuerySchema.parse({ search: customerA.name }),
    );
    expect(searchByCustomer.groups).toHaveLength(1);
    expect(searchByCustomer.groups[0]?.pendingSaleCount).toBe(3);
    expect(searchByCustomer.globalSummary).toEqual(result.globalSummary);

    const saleCode = olderA.sale.code;
    expect(saleCode).not.toBeNull();
    const searchByCode = await listGroupedReceivables(
      db,
      listReceivablesQuerySchema.parse({ search: saleCode ?? "" }),
    );
    expect(searchByCode.groups).toHaveLength(1);
    expect(searchByCode.groups[0]?.sales.map((sale) => sale.saleId)).toEqual([olderA.sale.id]);
    expect(searchByCode.globalSummary).toEqual(result.globalSummary);

    const ageFiltered = await listGroupedReceivables(
      db,
      listReceivablesQuerySchema.parse({ minAgeDays: 10, pageSize: 100 }),
    );
    const ageFilteredSaleIds = ageFiltered.groups.flatMap((group) =>
      group.sales.map((sale) => sale.saleId),
    );
    expect(ageFilteredSaleIds).toContain(olderA.sale.id);
    expect(ageFilteredSaleIds).toContain(olderB.sale.id);
    expect(ageFilteredSaleIds).not.toContain(recentA.sale.id);
    expect(ageFilteredSaleIds).not.toContain(noCustomerRecent.sale.id);
    expect(ageFiltered.globalSummary).toEqual(result.globalSummary);

    const firstPage = await listGroupedReceivables(
      db,
      listReceivablesQuerySchema.parse({ page: 1, pageSize: 1, sortBy: "highestBalance" }),
    );
    const secondPage = await listGroupedReceivables(
      db,
      listReceivablesQuerySchema.parse({ page: 2, pageSize: 1 }),
    );
    const lastPage = await listGroupedReceivables(
      db,
      listReceivablesQuerySchema.parse({ page: 3, pageSize: 1 }),
    );
    expect(firstPage.groups).toHaveLength(1);
    expect(firstPage.groups[0]?.groupType).toBe("CUSTOMER");
    if (firstPage.groups[0]?.groupType === "CUSTOMER") {
      expect(firstPage.groups[0].customerId).toBe(customerA.id);
    }
    expect(secondPage.groups).toHaveLength(1);
    expect(lastPage.groups[0]?.groupType).toBe("NO_CUSTOMER");
    expect(firstPage.pagination).toMatchObject({ totalGroups: 3, page: 1, hasNextPage: true });
    expect(lastPage.pagination).toMatchObject({ totalGroups: 3, page: 3, hasNextPage: false });
    expect(firstPage.globalSummary).toEqual(result.globalSummary);
    expect(secondPage.globalSummary).toEqual(result.globalSummary);
    expect(lastPage.globalSummary).toEqual(result.globalSummary);
  });
});
