import type { OrderDto } from "@kokoro/shared";
import { describe, expect, it } from "vitest";

import { filterOrdersByHistoryFilter } from "./order-history";

function makeOrder(
  id: string,
  status: OrderDto["status"],
  receivableBalance: number | null,
): OrderDto {
  return {
    id,
    status,
    customerId: `customer-${id}`,
    customerName: "Cliente",
    description: `Pedido ${id}`,
    agreedTotal: 10_000,
    additionalCharge: 0,
    balance: {
      customerAmount: 10_000,
      qualifyingReceipts: receivableBalance === null ? 0 : 10_000 - receivableBalance,
      expectedBalance: status === "DELIVERED" || status === "CANCELLED" ? null : 0,
      receivableBalance,
      excess: 0,
    },
    deliveryDate: null,
    deliveryPlace: null,
    saleId: status === "DELIVERED" ? `sale-${id}` : null,
    code: `PED-${id}`,
    notes: null,
    lines: [],
    createdAt: "2026-09-30T12:00:00.000Z",
    updatedAt: "2026-09-30T12:00:00.000Z",
  };
}

describe("filterOrdersByHistoryFilter (KOK-201/KOK-206)", () => {
  const orders = [
    makeOrder("due", "DELIVERED", 2_500),
    makeOrder("covered", "DELIVERED", 0),
    makeOrder("cancelled", "CANCELLED", null),
    makeOrder("active", "READY", null),
  ];

  it("uses the delivered receipt-derived remainder for Por cobrar and Pagados", () => {
    expect(filterOrdersByHistoryFilter(orders, "outstanding").map((order) => order.id)).toEqual([
      "due",
    ]);
    expect(filterOrdersByHistoryFilter(orders, "paid").map((order) => order.id)).toEqual([
      "covered",
    ]);
  });

  it("keeps cancellation separate and leaves Todos to the bounded server query", () => {
    expect(filterOrdersByHistoryFilter(orders, "cancelled").map((order) => order.id)).toEqual([
      "cancelled",
    ]);
    expect(filterOrdersByHistoryFilter(orders, "all")).toEqual(orders);
  });
});
