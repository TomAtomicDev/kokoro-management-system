// SC-02 · Sales — /sales (UC-03/UC-04). Header: "Nueva venta" action; filter preset for "Por
// cobrar" (paymentStatus=ON_CREDIT) with aging sourced from `v_receivables` (KOK-031); table of
// all sales with an inline "Cobrar" action on ON_CREDIT rows; read-only detail drawer on row
// click. Mirrors routes/purchases.tsx's composition.
//
// Scope: KOK-030 shipped CREATE + READ only. KOK-031 adds the receivables aging column + the
// "Cobrar" (collectPayment) action — `useReceivables` is only fetched while the preset is active
// (`enabled: receivableOnly`), since it exists solely to feed that column. Edit/delete for a sale
// itself remains KOK-064's scope.

import { getRouteApi } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  type DateRange,
  DateRangeFilter,
  getDefaultDateRange,
} from "@/components/common/DateRangeFilter";
import { SaleDetailDrawer } from "@/components/sales/SaleDetailDrawer";
import { SaleForm } from "@/components/sales/SaleForm";
import { SalesTable } from "@/components/sales/SalesTable";
import { Button } from "@/components/ui/button";
import { useAccounts } from "@/features/finance/api";
import { useReceivables, useSales } from "@/features/sales/api";
import { salesLabels } from "@/lib/i18n-sales";
import { cn } from "@/lib/utils";

const routeApi = getRouteApi("/_authenticated/sales");

export function SalesRoute() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const defaults = getDefaultDateRange();
  const fromDate = search.fromDate ?? defaults.fromDate;
  const toDate = search.toDate ?? defaults.toDate;
  const receivableOnly = search.paymentStatus === "ON_CREDIT";
  const accountsQuery = useAccounts();
  const salesQuery = useSales({
    fromDate,
    toDate,
    paymentStatus: search.paymentStatus,
  });
  const receivablesQuery = useReceivables(receivableOnly);

  const [formOpen, setFormOpen] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);

  const accounts = accountsQuery.data?.accounts ?? [];

  function updateDateRange(range: DateRange): void {
    void navigate({ search: (previous) => ({ ...previous, ...range }) });
  }

  function updateReceivableOnly(nextReceivableOnly: boolean): void {
    void navigate({
      search: (previous) => ({
        ...previous,
        paymentStatus: nextReceivableOnly ? "ON_CREDIT" : undefined,
      }),
    });
  }

  const daysOutstandingBySaleId = useMemo(() => {
    if (!receivableOnly) return undefined;
    const map = new Map<string, number>();
    for (const row of receivablesQuery.data?.receivables ?? []) {
      map.set(row.saleId, row.daysOutstanding);
    }
    return map;
  }, [receivableOnly, receivablesQuery.data]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl text-foreground">{salesLabels.title}</h1>
          <p className="text-muted-foreground text-sm">{salesLabels.subtitle}</p>
          <p className="text-muted-foreground text-xs">{salesLabels.orderClarification}</p>
        </div>
        <Button type="button" onClick={() => setFormOpen(true)}>
          {salesLabels.actionRecord}
        </Button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <DateRangeFilter fromDate={fromDate} toDate={toDate} onChange={updateDateRange} />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(!receivableOnly && "bg-accent")}
            onClick={() => updateReceivableOnly(false)}
          >
            {salesLabels.filterAll}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(receivableOnly && "bg-accent")}
            onClick={() => updateReceivableOnly(true)}
          >
            {salesLabels.filterReceivable}
          </Button>
        </div>
      </div>

      <SalesTable
        sales={salesQuery.data?.sales ?? []}
        accounts={accounts}
        loading={salesQuery.isLoading}
        onRowClick={(sale) => setSelectedSaleId(sale.id)}
        daysOutstandingBySaleId={daysOutstandingBySaleId}
      />

      <SaleForm open={formOpen} onOpenChange={setFormOpen} accounts={accounts} />
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
