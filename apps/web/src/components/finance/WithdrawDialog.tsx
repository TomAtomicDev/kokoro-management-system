// Dialog for UC-13 "withdraw" (Doc 10 KOK-015) — "Retiro personal": account, amount, description.
// No category field: `withdraw` writes a fixed OWNER_WITHDRAWAL row server-side.

import {
  type FinancialAccountDto,
  nowIso,
  toBusinessDate,
  withdrawCommandSchema,
} from "@kokoro/shared";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useWithdraw } from "@/features/finance/api";
import { ApiError } from "@/lib/api";
import { parseDecimalToInt } from "@/lib/decimal";
import { financeLabels } from "@/lib/i18n-finance";

export interface WithdrawDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: FinancialAccountDto[];
}

export function WithdrawDialog({ open, onOpenChange, accounts }: WithdrawDialogProps) {
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [businessDate, setBusinessDate] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useWithdraw();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on the open transition.
  useEffect(() => {
    if (open) {
      setAccountId(accounts[0]?.id ?? "");
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
    const parsed = withdrawCommandSchema.safeParse({
      accountId,
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

  const disabled = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label={financeLabels.withdrawTitle}>
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{financeLabels.withdrawTitle}</h2>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="wd-account">
            {financeLabels.fieldAccount}
          </label>
          <Select
            id="wd-account"
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

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="wd-amount">
              {financeLabels.fieldAmount}
            </label>
            <Input
              id="wd-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={disabled}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="wd-date">
              {financeLabels.fieldDate}
            </label>
            <Input
              id="wd-date"
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="wd-description">
            {financeLabels.fieldDescription}
          </label>
          <Input
            id="wd-description"
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
          {financeLabels.submitWithdraw}
        </Button>
      </div>
    </Dialog>
  );
}
