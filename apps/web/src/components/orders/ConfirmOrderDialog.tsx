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
  paymentMethodForAccountType,
  toBusinessDate,
  toCentavos,
} from "@kokoro/shared";
import { useEffect, useRef, useState } from "react";

import { PaymentAccountSelect } from "@/components/common/PaymentAccountSelect";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
  const [businessDate, setBusinessDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    PAYMENT_METHODS[0] as PaymentMethod,
  );
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const moneySeededRef = useRef(false);
  const accountSeededRef = useRef(false);

  // Money/date fields depend only on `order`, which the parent drawer guarantees is already
  // loaded before this dialog can open — seed them immediately, once per open, guarded so a later
  // `order` reference change (e.g. an unrelated background refetch) can't silently overwrite what
  // the owner already typed.
  useEffect(() => {
    if (!open) {
      moneySeededRef.current = false;
      return;
    }
    if (moneySeededRef.current) return;
    moneySeededRef.current = true;
    setAgreedTotal(order.agreedTotal !== null ? formatIntAsDecimalInput(order.agreedTotal, 2) : "");
    setDepositAmount(
      order.depositRequired !== null ? formatIntAsDecimalInput(order.depositRequired, 2) : "",
    );
    setBusinessDate(toBusinessDate(nowIso()));
    setError(null);
  }, [open, order.agreedTotal, order.depositRequired]);

  // `accounts` loads independently and can still be in flight when the dialog first renders — a
  // combined seed effect gated on it delayed the deposit amount above too, so a fast fill() (or a
  // fast owner) could still be clobbered once accounts finally arrived. Kept separate: this only
  // ever touches the account/payment-method default, never the money fields.
  useEffect(() => {
    if (!open) {
      accountSeededRef.current = false;
      return;
    }
    if (accountSeededRef.current || accountsQuery.isLoading) return;
    accountSeededRef.current = true;
    const firstAccount = accounts[0];
    setPaymentMethod(
      firstAccount
        ? paymentMethodForAccountType(firstAccount.type)
        : (PAYMENT_METHODS[0] as PaymentMethod),
    );
    setAccountId(firstAccount?.id ?? "");
  }, [open, accountsQuery.isLoading, accounts]);

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
      businessDate,
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

        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="co-date">
            {ordersLabels.confirmFieldDate}
          </label>
          <Input
            id="co-date"
            type="date"
            value={businessDate}
            onChange={(e) => setBusinessDate(e.target.value)}
            disabled={disabled}
          />
        </div>

        <PaymentAccountSelect
          id="co-payment-account"
          accounts={accounts}
          accountId={accountId}
          label={ordersLabels.confirmFieldPaymentAccount}
          paymentMethodLabels={ordersLabels.paymentMethodLabels}
          onChange={({ accountId: nextAccountId, paymentMethod: nextPaymentMethod }) => {
            setAccountId(nextAccountId);
            setPaymentMethod(nextPaymentMethod);
          }}
          disabled={disabled}
        />

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
