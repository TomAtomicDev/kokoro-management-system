import { SESSION_TYPES, type SessionListItemDto, type SessionType } from "@kokoro/shared";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { buildStartNowCommand } from "@/components/sessions/SessionForm";
import { Button } from "@/components/ui/button";
import { useCloseAndStartSession, useRecordSession, useSessions } from "@/features/sessions/api";
import { ApiError } from "@/lib/api";
import { sessionsLabels } from "@/lib/i18n-sessions";

// Stand-in for the real `QuickAddModal` (Doc 06 §4), which will host every event form
// (venta, compra, producción, gasto, …). Opened here from the sidebar "Registrar" item and the
// topbar "+ Registrar" button — both wire to the same `onOpenChange` state in AppShell.
export function QuickAddModalPlaceholder({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [selectedType, setSelectedType] = useState<SessionType | null>(null);
  const [conflictSessionId, setConflictSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeAndStartMutation = useCloseAndStartSession();

  useEffect(() => {
    if (open) {
      setSelectedType(null);
      setConflictSessionId(null);
      setError(null);
    }
  }, [open]);

  const handleConflict = useCallback((session: SessionListItemDto) => {
    setConflictSessionId(session.id);
  }, []);

  const handleStarted = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleStartError = useCallback((err: unknown) => {
    setSelectedType(null);
    setError(err instanceof ApiError ? err.message : sessionsLabels.errors.generic);
  }, []);

  async function handleCloseAndStart() {
    if (!selectedType || !conflictSessionId) return;
    setError(null);
    try {
      await closeAndStartMutation.mutateAsync({
        closeSessionId: conflictSessionId,
        newSession: buildStartNowCommand(selectedType),
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : sessionsLabels.errors.generic);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{sessionsLabels.quickStart.title}</h2>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        {selectedType && conflictSessionId ? (
          <div className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm">
              {sessionsLabels.quickStart.conflictMessage(sessionsLabels.typeLabels[selectedType])}
            </p>
            {error ? <p className="text-negative text-sm">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedType(null);
                  setConflictSessionId(null);
                  setError(null);
                }}
                disabled={closeAndStartMutation.isPending}
              >
                {sessionsLabels.quickStart.cancel}
              </Button>
              <Button onClick={handleCloseAndStart} disabled={closeAndStartMutation.isPending}>
                {sessionsLabels.quickStart.confirmCloseAndStart}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">{sessionsLabels.quickStart.chooseType}</p>
            <div className="grid grid-cols-2 gap-2">
              {SESSION_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className="rounded-md border border-border bg-card px-3 py-3 text-left font-medium text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    setSelectedType(type);
                    setConflictSessionId(null);
                    setError(null);
                  }}
                  disabled={selectedType !== null}
                >
                  {sessionsLabels.typeLabels[type]}
                </button>
              ))}
            </div>
            {selectedType ? (
              <SelectedTypeStarter
                type={selectedType}
                onConflict={handleConflict}
                onStarted={handleStarted}
                onError={handleStartError}
              />
            ) : null}
            {error ? <p className="text-negative text-sm">{error}</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}

function SelectedTypeStarter({
  type,
  onConflict,
  onStarted,
  onError,
}: {
  type: SessionType;
  onConflict: (session: SessionListItemDto) => void;
  onStarted: () => void;
  onError: (err: unknown) => void;
}) {
  const openSessionsQuery = useSessions({ status: "OPEN", type });
  const recordMutation = useRecordSession();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    if (openSessionsQuery.error) {
      handled.current = true;
      onError(openSessionsQuery.error);
      return;
    }
    if (!openSessionsQuery.data) return;
    handled.current = true;
    const existing = openSessionsQuery.data.sessions[0];
    if (existing) {
      onConflict(existing);
      return;
    }
    recordMutation.mutateAsync(buildStartNowCommand(type)).then(onStarted).catch(onError);
  }, [
    openSessionsQuery.data,
    openSessionsQuery.error,
    onConflict,
    onError,
    onStarted,
    recordMutation,
    type,
  ]);

  return null;
}
