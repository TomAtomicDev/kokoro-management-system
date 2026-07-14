import { Bell, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { topbarLabels } from "@/lib/i18n-nav";

// Visual placeholders only — each wires to a real feature in a later task:
// search → ⌘K command palette, bell → AlertsPanel (KOK-0xx), session chip → SessionChip (KOK-027).
export function Topbar({ onOpenQuickAdd }: { onOpenQuickAdd: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-border border-b bg-background px-4">
      <span className="font-semibold text-brand text-sm tracking-tight">Kokoro</span>

      <button
        type="button"
        disabled
        className="flex h-9 flex-1 max-w-sm items-center gap-2 rounded-md border border-border bg-surface px-3 text-muted-foreground text-sm disabled:cursor-not-allowed"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 text-left">{topbarLabels.searchPlaceholder}</span>
        <kbd className="rounded border border-border px-1.5 py-0.5 text-xs">
          {topbarLabels.searchShortcutHint}
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" onClick={onOpenQuickAdd}>
          {topbarLabels.quickAdd}
        </Button>

        <button
          type="button"
          disabled
          aria-label={topbarLabels.alerts}
          className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-surface disabled:cursor-not-allowed"
        >
          <Bell className="size-4" />
        </button>

        <span className="hidden items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-muted-foreground text-xs sm:flex">
          <span className="size-1.5 rounded-full bg-muted-foreground" />
          {topbarLabels.noOpenSession}
        </span>
      </div>
    </header>
  );
}
