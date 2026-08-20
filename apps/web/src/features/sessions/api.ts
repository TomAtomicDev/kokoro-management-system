// TanStack Query hooks over /api/sessions (KOK-027 frontend). Mirrors features/purchases/api.ts's
// shape, minus the replay-confirmation / photo-upload surface: the session command CONTRACT never
// exposes a costing replay (packages/shared/src/sessions.ts's header — no `confirm` field), so
// update/delete/restore are plain mutations here — no `useReplayConfirmableMutation` wrapping,
// unlike purchases/production-runs. KOK-028 (S-3) is a server-side-only side effect of closing a
// PRODUCTION session (see core/sessions's `updateSession`), applied without a confirmation step
// (that module's header explains why) — so it needs no new field or wrapper here either, just the
// production-runs query invalidation below so a close's per-run cost updates show without a
// manual refresh.

import type {
  CloseAndStartSessionCommand,
  CloseAndStartSessionResult,
  DeleteSessionCommand,
  DeleteSessionResult,
  GetSessionHoursResult,
  GetSessionResult,
  ListSessionsFilters,
  ListSessionsResult,
  RecordSessionCommand,
  RecordSessionResult,
  RestoreSessionResult,
  SessionHoursFilters,
  UpdateSessionCommand,
  UpdateSessionResult,
} from "@kokoro/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

const SESSIONS_ROOT_KEY = ["sessions"] as const;

function sessionsListKey(filters: ListSessionsFilters) {
  return [...SESSIONS_ROOT_KEY, "list", filters] as const;
}

function sessionDetailKey(id: string) {
  return [...SESSIONS_ROOT_KEY, "detail", id] as const;
}

function sessionHoursKey(filters: SessionHoursFilters) {
  return [...SESSIONS_ROOT_KEY, "hours", filters] as const;
}

function filtersToQueryString(filters: ListSessionsFilters): string {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.status) params.set("status", filters.status);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function hoursFiltersToQueryString(filters: SessionHoursFilters): string {
  const params = new URLSearchParams({ fromDate: filters.fromDate, toDate: filters.toDate });
  return `?${params.toString()}`;
}

/** `refetchInterval` keeps the topbar chip's "currently OPEN sessions" view (and the list screen,
 * while it happens to be open) reasonably fresh without a hand-rolled ticking clock — this is an
 * operational, live-status screen (Doc 07 SC-09 / Doc 06 SessionChip), unlike purchases/production
 * which only change on an explicit user action. */
export function useSessions(filters: ListSessionsFilters = {}) {
  return useQuery({
    queryKey: sessionsListKey(filters),
    queryFn: () => api.get<ListSessionsResult>(`/sessions${filtersToQueryString(filters)}`),
    refetchInterval: 60_000,
  });
}

/** KOK-135 / S-5: compares the sum of per-session durations with the deduplicated wall-clock
 * union for the selected business-date range. The existing sessions root invalidation refreshes
 * this read after a session is recorded, edited, closed or restored. */
export function useSessionHours(filters: SessionHoursFilters) {
  return useQuery({
    queryKey: sessionHoursKey(filters),
    queryFn: () =>
      api.get<GetSessionHoursResult>(`/sessions/hours${hoursFiltersToQueryString(filters)}`),
    refetchInterval: 60_000,
  });
}

export function useSession(id: string | undefined) {
  return useQuery({
    queryKey: sessionDetailKey(id ?? ""),
    queryFn: () => api.get<GetSessionResult>(`/sessions/${id}`),
    enabled: Boolean(id),
  });
}

function useInvalidateSessions() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: SESSIONS_ROOT_KEY });
}

export function useRecordSession() {
  const invalidate = useInvalidateSessions();
  return useMutation({
    mutationFn: (command: RecordSessionCommand) =>
      api.post<RecordSessionResult>("/sessions", command),
    onSuccess: invalidate,
  });
}

export function useCloseAndStartSession() {
  const invalidate = useInvalidateSessions();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: CloseAndStartSessionCommand) =>
      api.post<CloseAndStartSessionResult>("/sessions/close-and-start", command),
    onSuccess: () => {
      invalidate();
      // Mirrors useUpdateSession: closing a PRODUCTION session here can trigger the same
      // KOK-028 server-side production-run cost rewrite as any other close, so invalidate
      // production-runs too. See useUpdateSession's comment in this same file for why.
      queryClient.invalidateQueries({ queryKey: ["production-runs"] });
    },
  });
}

export function useUpdateSession(id: string) {
  const invalidate = useInvalidateSessions();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: UpdateSessionCommand) =>
      api.patch<UpdateSessionResult>(`/sessions/${id}`, command),
    onSuccess: () => {
      invalidate();
      // KOK-028: closing a PRODUCTION session may silently rewrite its linked production runs'
      // allocated_session_cost/total_cost server-side (core/sessions's updateSession) — this
      // module has no visibility into whether that happened for THIS command, so it always
      // invalidates rather than trying to detect it client-side. Root key literal, not imported:
      // features/production-runs/api.ts's key is module-private by design (this codebase's own
      // convention — see that file), so this mirrors its exact `["production-runs"]` shape rather
      // than reaching into its module.
      queryClient.invalidateQueries({ queryKey: ["production-runs"] });
    },
  });
}

export function useDeleteSession(id: string) {
  const invalidate = useInvalidateSessions();
  return useMutation({
    mutationFn: (command: DeleteSessionCommand) =>
      api.delete<DeleteSessionResult>(`/sessions/${id}`, command),
    onSuccess: invalidate,
  });
}

export function useRestoreSession(id: string) {
  const invalidate = useInvalidateSessions();
  return useMutation({
    mutationFn: (command: DeleteSessionCommand) =>
      api.post<RestoreSessionResult>(`/sessions/${id}/restore`, command),
    onSuccess: invalidate,
  });
}
