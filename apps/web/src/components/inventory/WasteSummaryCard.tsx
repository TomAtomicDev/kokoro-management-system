// SC-08 "costo invisible" summary card (UC-09, C-6): the exact selected period's total valued
// cost of non-commercial exits, broken down by reason. Deliberately a small summary card, not a
// full report — the worker query applies the day range before its month/reason buckets are read.

import { formatMoney, toCentavos } from "@kokoro/shared";

import type { DateRange } from "@/components/common/DateRangeFilter";
import { useWasteSummary } from "@/features/inventory/api";
import { inventoryLabels } from "@/lib/i18n-inventory";

export interface WasteSummaryCardProps {
  dateRange: DateRange;
}

export function WasteSummaryCard({ dateRange }: WasteSummaryCardProps) {
  const wasteSummaryQuery = useWasteSummary(dateRange);
  const rows = wasteSummaryQuery.data?.summary ?? [];
  const total = rows.reduce((sum, row) => sum + row.totalCost, 0);
  const byReason = new Map<(typeof rows)[number]["reason"], number>();
  for (const row of rows) {
    byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + row.totalCost);
  }

  return (
    <div className="flex flex-1 flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-sm">
      <span className="font-medium text-foreground text-sm">
        {inventoryLabels.wasteSummaryTitle}
      </span>
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground text-xs">
          {inventoryLabels.wasteSummaryTotalLabel}
        </span>
        <span className="numeric-cell font-medium text-foreground text-lg">
          {formatMoney(toCentavos(total))}
        </span>
      </div>
      {byReason.size > 0 ? (
        <div className="flex flex-col gap-1 border-border border-t pt-2">
          <span className="text-muted-foreground text-xs">
            {inventoryLabels.wasteSummaryByReasonLabel}
          </span>
          {[...byReason.entries()].map(([reason, reasonTotal]) => (
            <div key={reason} className="flex items-center justify-between text-xs">
              <span className="text-foreground">{inventoryLabels.reasonLabels[reason]}</span>
              <span className="numeric-cell text-muted-foreground">
                {formatMoney(toCentavos(reasonTotal))}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <span className="text-muted-foreground text-xs">{inventoryLabels.wasteSummaryEmpty}</span>
      )}
    </div>
  );
}
