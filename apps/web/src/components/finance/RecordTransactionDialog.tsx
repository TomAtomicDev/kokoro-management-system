// Dialog for UC-11 "recordTransaction" — gasto operativo / otro ingreso (Doc 10 KOK-015).
//
// Doc 07 SC-10 phrases these as two distinct entry points ("gasto operativo / otro ingreso"), not
// one generic form with a type toggle — so the Finance header exposes two buttons ("Registrar
// gasto" / "Registrar otro ingreso"), each opening THIS SAME component with `type` pre-fixed. The
// component itself only asks for `category` among the legal subset for that fixed type
// (RECORD_TRANSACTION_CATEGORIES_BY_TYPE, exported by packages/shared so this never re-derives
// the pairing rule — D-4). Validated with the exact same `recordTransactionCommandSchema` the API
// route parses with.

import {
  type FinancialAccountDto,
  type FinancialTransactionCategory,
  RECORD_TRANSACTION_CATEGORIES_BY_TYPE,
  nowIso,
  recordTransactionCommandSchema,
  toBusinessDate,
} from "@kokoro/shared";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useRecordTransaction } from "@/features/finance/api";
import { ApiError } from "@/lib/api";
import { parseDecimalToInt } from "@/lib/decimal";
import { financeLabels } from "@/lib/i18n-finance";

export interface RecordTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fixed for the lifetime of the dialog instance — the two header buttons mount two instances. */
  type: "INCOME" | "EXPENSE";
  accounts: FinancialAccountDto[];
}

export function RecordTransactionDialog({
  open,
  onOpenChange,
  type,
  accounts,
}: RecordTransactionDialogProps) {
  const allowedCategories = RECORD_TRANSACTION_CATEGORIES_BY_TYPE[type];
  const [accountId, setAccountId] = useState("");
  const [category, setCategory] = useState<FinancialTransactionCategory>(
    allowedCategories[0] ?? "OTHER_EXPENSE",
  );
  const [amount, setAmount] = useState("");
  const [businessDate, setBusinessDate] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useRecordTransaction();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on the open transition.
  useEffect(() => {
    if (open) {
      setAccountId(accounts[0]?.id ?? "");
      setCategory(allowedCategories[0] ?? "OTHER_EXPENSE");
      setAmount("");
      setBusinessDate(toBusinessDate(nowIso()));
      setDescription("");
      setError(null);
    }
  }, [open]);

  async function handleSubmit() {
    const amountCentavos = parseDecimalToInt(amount, 2);
    if (amountCentavos === null || amountCentavos <= 0) {
      setError(financeLabels.errors.invalidAmount);
      return;
    }
    const parsed = recordTransactionCommandSchema.safeParse({
      accountId,
      type,
      category,
      amount: amountCentavos,
      businessDate,
      occurredAt: nowIso(),
      description: description.trim() === "" ? undefined : description.trim(),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? financeLabels.errors.generic);
      return;
    }
    try {
      await mutation.mutateAsync(parsed.data);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : financeLabels.errors.generic);
    }
  }

  const title =
    type === "EXPENSE" ? financeLabels.recordExpenseTitle : financeLabels.recordIncomeTitle;
  const submitLabel = type === "EXPENSE" ? financeLabels.submitExpense : financeLabels.submitIncome;
  const disabled = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label={title}>
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{title}</h2>
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
            disabled={disabled}
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
