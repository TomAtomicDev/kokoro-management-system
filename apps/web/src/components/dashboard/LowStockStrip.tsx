// Low-stock subset of SC-01's alerts strip (KOK-023). Only the low-stock rows ship now — the full
// AlertsPanel (negative-stock, price-health, etc., the topbar bell) is KOK-052 "Dashboard v2"
// scope; this component intentionally shows nothing else.
//
// Every row links to `/inventory` (Doc 06 principle 5 / UX-5), not a `?tab=`-style deep link:
// InventoryRoute's tab (apps/web/src/routes/inventory.tsx) is plain component state
// (`useState<InventoryTab>("stock")`) with no URL search-param wiring today, and "stock" — the tab
// that lists exactly these rows, low-stock pinned on top by `listStock`'s own ordering — is already
// its default. A bare `/inventory` link lands the owner exactly where the badge implies without
// inventing a query-param convention InventoryRoute doesn't support yet (judgment call).

import type { StockRowDto } from "@kokoro/shared";
import { formatQty } from "@kokoro/shared";
import { Link } from "@tanstack/react-router";

import { dashboardLabels } from "@/lib/i18n-dashboard";

export function LowStockStrip({ rows, loading }: { rows: StockRowDto[]; loading?: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground text-sm">{dashboardLabels.lowStockTitle}</span>
        <Link to="/inventory" className="text-primary text-xs hover:underline">
          {dashboardLabels.lowStockViewAll}
        </Link>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">{dashboardLabels.loading}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{dashboardLabels.lowStockEmpty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((row) => (
            <li key={row.itemId}>
              <Link
                to="/inventory"
                className="flex items-center justify-between gap-4 rounded-sm px-1 py-2 text-sm transition-colors duration-fast hover:bg-accent"
              >
                <span className="font-medium text-foreground">{row.name}</span>
                <span className="numeric-cell text-muted-foreground">
                  {formatQty(row.qtyOnHand, row.unit)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
