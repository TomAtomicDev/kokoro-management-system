// One card in the OrderBoard (Doc 07 SC-04): customer, delivery date/place, agreed total, deposit
// paid/pending badge, balance. Click opens OrderDetailDrawer (composed by the caller).

import type { OrderDto } from "@kokoro/shared";
import { formatMoney, toCentavos } from "@kokoro/shared";

import { Badge } from "@/components/ui/badge";
import { ordersLabels } from "@/lib/i18n-orders";

export interface OrderCardProps {
  order: OrderDto;
  onClick: () => void;
}

export function OrderCard({ order, onClick }: OrderCardProps) {
  const hasDeposit = order.depositPaid > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-2 rounded-md border border-border bg-card p-3 text-left text-sm hover:border-primary/50 hover:bg-accent"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-foreground">
          {order.customerName ?? ordersLabels.columnCustomer}
        </span>
        <Badge variant={hasDeposit ? "default" : "muted"}>
          {hasDeposit ? ordersLabels.depositPaidBadge : ordersLabels.depositPendingBadge}
        </Badge>
      </div>

      <p className="line-clamp-2 text-muted-foreground text-xs">{order.description}</p>

      <div className="flex items-center justify-between text-muted-foreground text-xs">
        <span>{ordersLabels.columnDeliveryDate}</span>
        <span className="text-foreground">{order.deliveryDate ?? ordersLabels.noDeliveryDate}</span>
      </div>

      <div className="flex items-center justify-between border-border border-t pt-2 text-xs">
        <span className="text-muted-foreground">{ordersLabels.columnAgreedTotal}</span>
        <span className="numeric-cell font-medium text-foreground">
          {order.agreedTotal !== null
            ? formatMoney(toCentavos(order.agreedTotal))
            : ordersLabels.noAgreedTotal}
        </span>
      </div>
      {order.balanceDue !== null && order.balanceDue > 0 ? (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{ordersLabels.cardBalance}</span>
          <span className="numeric-cell font-medium text-warning">
            {formatMoney(toCentavos(order.balanceDue))}
          </span>
        </div>
      ) : null}
    </button>
  );
}
