// SC-10 order cash exposure/receivable strip. Values come from the shared Finance summary read.

import { formatMoney, toCentavos } from "@kokoro/shared";
import { Link } from "@tanstack/react-router";

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

function SummaryStat({
  label,
  value,
  hint,
  to,
}: {
  label: string;
  value: string;
  hint?: string;
  to?: "/receivables";
}) {
  const className =
    "flex flex-1 flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3 shadow-sm";
  const content = (
    <>
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="numeric-cell font-medium text-foreground text-lg">{value}</span>
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </>
  );

  return to ? (
    <Link
      to={to}
      className={`${className} min-h-11 transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
    >
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

export function OrderCashReceivableStrip() {
  const summaryQuery = useFinanceSummary();
  const summary = summaryQuery.data;

  if (summaryQuery.isLoading || summary === undefined) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row">
        <PendingStat label={financeLabels.preDeliveryOrderCashExposureLabel} />
        <PendingStat label={financeLabels.receivableLabel} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <SummaryStat
        label={financeLabels.preDeliveryOrderCashExposureLabel}
        value={formatMoney(toCentavos(summary.preDeliveryOrderCashExposure))}
        hint={financeLabels.preDeliveryOrderCashExposureHint}
      />
      <SummaryStat
        label={financeLabels.receivableLabel}
        value={formatMoney(toCentavos(summary.receivablesTotal))}
        to="/receivables"
      />
    </div>
  );
}
