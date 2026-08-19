import { useNavigate } from "@tanstack/react-router";
import { Bell, LogOut, Search } from "lucide-react";

import { SessionChip } from "@/components/sessions/SessionChip";
import { Button } from "@/components/ui/button";
import { useLogout } from "@/features/auth/api";
import { authLabels } from "@/lib/i18n-auth";
import { topbarLabels } from "@/lib/i18n-nav";

// search → ⌘K command palette, bell → AlertsPanel (KOK-0xx) stay visual placeholders. SessionChip
// (KOK-027) is the one placeholder promoted to a real feature here. The logout button (KOK-063,
// SC-18) was already real. No wordmark here — the sidebar carries the one persistent brand moment
// (Doc 06 §2 / design brief). Repeating it in the topbar would make "Kokoro" a daily-flow fixture
// instead of a quiet nod, which the brief explicitly avoids.
export function Topbar({ onOpenQuickAdd }: { onOpenQuickAdd: () => void }) {
  const navigate = useNavigate();
  const logoutMutation = useLogout();

  async function handleLogout() {
    await logoutMutation.mutateAsync().catch(() => {
      // Logout is idempotent from the owner's perspective (no session is the desired end state)
      // — redirect to /login regardless of whether the request itself succeeded.
    });
    await navigate({ to: "/login" });
  }

  return (
    <header className="flex h-[var(--layout-topbar-height)] shrink-0 items-center gap-3 border-border border-b bg-card px-4">
      <button
        type="button"
        disabled
        className="hidden h-9 flex-1 max-w-sm items-center gap-2 rounded-md border border-input bg-muted px-3 text-muted-foreground text-sm disabled:cursor-not-allowed"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 text-left">{topbarLabels.searchPlaceholder}</span>
        <kbd className="rounded border border-border px-1.5 py-0.5 text-xs">
          {topbarLabels.searchShortcutHint}
        </kbd>
      </button>

      <div className="ml-auto flex flex-nowrap items-center gap-2 overflow-x-auto">
        <Button size="sm" onClick={onOpenQuickAdd}>
          {topbarLabels.quickAdd}
        </Button>

        {/* Alerts stay hidden until KOK-046 restores this as a real, non-placeholder control. */}
        <button
          type="button"
          disabled
          aria-label={topbarLabels.alerts}
          className="hidden flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:cursor-not-allowed"
        >
          <Bell className="size-4" />
        </button>

        <SessionChip />

        <button
          type="button"
          onClick={handleLogout}
          disabled={logoutMutation.isPending}
          aria-label={authLabels.logout}
          title={authLabels.logout}
          className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </header>
  );
}
