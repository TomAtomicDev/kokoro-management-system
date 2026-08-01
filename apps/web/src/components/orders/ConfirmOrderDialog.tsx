// Dialog for UC-06 "confirmOrder" (O-1: `CONFIRMED` requires a recorded deposit). Mirrors
// CollectPaymentDialog.tsx's shape (small, focused, no replay dance — confirming writes no kardex
// movements). `agreedTotal` is only editable here when the order was quoted without one (Doc 04
// §3.3: "required to confirm") — otherwise it's shown read-only, since `confirmOrderCommandSchema`
// resolves `command.agreedTotal ?? order.agreedTotal` and a second, different value here would
// silently override the quoted price.

import type { OrderDto, PaymentMethod } from "@kokoro/shared";
import {
  confirmOrderCommandSchema,
  formatMoney,
  nowIso,
  PAYMENT_METHODS,
  toBusinessDate,
  toCentavos,
} from "@kokoro/shared";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAccounts } from "@/features/finance/api";
import { useConfirmOrder } from "@/features/orders/api";
import { ApiError } from "@/lib/api";
import { formatIntAsDecimalInput, parseDecimalToInt } from "@/lib/decimal";
import { ordersLabels } from "@/lib/i18n-orders";

export interface ConfirmOrderDialogProps {
  order: OrderDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConfirmOrderDialog({ order, open, onOpenChange }: ConfirmOrderDialogProps) {
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data?.accounts ?? [];
  const confirmMutation = useConfirmOrder(order.id);

  const [agreedTotal, setAgreedTotal] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    PAYMENT_METHODS[0] as PaymentMethod,
  );
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAgreedTotal(
        order.agreedTotal !== null ? formatIntAsDecimalInput(order.agreedTotal, 2) : "",
      );
      setDepositAmount(
        order.depositRequired !== null ? formatIntAsDecimalInput(order.depositRequired, 2) : "",
      );
      setPaymentMethod(PAYMENT_METHODS[0] as PaymentMethod);
      setAccountId(accounts[0]?.id ?? "");
      setError(null);
    }
  }, [open, order.agreedTotal, order.depositRequired, accounts]);

  const disabled = confirmMutation.isPending;
  const needsAgreedTotal = order.agreedTotal === null;

  async function handleSubmit() {
    setError(null);
    let parsedAgreedTotal: number | undefined;
    if (needsAgreedTotal) {
      const parsed = parseDecimalToInt(agreedTotal, 2);
      if (parsed === null || parsed <= 0) {
        setError(ordersLabels.errors.generic);
        return;
      }
      parsedAgreedTotal = parsed;
    }
    const parsedDeposit = parseDecimalToInt(depositAmount, 2);
    if (parsedDeposit === null || parsedDeposit <= 0) {
      setError(ordersLabels.errors.generic);
      return;
    }

    const parsed = confirmOrderCommandSchema.safeParse({
      occurredAt: nowIso(),
      businessDate: toBusinessDate(nowIso()),
      agreedTotal: parsedAgreedTotal ?? undefined,
      depositAmount: parsedDeposit,
      paymentMethod,
      accountId,
    });
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
        {needsAgreedTotal ? (
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="co-total">
              {ordersLabels.confirmFieldAgreedTotal}
            </label>
            <Input
              id="co-total"
              inputMode="decimal"
              placeholder="0.00"
              value={agreedTotal}
              onChange={(e) => setAgreedTotal(e.target.value)}
              disabled={disabled}
            />
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-md border border-border bg-muted px-4 py-3">
            <span className="font-medium text-foreground text-sm">
              {ordersLabels.columnAgreedTotal}
            </span>
            <span className="numeric-cell font-semibold text-foreground">
              {formatMoney(toCentavos(order.agreedTotal ?? 0))}
            </span>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="co-deposit">
            {ordersLabels.confirmFieldDepositAmount}
          </label>
          <Input
            id="co-deposit"
            inputMode="decimal"
            placeholder="0.00"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            disabled={disabled}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="co-method">
              {ordersLabels.confirmFieldPaymentMethod}
            </label>
            <Select
              id="co-method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              disabled={disabled}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {ordersLabels.paymentMethodLabels[method]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="co-account">
              {ordersLabels.confirmFieldAccount}
            </label>
            <Select
              id="co-account"
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
          {ordersLabels.cancel}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={disabled || !accountId}>
          {ordersLabels.confirmSubmit}
        </Button>
      </div>
    </Dialog>
  );
}
