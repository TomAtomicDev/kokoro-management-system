// SC-02 · Sales — /sales (UC-03). Header: "Nueva venta" action; filter preset for "Por cobrar"
// (paymentStatus=ON_CREDIT, a plain read filter — no aging math, that's v_receivables/KOK-031);
// table of all sales; read-only detail drawer on row click. Mirrors routes/purchases.tsx's
// composition.
//
// Scope (KOK-030): CREATE + READ only. Doc 07's SC-02 entry also lists "mark paid (account +
// method inline)" and "edit/delete" actions — deliberately NOT built here: core/sales ships only
// recordSale/listSales/getSale, with no update/delete/collectPayment endpoint yet (that's
// KOK-031). Building UI against a non-existent endpoint would be worse than leaving it out.

import { useState } from "react";

import { SaleDetailDrawer } from "@/components/sales/SaleDetailDrawer";
import { SaleForm } from "@/components/sales/SaleForm";
import { SalesTable } from "@/components/sales/SalesTable";
import { Button } from "@/components/ui/button";
import { useAccounts } from "@/features/finance/api";
import { useSales } from "@/features/sales/api";
import { salesLabels } from "@/lib/i18n-sales";
import { cn } from "@/lib/utils";

export function SalesRoute() {
  const [receivableOnly, setReceivableOnly] = useState(false);
  const accountsQuery = useAccounts();
  const salesQuery = useSales(receivableOnly ? { paymentStatus: "ON_CREDIT" } : {});

  const [formOpen, setFormOpen] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);

  const accounts = accountsQuery.data?.accounts ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl text-foreground">{salesLabels.title}</h1>
          <p className="text-muted-foreground text-sm">{salesLabels.subtitle}</p>
        </div>
        <Button type="button" onClick={() => setFormOpen(true)}>
          {salesLabels.actionRecord}
        </Button>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(!receivableOnly && "bg-accent")}
          onClick={() => setReceivableOnly(false)}
        >
          {salesLabels.filterAll}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(receivableOnly && "bg-accent")}
          onClick={() => setReceivableOnly(true)}
        >
          {salesLabels.filterReceivable}
        </Button>
      </div>

      <SalesTable
        sales={salesQuery.data?.sales ?? []}
        loading={salesQuery.isLoading}
        onRowClick={(sale) => setSelectedSaleId(sale.id)}
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
