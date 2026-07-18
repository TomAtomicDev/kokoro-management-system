// SC-08 Stock tab table: `v_stock` rows, pre-sorted server-side (negative-first, then low-stock,
// then by name — see packages/shared/src/inventory-views.ts) so no client-side re-sort is needed.
// Row click opens the Kardex drawer for that item.
//
// wac/replacementCost display: Doc 04 §2 stores both as REAL **centavos per MILLI-unit**
// (`docs/system-design-knowledge-base/04-data-model.md` line 39-40), the same scale ItemForm.tsx
// already displays via `formatMoney(Math.round(value * 1000))` + a "/ unit" suffix. The comment on
// `StockRowDto.wac` in inventory-views.ts says "centavos per whole unit", but that reads as a doc
// slip against Doc 04 (the SQL view's `stock_value = ROUND(qty_on_hand_milli * wac)` only produces
// a correct centavos total if `wac` is per-milli-unit) — per D-1 the KB (Doc 04) is the tie-breaker,
// so this table follows Doc 04's scale and ItemForm's existing display precedent rather than the
// StockRowDto comment. `stockValue` itself is already a plain INTEGER centavos column (Doc 04 §3.4
// `stock_value INTEGER`), so it needs no such conversion.

import type { StockRowDto } from "@kokoro/shared";
import { formatMoney, formatQty } from "@kokoro/shared";
import { EventTable, type EventTableColumn } from "@/components/data-table/EventTable";
import { CalcTraceStub } from "@/components/inventory/CalcTraceStub";
import { Badge } from "@/components/ui/badge";
import { inventoryLabels } from "@/lib/i18n-inventory";
import { cn } from "@/lib/utils";

export interface StockTableProps {
  rows: StockRowDto[];
  loading?: boolean;
  onRowClick?: (row: StockRowDto) => void;
}

/** Doc 04 §2: wac/replacementCost are REAL centavos-per-milli-unit; display per whole unit. */
function formatUnitCost(perMilliUnitCentavos: number, unit: StockRowDto["unit"]): string {
  return `${formatMoney(Math.round(perMilliUnitCentavos * 1000))} / ${inventoryLabels.unitAbbrev[unit]}`;
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
      cell: (row) => (row.minStockQty === null ? "—" : formatQty(row.minStockQty, row.unit)),
    },
    {
      id: "wac",
      header: inventoryLabels.columnWac,
      numeric: true,
      cell: (row) => formatUnitCost(row.wac, row.unit),
    },
    {
      id: "replacementCost",
      header: inventoryLabels.columnReplacementCost,
      numeric: true,
      cell: (row) => formatUnitCost(row.replacementCost, row.unit),
    },
    {
      id: "stockValue",
      header: inventoryLabels.columnStockValue,
      numeric: true,
      cell: (row) => (
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-medium">{formatMoney(row.stockValue)}</span>
          <CalcTraceStub formula={inventoryLabels.stockValueFormula} />
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
