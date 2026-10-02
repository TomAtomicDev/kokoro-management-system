// TanStack Query hooks over /api/orders (KOK-034 frontend, Doc 07 SC-04). Mirrors features/
// sales/api.ts's shape: a root key + list/detail key helpers, a query hook per resource, and a
// mutation whose onSuccess invalidates the root key.
//
// Agreement/lifecycle mutations invalidate order reads. Delivery/undo/cancel also move orders into
// or out of derived debt/exposure, so they invalidate every consumer of KOK-207's projection.
//
// deliverOrder is the only transition that writes kardex movements (Doc 03 O-8), so it's the only
// one wrapped with the R-5 replay-confirmation dance at the UI layer (OrderDetailDrawer composes it
// with useReplayConfirmableMutation, same precedent as SaleForm's edit path) — the plain mutation
// exposed here just posts the command and lets the caller catch the 409.

import type {
  CancelOrderCommand,
  CancelOrderResult,
  ConfirmOrderCommand,
  ConfirmOrderResult,
  DeliverOrderCommand,
  DeliverOrderResult,
  ListOrdersFilters,
  ListOrdersResult,
  OrderDto,
  OrderImpactRequest,
  OrderListCursor,
  OrderReceiptSummaryDto,
  OrderTransitionResult,
  QuoteOrderCommand,
  QuoteOrderResult,
  ReplayImpactDto,
  UndoDeliverOrderCommand,
  UpdateOrderCommand,
  UpdateOrderResult,
} from "@kokoro/shared";
import { serializeOrderListCursor } from "@kokoro/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { DASHBOARD_SUMMARY_KEY } from "@/features/dashboard/api";
import { FINANCE_SUMMARY_KEY, RECEIVABLES_KEY } from "@/features/finance/api";
import { ORDERS_ROOT_KEY, orderReceiptSummaryKey } from "@/features/orders/query-keys";
import { api } from "@/lib/api";
import { FORM_SAVE_ERROR_META } from "@/lib/form-save-errors";

function ordersListKey(filters: ListOrdersFilters) {
  return [...ORDERS_ROOT_KEY, "list", filters] as const;
}

function orderDetailKey(id: string) {
  return [...ORDERS_ROOT_KEY, "detail", id] as const;
}

function filtersToQueryString(filters: ListOrdersFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.excludeStatuses?.length)
    params.set("excludeStatuses", filters.excludeStatuses.join(","));
  if (filters.customerId) params.set("customerId", filters.customerId);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.cursor) params.set("cursor", serializeOrderListCursor(filters.cursor));
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useOrders(filters: ListOrdersFilters = {}) {
  return useQuery({
    queryKey: ordersListKey(filters),
    queryFn: async (): Promise<ListOrdersResult> => {
      const orders: OrderDto[] = [];
      const seenCursors = new Set(filters.cursor ? [serializeOrderListCursor(filters.cursor)] : []);
      let pageFilters = filters;

      while (true) {
        const page = await api.get<ListOrdersResult>(`/orders${filtersToQueryString(pageFilters)}`);
        orders.push(...page.orders);

        const nextCursor: OrderListCursor | null = page.nextCursor;
        if (nextCursor === null) return { orders, nextCursor: null };

        const serializedCursor = serializeOrderListCursor(nextCursor);
        if (seenCursors.has(serializedCursor)) {
          throw new Error("Orders pagination returned a repeated cursor.");
        }
        seenCursors.add(serializedCursor);
        pageFilters = { ...filters, cursor: nextCursor };
      }
    },
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: orderDetailKey(id ?? ""),
    queryFn: () => api.get<OrderDto>(`/orders/${id}`),
    enabled: Boolean(id),
  });
}

export function useOrderReceiptSummary(id: string | undefined) {
  return useQuery({
    queryKey: orderReceiptSummaryKey(id ?? ""),
    queryFn: () => api.get<OrderReceiptSummaryDto>(`/orders/${id}/receipt-summary`),
    enabled: Boolean(id),
  });
}

function useInvalidateOrders() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ORDERS_ROOT_KEY });
}

function useInvalidateOrderFinanceReads() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: FINANCE_SUMMARY_KEY });
    queryClient.invalidateQueries({ queryKey: RECEIVABLES_KEY });
    queryClient.invalidateQueries({ queryKey: DASHBOARD_SUMMARY_KEY });
  };
}

export function useQuoteOrder() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    meta: FORM_SAVE_ERROR_META,
    mutationFn: (command: QuoteOrderCommand) => api.post<QuoteOrderResult>("/orders", command),
    onSuccess: invalidate,
  });
}

export function useUpdateOrder(id: string) {
  const invalidate = useInvalidateOrders();
  const queryClient = useQueryClient();
  return useMutation({
    meta: FORM_SAVE_ERROR_META,
    mutationFn: (command: UpdateOrderCommand) =>
      api.patch<UpdateOrderResult>(`/orders/${id}`, command),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: orderReceiptSummaryKey(id) });
    },
  });
}

export function useConfirmOrder(id: string) {
  const invalidate = useInvalidateOrders();
  return useMutation({
    meta: FORM_SAVE_ERROR_META,
    mutationFn: (command: ConfirmOrderCommand) =>
      api.post<ConfirmOrderResult>(`/orders/${id}/confirm`, command),
    onSuccess: invalidate,
  });
}

export function useStartOrderProduction(id: string) {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: () => api.post<OrderTransitionResult>(`/orders/${id}/start-production`, {}),
    onSuccess: invalidate,
  });
}

export function useMarkOrderReady(id: string) {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: () => api.post<OrderTransitionResult>(`/orders/${id}/ready`, {}),
    onSuccess: invalidate,
  });
}

export function useUndoStartOrderProduction(id: string) {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: () => api.post<OrderTransitionResult>(`/orders/${id}/undo-start-production`, {}),
    onSuccess: invalidate,
  });
}

export function useUndoMarkOrderReady(id: string) {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: () => api.post<OrderTransitionResult>(`/orders/${id}/undo-ready`, {}),
    onSuccess: invalidate,
  });
}

export function useDeliverOrder(id: string) {
  const invalidate = useInvalidateOrders();
  const invalidateFinanceReads = useInvalidateOrderFinanceReads();
  return useMutation({
    meta: FORM_SAVE_ERROR_META,
    mutationFn: (command: DeliverOrderCommand) =>
      api.post<DeliverOrderResult>(`/orders/${id}/deliver`, command),
    onSuccess: () => {
      invalidate();
      invalidateFinanceReads();
    },
  });
}

// The order-owned sale is soft-deleted and stock is reversed; finance rows and accounts stay intact.
export function useUndoDeliverOrder(id: string) {
  const invalidate = useInvalidateOrders();
  const invalidateFinanceReads = useInvalidateOrderFinanceReads();
  return useMutation({
    mutationFn: (command: UndoDeliverOrderCommand) =>
      api.post<OrderTransitionResult>(`/orders/${id}/undo-deliver`, command),
    onSuccess: () => {
      invalidate();
      invalidateFinanceReads();
    },
  });
}

export function useCancelOrder(id: string) {
  const invalidate = useInvalidateOrders();
  const invalidateFinanceReads = useInvalidateOrderFinanceReads();
  return useMutation({
    mutationFn: (command: CancelOrderCommand) =>
      api.post<CancelOrderResult>(`/orders/${id}/cancel`, command),
    onSuccess: () => {
      invalidate();
      invalidateFinanceReads();
    },
  });
}

/** Dry-run preview (no write, so no cache to invalidate) — mirrors usePreviewSaleImpact. */
export function usePreviewOrderImpact() {
  return useMutation({
    mutationFn: (request: OrderImpactRequest) =>
      api.post<ReplayImpactDto>("/orders/impact", request),
  });
}
