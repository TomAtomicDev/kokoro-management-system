// SC-02 sales table: all sales, items summary, product gross margin from frozen line COGS (excluding
// a CUSTOM_ORDER's separately quoted additional charge), catalog-sale payment badge, row -> detail.
//
// Row-click still opens the read-only detail drawer (no inline edit here — that's KOK-064). The
// one inline action this table DOES have (KOK-031, UC-04) is "Cobrar" on ON_CREDIT rows, opening
// CollectPaymentDialog; its button stops click propagation so it doesn't also trigger the row's
// onRowClick. CUSTOM_ORDER compatibility payment state is never presented as its current order debt;
// KOK-206/207 reconcile those reads to independent order receipts.

import type { FinancialAccountDto, SaleDto, SaleLineDto } from "@kokoro/shared";
import { calculateSaleProductGrossMargin, formatMoney, subMoney, toCentavos } from "@kokoro/shared";
import { useMemo, useState } from "react";
import {
  EventTable,
  type EventTableColumn,
  type EventTableSortState,
} from "@/components/data-table/EventTable";
import { CollectPaymentDialog } from "@/components/sales/CollectPaymentDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useItemsQuery } from "@/features/catalog/api";
import { useCustomersQuery } from "@/features/customers/api";
import { salesLabels } from "@/lib/i18n-sales";

export interface SalesTableProps {
  sales: SaleDto[];
  accounts: FinancialAccountDto[];
  loading?: boolean;
  onRowClick?: (sale: SaleDto) => void;
  /** Legacy receivable amounts keyed by sale id; only CATALOG sale rows expose the collection action. */
  outstandingAmountBySaleId?: Map<string, number>;
  sortState: EventTableSortState | null;
  onSortChange: (sortState: EventTableSortState | null) => void;
}

function summarizeLines(lines: SaleLineDto[], itemNameById: Map<string, string>): string {
  const firstLine = lines[0];
  if (!firstLine) return "—";
  const firstName = itemNameById.get(firstLine.itemId) ?? firstLine.itemId;
  return lines.length > 1
    ? `${firstName} ${salesLabels.itemsSummaryMore(lines.length - 1)}`
    : firstName;
}

/** Product gross margin off frozen WAC snapshots (never live WAC); the order charge stays outside
 * both the margin amount and its percentage base. Returns `null` margin% when product sales are 0. */
function computeMargin(sale: SaleDto): { margin: number; marginPct: number | null } {
  const merchandiseTotal = subMoney(toCentavos(sale.total), toCentavos(sale.additionalCharge));
  const margin = calculateSaleProductGrossMargin(sale);
  const marginPct = merchandiseTotal > 0 ? margin / merchandiseTotal : null;
  return { margin, marginPct };
}

/** Plain display formatting for a 0..1 ratio -> "35%" (es-BO has no decimal here, whole percent is
 * enough precision for a table cell) — not a money/basis-points value, so money.ts doesn't apply. */
function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function SalesTable({
  sales,
  accounts,
  loading,
  onRowClick,
  outstandingAmountBySaleId,
  sortState,
  onSortChange,
}: SalesTableProps) {
  const itemsQuery = useItemsQuery({ isActive: true });
  const itemNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of itemsQuery.data?.items ?? []) map.set(item.id, item.name);
    return map;
  }, [itemsQuery.data]);

  const customersQuery = useCustomersQuery();
  const customerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const customer of customersQuery.data?.customers ?? [])
      map.set(customer.id, customer.name);
    return map;
  }, [customersQuery.data]);

  const [collectingSale, setCollectingSale] = useState<{
    id: string;
    total: number;
    outstandingAmount?: number;
  } | null>(null);

  const columns: EventTableColumn<SaleDto>[] = [
    {
      id: "code",
      header: salesLabels.columnCode,
      isRowIdentifier: true,
      cell: (row) => row.code ?? row.id,
      sortable: true,
      sortValue: (row) => row.code,
    },
    {
      id: "date",
      header: salesLabels.columnDate,
      cell: (row) => row.businessDate,
      sortable: true,
      sortValue: (row) => row.businessDate,
    },
    {
      id: "channel",
      header: salesLabels.columnChannel,
      cell: (row) => salesLabels.channelLabels[row.channel],
      sortable: true,
      sortValue: (row) => salesLabels.channelLabels[row.channel],
    },
    {
      id: "customer",
      header: salesLabels.columnCustomer,
      cell: (row) =>
        row.customerId
          ? (customerNameById.get(row.customerId) ?? row.customerId)
          : salesLabels.noCustomer,
      sortable: true,
      sortValue: (row) =>
        row.customerId
          ? (customerNameById.get(row.customerId) ?? row.customerId)
          : salesLabels.noCustomer,
    },
    {
      id: "items",
      header: salesLabels.columnItems,
      cell: (row) => summarizeLines(row.lines, itemNameById),
      sortable: true,
      sortValue: (row) => summarizeLines(row.lines, itemNameById),
    },
    {
      id: "total",
      header: salesLabels.columnTotal,
      numeric: true,
      cell: (row) => formatMoney(toCentavos(row.total)),
      sortable: true,
      sortValue: (row) => row.total,
    },
    {
      id: "margin",
      header: salesLabels.columnMargin,
      numeric: true,
      cell: (row) => {
        const { margin, marginPct } = computeMargin(row);
        return (
          <span>
            {formatMoney(toCentavos(margin))}
            {marginPct !== null ? (
              <span className="text-muted-foreground"> ({formatPercent(marginPct)})</span>
            ) : null}
          </span>
        );
      },
      sortable: true,
      sortValue: (row) => computeMargin(row).margin,
    },
    {
      id: "status",
      header: salesLabels.columnStatus,
      cell: (row) =>
        row.channel === "CUSTOM_ORDER" ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Badge variant={row.paymentStatus === "PAID" ? "default" : "warning"}>
            {salesLabels.paymentStatusLabels[row.paymentStatus]}
          </Badge>
        ),
      sortable: true,
      sortValue: (row) =>
        row.channel === "CUSTOM_ORDER" ? "—" : salesLabels.paymentStatusLabels[row.paymentStatus],
    },
    {
      id: "method",
      header: salesLabels.columnMethod,
      cell: (row) => (row.paymentMethod ? salesLabels.paymentMethodLabels[row.paymentMethod] : "—"),
      sortable: true,
      sortValue: (row) =>
        row.paymentMethod
          ? salesLabels.paymentMethodLabels[row.paymentMethod]
          : salesLabels.noCustomer,
    },
    {
      id: "actions",
      header: "",
      cell: (row) =>
        row.channel === "CATALOG" && row.paymentStatus === "ON_CREDIT" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              setCollectingSale({
                id: row.id,
                total: row.total,
                outstandingAmount: outstandingAmountBySaleId?.get(row.id),
              });
            }}
          >
            {salesLabels.actionCollect}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <EventTable
        columns={columns}
        rows={sales}
        getRowId={(row) => row.id}
        onRowClick={onRowClick}
        emptyMessage={salesLabels.noSales}
        loading={loading}
        loadingMessage={salesLabels.loading}
        sortState={sortState}
        onSortChange={onSortChange}
      />
      <CollectPaymentDialog
        sale={collectingSale}
        outstandingAmount={collectingSale?.outstandingAmount}
        accounts={accounts}
        open={collectingSale !== null}
        onOpenChange={(open) => {
          if (!open) setCollectingSale(null);
        }}
      />
    </>
  );
}
