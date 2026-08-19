// SC-08 Salidas tab table: `stock_exits` rows (KOK-018). Item name/unit are resolved via a
// caller-supplied id -> ItemDto lookup rather than fetched per-row, mirroring how
// PurchasesTable/TransactionsTable resolve foreign names via a passed-in lookup instead of N+1
// fetching (see routes/inventory.tsx for how the lookup Map is built from useItemsQuery).

import type { StockExitDto, Unit } from "@kokoro/shared";
import {
  formatMoney,
  formatQty,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
} from "@kokoro/shared";

import {
  EventTable,
  type EventTableColumn,
  type EventTableSortState,
} from "@/components/data-table/EventTable";
import { inventoryLabels } from "@/lib/i18n-inventory";

export interface ExitsTableProps {
  rows: StockExitDto[];
  /** itemId -> { name, unit }, built by the caller from useItemsQuery (see routes/inventory.tsx).
   * An id missing from the map (e.g. a since-merged or otherwise unresolvable item) falls back to
   * "—" for the name and a bare milli-unit count is avoided by defaulting to UNIT for formatQty —
   * acceptable per the task's own guidance not to over-engineer this fallback. */
  items: Map<string, { name: string; unit: Unit }>;
  loading?: boolean;
  /** Row -> detail drawer (KOK-024 Phase G) — same optional-prop precedent as PurchasesTable's. */
  onRowClick?: (row: StockExitDto) => void;
  sortState: EventTableSortState | null;
  onSortChange: (sortState: EventTableSortState | null) => void;
}

export function ExitsTable({
  rows,
  items,
  loading,
  onRowClick,
  sortState,
  onSortChange,
}: ExitsTableProps) {
  const columns: EventTableColumn<StockExitDto>[] = [
    {
      id: "code",
      header: inventoryLabels.exitsColumnCode,
      isRowIdentifier: true,
      cell: (row) => row.code ?? row.id,
      sortable: true,
      sortValue: (row) => row.code,
    },
    {
      id: "date",
      header: inventoryLabels.exitsColumnDate,
      cell: (row) => row.businessDate,
      sortable: true,
      sortValue: (row) => row.businessDate,
    },
    {
      id: "item",
      header: inventoryLabels.exitsColumnItem,
      cell: (row) => items.get(row.itemId)?.name ?? "—",
      sortable: true,
      sortValue: (row) => items.get(row.itemId)?.name ?? "—",
    },
    {
      id: "qty",
      header: inventoryLabels.exitsColumnQty,
      numeric: true,
      cell: (row) => {
        const unit = items.get(row.itemId)?.unit ?? "UNIT";
        return formatQty(row.qty, unit);
      },
      sortable: true,
      sortValue: (row) => row.qty,
    },
    {
      id: "reason",
      header: inventoryLabels.exitsColumnReason,
      cell: (row) => inventoryLabels.reasonLabels[row.reason],
      sortable: true,
      sortValue: (row) => inventoryLabels.reasonLabels[row.reason],
    },
    {
      id: "valuedCost",
      header: inventoryLabels.exitsColumnValuedCost,
      numeric: true,
      // Keep the preview on the same sanctioned rate-to-total conversion as core inventory.
      cell: (row) =>
        formatMoney(
          totalCentavos(toMilliCentavosPerUnit(row.unitCostSnapshotMc), toMilliUnits(row.qty)),
        ),
      sortable: true,
      sortValue: (row) =>
        totalCentavos(toMilliCentavosPerUnit(row.unitCostSnapshotMc), toMilliUnits(row.qty)),
    },
  ];

  return (
    <EventTable
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      onRowClick={onRowClick}
      emptyMessage={inventoryLabels.noExits}
      loading={loading}
      loadingMessage={inventoryLabels.loading}
      sortState={sortState}
      onSortChange={onSortChange}
    />
  );
}
