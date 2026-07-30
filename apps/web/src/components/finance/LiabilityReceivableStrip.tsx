// Liability/receivable strip - SC-10: "Anticipos de clientes (v_liability) + Por cobrar
// (v_receivables)". Values are read from the Finance summary endpoint.

import { formatMoney, toCentavos } from "@kokoro/shared";

import { useFinanceSummary } from "@/features/finance/api";
import { financeLabels } from "@/lib/i18n-finance";

function PendingStat({ label }: { label: string }) {
  return (
    <div className="flex flex-1 flex-col gap-1 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="flex items-baseline justify-between">
        <span className="numeric-cell text-subtle-foreground text-lg">—</span>
        <span className="text-muted-foreground text-xs">{financeLabels.loading}</span>
      </div>
    </div>
  );
}

function SummaryStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-1 flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="numeric-cell font-medium text-foreground text-lg">{value}</span>
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </div>
  );
}

export function LiabilityReceivableStrip() {
  const summaryQuery = useFinanceSummary();
  const summary = summaryQuery.data;

  if (summaryQuery.isLoading || summary === undefined) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row">
        <PendingStat label={financeLabels.liabilityLabel} />
        <PendingStat label={financeLabels.receivableLabel} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <SummaryStat
        label={financeLabels.liabilityLabel}
        value={formatMoney(toCentavos(summary.liability))}
        hint={financeLabels.liabilityHint}
      />
      <SummaryStat
        label={financeLabels.receivableLabel}
        value={formatMoney(toCentavos(summary.receivablesTotal))}
      />
    </div>
  );
}
