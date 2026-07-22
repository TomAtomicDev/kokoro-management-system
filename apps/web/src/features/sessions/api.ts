// TanStack Query hooks over /api/sessions (KOK-027 frontend). Mirrors features/purchases/api.ts's
// shape, minus the replay-confirmation / photo-upload surface: sessions never trigger a costing
// replay (packages/shared/src/sessions.ts's header), so update/delete/restore are plain mutations
// here — no `useReplayConfirmableMutation` wrapping, unlike purchases/production-runs.

import type {
  DeleteSessionCommand,
  DeleteSessionResult,
  GetSessionResult,
  ListSessionsFilters,
  ListSessionsResult,
  RecordSessionCommand,
  RecordSessionResult,
  RestoreSessionResult,
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

export function useUpdateSession(id: string) {
  const invalidate = useInvalidateSessions();
  return useMutation({
    mutationFn: (command: UpdateSessionCommand) =>
      api.patch<UpdateSessionResult>(`/sessions/${id}`, command),
    onSuccess: invalidate,
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
