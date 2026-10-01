import type { OrderDto } from "@kokoro/shared";
import {
  calculateOrderReceiptBalance,
  confirmOrderCommandSchema,
  formatMoney,
  toCentavos,
} from "@kokoro/shared";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useConfirmOrder } from "@/features/orders/api";
import { ApiError } from "@/lib/api";
import { ordersLabels } from "@/lib/i18n-orders";

export interface ConfirmOrderDialogProps {
  order: OrderDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConfirmOrderDialog({ order, open, onOpenChange }: ConfirmOrderDialogProps) {
  const confirmMutation = useConfirmOrder(order.id);
  const [error, setError] = useState<string | null>(null);
  const disabled = confirmMutation.isPending;
  const customerAmount = calculateOrderReceiptBalance(
    order.agreedTotal,
    order.additionalCharge,
    0,
  ).customerAmount;

  async function handleSubmit() {
    setError(null);
    const parsed = confirmOrderCommandSchema.safeParse({});
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? ordersLabels.errors.generic);
      return;
    }
    try {
      await confirmMutation.mutateAsync(parsed.data);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ordersLabels.errors.generic);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label={ordersLabels.confirmDialogTitle}>
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{ordersLabels.confirmDialogTitle}</h2>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground text-sm">{ordersLabels.fieldAgreedTotal}</span>
            <span className="numeric-cell font-medium text-foreground">
              {order.agreedTotal === null
                ? ordersLabels.noAgreedTotal
                : formatMoney(toCentavos(order.agreedTotal))}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground text-sm">
              {ordersLabels.fieldAdditionalCharge}
            </span>
            <span className="numeric-cell font-medium text-foreground">
              {formatMoney(toCentavos(order.additionalCharge))}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 border-border border-t pt-2">
            <span className="font-medium text-foreground text-sm">
              {ordersLabels.customerAmount}
            </span>
            <span className="numeric-cell font-semibold text-foreground">
              {customerAmount === null
                ? ordersLabels.noAgreedTotal
                : formatMoney(toCentavos(customerAmount))}
            </span>
          </div>
        </div>
        <p className="text-muted-foreground text-sm">{ordersLabels.confirmDescription}</p>
        {error ? <p className="text-negative text-sm">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-border border-t px-5 py-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={disabled}
        >
          {ordersLabels.cancel}
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || order.agreedTotal === null}
        >
          {ordersLabels.confirmSubmit}
        </Button>
      </div>
    </Dialog>
  );
}
