// View-only detail drawer for a single purchase (Doc 06 §4 DetailDrawer contract). No edit here —
// same precedent as catalog/finance: KOK-024's job, not this one.

import type { FinancialAccountDto, ItemDto } from "@kokoro/shared";
import { formatMoney, formatQty } from "@kokoro/shared";
import { useMemo } from "react";

import { DetailDrawer } from "@/components/data-table/DetailDrawer";
import { useItemsQuery } from "@/features/catalog/api";
import { usePurchase } from "@/features/purchases/api";
import { purchasesLabels } from "@/lib/i18n-purchases";

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
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={purchase?.supplierName ?? purchasesLabels.detailTitle}
      subtitle={purchase?.businessDate}
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
                const unitCost = line.qty > 0 ? line.lineTotal / line.qty : null;
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
                      {item && unitCost !== null ? (
                        <span className="numeric-cell">
                          {purchasesLabels.unitCostLabel}:{" "}
                          {formatMoney(Math.round(unitCost * 1000))} /{" "}
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
  );
}
