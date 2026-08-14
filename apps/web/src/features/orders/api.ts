// TanStack Query hooks over /api/orders (KOK-034 frontend, Doc 07 SC-04). Mirrors features/
// sales/api.ts's shape: a root key + list/detail key helpers, a query hook per resource, and a
// mutation whose onSuccess invalidates the root key.
//
// Every lifecycle mutation (confirm/start/ready/deliver/cancel/resolveLine) also invalidates
// finance's ACCOUNTS_KEY whenever it can move an account balance (confirm/deliver/cancel), same
// precedent as useCollectPayment/useRecordSale in features/sales/api.ts — there's no shared
// cross-feature invalidation surface yet.
//
// deliverOrder is the only transition that writes kardex movements (Doc 03 O-2), so it's the only
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
  OrderTransitionResult,
  QuoteOrderCommand,
  QuoteOrderResult,
  ReplayImpactDto,
  ResolveOrderLineCommand,
  ResolveOrderLineResult,
  UndoDeliverOrderCommand,
} from "@kokoro/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ACCOUNTS_KEY } from "@/features/finance/api";
import { api } from "@/lib/api";

const ORDERS_ROOT_KEY = ["orders"] as const;

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
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useOrders(filters: ListOrdersFilters = {}) {
  return useQuery({
    queryKey: ordersListKey(filters),
    queryFn: () => api.get<ListOrdersResult>(`/orders${filtersToQueryString(filters)}`),
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: orderDetailKey(id ?? ""),
    queryFn: () => api.get<OrderDto>(`/orders/${id}`),
    enabled: Boolean(id),
  });
}

function useInvalidateOrders() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ORDERS_ROOT_KEY });
}

export function useQuoteOrder() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: (command: QuoteOrderCommand) => api.post<QuoteOrderResult>("/orders", command),
    onSuccess: invalidate,
  });
}

export function useConfirmOrder(id: string) {
  const invalidate = useInvalidateOrders();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: ConfirmOrderCommand) =>
      api.post<ConfirmOrderResult>(`/orders/${id}/confirm`, command),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    },
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
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: DeliverOrderCommand) =>
      api.post<DeliverOrderResult>(`/orders/${id}/deliver`, command),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    },
  });
}

// Mirrors useDeliverOrder exactly (invalidates ACCOUNTS_KEY too — money moves).
export function useUndoDeliverOrder(id: string) {
  const invalidate = useInvalidateOrders();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: UndoDeliverOrderCommand) =>
      api.post<OrderTransitionResult>(`/orders/${id}/undo-deliver`, command),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    },
  });
}

export function useCancelOrder(id: string) {
  const invalidate = useInvalidateOrders();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: CancelOrderCommand) =>
      api.post<CancelOrderResult>(`/orders/${id}/cancel`, command),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    },
  });
}

/** KOK-034: attaches a catalog item to one free-text line (`resolveOrderLine`, the one narrow
 * exception to "no generic update order" — see packages/shared/src/orders.ts's header). */
export function useResolveOrderLine(orderId: string) {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: ({ lineId, ...command }: ResolveOrderLineCommand & { lineId: string }) =>
      api.post<ResolveOrderLineResult>(`/orders/${orderId}/lines/${lineId}/resolve`, command),
    onSuccess: invalidate,
  });
}

/** Dry-run preview (no write, so no cache to invalidate) — mirrors usePreviewSaleImpact. */
export function usePreviewOrderImpact() {
  return useMutation({
    mutationFn: (request: OrderImpactRequest) =>
      api.post<ReplayImpactDto>("/orders/impact", request),
  });
}
