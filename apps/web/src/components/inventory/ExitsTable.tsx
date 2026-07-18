// SC-08 Salidas tab table: `stock_exits` rows (KOK-018). Item name/unit are resolved via a
// caller-supplied id -> ItemDto lookup rather than fetched per-row, mirroring how
// PurchasesTable/TransactionsTable resolve foreign names via a passed-in lookup instead of N+1
// fetching (see routes/inventory.tsx for how the lookup Map is built from useItemsQuery).

import type { StockExitDto, Unit } from "@kokoro/shared";
import { formatMoney, formatQty } from "@kokoro/shared";

import { EventTable, type EventTableColumn } from "@/components/data-table/EventTable";
import { inventoryLabels } from "@/lib/i18n-inventory";

export interface ExitsTableProps {
  rows: StockExitDto[];
  /** itemId -> { name, unit }, built by the caller from useItemsQuery (see routes/inventory.tsx).
   * An id missing from the map (e.g. a since-merged or otherwise unresolvable item) falls back to
   * "—" for the name and a bare milli-unit count is avoided by defaulting to UNIT for formatQty —
   * acceptable per the task's own guidance not to over-engineer this fallback. */
  items: Map<string, { name: string; unit: Unit }>;
  loading?: boolean;
}

export function ExitsTable({ rows, items, loading }: ExitsTableProps) {
  const columns: EventTableColumn<StockExitDto>[] = [
    {
      id: "date",
      header: inventoryLabels.exitsColumnDate,
      cell: (row) => row.businessDate,
    },
    {
      id: "item",
      header: inventoryLabels.exitsColumnItem,
      cell: (row) => items.get(row.itemId)?.name ?? "—",
    },
    {
      id: "qty",
      header: inventoryLabels.exitsColumnQty,
      numeric: true,
      cell: (row) => {
        const unit = items.get(row.itemId)?.unit ?? "UNIT";
        return formatQty(row.qty, unit);
      },
    },
    {
      id: "reason",
      header: inventoryLabels.exitsColumnReason,
      cell: (row) => inventoryLabels.reasonLabels[row.reason],
    },
    {
      id: "valuedCost",
      header: inventoryLabels.exitsColumnValuedCost,
      numeric: true,
      // unitCostSnapshot is centavos-per-milli-unit (Doc 04 §3.4) and qty is milli-units, so their
      // direct product is already centavos — no ×1000 conversion, unlike a per-whole-unit DISPLAY
      // price. This mirrors core/inventory/movements.ts's `total_cost = qty × unit_cost` formula
      // for `stock_movements` exactly (see that file's comment on the INSERT builder).
      cell: (row) => formatMoney(Math.round(row.qty * row.unitCostSnapshot)),
    },
  ];

  return (
    <EventTable
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      emptyMessage={inventoryLabels.noExits}
      loading={loading}
      loadingMessage={inventoryLabels.loading}
    />
  );
}
