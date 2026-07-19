// TanStack Query hooks over /api/inventory/* (KOK-017 read-only views + KOK-018 stock-exit
// reads/write). Same shape as features/finance/api.ts and features/purchases/api.ts: plain
// useQuery with filters folded into the query key, and a mutation whose onSuccess invalidates the
// "inventory" root key (stock/kardex/exits/waste-summary all move together when an exit is
// recorded — INV-5 style consistency — so one shared root key is invalidated rather than four
// separate ones, mirroring purchasing's single PURCHASES_ROOT_KEY precedent).

import type {
  CommitCountResult,
  DeleteStockExitCommand,
  DeleteStockExitResult,
  InventoryCountDto,
  ListCountsFilters,
  ListCountsResult,
  ListKardexFilters,
  ListKardexResult,
  ListStockExitsFilters,
  ListStockExitsResult,
  ListStockFilters,
  ListStockResult,
  ListWasteSummaryFilters,
  ListWasteSummaryResult,
  RecordStockExitCommand,
  RecordStockExitResult,
  ReplayImpactDto,
  StartCountCommand,
  StartCountResult,
  StockExitDto,
  StockExitImpactRequest,
  UpdateCountLineResult,
  UpdateStockExitCommand,
  UpdateStockExitResult,
} from "@kokoro/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

const INVENTORY_ROOT_KEY = ["inventory"] as const;

function stockFiltersToQueryString(filters: ListStockFilters): string {
  const params = new URLSearchParams();
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.lowStockOnly) params.set("lowStockOnly", "true");
  if (filters.negativeOnly) params.set("negativeOnly", "true");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useStock(filters: ListStockFilters = {}) {
  return useQuery({
    queryKey: [...INVENTORY_ROOT_KEY, "stock", filters] as const,
    queryFn: () =>
      api.get<ListStockResult>(`/inventory/stock${stockFiltersToQueryString(filters)}`),
  });
}

type KardexFilters = Omit<ListKardexFilters, "itemId">;

function kardexFiltersToQueryString(itemId: string, filters: KardexFilters): string {
  const params = new URLSearchParams();
  params.set("itemId", itemId);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  return `?${params.toString()}`;
}

/** `enabled: !!itemId` — the drawer only fetches once an item is selected (SC-08's row -> Kardex
 * drawer interaction is always scoped to one item; `itemId` is required server-side). */
export function useKardex(itemId: string | null, filters: KardexFilters = {}) {
  return useQuery({
    queryKey: [...INVENTORY_ROOT_KEY, "kardex", itemId, filters] as const,
    queryFn: () =>
      api.get<ListKardexResult>(
        `/inventory/kardex${kardexFiltersToQueryString(itemId as string, filters)}`,
      ),
    enabled: !!itemId,
  });
}

// --- Stock exits (KOK-018, UC-09) -------------------------------------------------------------

function exitsFiltersToQueryString(filters: ListStockExitsFilters): string {
  const params = new URLSearchParams();
  if (filters.itemId) params.set("itemId", filters.itemId);
  if (filters.reason) params.set("reason", filters.reason);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useStockExits(filters: ListStockExitsFilters = {}) {
  return useQuery({
    queryKey: [...INVENTORY_ROOT_KEY, "exits", filters] as const,
    queryFn: () =>
      api.get<ListStockExitsResult>(`/inventory/exits${exitsFiltersToQueryString(filters)}`),
  });
}

/** `enabled: !!id` — mirrors `usePurchase`'s / `useCount`'s precedent: the detail drawer only
 * fetches once an exit is selected. GET /inventory/exits/:id returns the bare `StockExitDto`
 * (not wrapped in `{ exit }`), same as the record/update mutations' `.exit` is unwrapped here. */
export function useStockExit(id: string | undefined) {
  return useQuery({
    queryKey: [...INVENTORY_ROOT_KEY, "exits", "detail", id ?? ""] as const,
    queryFn: () => api.get<StockExitDto>(`/inventory/exits/${id}`),
    enabled: Boolean(id),
  });
}

function wasteSummaryFiltersToQueryString(filters: ListWasteSummaryFilters): string {
  const params = new URLSearchParams();
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useWasteSummary(filters: ListWasteSummaryFilters = {}) {
  return useQuery({
    queryKey: [...INVENTORY_ROOT_KEY, "waste-summary", filters] as const,
    queryFn: () =>
      api.get<ListWasteSummaryResult>(
        `/inventory/waste-summary${wasteSummaryFiltersToQueryString(filters)}`,
      ),
  });
}

function useInvalidateInventory() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: INVENTORY_ROOT_KEY });
}

export function useRecordStockExit() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (command: RecordStockExitCommand) =>
      api.post<RecordStockExitResult>("/inventory/exits", command),
    onSuccess: invalidate,
  });
}

// --- Edit / delete / restore / impact preview (KOK-024 Phase G) -----------------------------
//
// Same shape and same non-goal as purchasing's equivalent four (features/purchases/api.ts):
// plain, correctly-typed mutations only. The retry-with-confirm dance for the R-5 replay-
// confirmation contract belongs to whatever UI composes these with
// `useReplayConfirmableMutation` (apps/web/src/hooks/useReplayConfirmableMutation.ts).

export function useUpdateStockExit(id: string) {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (command: UpdateStockExitCommand) =>
      api.patch<UpdateStockExitResult>(`/inventory/exits/${id}`, command),
    onSuccess: invalidate,
  });
}

export function useDeleteStockExit(id: string) {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (command: DeleteStockExitCommand) =>
      api.delete<DeleteStockExitResult>(`/inventory/exits/${id}`, command),
    onSuccess: invalidate,
  });
}

export function useRestoreStockExit(id: string) {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (command: DeleteStockExitCommand) =>
      api.post<UpdateStockExitResult>(`/inventory/exits/${id}/restore`, command),
    onSuccess: invalidate,
  });
}

/** Dry-run preview (no write, so no cache to invalidate) — mirrors
 * usePreviewPurchaseImpact's precedent (features/purchases/api.ts). */
export function usePreviewStockExitImpact() {
  return useMutation({
    mutationFn: (request: StockExitImpactRequest) =>
      api.post<ReplayImpactDto>("/inventory/exits/impact", request),
  });
}

// --- Inventory counts (KOK-019, UC-10) --------------------------------------------------------

function countsFiltersToQueryString(filters: ListCountsFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useCounts(filters: ListCountsFilters = {}) {
  return useQuery({
    queryKey: [...INVENTORY_ROOT_KEY, "counts", filters] as const,
    queryFn: () =>
      api.get<ListCountsResult>(`/inventory/counts${countsFiltersToQueryString(filters)}`),
  });
}

/** `enabled: !!countId` — mirrors `useKardex`'s pattern: the detail drawer only fetches once a
 * count is selected. */
export function useCount(countId: string | null) {
  return useQuery({
    queryKey: [...INVENTORY_ROOT_KEY, "counts", "detail", countId] as const,
    queryFn: () => api.get<InventoryCountDto>(`/inventory/counts/${countId}`),
    enabled: !!countId,
  });
}

export function useStartCount() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (command: StartCountCommand) =>
      api.post<StartCountResult>("/inventory/counts", command),
    onSuccess: invalidate,
  });
}

interface UpdateCountLineInput {
  countId: string;
  itemId: string;
  countedQty: number;
}

export function useUpdateCountLine() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ countId, itemId, countedQty }: UpdateCountLineInput) =>
      api.patch<UpdateCountLineResult>(`/inventory/counts/${countId}/lines/${itemId}`, {
        countedQty,
      }),
    onSuccess: invalidate,
  });
}

export function useCommitCount() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (countId: string) =>
      api.post<CommitCountResult>(`/inventory/counts/${countId}/commit`),
    onSuccess: invalidate,
  });
}
