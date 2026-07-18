// SC-08 "costo invisible" summary card (UC-09, C-6): the current month's total valued cost of
// non-commercial exits, broken down by reason. Deliberately a small summary card, not a full
// report — `v_waste` (WasteSummaryRowDto) already aggregates by (month, reason); this just filters
// the current month's rows and sums/lists them. Mirrors AccountCard.tsx's card shell.

import { formatMoney, nowIso, toBusinessDate } from "@kokoro/shared";

import { useWasteSummary } from "@/features/inventory/api";
import { inventoryLabels } from "@/lib/i18n-inventory";

export function WasteSummaryCard() {
  const wasteSummaryQuery = useWasteSummary({});
  const rows = wasteSummaryQuery.data?.summary ?? [];
  // `business_date`'s own YYYY-MM prefix (America/La_Paz, INV-3) — not the browser's local
  // month — matches how `v_waste.month` itself is derived server-side (Doc 04 §4).
  const month = toBusinessDate(nowIso()).slice(0, 7);
  const currentMonthRows = rows.filter((row) => row.month === month);
  const total = currentMonthRows.reduce((sum, row) => sum + row.totalCost, 0);

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
          {formatMoney(total)}
        </span>
      </div>
      {currentMonthRows.length > 0 ? (
        <div className="flex flex-col gap-1 border-border border-t pt-2">
          <span className="text-muted-foreground text-xs">
            {inventoryLabels.wasteSummaryByReasonLabel}
          </span>
          {currentMonthRows.map((row) => (
            <div key={row.reason} className="flex items-center justify-between text-xs">
              <span className="text-foreground">{inventoryLabels.reasonLabels[row.reason]}</span>
              <span className="numeric-cell text-muted-foreground">
                {formatMoney(row.totalCost)}
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
