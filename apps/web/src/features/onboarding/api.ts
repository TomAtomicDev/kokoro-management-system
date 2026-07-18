// TanStack Query hooks over /api/onboarding/* (KOK-020, Doc 07 steps 1-5). Same shape as
// features/catalog/api.ts / features/inventory/api.ts: plain useQuery/useMutation, mutations
// invalidate the "onboarding" root key so `useOnboardingStatus` (gating the `/` redirect, see
// routes/panel.tsx) reconciles automatically. The balance/catalog mutations additionally
// invalidate finance's ACCOUNTS_KEY and catalog's ITEMS_ROOT_KEY — same cross-invalidation
// precedent features/finance/api.ts (accounts+transactions) and features/catalog/api.ts (items)
// already set for those roots — so /finance and /inventory's Stock tab show the wizard's writes
// without a manual refresh.

import type {
  BulkCreateItemsCommand,
  BulkCreateItemsResult,
  OnboardingCompleteResult,
  OnboardingStatusResult,
  SetOpeningBalancesCommand,
  SetOpeningBalancesResult,
} from "@kokoro/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

const ONBOARDING_ROOT_KEY = ["onboarding"] as const;
// Mirrors features/finance/api.ts's ACCOUNTS_KEY and features/catalog/api.ts's ITEMS_ROOT_KEY
// exactly — invalidating the same query keys those features already use, not a redeclaration of
// their query logic.
const ACCOUNTS_KEY = ["finance", "accounts"] as const;
const ITEMS_ROOT_KEY = ["items"] as const;

export function useOnboardingStatus() {
  return useQuery({
    queryKey: ["onboarding", "status"],
    queryFn: () => api.get<OnboardingStatusResult>("/onboarding/status"),
  });
}

export function useSetOpeningBalances() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: SetOpeningBalancesCommand) =>
      api.post<SetOpeningBalancesResult>("/onboarding/opening-balances", command),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ONBOARDING_ROOT_KEY });
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    },
  });
}

export function useBulkCreateItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: BulkCreateItemsCommand) =>
      api.post<BulkCreateItemsResult>("/onboarding/catalog", command),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ONBOARDING_ROOT_KEY });
      queryClient.invalidateQueries({ queryKey: ITEMS_ROOT_KEY });
    },
  });
}

export function useCompleteOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<OnboardingCompleteResult>("/onboarding/complete"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ONBOARDING_ROOT_KEY }),
  });
}
