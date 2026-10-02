// ADR-022 order agreement, derived reads, and cash-free lifecycle integration tests against real D1.
import { env } from "cloudflare:test";
import type { CustomOrderStatus, OrderDto, UpdateOrderCommand } from "@kokoro/shared";
import {
  addMoney,
  calculateOrderReceiptBalance,
  toBusinessDate,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
} from "@kokoro/shared";
import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createItem } from "../src/core/catalog/index.js";
import { createCustomer } from "../src/core/customers/index.js";
import { deleteTransaction, recordTransaction } from "../src/core/finance/index.js";
import {
  assertOrderLinkable,
  cancelOrder,
  confirmOrder,
  deliverOrder,
  getOrder,
  getOrderReceiptSummary,
  listOrders,
  markOrderReady,
  previewOrderImpact,
  quoteOrder,
  startOrderProduction,
  undoDeliverOrder,
  undoMarkOrderReady,
  undoStartOrderProduction,
  updateOrder,
} from "../src/core/orders/index.js";
import { getProductionRun, recordProductionRun } from "../src/core/production/index.js";
import { recordPurchase } from "../src/core/purchasing/index.js";
import { collectPayment, deleteSale, recordSale, updateSale } from "../src/core/sales/index.js";
import { createDb } from "../src/db/index.js";
import {
  auditLog,
  customOrderLines,
  customOrders,
  financialAccounts,
  financialTransactions,
  productionRuns,
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

async function seedCustomer(db: TestDb) {
  return createCustomer(db, { name: uniqueName("Cliente pedido") }, ACTOR);
}

async function seedStockedItem(db: TestDb) {
  const item = await createItem(
    db,
    { name: uniqueName("Producto pedido"), kind: "FINISHED", category: "BAKERY", unit: "UNIT" },
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

async function seedOrderInStatus(
  db: TestDb,
  status: CustomOrderStatus = "QUOTING",
  options: { agreedTotal?: number; additionalCharge?: number } = {},
): Promise<{ orderId: string; itemId: string; customerId: string; code: string | null }> {
  const customer = await seedCustomer(db);
  const item = await seedStockedItem(db);
  const { order } = await quoteOrder(
    db,
    {
      customerId: customer.id,
      description: "Torta personalizada",
      agreedTotal: options.agreedTotal ?? 30_000,
      additionalCharge: options.additionalCharge ?? 0,
      deliveryDate: BUSINESS_DATE,
      lines: [{ itemId: item.id, qty: 1000 }],
    },
    ACTOR,
  );
  if (status === "QUOTING") {
    return { orderId: order.id, itemId: item.id, customerId: customer.id, code: order.code };
  }
  if (status === "CANCELLED") {
    await cancelOrder(db, order.id, {}, ACTOR);
    return { orderId: order.id, itemId: item.id, customerId: customer.id, code: order.code };
  }

  await confirmOrder(db, order.id, {}, ACTOR);
  if (status === "CONFIRMED") {
    return { orderId: order.id, itemId: item.id, customerId: customer.id, code: order.code };
  }
  await startOrderProduction(db, order.id, ACTOR);
  if (status === "IN_PRODUCTION") {
    return { orderId: order.id, itemId: item.id, customerId: customer.id, code: order.code };
  }
  await markOrderReady(db, order.id, ACTOR);
  if (status === "READY") {
    return { orderId: order.id, itemId: item.id, customerId: customer.id, code: order.code };
  }
  await deliverOrder(db, order.id, { occurredAt: NOW, businessDate: BUSINESS_DATE }, ACTOR);
  return { orderId: order.id, itemId: item.id, customerId: customer.id, code: order.code };
}

function updateCommandFromOrder(
  order: OrderDto,
  changes: Partial<UpdateOrderCommand> = {},
): UpdateOrderCommand {
  return {
    expectedUpdatedAt: order.updatedAt,
    customerId: order.customerId,
    description: order.description,
    agreedTotal: order.agreedTotal,
    additionalCharge: order.additionalCharge,
    deliveryDate: order.deliveryDate,
    deliveryPlace: order.deliveryPlace,
    notes: order.notes,
    lines: order.lines.map((line) => ({
      itemId: line.itemId,
      description: line.description,
      qty: line.qty,
      lineTotal: line.lineTotal,
    })),
    ...changes,
  };
}

async function recordOrderReceipt(
  db: TestDb,
  orderId: string,
  amount: number,
  category: "ORDER_DEPOSIT" | "ORDER_BALANCE" = "ORDER_DEPOSIT",
) {
  const result = await recordTransaction(
    db,
    {
      accountId: "acc_cash",
      type: "INCOME",
      category,
      amount,
      customOrderId: orderId,
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
    },
    ACTOR,
  );
  return result.transaction;
}

async function financialSnapshot(db: TestDb): Promise<string> {
  const [transactions, accounts] = await Promise.all([
    db.query.financialTransactions.findMany({ orderBy: (t, { asc }) => asc(t.id) }),
    db.query.financialAccounts.findMany({
      where: (t, { inArray: inArrayOp }) => inArrayOp(t.id, ["acc_bank", "acc_cash"]),
      orderBy: (t, { asc }) => asc(t.id),
    }),
  ]);
  return JSON.stringify({ transactions, accounts });
}

const lifecycleTransitions: Array<{
  name: string;
  allowed: readonly CustomOrderStatus[];
  run: (db: TestDb, orderId: string) => Promise<unknown>;
}> = [
  { name: "confirm", allowed: ["QUOTING"], run: (db, id) => confirmOrder(db, id, {}, ACTOR) },
  {
    name: "start production",
    allowed: ["CONFIRMED"],
    run: (db, id) => startOrderProduction(db, id, ACTOR),
  },
  {
    name: "mark ready",
    allowed: ["IN_PRODUCTION"],
    run: (db, id) => markOrderReady(db, id, ACTOR),
  },
  {
    name: "deliver",
    allowed: ["READY"],
    run: (db, id) => deliverOrder(db, id, { occurredAt: NOW, businessDate: BUSINESS_DATE }, ACTOR),
  },
  {
    name: "cancel",
    allowed: ["QUOTING", "CONFIRMED", "IN_PRODUCTION", "READY"],
    run: (db, id) => cancelOrder(db, id, {}, ACTOR),
  },
  {
    name: "undo start production",
    allowed: ["IN_PRODUCTION"],
    run: (db, id) => undoStartOrderProduction(db, id, ACTOR),
  },
  {
    name: "undo mark ready",
    allowed: ["READY"],
    run: (db, id) => undoMarkOrderReady(db, id, ACTOR),
  },
  {
    name: "undo delivery",
    allowed: ["DELIVERED"],
    run: (db, id) => undoDeliverOrder(db, id, {}, ACTOR),
  },
];

const illegalLifecycleAttempts = (
  ["QUOTING", "CONFIRMED", "IN_PRODUCTION", "READY", "DELIVERED", "CANCELLED"] as const
).flatMap((status) =>
  lifecycleTransitions
    .filter((transition) => !transition.allowed.includes(status))
    .map((transition) => ({ status, name: transition.name, run: transition.run })),
);

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.update(customOrders).set({ saleId: null, depositTxId: null });
  await db.update(financialTransactions).set({ counterpartTxId: null });
  await db
    .delete(auditLog)
    .where(inArray(auditLog.entityType, ["custom_orders", "sales", "financial_transactions"]));
  await db.delete(stockMovements).where(eq(stockMovements.sourceEventType, "sale"));
  await db.delete(saleLines);
  await db.delete(sales);
  await db.delete(financialTransactions);
  await db.update(productionRuns).set({ customOrderId: null });
  await db.delete(customOrderLines);
  await db.delete(customOrders);
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("quoteOrder and updateOrder", () => {
  it("quotes merchandise and an independent additional charge without moving money", async () => {
    const db = createDb(env.DB);
    const customer = await seedCustomer(db);
    const item = await seedStockedItem(db);
    const before = await financialSnapshot(db);
    const { order } = await quoteOrder(
      db,
      {
        customerId: customer.id,
        description: "Cotización separada",
        agreedTotal: 12_000,
        additionalCharge: 2_000,
        lines: [{ itemId: item.id, qty: 1000 }],
      },
      ACTOR,
    );

    expect(order).toMatchObject({
      status: "QUOTING",
      agreedTotal: 12_000,
      additionalCharge: 2_000,
      code: expect.stringMatching(/^PED-\d{4}-\d{4}$/),
    });
    expect(await financialSnapshot(db)).toBe(before);
  });

  it("keeps quote validation for customers, free-text lines and FINISHED item eligibility", async () => {
    const db = createDb(env.DB);
    const customer = await seedCustomer(db);
    const raw = await createItem(
      db,
      {
        name: uniqueName("Insumo no vendible"),
        kind: "RAW_MATERIAL",
        category: "INGREDIENT",
        unit: "KG",
      },
      ACTOR,
    );
    await expect(
      quoteOrder(db, { customerId: "missing-customer", description: "Sin cliente" }, ACTOR),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      quoteOrder(
        db,
        { customerId: customer.id, description: "Línea vacía", lines: [{ description: "" }] },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      quoteOrder(
        db,
        { customerId: customer.id, description: "Ítem inválido", lines: [{ itemId: raw.id }] },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("edits every active status, clears nullable fields, preserves PED code, and audits one batch", async () => {
    const db = createDb(env.DB);
    for (const status of ["QUOTING", "CONFIRMED", "IN_PRODUCTION", "READY"] as const) {
      const { orderId, customerId, code } = await seedOrderInStatus(db, status);
      const replacementCustomer = await seedCustomer(db);
      const order = await getOrder(db, orderId);
      const beforeFinance = await financialSnapshot(db);
      const result = await updateOrder(
        db,
        orderId,
        updateCommandFromOrder(order, {
          customerId: replacementCustomer.id,
          description: `Ajustado ${status}`,
          agreedTotal: status === "QUOTING" ? null : 10_000,
          additionalCharge: 1_250,
          deliveryDate: null,
          deliveryPlace: null,
          notes: null,
          lines: [
            {
              itemId: order.lines[0]?.itemId ?? null,
              description: null,
              qty: 1000,
              lineTotal: null,
            },
          ],
        }),
        ACTOR,
      );

      expect(result.order).toMatchObject({
        status,
        customerId: replacementCustomer.id,
        description: `Ajustado ${status}`,
        agreedTotal: status === "QUOTING" ? null : 10_000,
        additionalCharge: 1_250,
        deliveryDate: null,
        deliveryPlace: null,
        notes: null,
        code,
      });
      expect(result.order.updatedAt).not.toBe(order.updatedAt);
      expect(await financialSnapshot(db)).toBe(beforeFinance);
      const audit = await db.query.auditLog.findFirst({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(eqOp(t.entityId, orderId), eqOp(t.action, "update")),
      });
      expect(audit).toBeDefined();
      expect(JSON.parse(audit?.beforeJson ?? "null")).toMatchObject({
        customerId,
        status,
      });
      expect(JSON.parse(audit?.afterJson ?? "null")).toMatchObject({
        customerId: replacementCustomer.id,
        additionalCharge: 1_250,
      });
    }
  });

  it("advances the optimistic version across same-millisecond lifecycle transitions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T12:00:00.000Z"));

    try {
      const db = createDb(env.DB);
      const { orderId } = await seedOrderInStatus(db, "QUOTING");
      const quoted = await getOrder(db, orderId);

      await confirmOrder(db, orderId, {}, ACTOR);
      const confirmed = await getOrder(db, orderId);
      expect(confirmed.updatedAt).not.toBe(quoted.updatedAt);
      await expect(
        updateOrder(
          db,
          orderId,
          updateCommandFromOrder(quoted, { description: "Edición abierta antes de confirmar" }),
          ACTOR,
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      const versions = [quoted.updatedAt, confirmed.updatedAt];
      const captureVersion = async () => {
        versions.push((await getOrder(db, orderId)).updatedAt);
      };
      await startOrderProduction(db, orderId, ACTOR);
      await captureVersion();
      await undoStartOrderProduction(db, orderId, ACTOR);
      await captureVersion();
      await startOrderProduction(db, orderId, ACTOR);
      await markOrderReady(db, orderId, ACTOR);
      await captureVersion();
      await undoMarkOrderReady(db, orderId, ACTOR);
      await captureVersion();
      await markOrderReady(db, orderId, ACTOR);
      await deliverOrder(db, orderId, { occurredAt: NOW, businessDate: BUSINESS_DATE }, ACTOR);
      await captureVersion();
      await undoDeliverOrder(db, orderId, {}, ACTOR);
      await captureVersion();
      await cancelOrder(db, orderId, {}, ACTOR);
      await captureVersion();

      expect(
        versions.slice(1).every((version, index) => {
          const previousVersion = versions[index];
          return previousVersion !== undefined && version > previousVersion;
        }),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts an agreement below active receipts and reports draft excess without blocking", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "CONFIRMED", { agreedTotal: 10_000 });
    await recordOrderReceipt(db, orderId, 12_500);
    const order = await getOrder(db, orderId);
    const updated = await updateOrder(
      db,
      orderId,
      updateCommandFromOrder(order, { agreedTotal: 8_000, additionalCharge: 1_000 }),
      ACTOR,
    );
    const receipts = await getOrderReceiptSummary(db, orderId);
    const preview = calculateOrderReceiptBalance(
      updated.order.agreedTotal,
      updated.order.additionalCharge,
      receipts.qualifyingReceipts,
    );

    expect(receipts).toEqual({ qualifyingReceipts: 12_500, hasEverQualifyingReceipt: true });
    expect(preview).toEqual({ customerAmount: 9_000, expected: 0, excess: 3_500 });
    expect(updated.order.agreedTotal).toBe(8_000);
  });

  it("resolves free-text order lines through the same full update command", async () => {
    const db = createDb(env.DB);
    const customer = await seedCustomer(db);
    const item = await seedStockedItem(db);
    const { order } = await quoteOrder(
      db,
      {
        customerId: customer.id,
        description: "Línea inicialmente libre",
        agreedTotal: 10_000,
        lines: [{ description: "Producto descrito", qty: 1000 }],
      },
      ACTOR,
    );
    const resolved = await updateOrder(
      db,
      order.id,
      updateCommandFromOrder(order, {
        lines: [{ itemId: item.id, description: "Producto descrito", qty: 1000, lineTotal: null }],
      }),
      ACTOR,
    );
    expect(resolved.order.lines).toMatchObject([
      { itemId: item.id, description: "Producto descrito", qty: 1000 },
    ]);
  });

  it("keeps linked production work unchanged when replacing agreement lines", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "IN_PRODUCTION");
    const rawItem = await createItem(
      db,
      {
        name: uniqueName("Insumo trabajo histórico"),
        kind: "RAW_MATERIAL",
        category: "INGREDIENT",
        unit: "KG",
      },
      ACTOR,
    );
    const output = await createItem(
      db,
      {
        name: uniqueName("Producto trabajo histórico"),
        kind: "SEMI_FINISHED",
        category: "INGREDIENT",
        unit: "KG",
      },
      ACTOR,
    );
    const production = await recordProductionRun(
      db,
      {
        recipeId: null,
        outputItemId: output.id,
        customOrderId: orderId,
        batches: 1,
        actualOutputQty: 1000,
        indirectCost: 500,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: rawItem.id, qty: 1000 }],
      },
      ACTOR,
    );
    const beforeWork = await getProductionRun(db, production.productionRun.id);
    const order = await getOrder(db, orderId);
    const updated = await updateOrder(
      db,
      orderId,
      updateCommandFromOrder(order, {
        description: "Acuerdo corregido después de iniciar el trabajo",
        agreedTotal: 28_000,
        additionalCharge: 1_000,
        lines: [{ itemId: order.lines[0]?.itemId ?? null, qty: 2000, lineTotal: null }],
      }),
      ACTOR,
    );

    const afterWork = await getProductionRun(db, production.productionRun.id);
    expect(updated.order.description).toBe("Acuerdo corregido después de iniciar el trabajo");
    expect(afterWork).toEqual(beforeWork);
  });

  it("receipt summary counts only active manual order receipts and remembers soft-deleted receipt identity", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db);
    const { orderId: unrelatedOrderId } = await seedOrderInStatus(db);
    const activeReceipt = await recordOrderReceipt(db, orderId, 3_000);
    const activeBalanceReceipt = await recordOrderReceipt(db, orderId, 500, "ORDER_BALANCE");
    const deletedReceipt = await recordOrderReceipt(db, orderId, 2_000, "ORDER_BALANCE");
    await recordTransaction(
      db,
      {
        accountId: "acc_cash",
        type: "INCOME",
        category: "OTHER_INCOME",
        amount: 4_000,
        customOrderId: orderId,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
      },
      ACTOR,
    );
    await recordTransaction(
      db,
      {
        accountId: "acc_cash",
        type: "EXPENSE",
        category: "ORDER_REFUND",
        amount: 1_500,
        customOrderId: orderId,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
      },
      ACTOR,
    );
    await recordTransaction(
      db,
      {
        accountId: "acc_cash",
        type: "EXPENSE",
        category: "OPERATING_EXPENSE",
        amount: 800,
        customOrderId: orderId,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
      },
      ACTOR,
    );
    await recordOrderReceipt(db, unrelatedOrderId, 7_000);
    await deleteTransaction(db, deletedReceipt.id, {}, ACTOR);

    expect(await getOrderReceiptSummary(db, orderId)).toEqual({
      qualifyingReceipts: 3_500,
      hasEverQualifyingReceipt: true,
    });
    await deleteTransaction(db, activeReceipt.id, {}, ACTOR);
    await deleteTransaction(db, activeBalanceReceipt.id, {}, ACTOR);
    expect(await getOrderReceiptSummary(db, orderId)).toEqual({
      qualifyingReceipts: 0,
      hasEverQualifyingReceipt: true,
    });
  });

  it("locks customer after any qualifying receipt, including deleted ones, but permits a pre-receipt change", async () => {
    const db = createDb(env.DB);
    const newCustomer = await seedCustomer(db);
    const beforeReceipt = await seedOrderInStatus(db);
    const beforeReceiptOrder = await getOrder(db, beforeReceipt.orderId);
    await expect(
      updateOrder(
        db,
        beforeReceipt.orderId,
        updateCommandFromOrder(beforeReceiptOrder, { customerId: newCustomer.id }),
        ACTOR,
      ),
    ).resolves.toMatchObject({ order: { customerId: newCustomer.id } });

    const afterReceipt = await seedOrderInStatus(db);
    const receipt = await recordOrderReceipt(db, afterReceipt.orderId, 1_000);
    await deleteTransaction(db, receipt.id, {}, ACTOR);
    const lockedOrder = await getOrder(db, afterReceipt.orderId);
    await expect(
      updateOrder(
        db,
        afterReceipt.orderId,
        updateCommandFromOrder(lockedOrder, { customerId: newCustomer.id }),
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects bad items, non-positive quantities, impossible pinned shares, terminal edits, and stale writes", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db);
    const order = await getOrder(db, orderId);
    const raw = await createItem(
      db,
      {
        name: uniqueName("Materia prima"),
        kind: "RAW_MATERIAL",
        category: "INGREDIENT",
        unit: "KG",
      },
      ACTOR,
    );
    const base = updateCommandFromOrder(order);

    await expect(
      updateOrder(db, orderId, { ...base, lines: [{ itemId: raw.id, qty: 1000 }] }, ACTOR),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      updateOrder(
        db,
        orderId,
        { ...base, lines: [{ itemId: order.lines[0]?.itemId ?? null, qty: 0 }] },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      updateOrder(
        db,
        orderId,
        {
          ...base,
          agreedTotal: 1_000,
          lines: [{ itemId: order.lines[0]?.itemId ?? null, qty: 1000, lineTotal: 2_000 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const updated = await updateOrder(
      db,
      orderId,
      { ...base, description: "Primer guardado" },
      ACTOR,
    );
    const auditCount = (
      await db.query.auditLog.findMany({
        where: (t, { eq: eqOp }) => eqOp(t.entityId, orderId),
      })
    ).length;
    await expect(
      updateOrder(db, orderId, { ...base, description: "Escritura obsoleta" }, ACTOR),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await getOrder(db, orderId)).description).toBe("Primer guardado");
    expect(
      (await db.query.auditLog.findMany({ where: (t, { eq: eqOp }) => eqOp(t.entityId, orderId) }))
        .length,
    ).toBe(auditCount);

    await confirmOrder(db, orderId, {}, ACTOR);
    await startOrderProduction(db, orderId, ACTOR);
    await markOrderReady(db, orderId, ACTOR);
    await deliverOrder(db, orderId, { occurredAt: NOW, businessDate: BUSINESS_DATE }, ACTOR);
    const delivered = await getOrder(db, orderId);
    await expect(
      updateOrder(
        db,
        orderId,
        updateCommandFromOrder(delivered, { description: "Inmutable" }),
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(updated.order.code).toBe(order.code);
  });

  it("serializes racing optimistic edits: one update and audit commit, the stale batch rolls back", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db);
    const order = await getOrder(db, orderId);
    const attempts = await Promise.allSettled([
      updateOrder(db, orderId, updateCommandFromOrder(order, { description: "A" }), ACTOR),
      updateOrder(db, orderId, updateCommandFromOrder(order, { description: "B" }), ACTOR),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    const updates = await db.query.auditLog.findMany({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(t.entityId, orderId), eqOp(t.action, "update")),
    });
    expect(updates).toHaveLength(1);
  });
});

describe("cash-free order lifecycle (O-8)", () => {
  it("audits status reversals without changing any existing finance row or account byte", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "QUOTING");
    await recordOrderReceipt(db, orderId, 6_000);
    const before = await financialSnapshot(db);

    expect((await confirmOrder(db, orderId, {}, ACTOR)).order.status).toBe("CONFIRMED");
    expect(await financialSnapshot(db)).toBe(before);
    expect((await startOrderProduction(db, orderId, ACTOR)).order.status).toBe("IN_PRODUCTION");
    expect(await financialSnapshot(db)).toBe(before);
    expect((await markOrderReady(db, orderId, ACTOR)).order.status).toBe("READY");
    expect(await financialSnapshot(db)).toBe(before);
    expect((await undoMarkOrderReady(db, orderId, ACTOR)).order.status).toBe("IN_PRODUCTION");
    expect(await financialSnapshot(db)).toBe(before);
    expect((await undoStartOrderProduction(db, orderId, ACTOR)).order.status).toBe("CONFIRMED");
    expect(await financialSnapshot(db)).toBe(before);

    for (const action of [
      "confirm",
      "start_production",
      "mark_ready",
      "undo_mark_ready",
      "undo_start_production",
    ]) {
      const audit = await db.query.auditLog.findFirst({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(eqOp(t.entityId, orderId), eqOp(t.action, action)),
      });
      expect(audit).toBeDefined();
    }
  });

  it("delivers an order-owned merchandise/charge sale and never writes cash", async () => {
    const db = createDb(env.DB);
    const { orderId, itemId } = await seedOrderInStatus(db, "READY", {
      agreedTotal: 10_000,
      additionalCharge: 2_000,
    });
    await recordOrderReceipt(db, orderId, 1_000);
    const before = await financialSnapshot(db);
    const stockBefore = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, itemId),
    });

    const delivered = await deliverOrder(
      db,
      orderId,
      { occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );
    expect(delivered.sale).toMatchObject({
      channel: "CUSTOM_ORDER",
      customOrderId: orderId,
      total: 12_000,
      additionalCharge: 2_000,
      paymentStatus: "ON_CREDIT",
      paidAt: null,
      paymentMethod: null,
      accountId: null,
    });
    expect(delivered.sale.lines).toHaveLength(1);
    expect(
      totalCentavos(
        toMilliCentavosPerUnit(delivered.sale.lines[0]?.unitPriceMc ?? 0),
        toMilliUnits(delivered.sale.lines[0]?.qty ?? 0),
      ),
    ).toBe(10_000);
    expect(await financialSnapshot(db)).toBe(before);
    const stockAfter = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, itemId),
    });
    expect(stockAfter?.qtyOnHand).toBe((stockBefore?.qtyOnHand ?? 0) - 1000);
    expect(
      await db.query.auditLog.findFirst({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(eqOp(t.entityId, delivered.sale.id), eqOp(t.action, "create")),
      }),
    ).toBeDefined();
  });

  it("allocates a pinned multi-line merchandise subtotal exactly and snapshots charge separately", async () => {
    const db = createDb(env.DB);
    const customer = await seedCustomer(db);
    const itemA = await seedStockedItem(db);
    const itemB = await seedStockedItem(db);
    const { order } = await quoteOrder(
      db,
      {
        customerId: customer.id,
        description: "Pedido con líneas fijadas",
        agreedTotal: 10_001,
        additionalCharge: 500,
        lines: [
          { itemId: itemA.id, qty: 1000, lineTotal: 3_000 },
          { itemId: itemB.id, qty: 1000 },
          { itemId: itemA.id, qty: 1000 },
        ],
      },
      ACTOR,
    );
    await confirmOrder(db, order.id, {}, ACTOR);
    await startOrderProduction(db, order.id, ACTOR);
    await markOrderReady(db, order.id, ACTOR);

    const delivered = await deliverOrder(
      db,
      order.id,
      { occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );
    const merchandiseLinesTotal = addMoney(
      ...delivered.sale.lines.map((line) =>
        totalCentavos(toMilliCentavosPerUnit(line.unitPriceMc), toMilliUnits(line.qty)),
      ),
    );
    expect(merchandiseLinesTotal).toBe(10_001);
    expect(delivered.sale).toMatchObject({ total: 10_501, additionalCharge: 500 });
    expect(delivered.sale.lines.map((line) => line.itemId)).toEqual([itemA.id, itemB.id, itemA.id]);
  });

  it("keeps the order-owned sale behind the order service", async () => {
    const db = createDb(env.DB);
    const { orderId, itemId } = await seedOrderInStatus(db, "READY");
    const { sale } = await deliverOrder(
      db,
      orderId,
      { occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );
    const before = await financialSnapshot(db);

    await expect(
      updateSale(
        db,
        sale.id,
        {
          paymentStatus: "ON_CREDIT",
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [{ itemId, qty: 1000, unitPriceMc: toMilliCentavosPerUnit(10_000_000) }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(deleteSale(db, sale.id, {}, ACTOR)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await financialSnapshot(db)).toBe(before);
  });

  it("refuses to deliver empty or unresolved lines until updateOrder makes them deliverable", async () => {
    const db = createDb(env.DB);
    const customer = await seedCustomer(db);
    const item = await seedStockedItem(db);
    const empty = await quoteOrder(
      db,
      { customerId: customer.id, description: "Sin líneas", agreedTotal: 1_000 },
      ACTOR,
    );
    await confirmOrder(db, empty.order.id, {}, ACTOR);
    await startOrderProduction(db, empty.order.id, ACTOR);
    await markOrderReady(db, empty.order.id, ACTOR);
    await expect(
      deliverOrder(db, empty.order.id, { occurredAt: NOW, businessDate: BUSINESS_DATE }, ACTOR),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const unresolved = await quoteOrder(
      db,
      {
        customerId: customer.id,
        description: "Línea libre",
        agreedTotal: 1_000,
        lines: [{ description: "Producto especial", qty: 1000 }],
      },
      ACTOR,
    );
    await confirmOrder(db, unresolved.order.id, {}, ACTOR);
    await startOrderProduction(db, unresolved.order.id, ACTOR);
    await markOrderReady(db, unresolved.order.id, ACTOR);
    await expect(
      deliverOrder(
        db,
        unresolved.order.id,
        { occurredAt: NOW, businessDate: BUSINESS_DATE },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const order = await getOrder(db, unresolved.order.id);
    await updateOrder(
      db,
      unresolved.order.id,
      updateCommandFromOrder(order, {
        lines: [{ itemId: item.id, description: "Producto especial", qty: 1000, lineTotal: null }],
      }),
      ACTOR,
    );
    expect(
      (
        await deliverOrder(
          db,
          unresolved.order.id,
          { occurredAt: NOW, businessDate: BUSINESS_DATE },
          ACTOR,
        )
      ).order.status,
    ).toBe("DELIVERED");
  });

  it("undoes after independent receipts and redelivers without reposting money", async () => {
    const db = createDb(env.DB);
    const { orderId, itemId } = await seedOrderInStatus(db, "READY", {
      agreedTotal: 10_000,
      additionalCharge: 500,
    });
    const deposit = await recordOrderReceipt(db, orderId, 3_000);
    const firstDelivery = await deliverOrder(
      db,
      orderId,
      { occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );
    const balanceReceipt = await recordOrderReceipt(db, orderId, 2_000, "ORDER_BALANCE");
    const beforeUndo = await financialSnapshot(db);

    await expect(
      collectPayment(
        db,
        firstDelivery.sale.id,
        {
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          paymentMethod: "CASH",
          accountId: "acc_cash",
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await financialSnapshot(db)).toBe(beforeUndo);

    const stockBefore = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, itemId),
    });
    expect((await undoDeliverOrder(db, orderId, {}, ACTOR)).order.status).toBe("READY");
    expect(await financialSnapshot(db)).toBe(beforeUndo);
    const deletedSale = await db.query.sales.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, firstDelivery.sale.id),
    });
    expect(deletedSale?.deletedAt).not.toBeNull();
    const stockAfterUndo = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, itemId),
    });
    expect(stockAfterUndo?.qtyOnHand).toBe((stockBefore?.qtyOnHand ?? 0) + 1000);

    const secondDelivery = await deliverOrder(
      db,
      orderId,
      { occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );
    expect(secondDelivery.sale.id).not.toBe(firstDelivery.sale.id);
    expect(secondDelivery.sale.total).toBe(10_500);
    expect(await financialSnapshot(db)).toBe(beforeUndo);
    expect(deposit.customOrderId).toBe(orderId);
    expect(balanceReceipt.customOrderId).toBe(orderId);
  });

  it("cancels terminally without resolving or mutating retained receipt cash", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "CONFIRMED");
    await recordOrderReceipt(db, orderId, 4_500);
    const before = await financialSnapshot(db);
    const result = await cancelOrder(db, orderId, {}, ACTOR);
    expect(result.order.status).toBe("CANCELLED");
    expect(result.order.balance).toEqual({
      customerAmount: 30_000,
      qualifyingReceipts: 4_500,
      expectedBalance: null,
      receivableBalance: null,
      excess: 0,
    });
    expect(await financialSnapshot(db)).toBe(before);
    await expect(cancelOrder(db, orderId, {}, ACTOR)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("allows cancellation from every pre-delivery status without changing finance rows", async () => {
    const db = createDb(env.DB);
    for (const status of ["QUOTING", "CONFIRMED", "IN_PRODUCTION", "READY"] as const) {
      const { orderId } = await seedOrderInStatus(db, status);
      await recordOrderReceipt(db, orderId, 1_000);
      const before = await financialSnapshot(db);
      expect((await cancelOrder(db, orderId, {}, ACTOR)).order.status).toBe("CANCELLED");
      expect(await financialSnapshot(db)).toBe(before);
    }
  });

  it.each(illegalLifecycleAttempts)(
    "rejects $name from $status without touching cash",
    async ({ status, run }) => {
      const db = createDb(env.DB);
      const { orderId } = await seedOrderInStatus(db, status);
      await recordOrderReceipt(db, orderId, 500);
      const before = await financialSnapshot(db);
      await expect(run(db, orderId)).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await financialSnapshot(db)).toBe(before);
      expect((await getOrder(db, orderId)).status).toBe(status);
    },
  );

  it("keeps catalog-sale collection available while refusing collection of order-owned sales", async () => {
    const db = createDb(env.DB);
    const catalogItem = await seedStockedItem(db);
    const catalogSale = await recordSale(
      db,
      {
        paymentStatus: "ON_CREDIT",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [
          { itemId: catalogItem.id, qty: 1000, unitPriceMc: toMilliCentavosPerUnit(8_000_000) },
        ],
      },
      ACTOR,
    );
    const collected = await collectPayment(
      db,
      catalogSale.sale.id,
      {
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        paymentMethod: "CASH",
        accountId: "acc_cash",
      },
      ACTOR,
    );
    expect(collected.sale.paymentStatus).toBe("PAID");
  });

  it("keeps R-5 delivery and undo previews even when order receipts exist", async () => {
    const db = createDb(env.DB);
    const { orderId, itemId } = await seedOrderInStatus(db, "READY");
    await recordOrderReceipt(db, orderId, 1_000);
    await recordSale(
      db,
      {
        paymentStatus: "ON_CREDIT",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId, qty: 1000, unitPriceMc: toMilliCentavosPerUnit(8_000_000) }],
      },
      ACTOR,
    );

    const backdated = { occurredAt: "2026-07-19T14:00:00.000Z", businessDate: "2026-07-19" };
    await expect(deliverOrder(db, orderId, backdated, ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "REPLAY_CONFIRMATION_REQUIRED" },
    });
    const delivered = await deliverOrder(db, orderId, { ...backdated, confirm: true }, ACTOR);
    const impact = await previewOrderImpact(db, {
      op: "undo_deliver",
      id: orderId,
      command: { confirm: true },
    });
    expect(impact.requiresConfirmation).toBe(true);
    expect(delivered.order.status).toBe("DELIVERED");
    const financeBeforeUndo = await financialSnapshot(db);
    await expect(undoDeliverOrder(db, orderId, {}, ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "REPLAY_CONFIRMATION_REQUIRED" },
    });
    expect(await financialSnapshot(db)).toBe(financeBeforeUndo);
    expect((await undoDeliverOrder(db, orderId, { confirm: true }, ACTOR)).order.status).toBe(
      "READY",
    );
    expect(await financialSnapshot(db)).toBe(financeBeforeUndo);
  });
});

describe("reads and order link guards", () => {
  it("keeps an unpriced quote's balance components null instead of inventing zero debt", async () => {
    const db = createDb(env.DB);
    const customer = await seedCustomer(db);
    const { order } = await quoteOrder(
      db,
      { customerId: customer.id, description: "Pedido sin precio todavía" },
      ACTOR,
    );

    expect(order.balance).toEqual({
      customerAmount: null,
      qualifyingReceipts: 0,
      expectedBalance: null,
      receivableBalance: null,
      excess: null,
    });
  });

  it("projects receipts, expected balance, delivered debt and excess independently of sale status", async () => {
    const db = createDb(env.DB);
    const { orderId } = await seedOrderInStatus(db, "QUOTING", {
      agreedTotal: 20_000,
      additionalCharge: 1_000,
    });
    await recordOrderReceipt(db, orderId, 5_000);

    const quoted = await getOrder(db, orderId);
    expect(quoted.balance).toEqual({
      customerAmount: 21_000,
      qualifyingReceipts: 5_000,
      expectedBalance: 16_000,
      receivableBalance: null,
      excess: 0,
    });

    await confirmOrder(db, orderId, {}, ACTOR);
    await startOrderProduction(db, orderId, ACTOR);
    await markOrderReady(db, orderId, ACTOR);
    await deliverOrder(db, orderId, { occurredAt: NOW, businessDate: BUSINESS_DATE }, ACTOR);
    expect((await getOrder(db, orderId)).balance).toEqual({
      customerAmount: 21_000,
      qualifyingReceipts: 5_000,
      expectedBalance: null,
      receivableBalance: 16_000,
      excess: 0,
    });

    await recordOrderReceipt(db, orderId, 10_000, "ORDER_BALANCE");
    expect((await getOrder(db, orderId)).balance).toMatchObject({
      qualifyingReceipts: 15_000,
      receivableBalance: 6_000,
    });
    await recordOrderReceipt(db, orderId, 6_000, "ORDER_BALANCE");
    expect((await getOrder(db, orderId)).balance).toMatchObject({
      qualifyingReceipts: 21_000,
      receivableBalance: 0,
      excess: 0,
    });
    await recordOrderReceipt(db, orderId, 500, "ORDER_BALANCE");
    const overpaid = await getOrder(db, orderId);
    expect(overpaid.balance).toMatchObject({
      qualifyingReceipts: 21_500,
      receivableBalance: 0,
      excess: 500,
    });
    expect(Object.hasOwn(overpaid, "salePaymentStatus")).toBe(false);
    expect(Object.hasOwn(overpaid, "balanceDue")).toBe(false);

    await undoDeliverOrder(db, orderId, {}, ACTOR);
    expect((await getOrder(db, orderId)).balance).toEqual({
      customerAmount: 21_000,
      qualifyingReceipts: 21_500,
      expectedBalance: 0,
      receivableBalance: null,
      excess: 500,
    });
    await deliverOrder(db, orderId, { occurredAt: NOW, businessDate: BUSINESS_DATE }, ACTOR);
    expect((await getOrder(db, orderId)).balance).toEqual({
      customerAmount: 21_000,
      qualifyingReceipts: 21_500,
      expectedBalance: null,
      receivableBalance: 0,
      excess: 500,
    });
  });

  it("returns bounded orders and refuses links only for terminal orders", async () => {
    const db = createDb(env.DB);
    const quoted = await seedOrderInStatus(db, "QUOTING");
    await seedOrderInStatus(db, "QUOTING");
    const ready = await seedOrderInStatus(db, "READY");
    const delivered = await seedOrderInStatus(db, "DELIVERED");
    const cancelled = await seedOrderInStatus(db, "CANCELLED");
    await expect(assertOrderLinkable(db, quoted.orderId)).resolves.toBeUndefined();
    await expect(assertOrderLinkable(db, ready.orderId)).resolves.toBeUndefined();
    await expect(assertOrderLinkable(db, delivered.orderId)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(assertOrderLinkable(db, cancelled.orderId)).rejects.toMatchObject({
      code: "VALIDATION",
    });

    const page = await listOrders(db, { status: "QUOTING", limit: 1 });
    expect(page.orders).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const activeOrders = await listOrders(db, { excludeStatuses: ["DELIVERED", "CANCELLED"] });
    expect(
      activeOrders.orders.every(
        (order) => order.status !== "DELIVERED" && order.status !== "CANCELLED",
      ),
    ).toBe(true);
  });

  it("retains order read not-found and customer/status filtering", async () => {
    const db = createDb(env.DB);
    const customerA = await seedCustomer(db);
    const customerB = await seedCustomer(db);
    const first = await quoteOrder(
      db,
      { customerId: customerA.id, description: "Filtrar pedido A", deliveryDate: "2026-07-20" },
      ACTOR,
    );
    const latest = await quoteOrder(
      db,
      {
        customerId: customerA.id,
        description: "Filtrar pedido reciente",
        deliveryDate: "2026-07-21",
      },
      ACTOR,
    );
    await quoteOrder(db, { customerId: customerB.id, description: "Filtrar pedido B" }, ACTOR);

    await expect(getOrder(db, "missing-order")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const filtered = await listOrders(db, { customerId: customerA.id, status: "QUOTING" });
    expect(filtered.orders.map((order) => order.id)).toEqual([latest.order.id, first.order.id]);
    const firstPage = await listOrders(db, { customerId: customerA.id, limit: 1 });
    expect(firstPage.orders[0]?.id).toBe(latest.order.id);
    expect(firstPage.nextCursor).not.toBeNull();
  });

  it("sorts latest promised date first, puts undated orders last, and filters on creation date", async () => {
    const db = createDb(env.DB);
    const customer = await seedCustomer(db);
    const latest = await quoteOrder(
      db,
      { customerId: customer.id, description: "Promesa reciente", deliveryDate: "2026-10-05" },
      ACTOR,
    );
    const earliest = await quoteOrder(
      db,
      { customerId: customer.id, description: "Promesa anterior", deliveryDate: "2026-10-02" },
      ACTOR,
    );
    const undated = await quoteOrder(
      db,
      { customerId: customer.id, description: "Sin promesa" },
      ACTOR,
    );

    const listed = await listOrders(db, { customerId: customer.id, limit: 10 });
    expect(listed.orders.map((order) => order.id)).toEqual([
      latest.order.id,
      earliest.order.id,
      undated.order.id,
    ]);
    const creationDate = toBusinessDate(latest.order.createdAt);
    const createdToday = await listOrders(db, {
      customerId: customer.id,
      fromDate: creationDate,
      toDate: creationDate,
    });
    expect(createdToday.orders.map((order) => order.id)).toHaveLength(3);
  });

  it("breaks matching delivery-date ties by createdAt and then id descending", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T12:00:00.000Z"));

    try {
      const db = createDb(env.DB);
      const customer = await seedCustomer(db);
      const first = await quoteOrder(
        db,
        {
          customerId: customer.id,
          description: "Empate primero",
          deliveryDate: "2026-10-05",
        },
        ACTOR,
      );
      const second = await quoteOrder(
        db,
        {
          customerId: customer.id,
          description: "Empate segundo",
          deliveryDate: "2026-10-05",
        },
        ACTOR,
      );
      vi.setSystemTime(new Date("2026-09-30T11:00:00.000Z"));
      const earlier = await quoteOrder(
        db,
        {
          customerId: customer.id,
          description: "Empate creado antes",
          deliveryDate: "2026-10-05",
        },
        ACTOR,
      );

      const orders = await listOrders(db, { customerId: customer.id });
      expect(orders.orders.map((order) => order.id)).toEqual([
        second.order.id,
        first.order.id,
        earlier.order.id,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues after 500 active orders and retains an older order without a date filter", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T12:00:00.000Z"));

    try {
      const db = createDb(env.DB);
      const customer = await seedCustomer(db);
      const oldOrder = await quoteOrder(
        db,
        { customerId: customer.id, description: "Pedido activo antiguo" },
        ACTOR,
      );

      vi.setSystemTime(new Date("2026-09-30T12:00:00.000Z"));
      for (let index = 0; index < 504; index += 1) {
        await quoteOrder(
          db,
          { customerId: customer.id, description: `Pedido activo ${index}` },
          ACTOR,
        );
      }

      const firstPage = await listOrders(db, { status: "QUOTING", limit: 500 });
      expect(firstPage.orders).toHaveLength(500);
      expect(firstPage.nextCursor).not.toBeNull();
      const secondPage = await listOrders(db, {
        status: "QUOTING",
        limit: 500,
        cursor: firstPage.nextCursor ?? undefined,
      });

      expect(secondPage.orders).toHaveLength(5);
      expect(secondPage.nextCursor).toBeNull();
      const allOrders = [...firstPage.orders, ...secondPage.orders];
      expect(new Set(allOrders.map((order) => order.id)).size).toBe(505);
      expect(allOrders.some((order) => order.id === oldOrder.order.id)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  }, 90_000);
});
