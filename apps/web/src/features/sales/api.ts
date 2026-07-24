// TanStack Query hooks over /api/sales (KOK-030 frontend). Mirrors features/purchases/api.ts's
// shape: a root key + list/detail key helpers, a query hook per resource, and a mutation whose
// onSuccess invalidates the root key.
//
// Scope (KOK-030): CREATE + READ only — core/sales ships `recordSale`/`listSales`/`getSale`
// exactly, with deliberately no update/delete/restore/collectPayment (KOK-031). So unlike
// purchases/inventory's api.ts files, there is no edit/delete/restore quartet here — adding one
// would be UI for an endpoint that doesn't exist yet.
//
// recordSale also moves stock (item_stock) and, for a PAID sale, an account balance
// (financial_accounts) on the server — same precedent as recordPurchase's header comment: there's
// no shared cross-feature invalidation surface yet, so this only invalidates the sales keys below.

import type {
  ListSalesFilters,
  ListSalesResult,
  RecordSaleCommand,
  RecordSaleResult,
  SaleDto,
} from "@kokoro/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

const SALES_ROOT_KEY = ["sales"] as const;

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
