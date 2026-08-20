// SC-05 · Producción — /production (UC-02). Header: "Nueva producción" action + a secondary link
// to Recetas (KOK-025's sub-feature, which has no other nav entry); table of all
// production runs; detail drawer on row click. Mirrors routes/purchases.tsx's composition.
//
// Replaces the former placeholder body (a single full-width link card to /production/recipes) now
// that the real screen exists — the link to Recipes is kept, just demoted to a header button
// alongside the primary action. Envasar is a separate top-level section (KOK-156).
//
// KOK-141: the record/edit form is its own full page (`/production/new`,
// `/production/$productionRunId/edit`) per KOK-140's pattern, not a dialog — mirrors
// routes/sales.tsx's SaleRecordRoute/SaleEditRoute split.

import { getRouteApi, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import type { EventTableSortState } from "@/components/data-table/EventTable";
import { ProductionRunDetailDrawer } from "@/components/production/ProductionRunDetailDrawer";
import { ProductionRunForm } from "@/components/production/ProductionRunForm";
import { ProductionRunsTable } from "@/components/production/ProductionRunsTable";
import { buttonVariants } from "@/components/ui/button";
import { useProductionRun, useProductionRuns } from "@/features/production-runs/api";
import { useRecipesQuery } from "@/features/recipes/api";
import { productionLabels } from "@/lib/i18n-production";

const routeApi = getRouteApi("/_authenticated/production");
const recordRouteApi = getRouteApi("/_authenticated/production/new");
const editRouteApi = getRouteApi("/_authenticated/production/$productionRunId/edit");

export function ProductionRecordRoute() {
  const { sessionId } = recordRouteApi.useSearch();
  return <ProductionRunForm preselectedSessionId={sessionId} />;
}

export function ProductionEditRoute() {
  const { productionRunId } = editRouteApi.useParams();
  const productionRunQuery = useProductionRun(productionRunId);
  const productionRun = productionRunQuery.data;

  if (!productionRun) {
    return <p className="text-muted-foreground text-sm">{productionLabels.loading}</p>;
  }

  return <ProductionRunForm productionRun={productionRun} />;
}

export function ProductionRoute() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const productionRunsQuery = useProductionRuns();
  const recipesQuery = useRecipesQuery({ isActive: true });

  const [selectedProductionRunId, setSelectedProductionRunId] = useState<string | null>(null);

  useEffect(() => {
    if (search.open) setSelectedProductionRunId(search.open);
  }, [search.open]);

  const recipes = recipesQuery.data?.recipes ?? [];
  const sortState: EventTableSortState | null =
    search.sort && search.sortDirection
      ? { columnId: search.sort, direction: search.sortDirection }
      : null;

  function updateSort(next: EventTableSortState | null): void {
    void navigate({
      search: (previous) => ({
        ...previous,
        sort: next?.columnId,
        sortDirection: next?.direction,
      }),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl text-foreground">{productionLabels.title}</h1>
          <p className="text-muted-foreground text-sm">{productionLabels.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/production/recipes" className={buttonVariants({ variant: "outline" })}>
            {productionLabels.goToRecipes}
          </Link>
          <Link to="/production/new" className={buttonVariants()}>
            {productionLabels.actionRecord}
          </Link>
        </div>
      </div>

      <ProductionRunsTable
        productionRuns={productionRunsQuery.data?.productionRuns ?? []}
        recipes={recipes}
        loading={productionRunsQuery.isLoading}
        onRowClick={(productionRun) => setSelectedProductionRunId(productionRun.id)}
        sortState={sortState}
        onSortChange={updateSort}
      />

      <ProductionRunDetailDrawer
        productionRunId={selectedProductionRunId}
        open={selectedProductionRunId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedProductionRunId(null);
        }}
      />
    </div>
  );
}
