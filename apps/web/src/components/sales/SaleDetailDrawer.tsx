// Detail drawer for a single sale (Doc 06 §4 DetailDrawer contract). KOK-064 adds edit (opens
// `SaleForm` in edit mode as a sibling dialog) and delete (soft delete + undo toast per Doc 06
// principle 6, with the ImpactConfirmDialog exception for an R-5 replay-affecting delete/restore)
// — mirrors PurchaseDetailDrawer.tsx's identical KOK-024 Phase G shape. The one KOK-031 mutation
// (collectPayment) still lives in SalesTable's inline "Cobrar" action, not here.

import type {
  DeleteSaleCommand,
  DeleteSaleResult,
  FinancialAccountDto,
  ItemDto,
  UpdateSaleResult,
} from "@kokoro/shared";
import { formatMoney, formatQty, mulMoneyByQty } from "@kokoro/shared";
import { useMemo, useState } from "react";

import { DetailDrawer } from "@/components/data-table/DetailDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImpactConfirmDialog } from "@/components/ui/ImpactConfirmDialog";
import { useToast } from "@/components/ui/toast";
import { useItemsQuery } from "@/features/catalog/api";
import { useDeleteSale, useRestoreSale, useSale } from "@/features/sales/api";
import { useReplayConfirmableMutation } from "@/hooks/useReplayConfirmableMutation";
import { salesLabels } from "@/lib/i18n-sales";

import { SaleForm } from "./SaleForm";

export interface SaleDetailDrawerProps {
  saleId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: FinancialAccountDto[];
}

export function SaleDetailDrawer({ saleId, open, onOpenChange, accounts }: SaleDetailDrawerProps) {
  const saleQuery = useSale(saleId ?? undefined);
  const itemsQuery = useItemsQuery({ isActive: true });
  const { showUndo } = useToast();

  const [editOpen, setEditOpen] = useState(false);
  // Frozen at the moment delete succeeds — see deleteReplay's onSuccess below. The restore mutation
  // is deliberately built from THIS, never from the live `saleId` prop — same bug precedent
  // PurchaseDetailDrawer.tsx's identical comment documents (ProductionRunDetailDrawer, KOK-026):
  // `onOpenChange(false)` closes the drawer as part of the same onSuccess, which flips `saleId` to
  // `null` on the parent's next render, and a restore mutation built from the live prop would close
  // over an empty id by the time the owner clicks "Deshacer".
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);

  // Called unconditionally (rules of hooks) with "" when nothing is selected yet — never actually
  // invoked in that state, since the buttons that call `execute`/`confirm` only render once `sale`
  // (below) is loaded.
  const deleteMutation = useDeleteSale(saleId ?? "");
  const restoreMutation = useRestoreSale(pendingRestoreId ?? "");

  const restoreReplay = useReplayConfirmableMutation<DeleteSaleCommand, UpdateSaleResult>(
    (command) => restoreMutation.mutateAsync(command),
  );

  const deleteReplay = useReplayConfirmableMutation<DeleteSaleCommand, DeleteSaleResult>(
    (command) => deleteMutation.mutateAsync(command),
    {
      onSuccess: () => {
        setPendingRestoreId(saleId);
        onOpenChange(false);
        showUndo({
          message: salesLabels.deletedUndo,
          actionLabel: salesLabels.undo,
          onAction: () => restoreReplay.execute({}),
        });
      },
    },
  );

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

  if (!saleId) return null;
  const sale = saleQuery.data;

  return (
    <>
      <DetailDrawer
        open={open}
        onOpenChange={onOpenChange}
        title={salesLabels.detailTitle}
        subtitle={sale?.businessDate}
        entityType="sales"
        entityId={sale?.id}
        footer={
          sale ? (
            <span>
              Creado {new Date(sale.createdAt).toLocaleDateString("es-BO")} · Actualizado{" "}
              {new Date(sale.updatedAt).toLocaleDateString("es-BO")}
            </span>
          ) : undefined
        }
      >
        {!sale ? (
          <p className="text-muted-foreground text-sm">{salesLabels.loading}</p>
        ) : (
          <div className="flex flex-col gap-5 text-sm">
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                {salesLabels.edit}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => deleteReplay.execute({})}
                disabled={deleteReplay.isPending}
              >
                {salesLabels.delete}
              </Button>
            </div>

            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{salesLabels.columnStatus}</span>
                <Badge variant={sale.paymentStatus === "PAID" ? "default" : "warning"}>
                  {salesLabels.paymentStatusLabels[sale.paymentStatus]}
                </Badge>
              </div>
              {sale.paymentMethod ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{salesLabels.columnMethod}</span>
                  <span className="font-medium text-foreground">
                    {salesLabels.paymentMethodLabels[sale.paymentMethod]}
                  </span>
                </div>
              ) : null}
              {sale.accountId ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{salesLabels.fieldAccount}</span>
                  <span className="font-medium text-foreground">
                    {accountNameById.get(sale.accountId) ?? sale.accountId}
                  </span>
                </div>
              ) : null}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{salesLabels.columnTotal}</span>
                <span className="numeric-cell font-medium text-foreground">
                  {formatMoney(sale.total)}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="font-medium text-foreground">{salesLabels.detailLines}</span>
              <ul className="flex flex-col gap-2">
                {sale.lines.map((line) => {
                  const item = itemById.get(line.itemId);
                  const subtotal = mulMoneyByQty(line.unitPrice, line.qty);
                  return (
                    <li
                      key={line.id}
                      className="flex flex-col gap-1 rounded-md border border-border px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">
                          {item?.name ?? line.itemId}
                        </span>
                        <span className="numeric-cell font-medium">{formatMoney(subtotal)}</span>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground text-xs">
                        <span>{item ? formatQty(line.qty, item.unit) : line.qty}</span>
                        <span className="numeric-cell">{formatMoney(line.unitPrice)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="flex flex-col gap-1">
              <span className="font-medium text-foreground">{salesLabels.fieldNotes}</span>
              <p className="text-muted-foreground">{sale.notes ?? salesLabels.noNotes}</p>
            </div>
          </div>
        )}
      </DetailDrawer>

      {sale ? (
        <SaleForm open={editOpen} onOpenChange={setEditOpen} accounts={accounts} sale={sale} />
      ) : null}

      {deleteReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={deleteReplay.pendingConfirmation.impact}
          onConfirm={deleteReplay.confirm}
          onCancel={deleteReplay.cancel}
          confirmLoading={deleteReplay.isPending}
          title={salesLabels.impactDeleteTitle}
          description={salesLabels.impactDeleteDescription}
        />
      ) : null}

      {restoreReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={restoreReplay.pendingConfirmation.impact}
          onConfirm={restoreReplay.confirm}
          onCancel={restoreReplay.cancel}
          confirmLoading={restoreReplay.isPending}
          title={salesLabels.impactRestoreTitle}
          description={salesLabels.impactRestoreDescription}
        />
      ) : null}
    </>
  );
}
