// SC-08 Stock tab table: `v_stock` rows, pre-sorted server-side (negative-first, then low-stock,
// then by name â€” see packages/shared/src/inventory-views.ts) so no client-side re-sort is needed.
// Row click opens the Kardex drawer for that item.
//
// WAC and replacement cost are both integer milli-centavos per WHOLE unit (ADR-017), so both
// columns go through the shared `totalCentavos` formatter below. `stockValue` is a plain INTEGER
// centavos column (Doc 04 §3.4), so it needs no conversion.

import type { StockRowDto } from "@kokoro/shared";
import {
  formatMoney,
  formatQty,
  toCentavos,
  toMilliCentavosPerUnit,
  totalCentavos,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";
import { CalcTrace } from "@/components/common/CalcTrace";
import {
  EventTable,
  type EventTableColumn,
  type EventTableSortState,
} from "@/components/data-table/EventTable";
import { Badge } from "@/components/ui/badge";
import { inventoryLabels } from "@/lib/i18n-inventory";
import { cn } from "@/lib/utils";

export interface StockTableProps {
  rows: StockRowDto[];
  loading?: boolean;
  onRowClick?: (row: StockRowDto) => void;
  sortState: EventTableSortState | null;
  onSortChange: (sortState: EventTableSortState | null) => void;
}

/** ADR-017: both rates are integer milli-centavos per WHOLE unit. */
function formatUnitCostMc(rateMc: number, unit: StockRowDto["unit"]): string {
  return `${formatMoney(totalCentavos(toMilliCentavosPerUnit(rateMc), WHOLE_UNIT_MILLI_UNITS))} / ${inventoryLabels.unitAbbrev[unit]}`;
}

export function StockTable({
  rows,
  loading,
  onRowClick,
  sortState,
  onSortChange,
}: StockTableProps) {
  const columns: EventTableColumn<StockRowDto>[] = [
    {
      id: "name",
      header: inventoryLabels.columnName,
      isRowIdentifier: true,
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{row.name}</span>
          {row.negativeSince ? (
            <Badge variant="negative">{inventoryLabels.flagNegative}</Badge>
          ) : row.isLowStock ? (
            <Badge variant="warning">{inventoryLabels.flagLowStock}</Badge>
          ) : null}
        </div>
      ),
      sortable: true,
      sortValue: (row) => row.name,
    },
    {
      id: "kind",
      header: inventoryLabels.columnKind,
      cell: (row) => inventoryLabels.kindLabels[row.kind],
      sortable: true,
      sortValue: (row) => inventoryLabels.kindLabels[row.kind],
    },
    {
      id: "category",
      header: inventoryLabels.columnCategory,
      cell: (row) => inventoryLabels.categoryLabels[row.category],
      sortable: true,
      sortValue: (row) => inventoryLabels.categoryLabels[row.category],
    },
    {
      id: "unit",
      header: inventoryLabels.columnUnit,
      cell: (row) => inventoryLabels.unitAbbrev[row.unit],
      sortable: true,
      sortValue: (row) => inventoryLabels.unitAbbrev[row.unit],
    },
    {
      id: "onHand",
      header: inventoryLabels.columnOnHand,
      numeric: true,
      cell: (row) => (
        <span className={cn(row.negativeSince && "text-negative font-medium")}>
          {formatQty(row.qtyOnHand, row.unit)}
        </span>
      ),
      sortable: true,
      sortValue: (row) => row.qtyOnHand,
    },
    {
      id: "minStock",
      header: inventoryLabels.columnMinStock,
      numeric: true,
      cell: (row) => (row.minStockQty === null ? "—" : formatQty(row.minStockQty, row.unit)),
      sortable: true,
      sortValue: (row) => row.minStockQty,
    },
    {
      id: "wac",
      header: inventoryLabels.columnWac,
      numeric: true,
      cell: (row) => formatUnitCostMc(row.wacMc, row.unit),
      sortable: true,
      sortValue: (row) => row.wacMc,
    },
    {
      id: "replacementCostMc",
      header: inventoryLabels.columnReplacementCost,
      numeric: true,
      cell: (row) => formatUnitCostMc(row.replacementCostMc, row.unit),
      sortable: true,
      sortValue: (row) => row.replacementCostMc,
    },
    {
      id: "stockValue",
      header: inventoryLabels.columnStockValue,
      numeric: true,
      cell: (row) => (
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-medium">{formatMoney(toCentavos(row.stockValue))}</span>
          <CalcTrace
            formula={inventoryLabels.stockValueFormula}
            inputs={[
              { label: inventoryLabels.columnOnHand, value: formatQty(row.qtyOnHand, row.unit) },
              { label: inventoryLabels.columnWac, value: formatUnitCostMc(row.wacMc, row.unit) },
            ]}
          />
        </div>
      ),
      sortable: true,
      sortValue: (row) => row.stockValue,
    },
  ];

  return (
    <EventTable
      columns={columns}
      rows={rows}
      getRowId={(row) => row.itemId}
      onRowClick={onRowClick}
      emptyMessage={inventoryLabels.noStock}
      loading={loading}
      loadingMessage={inventoryLabels.loading}
      sortState={sortState}
      onSortChange={onSortChange}
    />
  );
}
