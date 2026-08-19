// SC-02 sales table: all sales, items summary, margin (read-only display math off
// `unit_cost_snapshot` vs `unit_price`, never fed back into any command — D-5's integer-money
// rule governs values that get WRITTEN, this is display-only, same carve-out the task brief calls
// out explicitly), payment-status badge, row -> detail drawer.
//
// Row-click still opens the read-only detail drawer (no inline edit here — that's KOK-064). The
// one inline action this table DOES have (KOK-031, UC-04) is "Cobrar" on ON_CREDIT rows, opening
// CollectPaymentDialog; its button stops click propagation so it doesn't also trigger the row's
// onRowClick. `daysOutstandingBySaleId` is optional and only populated by the "Por cobrar" preset
// (routes/sales.tsx, from v_receivables) — a plain sales list has no aging to show.

import type { FinancialAccountDto, SaleDto, SaleLineDto } from "@kokoro/shared";
import {
  formatMoney,
  subMoney,
  toCentavos,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
} from "@kokoro/shared";
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
  /** `daysOutstanding` keyed by sale id, from `v_receivables` — present only while the "Por
   * cobrar" filter preset is active (routes/sales.tsx). */
  daysOutstandingBySaleId?: Map<string, number>;
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

/** Margin off the frozen WAC snapshot per line (never the item's LIVE wac, which may have moved
 * since the sale). Each line uses `totalCentavos`, matching the server's ADR-017 conversion.
 * Returns `null` margin% when the sale has zero total. */
function computeMargin(sale: SaleDto): { margin: number; marginPct: number | null } {
  let cost = 0;
  for (const line of sale.lines) {
    cost += totalCentavos(toMilliCentavosPerUnit(line.unitCostSnapshotMc), toMilliUnits(line.qty));
  }
  const margin = subMoney(toCentavos(sale.total), toCentavos(cost));
  const marginPct = sale.total > 0 ? margin / sale.total : null;
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
  daysOutstandingBySaleId,
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

  const [collectingSale, setCollectingSale] = useState<SaleDto | null>(null);

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
      cell: (row) => (
        <Badge variant={row.paymentStatus === "PAID" ? "default" : "warning"}>
          {salesLabels.paymentStatusLabels[row.paymentStatus]}
        </Badge>
      ),
      sortable: true,
      sortValue: (row) => salesLabels.paymentStatusLabels[row.paymentStatus],
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
    ...(daysOutstandingBySaleId
      ? [
          {
            id: "daysOutstanding",
            header: salesLabels.columnDaysOutstanding,
            numeric: true,
            cell: (row) => {
              const days = daysOutstandingBySaleId.get(row.id);
              return days === undefined ? "—" : salesLabels.daysOutstandingValue(days);
            },
            sortable: true,
            sortValue: (row) => daysOutstandingBySaleId.get(row.id),
          } satisfies EventTableColumn<SaleDto>,
        ]
      : []),
    {
      id: "actions",
      header: "",
      cell: (row) =>
        row.paymentStatus === "ON_CREDIT" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              setCollectingSale(row);
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
        accounts={accounts}
        open={collectingSale !== null}
        onOpenChange={(open) => {
          if (!open) setCollectingSale(null);
        }}
      />
    </>
  );
}
