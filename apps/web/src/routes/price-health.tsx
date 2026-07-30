// SC-12 · Price health — /price-health (G2, C-5, KOK-036). The anti-decapitalization screen:
// answers "¿qué precio subo esta semana?" — everything on it is actionable today (trends belong
// in SC-13, per Doc 07). "Dinero en riesgo" (KOK-074) and the per-item price-history drawer
// (KOK-076) are separate, later backlog items — deliberately out of scope here.

import type { PriceHealthRowDto } from "@kokoro/shared";
import { useState } from "react";

import { PriceHealthTable } from "@/components/pricing/PriceHealthTable";
import { UpdatePriceDialog } from "@/components/pricing/UpdatePriceDialog";
import { usePriceHealth } from "@/features/pricing/api";
import { pricingLabels } from "@/lib/i18n-pricing";

export function PriceHealthRoute() {
  const priceHealthQuery = usePriceHealth();
  const [editing, setEditing] = useState<PriceHealthRowDto | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">{pricingLabels.title}</h1>
        <p className="text-muted-foreground text-sm">{pricingLabels.subtitle}</p>
      </div>

      <PriceHealthTable
        rows={priceHealthQuery.data?.rows ?? []}
        minMarginPct={priceHealthQuery.data?.minMarginPct ?? 0}
        loading={priceHealthQuery.isLoading}
        onUpdatePrice={setEditing}
      />

      <UpdatePriceDialog
        itemId={editing?.itemId ?? null}
        itemName={editing?.name ?? null}
        currentSalePriceMc={editing?.salePriceMc ?? null}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </div>
  );
}
