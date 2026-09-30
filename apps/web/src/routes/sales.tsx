// SC-02 · Sales — /sales (UC-03/UC-04). The date range remains a sales-period view; a direct link
// opens the all-dates debt manager instead of filtering receivables inside that period.
//
// KOK-031's inline full-balance collect action remains available. Its display amount is sourced from
// v_receivables so delivered custom-order deposits are netted; edit/delete remains KOK-064's scope.

import { getRouteApi, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  type DateRange,
  DateRangeFilter,
  getDefaultDateRange,
} from "@/components/common/DateRangeFilter";
import type { EventTableSortState } from "@/components/data-table/EventTable";
import { SaleDetailDrawer } from "@/components/sales/SaleDetailDrawer";
import { SaleForm } from "@/components/sales/SaleForm";
import { SalesTable } from "@/components/sales/SalesTable";
import { Button } from "@/components/ui/button";
import { useAccounts } from "@/features/finance/api";
import { useReceivables, useSale, useSales } from "@/features/sales/api";
import { salesLabels } from "@/lib/i18n-sales";

const routeApi = getRouteApi("/_authenticated/sales");
const editRouteApi = getRouteApi("/_authenticated/sales/$saleId/edit");

export function SaleRecordRoute() {
  const accountsQuery = useAccounts();
  return <SaleForm accounts={accountsQuery.data?.accounts ?? []} />;
}

export function SaleEditRoute() {
  const { saleId } = editRouteApi.useParams();
  const accountsQuery = useAccounts();
  const saleQuery = useSale(saleId);
  const sale = saleQuery.data;

  if (!sale) {
    return <p className="text-muted-foreground text-sm">{salesLabels.loading}</p>;
  }

  return <SaleForm accounts={accountsQuery.data?.accounts ?? []} sale={sale} />;
}

export function SalesRoute() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const defaults = getDefaultDateRange();
  const fromDate = search.fromDate ?? defaults.fromDate;
  const toDate = search.toDate ?? defaults.toDate;
  const sortState: EventTableSortState | null =
    search.sort && search.sortDirection
      ? { columnId: search.sort, direction: search.sortDirection }
      : null;
  const accountsQuery = useAccounts();
  const salesQuery = useSales({ fromDate, toDate });
  const receivablesQuery = useReceivables();

  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);

  useEffect(() => {
    if (search.open) setSelectedSaleId(search.open);
  }, [search.open]);

  const accounts = accountsQuery.data?.accounts ?? [];

  function updateDateRange(range: DateRange): void {
    void navigate({ search: (previous) => ({ ...previous, ...range }) });
  }

  function updateSort(next: EventTableSortState | null): void {
    void navigate({
      search: (previous) => ({
        ...previous,
        sort: next?.columnId,
        sortDirection: next?.direction,
      }),
    });
  }

  const outstandingAmountBySaleId = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of receivablesQuery.data?.receivables ?? []) {
      map.set(row.saleId, row.total);
    }
    return map;
  }, [receivablesQuery.data]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl text-foreground">{salesLabels.title}</h1>
          <p className="text-muted-foreground text-sm">{salesLabels.subtitle}</p>
          <p className="text-muted-foreground text-xs">{salesLabels.orderClarification}</p>
        </div>
        <Button asChild>
          <Link to="/sales/new">{salesLabels.actionRecord}</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <DateRangeFilter fromDate={fromDate} toDate={toDate} onChange={updateDateRange} />
        <Button asChild variant="outline" size="sm">
          <Link to="/receivables">{salesLabels.manageReceivables}</Link>
        </Button>
      </div>

      <SalesTable
        sales={salesQuery.data?.sales ?? []}
        accounts={accounts}
        loading={salesQuery.isLoading}
        onRowClick={(sale) => setSelectedSaleId(sale.id)}
        outstandingAmountBySaleId={outstandingAmountBySaleId}
        sortState={sortState}
        onSortChange={updateSort}
      />

      <SaleDetailDrawer
        saleId={selectedSaleId}
        open={selectedSaleId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedSaleId(null);
        }}
        accounts={accounts}
      />
    </div>
  );
}
