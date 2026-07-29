// Detail drawer for a single purchase (Doc 06 §4 DetailDrawer contract). KOK-024 Phase G adds
// edit (opens `PurchaseForm` in edit mode as a sibling dialog) and delete (soft delete + undo
// toast per Doc 06 principle 6, with the ImpactConfirmDialog exception for an R-5 replay-affecting
// delete/restore) — the drawer itself stays otherwise unchanged.

import type {
  DeletePurchaseCommand,
  DeletePurchaseResult,
  FinancialAccountDto,
  ItemDto,
  UpdatePurchaseResult,
} from "@kokoro/shared";
import {
  formatMoney,
  formatQty,
  rateFromTotal,
  toCentavos,
  toMilliUnits,
  totalCentavos,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";
import { useEffect, useMemo, useState } from "react";

import { DetailDrawer } from "@/components/data-table/DetailDrawer";
import { Button } from "@/components/ui/button";
import { ImpactConfirmDialog } from "@/components/ui/ImpactConfirmDialog";
import { useToast } from "@/components/ui/toast";
import { useItemsQuery } from "@/features/catalog/api";
import { useDeletePurchase, usePurchase, useRestorePurchase } from "@/features/purchases/api";
import { useReplayConfirmableMutation } from "@/hooks/useReplayConfirmableMutation";
import { ApiError } from "@/lib/api";
import { purchasesLabels } from "@/lib/i18n-purchases";

import { PurchaseForm } from "./PurchaseForm";

export interface PurchaseDetailDrawerProps {
  purchaseId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: FinancialAccountDto[];
}

export function PurchaseDetailDrawer({
  purchaseId,
  open,
  onOpenChange,
  accounts,
}: PurchaseDetailDrawerProps) {
  const purchaseQuery = usePurchase(purchaseId ?? undefined);
  const itemsQuery = useItemsQuery({ isActive: true });
  const { show, showUndo } = useToast();

  const [editOpen, setEditOpen] = useState(false);
  // Frozen at the moment delete succeeds — see deleteReplay's onSuccess below. The restore mutation
  // is deliberately built from THIS, never from the live `purchaseId` prop: `onOpenChange(false)`
  // closes the drawer as part of that same onSuccess, which flips `purchaseId` to `null` on the
  // parent's next render. `useReplayConfirmableMutation`'s `mutateAsync` always calls the LATEST
  // `mutationFn` a render produced (TanStack Query re-applies options every render), so a restore
  // mutation built from the live prop would, by the time the owner actually clicks the toast's
  // "Deshacer" a moment later, close over an empty id and POST `/purchases//restore` — a 404 that
  // silently drops the undo. Same bug found live (via Playwright) and fixed in
  // ProductionRunDetailDrawer.tsx (KOK-026); ported here.
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);

  // Called unconditionally (rules of hooks) with "" when nothing is selected yet — never actually
  // invoked in that state, since the buttons that call `execute`/`confirm` only render once
  // `purchase` (below) is loaded.
  const deleteMutation = useDeletePurchase(purchaseId ?? "");
  const restoreMutation = useRestorePurchase(pendingRestoreId ?? "");

  const restoreReplay = useReplayConfirmableMutation<DeletePurchaseCommand, UpdatePurchaseResult>(
    (command) => restoreMutation.mutateAsync(command),
  );

  const deleteReplay = useReplayConfirmableMutation<DeletePurchaseCommand, DeletePurchaseResult>(
    (command) => deleteMutation.mutateAsync(command),
    {
      onSuccess: () => {
        setPendingRestoreId(purchaseId);
        onOpenChange(false);
        showUndo({
          message: purchasesLabels.deletedUndo,
          actionLabel: purchasesLabels.undo,
          onAction: () => restoreReplay.execute({}),
        });
      },
    },
  );

  // A restore failure that ISN'T the R-5 confirmation case (that one is handled by
  // `restoreReplay.pendingConfirmation` below) has nowhere else to surface — the undo toast that
  // triggered it is long gone by the time this rejects. Mirrors ExitDetailDrawer.tsx's identical
  // precedent (KOK-068). Deliberately depends only on the error itself, not `show` (stable per
  // ToastProvider's own useMemo) — re-running on every render would repeat the same toast for as
  // long as the error object reference is unchanged.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional, see comment above.
  useEffect(() => {
    if (restoreReplay.error) {
      show({ message: purchasesLabels.restoreFailed });
    }
  }, [restoreReplay.error]);

  const itemById = useMemo(() => {
    const map = new Map<string, ItemDto>();
    for (const item of itemsQuery.data?.items ?? []) map.set(item.id, item);
    return map;
  }, [itemsQuery.data]);

  const accountNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of accounts) map.set(account.id, account.name);
    return map;
  }, [accounts]);

  if (!purchaseId) return null;
  const purchase = purchaseQuery.data;

  return (
    <>
      <DetailDrawer
        open={open}
        onOpenChange={onOpenChange}
        title={purchase?.supplierName ?? purchasesLabels.detailTitle}
        subtitle={purchase?.businessDate}
        entityType="purchases"
        entityId={purchaseId}
        footer={
          purchase ? (
            <span>
              Creado {new Date(purchase.createdAt).toLocaleDateString("es-BO")} · Actualizado{" "}
              {new Date(purchase.updatedAt).toLocaleDateString("es-BO")}
            </span>
          ) : undefined
        }
      >
        {!purchase ? (
          <p className="text-muted-foreground text-sm">{purchasesLabels.loading}</p>
        ) : (
          <div className="flex flex-col gap-5 text-sm">
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                {purchasesLabels.edit}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => deleteReplay.execute({})}
                disabled={deleteReplay.isPending}
              >
                {purchasesLabels.delete}
              </Button>
            </div>

            {deleteReplay.error ? (
              <p className="text-negative text-sm">
                {deleteReplay.error instanceof ApiError
                  ? deleteReplay.error.message
                  : purchasesLabels.errors.generic}
              </p>
            ) : null}

            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{purchasesLabels.columnAccount}</span>
                <span className="font-medium text-foreground">
                  {accountNameById.get(purchase.accountId) ?? purchase.accountId}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{purchasesLabels.columnTotal}</span>
                <span className="numeric-cell font-medium text-foreground">
                  {formatMoney(purchase.total)}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="font-medium text-foreground">{purchasesLabels.detailLines}</span>
              <ul className="flex flex-col gap-2">
                {purchase.lines.map((line) => {
                  const item = itemById.get(line.itemId);
                  const unitCostMc =
                    line.qty > 0
                      ? rateFromTotal(toCentavos(line.lineTotal), toMilliUnits(line.qty))
                      : null;
                  return (
                    <li
                      key={line.id}
                      className="flex flex-col gap-1 rounded-md border border-border px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">
                          {item?.name ?? line.itemId}
                        </span>
                        <span className="numeric-cell font-medium">
                          {formatMoney(line.lineTotal)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground text-xs">
                        <span>{item ? formatQty(line.qty, item.unit) : line.qty}</span>
                        {item && unitCostMc !== null ? (
                          <span className="numeric-cell">
                            {purchasesLabels.unitCostLabel}:{" "}
                            {formatMoney(totalCentavos(unitCostMc, WHOLE_UNIT_MILLI_UNITS))} /{" "}
                            {purchasesLabels.unitAbbrev[item.unit]}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="flex flex-col gap-1">
              <span className="font-medium text-foreground">{purchasesLabels.fieldNotes}</span>
              <p className="text-muted-foreground">{purchase.notes ?? purchasesLabels.noNotes}</p>
            </div>

            {purchase.receiptPhotoKey ? (
              <div className="flex flex-col gap-2">
                <span className="font-medium text-foreground">{purchasesLabels.detailPhoto}</span>
                {/* Renders inline for image content-types; a PDF receipt silently fails to render
                  here, which is acceptable — the link below always works regardless of type. */}
                <img
                  src={`/api/purchases/photos/${encodeURIComponent(purchase.receiptPhotoKey)}`}
                  alt={purchasesLabels.detailPhoto}
                  className="max-h-64 w-auto rounded-md border border-border object-contain"
                />
                <a
                  href={`/api/purchases/photos/${encodeURIComponent(purchase.receiptPhotoKey)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary text-sm underline"
                >
                  {purchasesLabels.viewPhoto}
                </a>
              </div>
            ) : null}
          </div>
        )}
      </DetailDrawer>

      {purchase ? (
        <PurchaseForm
          open={editOpen}
          onOpenChange={setEditOpen}
          accounts={accounts}
          purchase={purchase}
        />
      ) : null}

      {deleteReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={deleteReplay.pendingConfirmation.impact}
          onConfirm={deleteReplay.confirm}
          onCancel={deleteReplay.cancel}
          confirmLoading={deleteReplay.isPending}
          title={purchasesLabels.impactDeleteTitle}
          description={purchasesLabels.impactDeleteDescription}
        />
      ) : null}

      {restoreReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={restoreReplay.pendingConfirmation.impact}
          onConfirm={restoreReplay.confirm}
          onCancel={restoreReplay.cancel}
          confirmLoading={restoreReplay.isPending}
          title={purchasesLabels.impactRestoreTitle}
          description={purchasesLabels.impactRestoreDescription}
        />
      ) : null}
    </>
  );
}
