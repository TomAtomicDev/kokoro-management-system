// SC-05 production runs table: fecha, receta, tandas, salida real vs esperada (yield %), costo
// total, costo unitario, sesión, pedido. Read + row-click only (no inline edit here) — same
// precedent as PurchasesTable/RecipesTable: editing opens the detail drawer instead.
//
// Session/pedido columns render "—" — no session (KOK-027) or custom-order (KOK-033) linking UI
// exists yet, so there's no data source to show for them; this table doesn't build picker UI for
// columns SC-05 lists but nothing yet populates.

import type { ProductionRunDto, RecipeDto } from "@kokoro/shared";
import {
  formatMoney,
  toCentavos,
  toMilliCentavosPerUnit,
  totalCentavos,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";
import { useMemo } from "react";

import {
  EventTable,
  type EventTableColumn,
  type EventTableSortState,
} from "@/components/data-table/EventTable";
import { productionLabels } from "@/lib/i18n-production";

export interface ProductionRunsTableProps {
  productionRuns: ProductionRunDto[];
  recipes: RecipeDto[];
  loading?: boolean;
  onRowClick?: (productionRun: ProductionRunDto) => void;
  sortState: EventTableSortState | null;
  onSortChange: (sortState: EventTableSortState | null) => void;
}

/** `batches` is a plain REAL JS number (not milli-scaled, see production-runs.ts's `batchesSchema`)
 * — es-BO convention is comma-decimal, so this uses `toLocaleString` rather than one of qty.ts's
 * milli-unit formatters (which assume an integer milli-units input, wrong shape for `batches`). */
function formatBatches(batches: number): string {
  return batches.toLocaleString("es-BO", { maximumFractionDigits: 3 });
}

/** Yield % = actual output ÷ (recipe's expected yield × batches) × 100, rounded. `null` when the
 * recipe isn't loaded/found — nothing to compare against yet. */
function formatYieldPct(run: ProductionRunDto, recipe: RecipeDto | undefined): string {
  if (!recipe) return "—";
  const expected = recipe.expectedYieldQty * run.batches;
  if (expected <= 0) return "—";
  const pct = Math.round((run.actualOutputQty / expected) * 100);
  return `${pct}%`;
}

export function ProductionRunsTable({
  productionRuns,
  recipes,
  loading,
  onRowClick,
  sortState,
  onSortChange,
}: ProductionRunsTableProps) {
  const recipesById = useMemo(() => {
    const map = new Map<string, RecipeDto>();
    for (const recipe of recipes) map.set(recipe.id, recipe);
    return map;
  }, [recipes]);

  const columns: EventTableColumn<ProductionRunDto>[] = [
    {
      id: "code",
      header: productionLabels.columnCode,
      isRowIdentifier: true,
      cell: (row) => row.code ?? row.id,
      sortable: true,
      sortValue: (row) => row.code,
    },
    {
      id: "date",
      header: productionLabels.columnDate,
      cell: (row) => row.businessDate,
      sortable: true,
      sortValue: (row) => row.businessDate,
    },
    {
      id: "recipe",
      header: productionLabels.columnRecipe,
      cell: (row) => recipesById.get(row.recipeId)?.name ?? row.recipeId,
      sortable: true,
      sortValue: (row) => recipesById.get(row.recipeId)?.name ?? row.recipeId,
    },
    {
      id: "batches",
      header: productionLabels.columnBatches,
      numeric: true,
      cell: (row) => formatBatches(row.batches),
      sortable: true,
      sortValue: (row) => row.batches,
    },
    {
      id: "yield",
      header: productionLabels.columnYield,
      numeric: true,
      cell: (row) => formatYieldPct(row, recipesById.get(row.recipeId)),
    },
    {
      id: "totalCost",
      header: productionLabels.columnTotalCost,
      numeric: true,
      cell: (row) => formatMoney(toCentavos(row.totalCost)),
      sortable: true,
      sortValue: (row) => row.totalCost,
    },
    {
      id: "unitCost",
      header: productionLabels.columnUnitCost,
      numeric: true,
      cell: (row) =>
        formatMoney(
          totalCentavos(toMilliCentavosPerUnit(row.outputUnitCostMc), WHOLE_UNIT_MILLI_UNITS),
        ),
      sortable: true,
      sortValue: (row) => row.outputUnitCostMc,
    },
    {
      id: "session",
      header: productionLabels.columnSession,
      cell: () => <span className="text-subtle-foreground">—</span>,
    },
    {
      id: "order",
      header: productionLabels.columnOrder,
      cell: () => <span className="text-subtle-foreground">—</span>,
    },
  ];

  return (
    <EventTable
      columns={columns}
      rows={productionRuns}
      getRowId={(row) => row.id}
      onRowClick={onRowClick}
      emptyMessage={productionLabels.noProductionRuns}
      loading={loading}
      loadingMessage={productionLabels.loading}
      sortState={sortState}
      onSortChange={onSortChange}
    />
  );
}
