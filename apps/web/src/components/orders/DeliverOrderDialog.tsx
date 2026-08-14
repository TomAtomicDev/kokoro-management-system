// Dialog for UC-07 "deliverOrder" (O-2). Wrapped in `useReplayConfirmableMutation` — delivery is
// the ONE order transition that writes kardex (SALE_OUT) movements, so a backdated one can trigger
// the R-5 confirmation dance exactly like a backdated sale (mirrors SaleForm.tsx's create path).
//
// `balancePaymentStatus` describes the BALANCE only (the deposit was already banked at confirm
// time) — PAID needs method+account, ON_CREDIT needs nothing. When `balanceDue` is zero either
// choice is accepted server-side, but the UI defaults to PAID and hides the payment fields since
// there's nothing left to collect.

import type {
  DeliverOrderCommand,
  DeliverOrderResult,
  OrderDto,
  PaymentMethod,
} from "@kokoro/shared";
import {
  deliverOrderCommandSchema,
  formatMoney,
  nowIso,
  PAYMENT_METHODS,
  paymentMethodForAccountType,
  toBusinessDate,
  toCentavos,
} from "@kokoro/shared";
import { useEffect, useState } from "react";

import { PaymentAccountSelect } from "@/components/common/PaymentAccountSelect";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ImpactConfirmDialog } from "@/components/ui/ImpactConfirmDialog";
import { Input } from "@/components/ui/input";
import { useAccounts } from "@/features/finance/api";
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
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data?.accounts ?? [];
  const deliverMutation = useDeliverOrder(order.id);
  const replay = useReplayConfirmableMutation<DeliverOrderCommand, DeliverOrderResult>(
    (command) => deliverMutation.mutateAsync(command),
    { onSuccess: () => onOpenChange(false) },
  );

  const balanceDue = order.balanceDue ?? 0;
  const [isPaid, setIsPaid] = useState(true);
  const [businessDate, setBusinessDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    PAYMENT_METHODS[0] as PaymentMethod,
  );
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setIsPaid(true);
      setBusinessDate(toBusinessDate(nowIso()));
      const firstAccount = accounts[0];
      setPaymentMethod(
        firstAccount
          ? paymentMethodForAccountType(firstAccount.type)
          : (PAYMENT_METHODS[0] as PaymentMethod),
      );
      setAccountId(firstAccount?.id ?? "");
      setError(null);
    }
  }, [open, accounts]);

  const disabled = replay.isPending;

  function handleSubmit() {
    setError(null);
    if (isPaid && balanceDue > 0 && !accountId) {
      setError(ordersLabels.errors.generic);
      return;
    }

    const commandInput = isPaid
      ? {
          balancePaymentStatus: "PAID" as const,
          paymentMethod,
          accountId,
          occurredAt: nowIso(),
          businessDate,
        }
      : {
          balancePaymentStatus: "ON_CREDIT" as const,
          occurredAt: nowIso(),
          businessDate,
        };

    const parsed = deliverOrderCommandSchema.safeParse(commandInput);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? ordersLabels.errors.generic);
      return;
    }
    replay.execute(parsed.data);
  }

  const displayError =
    error ??
    (replay.error instanceof ApiError ? replay.error.message : null) ??
    (replay.error ? ordersLabels.errors.generic : null);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} aria-label={ordersLabels.deliverDialogTitle}>
        <div className="border-border border-b px-5 py-4">
          <h2 className="font-medium text-foreground text-md">{ordersLabels.deliverDialogTitle}</h2>
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
          <div className="flex items-center justify-between rounded-md border border-border bg-muted px-4 py-3">
            <span className="font-medium text-foreground text-sm">{ordersLabels.cardBalance}</span>
            <span className="numeric-cell font-semibold text-foreground">
              {formatMoney(toCentavos(balanceDue))}
            </span>
          </div>

          {balanceDue === 0 ? (
            <p className="text-muted-foreground text-xs">{ordersLabels.deliverBalanceZero}</p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="font-medium text-foreground text-sm">
                  {ordersLabels.deliverFieldBalanceStatus}
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={isPaid ? "default" : "outline"}
                    size="sm"
                    onClick={() => setIsPaid(true)}
                    disabled={disabled}
                  >
                    {ordersLabels.deliverBalancePaid}
                  </Button>
                  <Button
                    type="button"
                    variant={!isPaid ? "default" : "outline"}
                    size="sm"
                    onClick={() => setIsPaid(false)}
                    disabled={disabled}
                  >
                    {ordersLabels.deliverBalanceOnCredit}
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-medium text-foreground" htmlFor="do-date">
                  {ordersLabels.deliverFieldDate}
                </label>
                <Input
                  id="do-date"
                  type="date"
                  value={businessDate}
                  onChange={(e) => setBusinessDate(e.target.value)}
                  disabled={disabled}
                />
              </div>

              {isPaid ? (
                <PaymentAccountSelect
                  id="do-payment-account"
                  accounts={accounts}
                  accountId={accountId}
                  label={ordersLabels.deliverFieldPaymentAccount}
                  paymentMethodLabels={ordersLabels.paymentMethodLabels}
                  onChange={({ accountId: nextAccountId, paymentMethod: nextPaymentMethod }) => {
                    setAccountId(nextAccountId);
                    setPaymentMethod(nextPaymentMethod);
                  }}
                  disabled={disabled}
                />
              ) : null}
            </>
          )}

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
            disabled={disabled || (isPaid && balanceDue > 0 && !accountId)}
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
