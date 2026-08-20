// SC-07 · Purchases — /purchases (UC-01). Header: "Registrar compra" action; table of all
// purchases; detail drawer on row click. Mirrors routes/finance.tsx's composition.

import { getRouteApi, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { EventTableSortState } from "@/components/data-table/EventTable";
import { PurchaseDetailDrawer } from "@/components/purchases/PurchaseDetailDrawer";
import { PurchaseForm } from "@/components/purchases/PurchaseForm";
import { PurchasesTable } from "@/components/purchases/PurchasesTable";
import { Button } from "@/components/ui/button";
import { useAccounts } from "@/features/finance/api";
import { usePurchase, usePurchases } from "@/features/purchases/api";
import { purchasesLabels } from "@/lib/i18n-purchases";

const newRouteApi = getRouteApi("/_authenticated/purchases/new");
const editRouteApi = getRouteApi("/_authenticated/purchases/$purchaseId/edit");
const routeApi = getRouteApi("/_authenticated/purchases");

export function PurchaseRecordRoute() {
  const { sessionId } = newRouteApi.useSearch();
  const accountsQuery = useAccounts();
  return (
    <PurchaseForm accounts={accountsQuery.data?.accounts ?? []} preselectedSessionId={sessionId} />
  );
}

export function PurchaseEditRoute() {
  const { purchaseId } = editRouteApi.useParams();
  const accountsQuery = useAccounts();
  const purchaseQuery = usePurchase(purchaseId);
  const purchase = purchaseQuery.data;

  if (!purchase) {
    return <p className="text-muted-foreground text-sm">{purchasesLabels.loading}</p>;
  }

  return <PurchaseForm accounts={accountsQuery.data?.accounts ?? []} purchase={purchase} />;
}

export function PurchasesRoute() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const accountsQuery = useAccounts();
  const purchasesQuery = usePurchases();

  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);

  useEffect(() => {
    if (search.open) setSelectedPurchaseId(search.open);
  }, [search.open]);

  const accounts = accountsQuery.data?.accounts ?? [];
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
          <h1 className="font-semibold text-2xl text-foreground">{purchasesLabels.title}</h1>
          <p className="text-muted-foreground text-sm">{purchasesLabels.subtitle}</p>
        </div>
        <Button asChild>
          <Link to="/purchases/new">{purchasesLabels.actionRecord}</Link>
        </Button>
      </div>

      <PurchasesTable
        purchases={purchasesQuery.data?.purchases ?? []}
        accounts={accounts}
        loading={purchasesQuery.isLoading}
        onRowClick={(purchase) => setSelectedPurchaseId(purchase.id)}
        sortState={sortState}
        onSortChange={updateSort}
      />

      <PurchaseDetailDrawer
        purchaseId={selectedPurchaseId}
        open={selectedPurchaseId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedPurchaseId(null);
        }}
        accounts={accounts}
      />
    </div>
  );
}
