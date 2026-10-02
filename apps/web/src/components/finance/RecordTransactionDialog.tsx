// Dialog for UC-11 "recordTransaction" — gasto operativo / otro ingreso (Doc 10 KOK-015).
//
// Doc 07 SC-10 phrases these as two distinct entry points ("gasto operativo / otro ingreso"), not
// one generic form with a type toggle — so the Finance header exposes two buttons ("Registrar
// gasto" / "Registrar otro ingreso"), each opening THIS SAME component with `type` pre-fixed. The
// component itself only asks for `category` among the legal subset for that fixed type
// (FINANCE_FORM_TRANSACTION_CATEGORIES_BY_TYPE, exported by packages/shared so this never offers
// order-only categories without page context — D-4). An order page supplies its own fixed context,
// validates through the shared order command and never adds an editable order picker. Validated with the exact same
// `recordTransactionCommandSchema` the API route parses with.

import {
  FINANCE_FORM_TRANSACTION_CATEGORIES_BY_TYPE,
  type FinancialAccountDto,
  type FinancialTransactionCategory,
  nowIso,
  RECORD_TRANSACTION_CATEGORIES_BY_TYPE,
  recordOrderTransactionCommandSchema,
  recordTransactionCommandSchema,
  toBusinessDate,
} from "@kokoro/shared";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useRecordOrderTransaction, useRecordTransaction } from "@/features/finance/api";
import { ApiError } from "@/lib/api";
import { parseDecimalToInt } from "@/lib/decimal";
import { financeLabels } from "@/lib/i18n-finance";

export interface RecordTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fixed for the lifetime of the dialog instance — the two header buttons mount two instances. */
  type: "INCOME" | "EXPENSE";
  accounts: FinancialAccountDto[];
  /** When set, the order id comes from this page and is submitted in the URL, never as a field. */
  orderContext?: { id: string; code: string | null };
  /** Exposes a refund-only order action without offering ORDER_REFUND for ordinary expenses. */
  fixedCategory?: FinancialTransactionCategory;
}

export function RecordTransactionDialog({
  open,
  onOpenChange,
  type,
  accounts,
  orderContext,
  fixedCategory,
}: RecordTransactionDialogProps) {
  const orderCategories = RECORD_TRANSACTION_CATEGORIES_BY_TYPE[type].filter(
    (value) => value !== "ORDER_REFUND",
  );
  const allowedCategories = fixedCategory
    ? [fixedCategory]
    : orderContext
      ? orderCategories
      : FINANCE_FORM_TRANSACTION_CATEGORIES_BY_TYPE[type];
  const [accountId, setAccountId] = useState("");
  const [category, setCategory] = useState<FinancialTransactionCategory>(
    allowedCategories[0] ?? "OTHER_EXPENSE",
  );
  const [amount, setAmount] = useState("");
  const [businessDate, setBusinessDate] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useRecordTransaction();
  const orderMutation = useRecordOrderTransaction(orderContext?.id ?? "");

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on the open transition.
  useEffect(() => {
    if (open) {
      setAccountId(accounts[0]?.id ?? "");
      setCategory(fixedCategory ?? allowedCategories[0] ?? "OTHER_EXPENSE");
      setAmount("");
      setBusinessDate(toBusinessDate(nowIso()));
      setDescription("");
      setError(null);
    }
  }, [open]);

  async function handleSubmit() {
    setError(null);
    const amountCentavos = parseDecimalToInt(amount, 2);
    if (amountCentavos === null || amountCentavos <= 0) {
      setError(financeLabels.errors.invalidAmount);
      return;
    }
    const command = {
      accountId,
      type,
      category,
      amount: amountCentavos,
      businessDate,
      occurredAt: nowIso(),
      description: description.trim() === "" ? undefined : description.trim(),
    };
    try {
      if (orderContext) {
        const parsed = recordOrderTransactionCommandSchema.safeParse(command);
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? financeLabels.errors.generic);
          return;
        }
        await orderMutation.mutateAsync(parsed.data);
      } else {
        const parsed = recordTransactionCommandSchema.safeParse(command);
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? financeLabels.errors.generic);
          return;
        }
        await mutation.mutateAsync(parsed.data);
      }
      onOpenChange(false);
    } catch (err) {
      if (!(err instanceof ApiError)) setError(financeLabels.errors.generic);
    }
  }

  const isOrderRefund = fixedCategory === "ORDER_REFUND";
  const title = isOrderRefund
    ? financeLabels.recordRefundTitle
    : orderContext && type === "INCOME"
      ? financeLabels.recordOrderIncomeTitle
      : type === "EXPENSE"
        ? financeLabels.recordExpenseTitle
        : financeLabels.recordIncomeTitle;
  const submitLabel = isOrderRefund
    ? financeLabels.submitRefund
    : type === "EXPENSE"
      ? financeLabels.submitExpense
      : financeLabels.submitIncome;
  const disabled = mutation.isPending || orderMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label={title}>
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{title}</h2>
        {orderContext ? (
          <p className="mt-1 text-muted-foreground text-xs">
            {financeLabels.orderContext}:{" "}
            <span className="font-medium text-foreground">
              {orderContext.code ?? financeLabels.relatedOrderWithoutCode}
            </span>
          </p>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="rt-account">
            {financeLabels.fieldAccount}
          </label>
          <Select
            id="rt-account"
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

        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="rt-category">
            {financeLabels.fieldCategory}
          </label>
          <Select
            id="rt-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as FinancialTransactionCategory)}
            disabled={disabled || fixedCategory !== undefined}
          >
            {allowedCategories.map((cat) => (
              <option key={cat} value={cat}>
                {financeLabels.categoryLabels[cat]}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="rt-amount">
              {financeLabels.fieldAmount}
            </label>
            <Input
              id="rt-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={disabled}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="rt-date">
              {financeLabels.fieldDate}
            </label>
            <Input
              id="rt-date"
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="rt-description">
            {financeLabels.fieldDescription}
          </label>
          <Input
            id="rt-description"
            placeholder={financeLabels.descriptionPlaceholder}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={disabled}
          />
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
          {financeLabels.cancel}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={disabled || !accountId}>
          {submitLabel}
        </Button>
      </div>
    </Dialog>
  );
}
