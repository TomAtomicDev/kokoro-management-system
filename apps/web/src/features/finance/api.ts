// TanStack Query hooks over /api/finance/* (KOK-015, consuming KOK-014's finance API). Every
// mutation invalidates both "accounts" (balances move) and "transactions" (a new row appears) so
// the account cards and the transactions table reconcile automatically — same pattern as
// features/catalog/api.ts.

import type {
  ListAccountsResult,
  ListTransactionsFilters,
  ListTransactionsResult,
  RecordTransactionCommand,
  RecordTransactionResult,
  TransferCommand,
  TransferResult,
  WithdrawCommand,
  WithdrawResult,
} from "@kokoro/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

const ACCOUNTS_KEY = ["finance", "accounts"] as const;
const TRANSACTIONS_ROOT_KEY = ["finance", "transactions"] as const;

function transactionsListKey(filters: ListTransactionsFilters) {
  return [...TRANSACTIONS_ROOT_KEY, "list", filters] as const;
}

function filtersToQueryString(filters: ListTransactionsFilters): string {
  const params = new URLSearchParams();
  if (filters.accountId) params.set("accountId", filters.accountId);
  if (filters.category) params.set("category", filters.category);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useAccounts() {
  return useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: () => api.get<ListAccountsResult>("/finance/accounts"),
  });
}

export function useTransactions(filters: ListTransactionsFilters = {}) {
  return useQuery({
    queryKey: transactionsListKey(filters),
    queryFn: () =>
      api.get<ListTransactionsResult>(`/finance/transactions${filtersToQueryString(filters)}`),
  });
}

function useInvalidateFinance() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    queryClient.invalidateQueries({ queryKey: TRANSACTIONS_ROOT_KEY });
  };
}

export function useRecordTransaction() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (command: RecordTransactionCommand) =>
      api.post<RecordTransactionResult>("/finance/transactions", command),
    onSuccess: invalidate,
  });
}

export function useTransfer() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (command: TransferCommand) =>
      api.post<TransferResult>("/finance/transfers", command),
    onSuccess: invalidate,
  });
}

export function useWithdraw() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (command: WithdrawCommand) =>
      api.post<WithdrawResult>("/finance/withdrawals", command),
    onSuccess: invalidate,
  });
}
