// SC-07 · Purchases — /purchases (UC-01). Header: "Registrar compra" action; table of all
// purchases; detail drawer on row click. Mirrors routes/finance.tsx's composition.

import { useState } from "react";

import { PurchaseDetailDrawer } from "@/components/purchases/PurchaseDetailDrawer";
import { PurchaseForm } from "@/components/purchases/PurchaseForm";
import { PurchasesTable } from "@/components/purchases/PurchasesTable";
import { Button } from "@/components/ui/button";
import { useAccounts } from "@/features/finance/api";
import { usePurchases } from "@/features/purchases/api";
import { purchasesLabels } from "@/lib/i18n-purchases";

export function PurchasesRoute() {
  const accountsQuery = useAccounts();
  const purchasesQuery = usePurchases();

  const [formOpen, setFormOpen] = useState(false);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);

  const accounts = accountsQuery.data?.accounts ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl text-foreground">{purchasesLabels.title}</h1>
          <p className="text-muted-foreground text-sm">{purchasesLabels.subtitle}</p>
        </div>
        <Button type="button" onClick={() => setFormOpen(true)}>
          {purchasesLabels.actionRecord}
        </Button>
      </div>

      <PurchasesTable
        purchases={purchasesQuery.data?.purchases ?? []}
        accounts={accounts}
        loading={purchasesQuery.isLoading}
        onRowClick={(purchase) => setSelectedPurchaseId(purchase.id)}
      />

      <PurchaseForm open={formOpen} onOpenChange={setFormOpen} accounts={accounts} />
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
