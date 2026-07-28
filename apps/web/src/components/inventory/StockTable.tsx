// SC-08 Stock tab table: `v_stock` rows, pre-sorted server-side (negative-first, then low-stock,
// then by name â€” see packages/shared/src/inventory-views.ts) so no client-side re-sort is needed.
// Row click opens the Kardex drawer for that item.
//
// wac/replacementCostMc display: KOK-071 (ADR-017) migrated `wac` to the integer milli-centavos-
// per-WHOLE-unit scale (`wacMc`, Ã·1000 to display as centavos) â€” `replacementCostMc` is not migrated
// yet and stays the pre-migration REAL centavos-per-MILLI-unit scale (`Ã—1000` to display), the
// same scale ItemForm.tsx still displays via `formatMoney(Math.round(value * 1000))`. The two
// columns therefore use different formatters below until replacementCostMc's own KOK-071 vertical
// lands. `stockValue` itself is already a plain INTEGER centavos column (Doc 04 Â§3.4
// `stock_value INTEGER`), so it needs no such conversion.

import type { StockRowDto } from "@kokoro/shared";
import {
  formatMoney,
  formatQty,
  toMilliCentavosPerUnit,
  totalCentavos,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";
import { CalcTrace } from "@/components/common/CalcTrace";
import { EventTable, type EventTableColumn } from "@/components/data-table/EventTable";
import { Badge } from "@/components/ui/badge";
import { inventoryLabels } from "@/lib/i18n-inventory";
import { cn } from "@/lib/utils";

export interface StockTableProps {
  rows: StockRowDto[];
  loading?: boolean;
  onRowClick?: (row: StockRowDto) => void;
}

/** ADR-017/KOK-071: both rates are integer milli-centavos per WHOLE unit. */
function formatUnitCostMc(rateMc: number, unit: StockRowDto["unit"]): string {
  return `${formatMoney(totalCentavos(toMilliCentavosPerUnit(rateMc), WHOLE_UNIT_MILLI_UNITS))} / ${inventoryLabels.unitAbbrev[unit]}`;
}

export function StockTable({ rows, loading, onRowClick }: StockTableProps) {
  const columns: EventTableColumn<StockRowDto>[] = [
    {
      id: "name",
      header: inventoryLabels.columnName,
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
    },
    {
      id: "kind",
      header: inventoryLabels.columnKind,
      cell: (row) => inventoryLabels.kindLabels[row.kind],
    },
    {
      id: "category",
      header: inventoryLabels.columnCategory,
      cell: (row) => inventoryLabels.categoryLabels[row.category],
    },
    {
      id: "unit",
      header: inventoryLabels.columnUnit,
      cell: (row) => inventoryLabels.unitAbbrev[row.unit],
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
    },
    {
      id: "minStock",
      header: inventoryLabels.columnMinStock,
      numeric: true,
      cell: (row) => (row.minStockQty === null ? "â€”" : formatQty(row.minStockQty, row.unit)),
    },
    {
      id: "wac",
      header: inventoryLabels.columnWac,
      numeric: true,
      cell: (row) => formatUnitCostMc(row.wacMc, row.unit),
    },
    {
      id: "replacementCostMc",
      header: inventoryLabels.columnReplacementCost,
      numeric: true,
      cell: (row) => formatUnitCostMc(row.replacementCostMc, row.unit),
    },
    {
      id: "stockValue",
      header: inventoryLabels.columnStockValue,
      numeric: true,
      cell: (row) => (
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-medium">{formatMoney(row.stockValue)}</span>
          <CalcTrace
            formula={inventoryLabels.stockValueFormula}
            inputs={[
              { label: inventoryLabels.columnOnHand, value: formatQty(row.qtyOnHand, row.unit) },
              { label: inventoryLabels.columnWac, value: formatUnitCostMc(row.wacMc, row.unit) },
            ]}
          />
        </div>
      ),
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
    />
  );
}
