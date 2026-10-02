// Read-time custom-order balances and pre-delivery cash exposure (Doc 04 §3.4.1 / ADR-022).

import type { CustomOrderReceivableDto } from "@kokoro/shared";
import {
  addMoney,
  calculateOrderReceiptBalance,
  calculatePreDeliveryOrderCashExposure,
  toBusinessDate,
  toCentavos,
} from "@kokoro/shared";
import { sql } from "drizzle-orm";

import type { Db } from "../../db/index.js";
import { DomainError } from "../errors.js";

export interface OrderFinanceProjectionRow {
  order_id: string;
  order_status: string;
  customer_id: string;
  customer_name: string | null;
  order_code: string | null;
  agreed_total: number | null;
  additional_charge: number;
  sale_id: string | null;
  active_sale_id: string | null;
  active_sale_order_id: string | null;
  active_sale_channel: string | null;
  active_sale_total: number | null;
  active_sale_occurred_at: string | null;
  active_sale_business_date: string | null;
  active_sale_code: string | null;
  qualifying_receipts: number;
  order_refunds: number;
}

export interface OrderFinanceProjection {
  balances: OrderFinanceBalance[];
  receivables: {
    customerId: string;
    customerName: string | null;
    receivable: CustomOrderReceivableDto;
  }[];
  preDeliveryOrderCashExposure: number;
}

export interface OrderFinanceBalance {
  orderId: string;
  status: string;
  customerAmount: number | null;
  qualifyingReceipts: number;
  expected: number | null;
  excess: number | null;
}

const ORDER_FINANCE_READ_BATCH_SIZE = 90;

function readNonnegativeCentavos(value: number | null, field: string): number {
  if (value === null || !Number.isSafeInteger(value) || value < 0) {
    throw new DomainError("INTERNAL", "No se pudieron leer los saldos de pedidos.", {
      field,
      value,
    });
  }
  return toCentavos(value);
}

function daysSinceBusinessDate(businessDate: string): number {
  const today = toBusinessDate(new Date());
  const saleDay = Date.parse(`${businessDate}T00:00:00.000Z`);
  const todayDay = Date.parse(`${today}T00:00:00.000Z`);
  const ageDays = Math.floor((todayDay - saleDay) / 86_400_000);
  if (!Number.isSafeInteger(ageDays) || ageDays < 0) {
    throw new DomainError("INTERNAL", "La fecha de entrega del pedido no es válida.", {
      businessDate,
      today,
    });
  }
  return ageDays;
}

function missingDeliveredSale(row: OrderFinanceProjectionRow): DomainError {
  return new DomainError(
    "INTERNAL",
    "El pedido entregado no tiene una venta activa vinculada correctamente.",
    { orderId: row.order_id, saleId: row.sale_id },
  );
}

export function projectOrderFinanceRows(
  rows: readonly OrderFinanceProjectionRow[],
): OrderFinanceProjection {
  const balances: OrderFinanceBalance[] = [];
  const receivables: OrderFinanceProjection["receivables"] = [];
  let preDeliveryOrderCashExposure = toCentavos(0);

  for (const row of rows) {
    const qualifyingReceipts = readNonnegativeCentavos(
      row.qualifying_receipts,
      "qualifyingReceipts",
    );
    const orderRefunds = readNonnegativeCentavos(row.order_refunds, "orderRefunds");
    const balance = calculateOrderReceiptBalance(
      row.agreed_total,
      row.additional_charge,
      qualifyingReceipts,
    );
    balances.push({
      orderId: row.order_id,
      status: row.order_status,
      customerAmount: balance.customerAmount,
      qualifyingReceipts,
      expected: row.order_status === "CANCELLED" ? null : balance.expected,
      excess: balance.excess,
    });

    if (row.order_status === "DELIVERED") {
      if (
        row.sale_id === null ||
        row.active_sale_id !== row.sale_id ||
        row.active_sale_order_id !== row.order_id ||
        row.active_sale_channel !== "CUSTOM_ORDER" ||
        row.active_sale_total === null ||
        row.active_sale_occurred_at === null ||
        row.active_sale_business_date === null
      ) {
        throw missingDeliveredSale(row);
      }

      const saleTotal = readNonnegativeCentavos(row.active_sale_total, "activeSaleTotal");
      if (balance.customerAmount !== null && balance.customerAmount !== saleTotal) {
        throw new DomainError(
          "INTERNAL",
          "El precio del pedido no coincide con el total de su venta activa.",
          {
            orderId: row.order_id,
            customerAmount: balance.customerAmount,
            saleTotal,
          },
        );
      }

      if (balance.expected !== null && balance.expected > 0) {
        receivables.push({
          customerId: row.customer_id,
          customerName: row.customer_name,
          receivable: {
            sourceType: "CUSTOM_ORDER",
            saleId: row.active_sale_id,
            code: row.order_code,
            saleCode: row.active_sale_code,
            occurredAt: row.active_sale_occurred_at,
            businessDate: row.active_sale_business_date,
            channel: "CUSTOM_ORDER",
            saleTotal,
            customerPrice: balance.customerAmount ?? 0,
            qualifyingReceipts,
            excess: balance.excess ?? 0,
            outstandingAmount: balance.expected,
            ageDays: daysSinceBusinessDate(row.active_sale_business_date),
            customOrderId: row.order_id,
          },
        });
      }
      continue;
    }

    if (
      row.order_status === "QUOTING" ||
      row.order_status === "CONFIRMED" ||
      row.order_status === "IN_PRODUCTION" ||
      row.order_status === "READY"
    ) {
      const orderExposure = calculatePreDeliveryOrderCashExposure(qualifyingReceipts, orderRefunds);
      preDeliveryOrderCashExposure = addMoney(
        toCentavos(preDeliveryOrderCashExposure),
        toCentavos(orderExposure),
      );
    }
  }

  return { balances, receivables, preDeliveryOrderCashExposure };
}

/** One set-based read of every active order and its eligible direct cash events. */
export async function getOrderFinanceProjection(db: Db): Promise<OrderFinanceProjection> {
  const rows = await db.all<OrderFinanceProjectionRow>(sql`
    SELECT * FROM v_order_finance_projection ORDER BY order_id
  `);
  return projectOrderFinanceRows(rows);
}

/** Read bounded order balances from the canonical KOK-207 projection without scanning unrelated orders. */
export async function getOrderFinanceBalances(
  db: Db,
  orderIds: readonly string[],
): Promise<Map<string, OrderFinanceBalance>> {
  const balancesByOrderId = new Map<string, OrderFinanceBalance>();
  for (let offset = 0; offset < orderIds.length; offset += ORDER_FINANCE_READ_BATCH_SIZE) {
    const batch = orderIds.slice(offset, offset + ORDER_FINANCE_READ_BATCH_SIZE);
    if (batch.length === 0) continue;
    const ids = sql.join(
      batch.map((orderId) => sql`${orderId}`),
      sql`, `,
    );
    const rows = await db.all<OrderFinanceProjectionRow>(sql`
      SELECT *
      FROM v_order_finance_projection
      WHERE order_id IN (${ids})
      ORDER BY order_id
    `);
    for (const balance of projectOrderFinanceRows(rows).balances) {
      balancesByOrderId.set(balance.orderId, balance);
    }
  }
  return balancesByOrderId;
}
