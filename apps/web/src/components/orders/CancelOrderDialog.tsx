import type { OrderDto } from "@kokoro/shared";
import { cancelOrderCommandSchema } from "@kokoro/shared";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useCancelOrder } from "@/features/orders/api";
import { ApiError } from "@/lib/api";
import { ordersLabels } from "@/lib/i18n-orders";

export interface CancelOrderDialogProps {
  order: OrderDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CancelOrderDialog({ order, open, onOpenChange }: CancelOrderDialogProps) {
  const cancelMutation = useCancelOrder(order.id);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  async function handleSubmit() {
    setError(null);
    const parsed = cancelOrderCommandSchema.safeParse({});
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? ordersLabels.errors.generic);
      return;
    }
    try {
      await cancelMutation.mutateAsync(parsed.data);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ordersLabels.errors.generic);
    }
  }

  const disabled = cancelMutation.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label={ordersLabels.cancelDialogTitle}>
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{ordersLabels.cancelDialogTitle}</h2>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
        <p className="text-muted-foreground text-sm">{ordersLabels.cancelDescription}</p>
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
        <Button type="button" variant="destructive" onClick={handleSubmit} disabled={disabled}>
          {ordersLabels.cancelSubmit}
        </Button>
      </div>
    </Dialog>
  );
}
