// SC-02 sales table: all sales, items summary, margin (read-only display math off
// `unit_cost_snapshot` vs `unit_price`, never fed back into any command — D-5's integer-money
// rule governs values that get WRITTEN, this is display-only, same carve-out the task brief calls
// out explicitly), payment-status badge, row -> detail drawer.
//
// Read + row-click only (no inline edit/mark-paid here) — core/sales has no update/collectPayment
// yet (KOK-031), same precedent as PurchasesTable's "no inline edit" header comment.

import type { SaleDto, SaleLineDto } from "@kokoro/shared";
import { formatMoney, roundHalfUpToInt, subMoney } from "@kokoro/shared";
import { useMemo } from "react";

import { EventTable, type EventTableColumn } from "@/components/data-table/EventTable";
import { Badge } from "@/components/ui/badge";
import { useItemsQuery } from "@/features/catalog/api";
import { salesLabels } from "@/lib/i18n-sales";

export interface SalesTableProps {
  sales: SaleDto[];
  loading?: boolean;
  onRowClick?: (sale: SaleDto) => void;
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

export function SalesTable({ sales, loading, onRowClick }: SalesTableProps) {
  const itemsQuery = useItemsQuery({ isActive: true });
  const itemNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of itemsQuery.data?.items ?? []) map.set(item.id, item.name);
    return map;
  }, [itemsQuery.data]);

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
      cell: (row) => row.customerId ?? salesLabels.noCustomer,
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
  ];

  return (
    <EventTable
      columns={columns}
      rows={sales}
      getRowId={(row) => row.id}
      onRowClick={onRowClick}
      emptyMessage={salesLabels.noSales}
      loading={loading}
      loadingMessage={salesLabels.loading}
    />
  );
}
