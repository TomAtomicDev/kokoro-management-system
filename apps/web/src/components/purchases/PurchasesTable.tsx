// SC-07 purchases table: all purchases, items summary, receipt indicator, row -> detail drawer.
//
// Read + row-click only (no inline edit here) — same precedent as finance/TransactionsTable:
// editing a recorded purchase has no API yet (KOK-024's job).

import type { FinancialAccountDto, PurchaseDto, PurchaseLineDto } from "@kokoro/shared";
import { formatMoney } from "@kokoro/shared";
import { Paperclip } from "lucide-react";
import { useMemo } from "react";

import { EventTable, type EventTableColumn } from "@/components/data-table/EventTable";
import { useItemsQuery } from "@/features/catalog/api";
import { purchasesLabels } from "@/lib/i18n-purchases";

export interface PurchasesTableProps {
  purchases: PurchaseDto[];
  accounts: FinancialAccountDto[];
  loading?: boolean;
  onRowClick?: (purchase: PurchaseDto) => void;
}

function summarizeLines(lines: PurchaseLineDto[], itemNameById: Map<string, string>): string {
  const firstLine = lines[0];
  if (!firstLine) return "—";
  const firstName = itemNameById.get(firstLine.itemId) ?? firstLine.itemId;
  return lines.length > 1
    ? `${firstName} ${purchasesLabels.itemsSummaryMore(lines.length - 1)}`
    : firstName;
}

export function PurchasesTable({ purchases, accounts, loading, onRowClick }: PurchasesTableProps) {
  // Same query key ItemPicker/PurchaseForm use for their own item lookups — TanStack Query dedups
  // identical keys, so this doesn't add a second network round-trip in the common case where the
  // form has already been opened once.
  const itemsQuery = useItemsQuery({ isActive: true });

  const accountNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of accounts) map.set(account.id, account.name);
    return map;
  }, [accounts]);

  const itemNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of itemsQuery.data?.items ?? []) map.set(item.id, item.name);
    return map;
  }, [itemsQuery.data]);

  const columns: EventTableColumn<PurchaseDto>[] = [
    {
      id: "date",
      header: purchasesLabels.columnDate,
      cell: (row) => row.businessDate,
    },
    {
      id: "supplier",
      header: purchasesLabels.columnSupplier,
      cell: (row) => row.supplierName ?? purchasesLabels.noSupplier,
    },
    {
      id: "items",
      header: purchasesLabels.columnItems,
      cell: (row) => summarizeLines(row.lines, itemNameById),
    },
    {
      id: "total",
      header: purchasesLabels.columnTotal,
      numeric: true,
      cell: (row) => formatMoney(row.total),
    },
    {
      id: "account",
      header: purchasesLabels.columnAccount,
      cell: (row) => accountNameById.get(row.accountId) ?? row.accountId,
    },
    {
      id: "photo",
      header: purchasesLabels.columnPhoto,
      cell: (row) =>
        row.receiptPhotoKey ? (
          <span title={purchasesLabels.detailPhoto} className="inline-flex text-muted-foreground">
            <Paperclip className="size-4" />
          </span>
        ) : (
          <span className="text-subtle-foreground">—</span>
        ),
    },
  ];

  return (
    <EventTable
      columns={columns}
      rows={purchases}
      getRowId={(row) => row.id}
      onRowClick={onRowClick}
      emptyMessage={purchasesLabels.noPurchases}
      loading={loading}
      loadingMessage={purchasesLabels.loading}
    />
  );
}
