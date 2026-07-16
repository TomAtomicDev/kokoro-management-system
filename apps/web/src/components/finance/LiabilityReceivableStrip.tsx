// Liability/receivable strip — SC-10: "Anticipos de clientes (v_liability) + Por cobrar
// (v_receivables)". PLACEHOLDER ONLY (Doc 10 KOK-015 scope note): those views are populated by the
// sales/orders event services, which don't exist until Phase 3. Querying them now would be
// structurally-always-zero and untestable in any meaningful way, so this renders static "—" tiles
// with no live query — swap in a real hook the day KOK-0xx (Phase 3) ships those services.

import { financeLabels } from "@/lib/i18n-finance";

function PlaceholderStat({ label }: { label: string }) {
  return (
    <div className="flex flex-1 flex-col gap-1 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="flex items-baseline justify-between">
        <span className="numeric-cell text-subtle-foreground text-lg">—</span>
        <span className="text-subtle-foreground text-xs">{financeLabels.comingSoon}</span>
      </div>
    </div>
  );
}

export function LiabilityReceivableStrip() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <PlaceholderStat label={financeLabels.liabilityLabel} />
      <PlaceholderStat label={financeLabels.receivableLabel} />
    </div>
  );
}
