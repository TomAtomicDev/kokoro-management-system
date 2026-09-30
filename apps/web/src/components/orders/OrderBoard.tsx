// SC-04 active orders are four full-width vertical lanes; history is a separate, single list.

import type { CustomOrderStatus, OrderDto } from "@kokoro/shared";

import { Button } from "@/components/ui/button";
import { type OrdersHistoryFilter, ordersLabels } from "@/lib/i18n-orders";
import { orderStatusStyles } from "@/lib/order-status-style";

import { OrderCard } from "./OrderCard";

export interface OrderBoardProps {
  orders: OrderDto[];
  view: "active" | "history";
  loading: boolean;
  error: boolean;
  historyFilter: OrdersHistoryFilter;
  onRetry: () => void;
  onSelect: (order: OrderDto) => void;
}

const ACTIVE_LANE_ORDER: readonly CustomOrderStatus[] = [
  "QUOTING",
  "CONFIRMED",
  "IN_PRODUCTION",
  "READY",
];

export function OrderBoard({
  orders,
  view,
  loading,
  error,
  historyFilter,
  onRetry,
  onSelect,
}: OrderBoardProps) {
  if (loading) {
    return <p className="text-muted-foreground text-sm">{ordersLabels.loading}</p>;
  }

  if (error) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border border-border p-4">
        <p className="text-sm text-foreground">{ordersLabels.loadError}</p>
        <Button type="button" variant="outline" onClick={onRetry}>
          {ordersLabels.retry}
        </Button>
      </div>
    );
  }

  if (view === "history") {
    return orders.length === 0 ? (
      <p className="rounded-md border border-border border-dashed px-3 py-6 text-center text-muted-foreground text-sm">
        {ordersLabels.historyEmpty[historyFilter]}
      </p>
    ) : (
      <section className="flex flex-col gap-2" aria-label={ordersLabels.historyTitle}>
        {orders.map((order) => (
          <OrderCard key={order.id} order={order} onClick={() => onSelect(order)} />
        ))}
      </section>
    );
  }

  const ordersByStatus = new Map<CustomOrderStatus, OrderDto[]>();
  for (const status of ACTIVE_LANE_ORDER) ordersByStatus.set(status, []);
  for (const order of orders) ordersByStatus.get(order.status)?.push(order);

  return (
    <section className="flex flex-col gap-5" aria-label={ordersLabels.activeTitle}>
      {ACTIVE_LANE_ORDER.map((status) => {
        const laneOrders = ordersByStatus.get(status) ?? [];
        const statusStyle = orderStatusStyles[status];
        return (
          <section
            key={status}
            aria-labelledby={`orders-lane-${status}`}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h2
                id={`orders-lane-${status}`}
                className={`font-medium text-sm ${statusStyle.text}`}
              >
                {ordersLabels.statusLabels[status]}
              </h2>
              <span className="text-muted-foreground text-xs">{laneOrders.length}</span>
            </div>
            {laneOrders.length === 0 ? (
              <p className="rounded-md border border-border border-dashed px-3 py-4 text-center text-muted-foreground text-xs">
                {ordersLabels.noOrders}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {laneOrders.map((order) => (
                  <OrderCard key={order.id} order={order} onClick={() => onSelect(order)} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </section>
  );
}
