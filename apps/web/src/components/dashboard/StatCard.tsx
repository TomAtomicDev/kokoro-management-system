// Generic dashboard stat tile (KOK-023, Doc 06 principle 5 / Doc 07 UX-5: "every dashboard number
// links to its underlying list filtered accordingly"). The whole card is the link, not a separate
// "ver más" affordance next to it — mirrors AccountCard.tsx's visual shape
// (components/finance/AccountCard.tsx: rounded-lg border bg-card p-4 shadow-sm, muted-foreground
// text-xs label) with `hover:bg-accent` added since this one is interactive.
//
// `delta`/`sparkline` are typed but deliberately unused/unrendered here — KOK-023's scope is only
// the reduced SC-01 (no deltas, no charts; those arrive in Phase 5 / KOK-052 "Dashboard v2"). They
// exist on the prop type now so KOK-052 can wire them in without a breaking prop-shape change to
// every existing call site.

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { AppPath } from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

export interface StatCardDelta {
  /** Signed value, same unit as the card's own `value` (e.g. centavos for a money StatCard). */
  value: number;
  label?: string;
}

export interface StatCardProps {
  label: string;
  /** Already-formatted display string (e.g. via `formatMoney` — D-5: never hand-format centavos
   * here or at any call site). */
  value: string;
  /** Where the whole card links to (Doc 06 principle 5). */
  href: AppPath;
  /** Reserved for KOK-052 ("Dashboard v2") — not rendered yet. */
  delta?: StatCardDelta;
  /** Reserved for KOK-052 ("Dashboard v2") — not rendered yet. */
  sparkline?: number[];
  className?: string;
  /** Extra content under the headline value, e.g. the bank/cash breakdown row. */
  children?: ReactNode;
}

export function StatCard({ label, value, href, className, children }: StatCardProps) {
  return (
    <Link
      to={href}
      className={cn(
        "flex flex-1 flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-sm",
        "transition-colors duration-fast hover:bg-accent",
        className,
      )}
    >
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="numeric-cell font-medium text-2xl text-foreground">{value}</span>
      {children}
    </Link>
  );
}
