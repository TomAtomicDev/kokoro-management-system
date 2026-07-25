// SC-04's `OrderBoard`: one column per status, cards sorted by `delivery_date` within each column
// (O-5). A single unfiltered `useOrders()` fetch feeds every column — `OrderDto` already carries
// `customerName` (no N+1), and grouping client-side avoids six separate list requests.

import type { CustomOrderStatus, OrderDto } from "@kokoro/shared";
import { CUSTOM_ORDER_STATUSES } from "@kokoro/shared";

import { ordersLabels } from "@/lib/i18n-orders";

import { OrderCard } from "./OrderCard";

export interface OrderBoardProps {
  orders: OrderDto[];
  loading: boolean;
  onSelect: (order: OrderDto) => void;
}

/** Board column order: the happy-path progression (Doc 07 SC-04's "QUOTING → … → DELIVERED"),
 * with the terminal CANCELLED branch last. */
const COLUMN_ORDER: readonly CustomOrderStatus[] = CUSTOM_ORDER_STATUSES;

export function OrderBoard({ orders, loading, onSelect }: OrderBoardProps) {
  const byStatus = new Map<CustomOrderStatus, OrderDto[]>();
  for (const status of COLUMN_ORDER) byStatus.set(status, []);
  for (const order of orders) byStatus.get(order.status)?.push(order);

  if (loading) {
    return <p className="text-muted-foreground text-sm">{ordersLabels.loading}</p>;
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {COLUMN_ORDER.map((status) => {
        const columnOrders = byStatus.get(status) ?? [];
        return (
          <div key={status} className="flex w-72 shrink-0 flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="font-medium text-foreground text-sm">
                {ordersLabels.statusLabels[status]}
              </h3>
              <span className="text-muted-foreground text-xs">{columnOrders.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {columnOrders.length === 0 ? (
                <p className="rounded-md border border-border border-dashed px-3 py-4 text-center text-muted-foreground text-xs">
                  {ordersLabels.noOrders}
                </p>
              ) : (
                columnOrders.map((order) => (
                  <OrderCard key={order.id} order={order} onClick={() => onSelect(order)} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
