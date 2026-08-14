// Topbar "open session" indicator (Doc 06 §2/§4: "🟢 Producción 2h 15m" example; component named
// `SessionChip` in that same doc, wired here in place of Topbar.tsx's placeholder span). Doc 06
// says clicking it goes straight into the close-session flow; the KB doesn't say what to show when
// more than one session is open at once (gap, noted in packages/shared/src/sessions.ts's own style
// of calling out unspecified cases) — this picks the simplest defensible rule: exactly one OPEN
// session shows its type + duration and opens straight to ITS drawer (via `/sessions?open=<id>`,
// KOK-027's own addition to router.tsx — no other screen in this app deep-links to one specific
// record yet, so this is a new, narrowly-scoped convention, not an existing one being reused);
// more than one shows a compact count and just goes to the list.

import { nowIso, updateSessionCommandSchema } from "@kokoro/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components/ui/toast";
import { useSession, useSessions, useUpdateSession } from "@/features/sessions/api";
import { ApiError } from "@/lib/api";
import { sessionsLabels } from "@/lib/i18n-sessions";

import { formatDuration } from "./SessionsTable";

export function SessionChip() {
  const navigate = useNavigate();
  const { show } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const openSessionsQuery = useSessions({ status: "OPEN" });
  const openSessions = openSessionsQuery.data?.sessions ?? [];
  const session = openSessions.length === 1 ? openSessions[0] : undefined;
  const sessionQuery = useSession(session?.id);
  const stopMutation = useUpdateSession(session?.id ?? "");

  useEffect(() => {
    if (!menuOpen) return;
    function handleOutsideClick(event: MouseEvent) {
      if (!(event.target instanceof Node) || menuRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [menuOpen]);

  async function handleStop() {
    const fullSession = sessionQuery.data?.session;
    if (!fullSession) {
      show({ message: sessionsLabels.errors.generic });
      return;
    }
    const parsed = updateSessionCommandSchema.safeParse({
      type: fullSession.type,
      businessDate: fullSession.businessDate,
      startedAt: fullSession.startedAt ?? undefined,
      endedAt: nowIso(),
      notes: fullSession.notes ?? undefined,
      costLines: fullSession.costLines.map((line) => ({
        label: line.label,
        amount: line.amount,
        isEstimate: line.isEstimate,
        accountId: line.accountId ?? undefined,
      })),
      status: "CLOSED",
    });
    if (!parsed.success) {
      show({ message: parsed.error.issues[0]?.message ?? sessionsLabels.errors.generic });
      return;
    }
    try {
      await stopMutation.mutateAsync(parsed.data);
      setMenuOpen(false);
    } catch (err) {
      show({ message: err instanceof ApiError ? err.message : sessionsLabels.errors.generic });
    }
  }

  if (openSessions.length === 0) {
    return (
      <span className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-muted-foreground text-xs">
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
        className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-accent"
      >
        <span className="size-1.5 rounded-full bg-positive" />
        {sessionsLabels.chip.multipleOpen(openSessions.length)}
      </button>
    );
  }

  if (!session) return null;
  const duration =
    session.durationMin !== null
      ? formatDuration(session.durationMin)
      : sessionsLabels.chip.elapsedUnknown;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-accent"
      >
        <span className="size-1.5 rounded-full bg-positive" />
        {sessionsLabels.typeLabels[session.type]} {duration}
      </button>
      {menuOpen ? (
        <div className="absolute right-0 top-full z-20 mt-1 flex w-44 flex-col gap-0.5 rounded-md border border-border bg-card p-1 shadow-lg">
          <button
            type="button"
            className="rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
            onClick={() => {
              setMenuOpen(false);
              navigate({ to: "/sessions", search: { open: session.id } });
            }}
          >
            {sessionsLabels.chip.viewDetail}
          </button>
          <button
            type="button"
            className="rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
            onClick={handleStop}
            disabled={stopMutation.isPending}
          >
            {sessionsLabels.chip.stopNow}
          </button>
        </div>
      ) : null}
    </div>
  );
}
