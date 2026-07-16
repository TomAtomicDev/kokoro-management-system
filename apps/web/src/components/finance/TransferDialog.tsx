// Dialog for UC-12 "transfer" (Doc 10 KOK-015) — from-account -> to-account, amount, description.
// No category field: `transfer` writes a fixed TRANSFER_OUT/TRANSFER_IN pair server-side.

import {
  type FinancialAccountDto,
  nowIso,
  toBusinessDate,
  transferCommandSchema,
} from "@kokoro/shared";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useTransfer } from "@/features/finance/api";
import { ApiError } from "@/lib/api";
import { parseDecimalToInt } from "@/lib/decimal";
import { financeLabels } from "@/lib/i18n-finance";

export interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: FinancialAccountDto[];
}

export function TransferDialog({ open, onOpenChange, accounts }: TransferDialogProps) {
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [businessDate, setBusinessDate] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useTransfer();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on the open transition.
  useEffect(() => {
    if (open) {
      setFromAccountId(accounts[0]?.id ?? "");
      setToAccountId(accounts[1]?.id ?? accounts[0]?.id ?? "");
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
    const parsed = transferCommandSchema.safeParse({
      fromAccountId,
      toAccountId,
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
    <Dialog open={open} onOpenChange={onOpenChange} aria-label={financeLabels.transferTitle}>
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{financeLabels.transferTitle}</h2>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="tr-from">
              {financeLabels.fieldFromAccount}
            </label>
            <Select
              id="tr-from"
              value={fromAccountId}
              onChange={(e) => setFromAccountId(e.target.value)}
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
            <label className="font-medium text-foreground" htmlFor="tr-to">
              {financeLabels.fieldToAccount}
            </label>
            <Select
              id="tr-to"
              value={toAccountId}
              onChange={(e) => setToAccountId(e.target.value)}
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

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="tr-amount">
              {financeLabels.fieldAmount}
            </label>
            <Input
              id="tr-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={disabled}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="tr-date">
              {financeLabels.fieldDate}
            </label>
            <Input
              id="tr-date"
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="tr-description">
            {financeLabels.fieldDescription}
          </label>
          <Input
            id="tr-description"
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
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || !fromAccountId || !toAccountId}
        >
          {financeLabels.submitTransfer}
        </Button>
      </div>
    </Dialog>
  );
}
