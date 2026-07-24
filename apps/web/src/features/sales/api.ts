// TanStack Query hooks over /api/sales (KOK-030/KOK-031 frontend). Mirrors features/purchases/
// api.ts's shape: a root key + list/detail key helpers, a query hook per resource, and a mutation
// whose onSuccess invalidates the root key.
//
// Scope: KOK-030 shipped CREATE + READ only (recordSale/listSales/getSale). KOK-031 adds UC-04's
// collectPayment + the receivables read (listReceivables/v_receivables) — still no generic
// update/delete/restore for a sale itself (that's KOK-064), so this stays short of purchases/
// inventory's full edit/delete/restore quartet.
//
// recordSale/collectPayment also move stock (item_stock) / an account balance
// (financial_accounts) on the server — same precedent as recordPurchase's header comment: there's
// no shared cross-feature invalidation surface yet, so collectPayment additionally invalidates
// finance's ACCOUNTS_KEY directly (imported, not duplicated) alongside the sales keys below.

import type {
  CollectPaymentCommand,
  CollectPaymentResult,
  ListReceivablesResult,
  ListSalesFilters,
  ListSalesResult,
  RecordSaleCommand,
  RecordSaleResult,
  SaleDto,
} from "@kokoro/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ACCOUNTS_KEY } from "@/features/finance/api";
import { api } from "@/lib/api";

const SALES_ROOT_KEY = ["sales"] as const;
const RECEIVABLES_KEY = [...SALES_ROOT_KEY, "receivables"] as const;

function salesListKey(filters: ListSalesFilters) {
  return [...SALES_ROOT_KEY, "list", filters] as const;
}

function saleDetailKey(id: string) {
  return [...SALES_ROOT_KEY, "detail", id] as const;
}

function filtersToQueryString(filters: ListSalesFilters): string {
  const params = new URLSearchParams();
  if (filters.customerId) params.set("customerId", filters.customerId);
  if (filters.paymentStatus) params.set("paymentStatus", filters.paymentStatus);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useSales(filters: ListSalesFilters = {}) {
  return useQuery({
    queryKey: salesListKey(filters),
    queryFn: () => api.get<ListSalesResult>(`/sales${filtersToQueryString(filters)}`),
  });
}

export function useSale(id: string | undefined) {
  return useQuery({
    queryKey: saleDetailKey(id ?? ""),
    queryFn: () => api.get<SaleDto>(`/sales/${id}`),
    enabled: Boolean(id),
  });
}

function useInvalidateSales() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: SALES_ROOT_KEY });
}

export function useRecordSale() {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: (command: RecordSaleCommand) => api.post<RecordSaleResult>("/sales", command),
    onSuccess: invalidate,
  });
}

/** SC-02's "Por cobrar" preset aging (KOK-031) — `v_receivables` via GET /sales/receivables. Only
 * fetched while the preset is active (`enabled`), same precedent as useSale's `enabled: Boolean(id)`. */
export function useReceivables(enabled = true) {
  return useQuery({
    queryKey: RECEIVABLES_KEY,
    queryFn: () => api.get<ListReceivablesResult>("/sales/receivables"),
    enabled,
  });
}

/** UC-04 (KOK-031): collects a receivable. Also invalidates finance's ACCOUNTS_KEY — the credited
 * account's balance moves server-side, exactly like recordSale's PAID branch already implies for
 * the Finance screen, just deferred to whenever this runs instead of at sale time. */
export function useCollectPayment() {
  const invalidateSales = useInvalidateSales();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ saleId, ...command }: CollectPaymentCommand & { saleId: string }) =>
      api.post<CollectPaymentResult>(`/sales/${saleId}/collect-payment`, command),
    onSuccess: () => {
      invalidateSales();
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    },
  });
}
