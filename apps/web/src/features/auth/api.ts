// TanStack Query hooks over /api/auth/* (SC-18, KOK-063). `sessionQueryKey`/`fetchSession` are
// also used directly (not just via a hook) by the router's `_authenticated` beforeLoad guard —
// see router.tsx — so it can call `queryClient.ensureQueryData` without a React render.

import type { LoginCommand } from "@kokoro/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

export const sessionQueryKey = ["auth", "session"] as const;

interface SessionResult {
  ok: true;
}

export function fetchSession(): Promise<SessionResult> {
  return api.get<SessionResult>("/auth/session");
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    // Tagged so lib/query-client.ts's global 401 handler can skip it — a 401 here means "wrong
    // password" (an in-place form error), not "session expired" (a redirect-to-login).
    mutationKey: ["auth", "login"],
    mutationFn: (command: LoginCommand) => api.post<SessionResult>("/auth/login", command),
    onSuccess: (result) => {
      // Seed the cache so the _authenticated guard's ensureQueryData doesn't immediately refetch
      // on the very next navigation.
      queryClient.setQueryData(sessionQueryKey, result);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>("/auth/logout"),
    onSuccess: () => {
      // Owner-only, single-tenant app (Doc 06 principle 6 territory) — a full cache clear on
      // logout is simpler and safer than picking which queries are "user data" vs not.
      queryClient.clear();
    },
  });
}
