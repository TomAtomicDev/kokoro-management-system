import type { DeliverOrderCommand, DeliverOrderResult, OrderDto } from "@kokoro/shared";
import {
  calculateOrderReceiptBalance,
  deliverOrderCommandSchema,
  formatMoney,
  nowIso,
  toBusinessDate,
  toCentavos,
} from "@kokoro/shared";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ImpactConfirmDialog } from "@/components/ui/ImpactConfirmDialog";
import { Input } from "@/components/ui/input";
import { useDeliverOrder } from "@/features/orders/api";
import { useReplayConfirmableMutation } from "@/hooks/useReplayConfirmableMutation";
import { ApiError } from "@/lib/api";
import { ordersLabels } from "@/lib/i18n-orders";

export interface DeliverOrderDialogProps {
  order: OrderDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeliverOrderDialog({ order, open, onOpenChange }: DeliverOrderDialogProps) {
  const deliverMutation = useDeliverOrder(order.id);
  const replay = useReplayConfirmableMutation<DeliverOrderCommand, DeliverOrderResult>(
    (command) => deliverMutation.mutateAsync(command),
    { onSuccess: () => onOpenChange(false) },
  );
  const [businessDate, setBusinessDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setBusinessDate(toBusinessDate(nowIso()));
      setError(null);
    }
  }, [open]);

  function handleSubmit() {
    setError(null);
    const parsed = deliverOrderCommandSchema.safeParse({
      occurredAt: nowIso(),
      businessDate,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? ordersLabels.errors.generic);
      return;
    }
    replay.execute(parsed.data);
  }

  const totalPreview = calculateOrderReceiptBalance(order.agreedTotal, order.additionalCharge, 0);
  const displayError =
    error ??
    (replay.error && !(replay.error instanceof ApiError) ? ordersLabels.errors.generic : null);
  const disabled = replay.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} aria-label={ordersLabels.deliverDialogTitle}>
        <div className="border-border border-b px-5 py-4">
          <h2 className="font-medium text-foreground text-md">{ordersLabels.deliverDialogTitle}</h2>
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
          <div className="flex items-center justify-between rounded-md border border-border bg-muted px-4 py-3">
            <span className="font-medium text-foreground text-sm">
              {ordersLabels.customerAmount}
            </span>
            <span className="numeric-cell font-semibold text-foreground">
              {totalPreview.customerAmount === null
                ? ordersLabels.noAgreedTotal
                : formatMoney(toCentavos(totalPreview.customerAmount))}
            </span>
          </div>
          <p className="text-muted-foreground text-sm">{ordersLabels.deliverDescription}</p>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="do-date">
              {ordersLabels.deliverFieldDate}
            </label>
            <Input
              id="do-date"
              type="date"
              value={businessDate}
              onChange={(event) => setBusinessDate(event.currentTarget.value)}
              disabled={disabled}
            />
          </div>
          {displayError ? <p className="text-negative text-sm">{displayError}</p> : null}
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
            {ordersLabels.deliverSubmit}
          </Button>
        </div>
      </Dialog>

      {replay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={replay.pendingConfirmation.impact}
          onConfirm={replay.confirm}
          onCancel={replay.cancel}
          confirmLoading={replay.isPending}
          title={ordersLabels.impactDeliverTitle}
          description={ordersLabels.impactDeliverDescription}
          confirmLabel={ordersLabels.deliverSubmit}
        />
      ) : null}
    </>
  );
}
