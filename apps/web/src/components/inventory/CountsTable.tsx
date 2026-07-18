// SC-08 Conteos tab list table: `inventory_counts` rows (KOK-019). Variance count is computed
// client-side as `countedQty !== expectedQty` per line — there is no separate variance field on
// InventoryCountDto (packages/shared/src/counts.ts), and both fields are present regardless of
// status (DRAFT or COMMITTED), so this works for either.

import type { InventoryCountDto } from "@kokoro/shared";

import { EventTable, type EventTableColumn } from "@/components/data-table/EventTable";
import { Badge } from "@/components/ui/badge";
import { inventoryLabels } from "@/lib/i18n-inventory";

export interface CountsTableProps {
  rows: InventoryCountDto[];
  loading?: boolean;
  onRowClick: (row: InventoryCountDto) => void;
}

function varianceCount(count: InventoryCountDto): number {
  return count.lines.filter((line) => line.countedQty !== line.expectedQty).length;
}

export function CountsTable({ rows, loading, onRowClick }: CountsTableProps) {
  const columns: EventTableColumn<InventoryCountDto>[] = [
    {
      id: "date",
      header: inventoryLabels.countsColumnDate,
      cell: (row) => row.businessDate,
    },
    {
      id: "status",
      header: inventoryLabels.countsColumnStatus,
      cell: (row) => (
        <Badge variant={row.status === "DRAFT" ? "warning" : "default"}>
          {inventoryLabels.countStatusLabels[row.status]}
        </Badge>
      ),
    },
    {
      id: "lines",
      header: inventoryLabels.countsColumnLines,
      numeric: true,
      cell: (row) => row.lines.length,
    },
    {
      id: "variance",
      header: inventoryLabels.countsColumnVariance,
      numeric: true,
      cell: (row) => varianceCount(row),
    },
  ];

  return (
    <EventTable
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      onRowClick={onRowClick}
      emptyMessage={inventoryLabels.noCounts}
      loading={loading}
      loadingMessage={inventoryLabels.loading}
    />
  );
}
