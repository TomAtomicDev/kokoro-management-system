// Detail drawer for a single stock exit (KOK-024 Phase G). Mirrors PurchaseDetailDrawer's shape
// (DetailDrawer wrapper, a `use<Feature>(id)` query hook, formatted fields, an audit-trail
// footer) but this one is read/write, unlike the purchases baseline: an "Editar" button opens
// `ExitForm` in edit mode, and an "Eliminar" button deletes with the Doc 06 principle 6 undo-toast
// flow (no confirm-dialog wall for the ordinary case) plus the R-5 "backdated replay" confirmation
// dance for both the delete AND, if it comes to that, the undo/restore itself.
//
// Deliberately NOT gated behind an early `if (!exitId) return null` the way PurchaseDetailDrawer
// is: `open`/`onOpenChange` alone already control the underlying Dialog's visibility (Dialog
// returns null internally when `open` is false), and this component is always mounted at the same
// JSX position by the route (never conditionally excluded from the tree), so its hooks — in
// particular `restoreReplay` below — keep their state across the drawer visually closing. That
// matters here specifically: the delete's undo toast can fire `restoreReplay.execute` up to 10s
// after the drawer closes and `exitId` has gone back to `null`, and if THAT restore itself comes
// back with REPLAY_CONFIRMATION_REQUIRED, the resulting `ImpactConfirmDialog` still needs
// somewhere mounted to render into. An early-return-null component would have thrown that state
// away the instant the drawer closed.
//
// `deletedExitId` (separate from `exitId`) exists because of a subtlety discovered via manual
// testing: `useRestoreStockExit(exitId ?? "")`'s `mutateAsync` is a STABLE function identity
// whose underlying URL is read from whichever render was MOST RECENT when it actually runs, not
// the render that was active when the undo toast captured it (TanStack Query updates a mutation
// observer's options every render, `mutate`/`mutateAsync` always dispatch through the latest
// ones). By the time the user clicks "Deshacer", `onOpenChange(false)` has already nulled
// `exitId` on the route, so a plain `useRestoreStockExit(exitId ?? "")` silently POSTs to
// `/inventory/exits//restore` (empty id, 404) instead of the exit that was actually deleted —
// reproduced live: see this task's manual verification notes. `deletedExitId` is set ONLY inside
// the delete's own `onSuccess`, so it stays pinned to the exit that was just deleted regardless
// of what `exitId` does afterward.

import type { ItemDto } from "@kokoro/shared";
import { formatMoney, formatQty } from "@kokoro/shared";
import { useEffect, useMemo, useState } from "react";

import { DetailDrawer } from "@/components/data-table/DetailDrawer";
import { Button } from "@/components/ui/button";
import { ImpactConfirmDialog } from "@/components/ui/ImpactConfirmDialog";
import { useToast } from "@/components/ui/toast";
import { useItemsQuery } from "@/features/catalog/api";
import { useDeleteStockExit, useRestoreStockExit, useStockExit } from "@/features/inventory/api";
import { useReplayConfirmableMutation } from "@/hooks/useReplayConfirmableMutation";
import { ApiError } from "@/lib/api";
import { inventoryLabels } from "@/lib/i18n-inventory";

import { ExitForm } from "./ExitForm";

export interface ExitDetailDrawerProps {
  exitId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExitDetailDrawer({ exitId, open, onOpenChange }: ExitDetailDrawerProps) {
  const exitQuery = useStockExit(exitId ?? undefined);
  const itemsQuery = useItemsQuery({});
  const toast = useToast();

  const [editOpen, setEditOpen] = useState(false);
  // See the file header: pinned to the just-deleted exit's id, independent of `exitId` (which
  // goes back to `null` the moment the drawer closes) so a later "Deshacer" always targets the
  // right row.
  const [deletedExitId, setDeletedExitId] = useState<string | null>(null);

  // `exitId ?? ""` keeps every hook call unconditional (rules of hooks) — the bogus "" id is never
  // actually exercised unless `deleteReplay.execute` runs, which only happens while `exitId` is a
  // real id (the delete button only renders once `exit` has loaded).
  const deleteMutation = useDeleteStockExit(exitId ?? "");
  const restoreMutation = useRestoreStockExit(deletedExitId ?? "");

  const restoreReplay = useReplayConfirmableMutation(restoreMutation.mutateAsync);

  const deleteReplay = useReplayConfirmableMutation(deleteMutation.mutateAsync, {
    onSuccess: () => {
      if (exitId) setDeletedExitId(exitId);
      onOpenChange(false);
      setEditOpen(false);
      toast.showUndo({
        message: inventoryLabels.exitDeletedUndo,
        actionLabel: inventoryLabels.undoExit,
        onAction: () => restoreReplay.execute({}),
      });
    },
  });

  // A restore failure that ISN'T the R-5 confirmation case (that one is handled by
  // `restoreReplay.pendingConfirmation` below) has nowhere else to surface, since the toast that
  // triggered it is long gone by the time this rejects. Deliberately depends only on the error
  // itself, not `toast` (stable per ToastProvider's own useMemo) — re-running on every render
  // would show the same toast repeatedly for as long as the error object reference is unchanged.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional, see comment above.
  useEffect(() => {
    if (restoreReplay.error) {
      toast.show({ message: inventoryLabels.restoreExitFailed });
    }
  }, [restoreReplay.error]);

  const itemById = useMemo(() => {
    const map = new Map<string, ItemDto>();
    for (const item of itemsQuery.data?.items ?? []) map.set(item.id, item);
    return map;
  }, [itemsQuery.data]);

  const exit = exitQuery.data;
  const item = exit ? itemById.get(exit.itemId) : undefined;

  return (
    <>
      <DetailDrawer
        open={open}
        onOpenChange={onOpenChange}
        title={item?.name ?? inventoryLabels.exitDetailTitle}
        subtitle={exit?.businessDate}
        footer={
          exit ? (
            <span>
              Creado {new Date(exit.createdAt).toLocaleDateString("es-BO")} · Actualizado{" "}
              {new Date(exit.updatedAt).toLocaleDateString("es-BO")}
            </span>
          ) : undefined
        }
      >
        {!exit ? (
          <p className="text-muted-foreground text-sm">{inventoryLabels.loading}</p>
        ) : (
          <div className="flex flex-col gap-5 text-sm">
            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{inventoryLabels.fieldItem}</span>
                <span className="font-medium text-foreground">{item?.name ?? exit.itemId}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{inventoryLabels.fieldQty}</span>
                <span className="numeric-cell font-medium text-foreground">
                  {item ? formatQty(exit.qty, item.unit) : exit.qty}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{inventoryLabels.fieldReason}</span>
                <span className="font-medium text-foreground">
                  {inventoryLabels.reasonLabels[exit.reason]}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {inventoryLabels.exitsColumnValuedCost}
                </span>
                <span className="numeric-cell font-medium text-foreground">
                  {formatMoney(Math.round(exit.qty * exit.unitCostSnapshot))}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="font-medium text-foreground">{inventoryLabels.fieldNotes}</span>
              <p className="text-muted-foreground">{exit.notes ?? inventoryLabels.noExitNotes}</p>
            </div>

            {deleteReplay.error ? (
              <p className="text-negative text-sm">
                {deleteReplay.error instanceof ApiError
                  ? deleteReplay.error.message
                  : inventoryLabels.errors.generic}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 border-border border-t pt-3">
              <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
                {inventoryLabels.editExit}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => deleteReplay.execute({})}
                disabled={deleteReplay.isPending}
              >
                {inventoryLabels.deleteExit}
              </Button>
            </div>
          </div>
        )}
      </DetailDrawer>

      <ExitForm open={editOpen} onOpenChange={setEditOpen} exit={exit ?? undefined} />

      {deleteReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={deleteReplay.pendingConfirmation.impact}
          onConfirm={deleteReplay.confirm}
          onCancel={deleteReplay.cancel}
          confirmLoading={deleteReplay.isPending}
          title={inventoryLabels.impactDeleteExitTitle}
          description={inventoryLabels.impactDeleteExitDescription}
        />
      ) : null}

      {restoreReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={restoreReplay.pendingConfirmation.impact}
          onConfirm={restoreReplay.confirm}
          onCancel={restoreReplay.cancel}
          confirmLoading={restoreReplay.isPending}
          title={inventoryLabels.impactRestoreExitTitle}
          description={inventoryLabels.impactRestoreExitDescription}
        />
      ) : null}
    </>
  );
}
