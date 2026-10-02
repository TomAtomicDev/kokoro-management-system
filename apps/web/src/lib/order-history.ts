import type { OrderDto } from "@kokoro/shared";

import type { OrdersHistoryFilter } from "./i18n-orders";

/** History payment scopes come from ADR-022 order receipts, never the generated sale's status. */
export function filterOrdersByHistoryFilter(
  orders: readonly OrderDto[],
  filter: OrdersHistoryFilter,
): OrderDto[] {
  if (filter === "outstanding") {
    return orders.filter(
      (order) =>
        order.status === "DELIVERED" &&
        order.balance.receivableBalance !== null &&
        order.balance.receivableBalance > 0,
    );
  }
  if (filter === "paid") {
    return orders.filter(
      (order) => order.status === "DELIVERED" && order.balance.receivableBalance === 0,
    );
  }
  if (filter === "cancelled") return orders.filter((order) => order.status === "CANCELLED");
  return [...orders];
}
