// Topbar "open session" indicator (Doc 06 §2/§4: "🟢 Producción 2h 15m" example; component named
// `SessionChip` in that same doc, wired here in place of Topbar.tsx's placeholder span). Doc 06
// says clicking it goes straight into the close-session flow; the KB doesn't say what to show when
// more than one session is open at once (gap, noted in packages/shared/src/sessions.ts's own style
// of calling out unspecified cases) — this picks the simplest defensible rule: exactly one OPEN
// session shows its type + duration and opens straight to ITS drawer (via `/sessions?open=<id>`,
// KOK-027's own addition to router.tsx — no other screen in this app deep-links to one specific
// record yet, so this is a new, narrowly-scoped convention, not an existing one being reused);
// more than one shows a compact count and just goes to the list.

import { useNavigate } from "@tanstack/react-router";

import { useSessions } from "@/features/sessions/api";
import { sessionsLabels } from "@/lib/i18n-sessions";

import { formatDuration } from "./SessionsTable";

export function SessionChip() {
  const navigate = useNavigate();
  const openSessionsQuery = useSessions({ status: "OPEN" });
  const openSessions = openSessionsQuery.data?.sessions ?? [];

  if (openSessions.length === 0) {
    return (
      <span className="hidden items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-muted-foreground text-xs sm:flex">
        <span className="size-1.5 rounded-full bg-muted-foreground" />
        {sessionsLabels.chip.noOpenSession}
      </span>
    );
  }

  if (openSessions.length > 1) {
    return (
      <button
        type="button"
        onClick={() => navigate({ to: "/sessions" })}
        className="hidden items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs sm:flex hover:bg-accent"
      >
        <span className="size-1.5 rounded-full bg-positive" />
        {sessionsLabels.chip.multipleOpen(openSessions.length)}
      </button>
    );
  }

  const session = openSessions[0];
  if (!session) return null;
  const duration =
    session.durationMin !== null
      ? formatDuration(session.durationMin)
      : sessionsLabels.chip.elapsedUnknown;

  return (
    <button
      type="button"
      onClick={() => navigate({ to: "/sessions", search: { open: session.id } })}
      className="hidden items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs sm:flex hover:bg-accent"
    >
      <span className="size-1.5 rounded-full bg-positive" />
      {sessionsLabels.typeLabels[session.type]} {duration}
    </button>
  );
}
