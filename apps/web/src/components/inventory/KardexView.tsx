// SC-08 Kardex drawer: movements for a single item (DetailDrawer contract, Doc 06 §4), newest
// first (server-sorted, see packages/shared/src/inventory-views.ts).

import type { KardexRowDto } from "@kokoro/shared";
import { formatMoney, formatQty } from "@kokoro/shared";
import { Link } from "@tanstack/react-router";

import { DetailDrawer } from "@/components/data-table/DetailDrawer";
import { EventTable, type EventTableColumn } from "@/components/data-table/EventTable";
import { useKardex } from "@/features/inventory/api";
import { inventoryLabels } from "@/lib/i18n-inventory";
import { cn } from "@/lib/utils";

export interface KardexViewProps {
  itemId: string | null;
  /** Passed by the caller (which already holds the StockRowDto row) rather than derived from the
   * first fetched kardex row, so the drawer title is correct immediately — no empty-state flash
   * while the query is in flight. */
  itemName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Doc 04 §3.4: unit_cost is REAL centavos-per-milli-unit — same display scale as StockTable's
 * wac/replacementCost columns. */
function formatUnitCost(row: KardexRowDto): string {
  return `${formatMoney(Math.round(row.unitCost * 1000))} / ${inventoryLabels.unitAbbrev[row.unit]}`;
}

function SourceCell({ row }: { row: KardexRowDto }) {
  if (row.sourceEventType === "purchase") {
    return (
      <Link to="/purchases" className="text-primary hover:underline">
        {inventoryLabels.sourceEventLabels.purchase}
      </Link>
    );
  }
  return (
    <span>{inventoryLabels.sourceEventLabels[row.sourceEventType] ?? row.sourceEventType}</span>
  );
}

export function KardexView({ itemId, itemName, open, onOpenChange }: KardexViewProps) {
  const kardexQuery = useKardex(itemId, {});
  const movements = kardexQuery.data?.movements ?? [];

  const columns: EventTableColumn<KardexRowDto>[] = [
    {
      id: "date",
      header: inventoryLabels.kardexColumnDate,
      cell: (row) => row.businessDate,
    },
    {
      id: "type",
      header: inventoryLabels.kardexColumnType,
      cell: (row) => inventoryLabels.movementTypeLabels[row.type],
    },
    {
      id: "qty",
      header: inventoryLabels.kardexColumnQty,
      numeric: true,
      cell: (row) => (
        <span className={cn(row.qty < 0 && "text-negative")}>{formatQty(row.qty, row.unit)}</span>
      ),
    },
    {
      id: "unitCost",
      header: inventoryLabels.kardexColumnUnitCost,
      numeric: true,
      cell: (row) => formatUnitCost(row),
    },
    {
      id: "totalCost",
      header: inventoryLabels.kardexColumnTotalCost,
      numeric: true,
      cell: (row) => (
        <span className={cn(row.totalCost < 0 && "text-negative")}>
          {formatMoney(row.totalCost, { signed: true })}
        </span>
      ),
    },
    {
      id: "balance",
      header: inventoryLabels.kardexColumnBalance,
      numeric: true,
      cell: (row) => (
        <span className={cn(row.runningBalance < 0 && "text-negative")}>
          {formatQty(row.runningBalance, row.unit)}
        </span>
      ),
    },
    {
      id: "source",
      header: inventoryLabels.kardexColumnSource,
      cell: (row) => <SourceCell row={row} />,
    },
  ];

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={
        itemName
          ? `${inventoryLabels.kardexTitlePrefix} · ${itemName}`
          : inventoryLabels.kardexTitlePrefix
      }
    >
      <EventTable
        columns={columns}
        rows={movements}
        getRowId={(row) => row.id}
        emptyMessage={inventoryLabels.noMovements}
        loading={kardexQuery.isLoading}
        loadingMessage={inventoryLabels.loading}
      />
    </DetailDrawer>
  );
}
