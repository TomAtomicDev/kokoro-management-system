import { QueryClient } from "@tanstack/react-query";

// Shared TanStack Query client. `staleTime` favors a snappy UI for an owner-only, single-tenant
// app (Doc 06 principle 6: every mutation gives optimistic UI + invalidation); a short stale
// window still avoids re-fetch storms on rapid navigation between shell routes.
export const queryClient = new QueryClient({
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
