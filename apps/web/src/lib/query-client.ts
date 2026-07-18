import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { sessionQueryKey } from "@/features/auth/api";
import { ApiError } from "@/lib/api";

// Global 401 handling (KOK-063): a session's 30-day sliding cookie can age out while the SPA
// stays open in a tab, so a UNAUTHORIZED error can surface from any query/mutation, not just on
// initial load (that case is handled separately by the router's `_authenticated` beforeLoad
// guard, which is why the session-check query and the login mutation are excluded below — both
// already own their own in-place handling and would otherwise race this hard redirect).
function isSessionQuery(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === sessionQueryKey[0] && queryKey[1] === sessionQueryKey[1];
}

function isLoginMutation(mutationKey: readonly unknown[] | undefined): boolean {
  return mutationKey?.[0] === "auth" && mutationKey?.[1] === "login";
}

function handleUnauthorized(error: unknown): void {
  if (!(error instanceof ApiError) || error.code !== "UNAUTHORIZED") return;
  queryCache.clear();
  mutationCache.clear();
  window.location.href = "/login";
}

const queryCache = new QueryCache({
  onError: (error, query) => {
    if (isSessionQuery(query.queryKey)) return;
    handleUnauthorized(error);
  },
});

const mutationCache = new MutationCache({
  onError: (error, _variables, _onMutateResult, mutation) => {
    if (isLoginMutation(mutation.options.mutationKey)) return;
    handleUnauthorized(error);
  },
});

// Shared TanStack Query client. `staleTime` favors a snappy UI for an owner-only, single-tenant
// app (Doc 06 principle 6: every mutation gives optimistic UI + invalidation); a short stale
// window still avoids re-fetch storms on rapid navigation between shell routes.
export const queryClient = new QueryClient({
  queryCache,
  mutationCache,
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
