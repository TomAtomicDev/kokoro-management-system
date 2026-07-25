// Dialog for UC-08 "cancelOrder" (O-3). No replay dance — cancelling writes no kardex movements.
// `resolution` is required EXACTLY when the order already holds a deposit and must stay absent
// otherwise (the service enforces both directions, since the schema alone can't know
// `depositPaid`) — this UI mirrors that split directly instead of always showing the choice.

import type { CancelResolution, OrderDto } from "@kokoro/shared";
import { cancelOrderCommandSchema, nowIso, toBusinessDate } from "@kokoro/shared";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { useAccounts } from "@/features/finance/api";
import { useCancelOrder } from "@/features/orders/api";
import { ApiError } from "@/lib/api";
import { ordersLabels } from "@/lib/i18n-orders";

export interface CancelOrderDialogProps {
  order: OrderDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CancelOrderDialog({ order, open, onOpenChange }: CancelOrderDialogProps) {
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data?.accounts ?? [];
  const cancelMutation = useCancelOrder(order.id);

  const hasDeposit = order.depositPaid > 0;
  const [resolution, setResolution] = useState<CancelResolution>("REFUND");
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setResolution("REFUND");
      setAccountId("");
      setError(null);
    }
  }, [open]);

  const disabled = cancelMutation.isPending;

  async function handleSubmit() {
    setError(null);
    const parsed = cancelOrderCommandSchema.safeParse({
      occurredAt: nowIso(),
      businessDate: toBusinessDate(nowIso()),
      resolution: hasDeposit ? resolution : undefined,
      accountId: hasDeposit && resolution === "REFUND" && accountId !== "" ? accountId : undefined,
    });
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label={ordersLabels.cancelDialogTitle}>
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{ordersLabels.cancelDialogTitle}</h2>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
        {!hasDeposit ? (
          <p className="text-muted-foreground text-sm">{ordersLabels.cancelNoDeposit}</p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="font-medium text-foreground text-sm">
                {ordersLabels.cancelFieldResolution}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={resolution === "REFUND" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setResolution("REFUND")}
                  disabled={disabled}
                >
                  {ordersLabels.cancelResolutionRefund}
                </Button>
                <Button
                  type="button"
                  variant={resolution === "FORFEIT" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setResolution("FORFEIT")}
                  disabled={disabled}
                >
                  {ordersLabels.cancelResolutionForfeit}
                </Button>
              </div>
            </div>

            {resolution === "REFUND" ? (
              <div className="flex flex-col gap-1.5">
                <label className="font-medium text-foreground" htmlFor="cd-account">
                  {ordersLabels.cancelFieldAccount}
                </label>
                <Select
                  id="cd-account"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  disabled={disabled}
                >
                  <option value="">—</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
          </>
        )}

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
