// Margin pill with C-5 threshold colors (Doc 06 §4: "MarginBadge — margin% with C-5 threshold
// colors, used everywhere margins appear"). First consumer: the recipes theoretical-cost panel
// (KOK-025); KOK-036's Price-health screen (SC-12) reuses this as-is, which is why it takes raw
// `pctBasisPoints`/`minMarginPct` rather than anything recipe-shaped.
//
// Color convention matches the rest of the app's semantic tokens (transaction-styling.ts,
// StockTable.tsx's low-stock/negative badges): --positive/--warning/--negative + their -bg pair.
// C-5 (Doc 03 §"C-5 Margins") only defines a single alert threshold
// (`margin_replacement_pct < settings.min_margin_pct`); this component adds one more tier — a
// genuine loss (margin ≤ 0) reads as more urgent (red) than merely-below-target (amber) — a
// judgment call in the same spirit as Doc 06 principle 4's "amber/red thresholds" language for
// this exact screen.

import { cn } from "@/lib/utils";

export interface MarginBadgeProps {
  /** Margin as a percentage of price, in integer basis points (100% = 10000). */
  pctBasisPoints: number;
  /** `app_settings.min_margin_pct` (C-5), basis points — the alert threshold. */
  minMarginPct: number;
  className?: string;
}

type MarginTone = "positive" | "warning" | "negative";

function marginTone(pctBasisPoints: number, minMarginPct: number): MarginTone {
  if (pctBasisPoints <= 0) return "negative";
  if (pctBasisPoints < minMarginPct) return "warning";
  return "positive";
}

const TONE_CLASSES: Record<MarginTone, string> = {
  positive: "border-transparent bg-positive-bg text-positive",
  warning: "border-transparent bg-warning-bg text-warning",
  negative: "border-transparent bg-negative-bg text-negative",
};

/** Display-only formatting (no money/qty involved, D-5 doesn't apply): basis points -> "30,5%",
 * es-BO decimal comma, one decimal place. */
function formatBasisPointsAsPercent(bps: number): string {
  const negative = bps < 0;
  const abs = Math.abs(bps);
  const wholePct = Math.floor(abs / 100);
  const tenthPct = Math.floor((abs % 100) / 10);
  return `${negative ? "-" : ""}${wholePct},${tenthPct}%`;
}

export function MarginBadge({ pctBasisPoints, minMarginPct, className }: MarginBadgeProps) {
  const tone = marginTone(pctBasisPoints, minMarginPct);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-none",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {formatBasisPointsAsPercent(pctBasisPoints)}
    </span>
  );
}
