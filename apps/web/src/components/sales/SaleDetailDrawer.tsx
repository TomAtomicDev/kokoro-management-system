// Detail drawer for a single sale (Doc 06 §4 DetailDrawer contract). Pure display — no
// edit/delete here (core/sales has no generic update/delete yet, that's KOK-064), so this is
// simpler than PurchaseDetailDrawer.tsx: no edit button, no delete/undo dance, no
// ImpactConfirmDialog. The one KOK-031 mutation (collectPayment) lives in SalesTable's inline
// "Cobrar" action instead, not here.

import type { FinancialAccountDto, ItemDto } from "@kokoro/shared";
import { formatMoney, formatQty, mulMoneyByQty } from "@kokoro/shared";
import { useMemo } from "react";

import { DetailDrawer } from "@/components/data-table/DetailDrawer";
import { Badge } from "@/components/ui/badge";
import { useItemsQuery } from "@/features/catalog/api";
import { useSale } from "@/features/sales/api";
import { salesLabels } from "@/lib/i18n-sales";

export interface SaleDetailDrawerProps {
  saleId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: FinancialAccountDto[];
}

export function SaleDetailDrawer({ saleId, open, onOpenChange, accounts }: SaleDetailDrawerProps) {
  const saleQuery = useSale(saleId ?? undefined);
  const itemsQuery = useItemsQuery({ isActive: true });

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
  );
}
