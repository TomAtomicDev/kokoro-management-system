// Finance detail drawer (SC-10 / KOK-146). Manual rows can be edited in place and soft-deleted;
// system-owned rows remain visibly read-only because their source event owns their state.

import type {
  FinancialAccountDto,
  FinancialTransactionCategory,
  FinancialTransactionDto,
  UpdateTransactionCommand,
} from "@kokoro/shared";
import {
  formatMoney,
  RECORD_TRANSACTION_CATEGORIES_BY_TYPE,
  toCentavos,
  updateTransactionCommandSchema,
} from "@kokoro/shared";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { DetailDrawer } from "@/components/data-table/DetailDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  useDeleteTransaction,
  useRestoreTransaction,
  useUpdateTransaction,
} from "@/features/finance/api";
import {
  signedTransactionAmount,
  transactionAmountColorClass,
} from "@/features/finance/transaction-styling";
import { ApiError } from "@/lib/api";
import { parseDecimalToInt } from "@/lib/decimal";
import { financeLabels } from "@/lib/i18n-finance";
import { cn } from "@/lib/utils";

interface StandaloneDraft {
  kind: "standalone";
  accountId: string;
  type: "INCOME" | "EXPENSE";
  category: FinancialTransactionCategory;
  amount: string;
  businessDate: string;
  occurredAt: string;
  description: string;
}

interface TransferDraft {
  kind: "transfer";
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  businessDate: string;
  occurredAt: string;
  description: string;
}

type TransactionDraft = StandaloneDraft | TransferDraft;

export interface TransactionDetailDrawerProps {
  transaction: FinancialTransactionDto | null;
  counterpart: FinancialTransactionDto | null;
  accounts: FinancialAccountDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function amountInput(amount: number): string {
  return formatMoney(toCentavos(amount)).replace(/^Bs\s/, "");
}

function draftFor(
  transaction: FinancialTransactionDto,
  counterpart: FinancialTransactionDto | null,
): TransactionDraft {
  const isTransfer = transaction.type === "TRANSFER_IN" || transaction.type === "TRANSFER_OUT";
  if (isTransfer && counterpart) {
    const out = transaction.type === "TRANSFER_OUT" ? transaction : counterpart;
    const incoming = transaction.type === "TRANSFER_IN" ? transaction : counterpart;
    return {
      kind: "transfer",
      fromAccountId: out.accountId,
      toAccountId: incoming.accountId,
      amount: amountInput(out.amount),
      businessDate: out.businessDate,
      occurredAt: out.occurredAt,
      description: out.description ?? "",
    };
  }
  return {
    kind: "standalone",
    accountId: transaction.accountId,
    type: transaction.type === "INCOME" ? "INCOME" : "EXPENSE",
    category: transaction.category,
    amount: amountInput(transaction.amount),
    businessDate: transaction.businessDate,
    occurredAt: transaction.occurredAt,
    description: transaction.description ?? "",
  };
}

function transactionTitle(transaction: FinancialTransactionDto): string {
  return transaction.code ?? financeLabels.detailTitle;
}

function FieldRow({ label, children }: { label: string; children: ReactNode }): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{children}</span>
    </div>
  );
}

export function TransactionDetailDrawer({
  transaction,
  counterpart,
  accounts,
  open,
  onOpenChange,
}: TransactionDetailDrawerProps) {
  const { show, showUndo } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TransactionDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateMutation = useUpdateTransaction(transaction?.id ?? "");
  const deleteMutation = useDeleteTransaction();
  const restoreMutation = useRestoreTransaction();

  useEffect(() => {
    if (!transaction) {
      setDraft(null);
      setEditing(false);
      return;
    }
    setDraft(draftFor(transaction, counterpart));
    setEditing(false);
    setError(null);
  }, [transaction, counterpart]);

  // Undo happens after the drawer closes, so a restore error needs its own toast rather than the
  // now-unmounted detail body. The mutation is intentionally shared by all undo callbacks.
  useEffect(() => {
    if (restoreMutation.error) {
      show({
        message:
          restoreMutation.error instanceof ApiError
            ? restoreMutation.error.message
            : financeLabels.errors.generic,
      });
    }
  }, [restoreMutation.error, show]);

  const accountNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of accounts) map.set(account.id, account.name);
    return map;
  }, [accounts]);

  if (!transaction) return null;
  const transactionId = transaction.id;

  const isTransfer = transaction.type === "TRANSFER_IN" || transaction.type === "TRANSFER_OUT";
  const isManual = transaction.sourceEventId === null;
  const transferPairReady = !isTransfer || counterpart !== null;
  const transferOut = transaction.type === "TRANSFER_OUT" ? transaction : counterpart;
  const transferIn = transaction.type === "TRANSFER_IN" ? transaction : counterpart;

  function setDraftField(
    key: Exclude<keyof StandaloneDraft | keyof TransferDraft, "kind">,
    value: string,
  ): void {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  async function handleSave(): Promise<void> {
    if (!draft) return;
    setError(null);
    const raw: UpdateTransactionCommand =
      draft.kind === "transfer"
        ? {
            fromAccountId: draft.fromAccountId,
            toAccountId: draft.toAccountId,
            amount: parseDecimalToInt(draft.amount, 2) ?? 0,
            businessDate: draft.businessDate,
            occurredAt: draft.occurredAt,
            description: draft.description.trim() === "" ? undefined : draft.description.trim(),
          }
        : draft.category === "OWNER_WITHDRAWAL"
          ? {
              accountId: draft.accountId,
              amount: parseDecimalToInt(draft.amount, 2) ?? 0,
              businessDate: draft.businessDate,
              occurredAt: draft.occurredAt,
              description: draft.description.trim() === "" ? undefined : draft.description.trim(),
            }
          : {
              accountId: draft.accountId,
              type: draft.type,
              category: draft.category,
              amount: parseDecimalToInt(draft.amount, 2) ?? 0,
              businessDate: draft.businessDate,
              occurredAt: draft.occurredAt,
              description: draft.description.trim() === "" ? undefined : draft.description.trim(),
            };
    const parsed = updateTransactionCommandSchema.safeParse(raw);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? financeLabels.errors.generic);
      return;
    }
    try {
      await updateMutation.mutateAsync(parsed.data);
      setEditing(false);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : financeLabels.errors.generic);
    }
  }

  async function handleDelete(): Promise<void> {
    setError(null);
    try {
      const deletedId = transactionId;
      await deleteMutation.mutateAsync({ id: deletedId, command: {} });
      onOpenChange(false);
      showUndo({
        message: financeLabels.deletedUndo,
        actionLabel: financeLabels.undo,
        onAction: () => {
          void restoreMutation.mutateAsync({ id: deletedId, command: {} });
        },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : financeLabels.errors.generic);
    }
  }

  const mutationPending = updateMutation.isPending || deleteMutation.isPending;

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={transactionTitle(transaction)}
      subtitle={`${financeLabels.typeLabels[transaction.type]} · ${transaction.businessDate}`}
      entityType="financial_transactions"
      entityId={transaction.id}
      footer={
        <span>
          {financeLabels.createdAt} {new Date(transaction.createdAt).toLocaleDateString("es-BO")} ·{" "}
          {financeLabels.updatedAt} {new Date(transaction.updatedAt).toLocaleDateString("es-BO")}
        </span>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        {isManual && transferPairReady && !editing ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
              {financeLabels.edit}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => void handleDelete()}
              disabled={mutationPending}
            >
              {financeLabels.delete}
            </Button>
          </div>
        ) : null}

        {transaction.sourceEventId ? (
          <div className="rounded-md border border-border bg-muted px-3 py-2 text-muted-foreground">
            <Badge variant="muted">{financeLabels.systemOwnedBadge}</Badge>
            <p className="mt-2">{financeLabels.systemOwnedHint}</p>
          </div>
        ) : null}

        {error ? <p className="text-negative text-sm">{error}</p> : null}

        {editing && draft && isManual ? (
          <div className="flex flex-col gap-4">
            {draft.kind === "transfer" && transferPairReady ? (
              <div className="grid grid-cols-2 gap-3">
                <label
                  className="flex flex-col gap-1.5 font-medium text-foreground"
                  htmlFor="finance-transfer-from"
                >
                  {financeLabels.fieldFromAccount}
                  <Select
                    id="finance-transfer-from"
                    value={draft.fromAccountId}
                    onChange={(event) => setDraftField("fromAccountId", event.target.value)}
                    disabled={mutationPending}
                  >
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <label
                  className="flex flex-col gap-1.5 font-medium text-foreground"
                  htmlFor="finance-transfer-to"
                >
                  {financeLabels.fieldToAccount}
                  <Select
                    id="finance-transfer-to"
                    value={draft.toAccountId}
                    onChange={(event) => setDraftField("toAccountId", event.target.value)}
                    disabled={mutationPending}
                  >
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
            ) : draft.kind === "standalone" ? (
              <>
                <label
                  className="flex flex-col gap-1.5 font-medium text-foreground"
                  htmlFor="finance-standalone-account"
                >
                  {financeLabels.fieldAccount}
                  <Select
                    id="finance-standalone-account"
                    value={draft.accountId}
                    onChange={(event) => setDraftField("accountId", event.target.value)}
                    disabled={mutationPending}
                  >
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </Select>
                </label>
                {draft.category === "OWNER_WITHDRAWAL" ? (
                  <div className="flex flex-col rounded-md border border-border bg-muted px-3 py-2">
                    <FieldRow label={financeLabels.fieldType}>
                      {financeLabels.typeLabels.EXPENSE}
                    </FieldRow>
                    <FieldRow label={financeLabels.fieldCategory}>
                      {financeLabels.categoryLabels.OWNER_WITHDRAWAL}
                    </FieldRow>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <label
                      className="flex flex-col gap-1.5 font-medium text-foreground"
                      htmlFor="finance-transaction-type"
                    >
                      {financeLabels.fieldType}
                      <Select
                        id="finance-transaction-type"
                        value={draft.type}
                        onChange={(event) => {
                          const type = event.target.value as "INCOME" | "EXPENSE";
                          setDraft((current) =>
                            current && current.kind === "standalone"
                              ? {
                                  ...current,
                                  type,
                                  category:
                                    RECORD_TRANSACTION_CATEGORIES_BY_TYPE[type][0] ??
                                    "OTHER_EXPENSE",
                                }
                              : current,
                          );
                        }}
                        disabled={mutationPending}
                      >
                        <option value="EXPENSE">{financeLabels.typeLabels.EXPENSE}</option>
                        <option value="INCOME">{financeLabels.typeLabels.INCOME}</option>
                      </Select>
                    </label>
                    <label
                      className="flex flex-col gap-1.5 font-medium text-foreground"
                      htmlFor="finance-transaction-category"
                    >
                      {financeLabels.fieldCategory}
                      <Select
                        id="finance-transaction-category"
                        value={draft.category}
                        onChange={(event) =>
                          setDraftField(
                            "category",
                            event.target.value as FinancialTransactionCategory,
                          )
                        }
                        disabled={mutationPending}
                      >
                        {RECORD_TRANSACTION_CATEGORIES_BY_TYPE[draft.type].map((category) => (
                          <option key={category} value={category}>
                            {financeLabels.categoryLabels[category]}
                          </option>
                        ))}
                      </Select>
                    </label>
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">{financeLabels.transferPairUnavailable}</p>
            )}

            {draft.kind === "transfer" || draft.kind === "standalone" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <label
                    className="flex flex-col gap-1.5 font-medium text-foreground"
                    htmlFor="finance-transaction-amount"
                  >
                    {financeLabels.fieldAmount}
                    <Input
                      id="finance-transaction-amount"
                      inputMode="decimal"
                      value={draft.amount}
                      onChange={(event) => setDraftField("amount", event.target.value)}
                      disabled={mutationPending}
                    />
                  </label>
                  <label
                    className="flex flex-col gap-1.5 font-medium text-foreground"
                    htmlFor="finance-transaction-date"
                  >
                    {financeLabels.fieldDate}
                    <Input
                      id="finance-transaction-date"
                      type="date"
                      value={draft.businessDate}
                      onChange={(event) => setDraftField("businessDate", event.target.value)}
                      disabled={mutationPending}
                    />
                  </label>
                </div>
                <label
                  className="flex flex-col gap-1.5 font-medium text-foreground"
                  htmlFor="finance-transaction-description"
                >
                  {financeLabels.fieldDescription}
                  <Input
                    id="finance-transaction-description"
                    value={draft.description}
                    placeholder={financeLabels.descriptionPlaceholder}
                    onChange={(event) => setDraftField("description", event.target.value)}
                    disabled={mutationPending}
                  />
                </label>
                <div className="flex justify-end gap-2 border-t border-border pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditing(false)}
                    disabled={mutationPending}
                  >
                    {financeLabels.cancel}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={mutationPending || !transferPairReady}
                  >
                    {financeLabels.saveChanges}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col rounded-md border border-border bg-muted px-3 py-2">
            <FieldRow label={financeLabels.columnAccount}>
              {isTransfer && transferOut && transferIn
                ? `${accountNameById.get(transferOut.accountId) ?? transferOut.accountId} → ${accountNameById.get(transferIn.accountId) ?? transferIn.accountId}`
                : (accountNameById.get(transaction.accountId) ?? transaction.accountId)}
            </FieldRow>
            <FieldRow label={financeLabels.columnCategory}>
              {financeLabels.categoryLabels[transaction.category]}
            </FieldRow>
            <FieldRow label={financeLabels.columnAmount}>
              <span className={cn("font-medium", transactionAmountColorClass(transaction.type))}>
                {formatMoney(
                  toCentavos(signedTransactionAmount(transaction.type, transaction.amount)),
                  { signed: true },
                )}
              </span>
            </FieldRow>
            <FieldRow label={financeLabels.columnDescription}>
              {transaction.description ?? "—"}
            </FieldRow>
            <FieldRow label={financeLabels.columnDate}>{transaction.businessDate}</FieldRow>
          </div>
        )}
      </div>
    </DetailDrawer>
  );
}
