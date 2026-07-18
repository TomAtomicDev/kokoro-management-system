import type { DashboardSummaryDto } from "@kokoro/shared";
import { formatMoney } from "@kokoro/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { LowStockStrip } from "@/components/dashboard/LowStockStrip";
import { QuickAddShortcuts } from "@/components/dashboard/QuickAddShortcuts";
import { StatCard } from "@/components/dashboard/StatCard";
import { useDashboardSummary } from "@/features/dashboard/api";
import { useOnboardingStatus } from "@/features/onboarding/api";
import { dashboardLabels } from "@/lib/i18n-dashboard";

// SC-01 · Dashboard, reduced scope (KOK-023): cash total (bank+cash split), stock value,
// low-stock strip, quick-add shortcuts. Every number links to its source screen (Doc 06
// principle 5 / UX-5) — see StatCard.tsx and LowStockStrip.tsx for the link targets.
//
// Explicitly OUT of scope here (KOK-052 "Dashboard v2"): sales/profit/Bs-per-hour StatCards,
// deltas/sparklines, margin-at-risk top-5, upcoming orders, the 30-day sales chart, and the
// general alerts strip (only the low-stock subset ships now).
function CashBreakdown({ cash }: { cash: DashboardSummaryDto["cash"] }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground text-xs">
      <span>
        {dashboardLabels.cashBank}: {formatMoney(cash.bank)}
      </span>
      <span>
        {dashboardLabels.cashCash}: {formatMoney(cash.cash)}
      </span>
    </div>
  );
}

export function PanelRoute() {
  const navigate = useNavigate();
  const statusQuery = useOnboardingStatus();

  // The one piece of real logic that predates SC-01 (KOK-020): redirect to the first-run wizard
  // while onboarding is incomplete. Guarded by `!isLoading` so this never fires on the query's
  // initial undefined-data render, and by `data.completed === false` so it only fires once the
  // status is known — never on a fetch error.
  useEffect(() => {
    if (!statusQuery.isLoading && statusQuery.data?.completed === false) {
      navigate({ to: "/onboarding" });
    }
  }, [statusQuery.isLoading, statusQuery.data, navigate]);

  const summaryQuery = useDashboardSummary();
  const summary = summaryQuery.data;
  const cashValue =
    summaryQuery.isLoading || !summary ? dashboardLabels.loading : formatMoney(summary.cash.total);
  const stockValue =
    summaryQuery.isLoading || !summary ? dashboardLabels.loading : formatMoney(summary.stockValue);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">{dashboardLabels.title}</h1>
        <p className="text-muted-foreground text-sm">{dashboardLabels.subtitle}</p>
      </div>

      <QuickAddShortcuts />

      <div className="flex flex-col gap-3 sm:flex-row">
        <StatCard label={dashboardLabels.cashTotal} value={cashValue} href="/finance">
          {summary ? <CashBreakdown cash={summary.cash} /> : null}
        </StatCard>

        <StatCard label={dashboardLabels.stockValue} value={stockValue} href="/inventory" />
      </div>

      <LowStockStrip rows={summary?.lowStock ?? []} loading={summaryQuery.isLoading} />
    </div>
  );
}
