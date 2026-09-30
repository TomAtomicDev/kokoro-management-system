// One card in the OrderBoard (Doc 07 SC-04): customer, delivery date/place, agreed total, deposit
// paid/pending deposit or linked-sale payment badge, and the matching expected/current balance.
// Click opens OrderDetailDrawer (composed by the caller).

import type { OrderDto } from "@kokoro/shared";
import { formatMoney, toCentavos } from "@kokoro/shared";

import { Badge } from "@/components/ui/badge";
import { ordersLabels } from "@/lib/i18n-orders";
import { orderStatusStyles } from "@/lib/order-status-style";

export interface OrderCardProps {
  order: OrderDto;
  onClick: () => void;
}

export function OrderCard({ order, onClick }: OrderCardProps) {
  const hasDeposit = order.depositPaid > 0;
  const isDelivered = order.status === "DELIVERED";
  const paymentOrDepositLabel = isDelivered
    ? order.salePaymentStatus === "PAID"
      ? ordersLabels.paymentStatusLabels.PAID
      : ordersLabels.paymentStatusLabels.ON_CREDIT
    : order.status === "CANCELLED"
      ? null
      : hasDeposit
        ? ordersLabels.depositPaidBadge
        : ordersLabels.depositPendingBadge;
  const badgeVariant = isDelivered
    ? order.salePaymentStatus === "ON_CREDIT"
      ? "warning"
      : "outline"
    : hasDeposit
      ? "default"
      : "muted";
  const statusStyle = orderStatusStyles[order.status];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full flex-col gap-2 rounded-md border border-border border-l-4 bg-card p-3 text-left text-sm hover:bg-accent ${statusStyle.border}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-medium text-foreground">
            {order.customerName ?? ordersLabels.columnCustomer}
          </span>
          {order.code ? <span className="text-muted-foreground text-xs">{order.code}</span> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          <Badge variant="outline" className={`${statusStyle.border} ${statusStyle.text}`}>
            {ordersLabels.statusLabels[order.status]}
          </Badge>
          {paymentOrDepositLabel ? (
            <Badge
              variant={badgeVariant}
              className={
                isDelivered && order.salePaymentStatus === "PAID"
                  ? "border-positive bg-positive-bg text-positive"
                  : undefined
              }
            >
              {paymentOrDepositLabel}
            </Badge>
          ) : null}
        </div>
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
      {isDelivered && order.outstandingAmount !== null ? (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{ordersLabels.cardOutstandingBalance}</span>
          <span className="numeric-cell font-medium text-warning">
            {formatMoney(toCentavos(order.outstandingAmount))}
          </span>
        </div>
      ) : !isDelivered && order.balanceDue !== null && order.balanceDue > 0 ? (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{ordersLabels.cardExpectedBalance}</span>
          <span className="numeric-cell font-medium text-warning">
            {formatMoney(toCentavos(order.balanceDue))}
          </span>
        </div>
      ) : null}
    </button>
  );
}
