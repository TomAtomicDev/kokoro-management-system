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
import { formatMoney, roundHalfUpToInt, subMoney } from "@kokoro/shared";
import { useMemo, useState } from "react";
import { EventTable, type EventTableColumn } from "@/components/data-table/EventTable";
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
 * since the sale) — `total` is the server-recomputed Σ(qty×unitPrice) (Doc 04 §5), `cost` sums
 * each line's `qty × unitCostSnapshot` (same basis ProductionRunForm's `renderLineExtra` uses for
 * `qty × item.wac`: qty is milli-units, unitCostSnapshot is centavos-per-milli-unit, so the
 * product is already whole centavos, no ×1000 conversion). Returns `null` margin% when the sale
 * has zero total (an all-giveaway sale) — a percentage of zero is not meaningful. */
function computeMargin(sale: SaleDto): { margin: number; marginPct: number | null } {
  let cost = 0;
  for (const line of sale.lines) {
    cost += roundHalfUpToInt(line.qty * line.unitCostSnapshot);
  }
  const margin = subMoney(sale.total, cost);
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
      id: "date",
      header: salesLabels.columnDate,
      cell: (row) => row.businessDate,
    },
    {
      id: "channel",
      header: salesLabels.columnChannel,
      cell: (row) => salesLabels.channelLabels[row.channel],
    },
    {
      id: "customer",
      header: salesLabels.columnCustomer,
      cell: (row) =>
        row.customerId
          ? (customerNameById.get(row.customerId) ?? row.customerId)
          : salesLabels.noCustomer,
    },
    {
      id: "items",
      header: salesLabels.columnItems,
      cell: (row) => summarizeLines(row.lines, itemNameById),
    },
    {
      id: "total",
      header: salesLabels.columnTotal,
      numeric: true,
      cell: (row) => formatMoney(row.total),
    },
    {
      id: "margin",
      header: salesLabels.columnMargin,
      numeric: true,
      cell: (row) => {
        const { margin, marginPct } = computeMargin(row);
        return (
          <span>
            {formatMoney(margin)}
            {marginPct !== null ? (
              <span className="text-muted-foreground"> ({formatPercent(marginPct)})</span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "status",
      header: salesLabels.columnStatus,
      cell: (row) => (
        <Badge variant={row.paymentStatus === "PAID" ? "default" : "warning"}>
          {salesLabels.paymentStatusLabels[row.paymentStatus]}
        </Badge>
      ),
    },
    {
      id: "method",
      header: salesLabels.columnMethod,
      cell: (row) => (row.paymentMethod ? salesLabels.paymentMethodLabels[row.paymentMethod] : "—"),
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
