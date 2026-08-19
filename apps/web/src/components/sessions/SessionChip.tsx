// Topbar "open session" indicator (Doc 06 §2/§4: "🟢 Producción 2h 15m" example; component named
// `SessionChip` in that same doc, wired here in place of Topbar.tsx's placeholder span). Doc 06
// says clicking it goes straight into the close-session flow; the KB doesn't say what to show when
// more than one session is open at once (gap, noted in packages/shared/src/sessions.ts's own style
// of calling out unspecified cases) — the multi-session case is handled in this same popover. Each
// session shows its type + duration and opens straight to ITS drawer (via `/sessions?open=<id>`,
// KOK-027's own addition to router.tsx — no other screen in this app deep-links to one specific
// record yet, so this is a new, narrowly-scoped convention, not an existing one being reused);
// Multiple OPEN sessions use the same popover to list each session with its own detail and close
// actions.

import type { SessionDto, SessionListItemDto } from "@kokoro/shared";
import { nowIso, updateSessionCommandSchema } from "@kokoro/shared";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useToast } from "@/components/ui/toast";
import { useSession, useSessions, useUpdateSession } from "@/features/sessions/api";
import { ApiError } from "@/lib/api";
import { sessionsLabels } from "@/lib/i18n-sessions";

import { formatDuration } from "./SessionsTable";

function formatOpenSessionDuration(
  session: Pick<SessionListItemDto, "durationMin" | "startedAt">,
): string {
  if (session.durationMin !== null) return formatDuration(session.durationMin);
  if (session.startedAt) {
    const elapsedMinutes = Math.floor((Date.now() - Date.parse(session.startedAt)) / 60_000);
    if (Number.isFinite(elapsedMinutes)) return formatDuration(Math.max(0, elapsedMinutes));
  }
  return sessionsLabels.chip.elapsedUnknown;
}

function buildCloseCommand(session: SessionDto) {
  return {
    type: session.type,
    businessDate: session.businessDate,
    startedAt: session.startedAt ?? undefined,
    endedAt: nowIso(),
    notes: session.notes ?? undefined,
    costLines: session.costLines.map((line) => ({
      label: line.label,
      amount: line.amount,
      isEstimate: line.isEstimate,
      accountId: line.accountId ?? undefined,
    })),
    status: "CLOSED" as const,
  };
}

function OpenSessionPopover({
  children,
  position,
  popoverRef,
  width,
}: {
  children: ReactNode;
  position: { top: number; right: number };
  popoverRef: RefObject<HTMLDivElement | null>;
  width: "w-44" | "w-64";
}) {
  return createPortal(
    <div
      ref={popoverRef}
      style={{ top: position.top, right: position.right }}
      className={`fixed z-50 flex ${width} flex-col gap-0.5 rounded-md border border-border bg-card p-1 shadow-lg`}
    >
      {children}
    </div>,
    document.body,
  );
}

function OpenSessionMenuItem({
  session,
  onClosed,
}: {
  session: SessionListItemDto;
  onClosed: () => void;
}) {
  const navigate = useNavigate();
  const { show } = useToast();
  const sessionQuery = useSession(session.id);
  const stopMutation = useUpdateSession(session.id);

  async function handleStop(): Promise<void> {
    const fullSession = sessionQuery.data?.session ?? (await sessionQuery.refetch()).data?.session;
    if (!fullSession) {
      show({ message: sessionsLabels.errors.generic });
      return;
    }
    const parsed = updateSessionCommandSchema.safeParse({
      ...buildCloseCommand(fullSession),
    });
    if (!parsed.success) {
      show({ message: parsed.error.issues[0]?.message ?? sessionsLabels.errors.generic });
      return;
    }
    try {
      await stopMutation.mutateAsync(parsed.data);
      onClosed();
    } catch (err) {
      show({ message: err instanceof ApiError ? err.message : sessionsLabels.errors.generic });
    }
  }

  return (
    <div className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent">
      <button
        type="button"
        className="min-w-0 flex-1 text-left text-xs"
        onClick={() => navigate({ to: "/sessions", search: { open: session.id } })}
      >
        <span className="block truncate font-medium">
          {sessionsLabels.typeLabels[session.type]}
        </span>
        <span className="block truncate text-muted-foreground">
          {formatOpenSessionDuration(session)}
        </span>
      </button>
      <button
        type="button"
        className="shrink-0 rounded px-1.5 py-1 text-left text-xs hover:bg-background"
        onClick={() => void handleStop()}
        disabled={stopMutation.isPending}
      >
        {sessionsLabels.chip.stopNow}
      </button>
    </div>
  );
}

export function SessionChip() {
  const navigate = useNavigate();
  const { show } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const openSessionsQuery = useSessions({ status: "OPEN" });
  const openSessions = openSessionsQuery.data?.sessions ?? [];
  const session = openSessions.length === 1 ? openSessions[0] : undefined;
  const sessionQuery = useSession(session?.id);
  const stopMutation = useUpdateSession(session?.id ?? "");

  useEffect(() => {
    if (!menuOpen) return;
    function handleOutsideClick(event: MouseEvent) {
      if (
        !(event.target instanceof Node) ||
        menuRef.current?.contains(event.target) ||
        popoverRef.current?.contains(event.target)
      )
        return;
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) {
      setMenuPosition(null);
      return;
    }
    const updateMenuPosition = () => {
      const trigger = menuRef.current?.querySelector("button");
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuOpen]);

  async function handleStop() {
    const fullSession = sessionQuery.data?.session;
    if (!fullSession) {
      show({ message: sessionsLabels.errors.generic });
      return;
    }
    const parsed = updateSessionCommandSchema.safeParse(buildCloseCommand(fullSession));
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
      <div ref={menuRef} className="relative z-50">
        <button
          type="button"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-accent"
        >
          <span className="size-1.5 rounded-full bg-positive" />
          {sessionsLabels.chip.multipleOpen(openSessions.length)}
        </button>
        {menuOpen && menuPosition ? (
          <OpenSessionPopover position={menuPosition} popoverRef={popoverRef} width="w-64">
            {openSessions.map((openSession) => (
              <OpenSessionMenuItem
                key={openSession.id}
                session={openSession}
                onClosed={() => setMenuOpen(false)}
              />
            ))}
          </OpenSessionPopover>
        ) : null}
      </div>
    );
  }

  if (!session) return null;
  const duration =
    session.durationMin !== null
      ? formatDuration(session.durationMin)
      : sessionsLabels.chip.elapsedUnknown;

  return (
    <div ref={menuRef} className="relative z-50">
      <button
        type="button"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-accent"
      >
        <span className="size-1.5 rounded-full bg-positive" />
        {sessionsLabels.typeLabels[session.type]} {duration}
      </button>
      {menuOpen && menuPosition ? (
        <OpenSessionPopover position={menuPosition} popoverRef={popoverRef} width="w-44">
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
        </OpenSessionPopover>
      ) : null}
    </div>
  );
}
