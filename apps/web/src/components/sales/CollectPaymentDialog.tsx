// Dialog for UC-04 "collectPayment" (Doc 07 SC-02's "mark paid (account + method inline)" action,
// KOK-031). Deliberately much smaller than SaleForm: the only inputs are payment method + the
// credited account — everything else (the sale itself, its total) is already fixed by the time
// this opens. `occurredAt`/`businessDate` are stamped to "now", mirroring SaleForm's own
// `nowIso()`/`toBusinessDate` use for a same-moment action.

import type { FinancialAccountDto, SaleDto } from "@kokoro/shared";
import {
  collectPaymentCommandSchema,
  formatMoney,
  nowIso,
  PAYMENT_METHODS,
  type PaymentMethod,
  toBusinessDate,
  toCentavos,
} from "@kokoro/shared";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { useCollectPayment } from "@/features/sales/api";
import { ApiError } from "@/lib/api";
import { salesLabels } from "@/lib/i18n-sales";

export interface CollectPaymentDialogProps {
  sale: SaleDto | null;
  accounts: FinancialAccountDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CollectPaymentDialog({
  sale,
  accounts,
  open,
  onOpenChange,
}: CollectPaymentDialogProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    PAYMENT_METHODS[0] as PaymentMethod,
  );
  const [accountId, setAccountId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const collectMutation = useCollectPayment();

  // Reset on the open transition only, mirroring SaleForm/PurchaseForm's precedent.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset-on-open precedent, see above.
  useEffect(() => {
    if (open) {
      setPaymentMethod(PAYMENT_METHODS[0] as PaymentMethod);
      setAccountId(accounts[0]?.id ?? "");
      setError(null);
    }
  }, [open]);

  if (!sale) return null;
  const disabled = collectMutation.isPending;

  async function handleSubmit() {
    if (!sale) return;
    setError(null);
    const parsed = collectPaymentCommandSchema.safeParse({
      occurredAt: nowIso(),
      businessDate: toBusinessDate(nowIso()),
      paymentMethod,
      accountId,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? salesLabels.errors.generic);
      return;
    }

    try {
      await collectMutation.mutateAsync({ saleId: sale.id, ...parsed.data });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : salesLabels.errors.generic);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label={salesLabels.collectTitle}>
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{salesLabels.collectTitle}</h2>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
        <div className="flex items-center justify-between rounded-md border border-border bg-muted px-4 py-3">
          <span className="font-medium text-foreground text-sm">{salesLabels.columnTotal}</span>
          <span className="numeric-cell font-semibold text-foreground text-lg">
            {formatMoney(toCentavos(sale.total))}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="cp-method">
              {salesLabels.fieldPaymentMethod}
            </label>
            <Select
              id="cp-method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              disabled={disabled}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {salesLabels.paymentMethodLabels[method]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="cp-account">
              {salesLabels.fieldAccount}
            </label>
            <Select
              id="cp-account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={disabled}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {error ? <p className="text-negative text-sm">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-border border-t px-5 py-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={disabled}
        >
          {salesLabels.cancel}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={disabled || !accountId}>
          {salesLabels.collectSubmit}
        </Button>
      </div>
    </Dialog>
  );
}
