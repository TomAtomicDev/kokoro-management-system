// TanStack Query hooks over /api/finance/* (KOK-015, consuming KOK-014's finance API). Every
// mutation invalidates both "accounts" (balances move) and "transactions" (a new row appears) so
// the account cards and the transactions table reconcile automatically — same pattern as
// features/catalog/api.ts.

import type {
  DeleteTransactionCommand,
  DeleteTransactionResult,
  FinanceSummaryDto,
  ListAccountsResult,
  ListReceivablesQuery,
  ListTransactionsFilters,
  ListTransactionsResult,
  ReceivablesResponseDto,
  RecordTransactionCommand,
  RecordTransactionResult,
  RestoreTransactionResult,
  TransferCommand,
  TransferResult,
  UpdateTransactionCommand,
  UpdateTransactionResult,
  WithdrawCommand,
  WithdrawResult,
} from "@kokoro/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { FORM_SAVE_ERROR_META } from "@/lib/form-save-errors";

// Exported so other features whose commands move an account balance without going through
// core/finance directly (e.g. core/sales' collectPayment, KOK-031) can invalidate it too, instead
// of duplicating this literal.
export const ACCOUNTS_KEY = ["finance", "accounts"] as const;
export const FINANCE_SUMMARY_KEY = ["finance", "summary"] as const;
export const RECEIVABLES_KEY = ["finance", "receivables"] as const;
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

export function useFinanceSummary() {
  return useQuery({
    queryKey: FINANCE_SUMMARY_KEY,
    queryFn: () => api.get<FinanceSummaryDto>("/finance/summary"),
  });
}

function receivablesListKey(filters: ListReceivablesQuery) {
  return [...RECEIVABLES_KEY, "list", filters] as const;
}

function receivablesFiltersToQueryString(filters: ListReceivablesQuery): string {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.minAgeDays !== undefined) params.set("minAgeDays", String(filters.minAgeDays));
  params.set("sortBy", filters.sortBy);
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  return `?${params.toString()}`;
}

/** SC-21's all-dates grouped receivables read (KOK-197). Summary stays global across filters. */
export function useGroupedReceivables(filters: ListReceivablesQuery) {
  return useQuery({
    queryKey: receivablesListKey(filters),
    queryFn: () =>
      api.get<ReceivablesResponseDto>(`/receivables${receivablesFiltersToQueryString(filters)}`),
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
    meta: FORM_SAVE_ERROR_META,
    mutationFn: (command: RecordTransactionCommand) =>
      api.post<RecordTransactionResult>("/finance/transactions", command),
    onSuccess: invalidate,
  });
}

export function useUpdateTransaction(id: string) {
  const invalidate = useInvalidateFinance();
  return useMutation({
    meta: FORM_SAVE_ERROR_META,
    mutationFn: (command: UpdateTransactionCommand) =>
      api.patch<UpdateTransactionResult>(`/finance/transactions/${id}`, command),
    onSuccess: invalidate,
  });
}

export function useDeleteTransaction() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ id, command }: { id: string; command: DeleteTransactionCommand }) =>
      api.delete<DeleteTransactionResult>(`/finance/transactions/${id}`, command),
    onSuccess: invalidate,
  });
}

export function useRestoreTransaction() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ id, command }: { id: string; command: DeleteTransactionCommand }) =>
      api.post<RestoreTransactionResult>(`/finance/transactions/${id}/restore`, command),
    onSuccess: invalidate,
  });
}

export function useTransfer() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    meta: FORM_SAVE_ERROR_META,
    mutationFn: (command: TransferCommand) =>
      api.post<TransferResult>("/finance/transfers", command),
    onSuccess: invalidate,
  });
}

export function useWithdraw() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    meta: FORM_SAVE_ERROR_META,
    mutationFn: (command: WithdrawCommand) =>
      api.post<WithdrawResult>("/finance/withdrawals", command),
    onSuccess: invalidate,
  });
}
