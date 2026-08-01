// TanStack Query hooks over /api/production-runs (KOK-026 frontend). Mirrors
// features/purchases/api.ts's shape exactly: a root key + list/detail key helpers, a query hook
// per resource, and a mutation whose onSuccess invalidates the whole root key.
//
// Edit/delete/restore/impact expose plain, correctly-typed mutations only — the retry-with-confirm
// dance for the R-5 replay-confirmation contract (a 409 CONFLICT carrying a ReplayImpactDto, see
// packages/shared/src/costing.ts) is deliberately NOT wired in here, same precedent as
// features/purchases/api.ts's identical header comment. That orchestration belongs to whatever UI
// composes these with `useReplayConfirmableMutation`
// (apps/web/src/hooks/useReplayConfirmableMutation.ts).
//
// No receipt-photo endpoints — production has no receipt photo (Doc 04 §3.3 has no such column on
// `production_runs`).

import type {
  DeleteProductionRunCommand,
  DeleteProductionRunResult,
  ListProductionRunsFilters,
  ListProductionRunsResult,
  ProductionRunDto,
  ProductionRunImpactRequest,
  RecordProductionRunCommand,
  RecordProductionRunResult,
  ReplayImpactDto,
  UpdateProductionRunCommand,
  UpdateProductionRunResult,
} from "@kokoro/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

const PRODUCTION_RUNS_ROOT_KEY = ["production-runs"] as const;

function productionRunsListKey(filters: ListProductionRunsFilters) {
  return [...PRODUCTION_RUNS_ROOT_KEY, "list", filters] as const;
}

function productionRunDetailKey(id: string) {
  return [...PRODUCTION_RUNS_ROOT_KEY, "detail", id] as const;
}

function filtersToQueryString(filters: ListProductionRunsFilters): string {
  const params = new URLSearchParams();
  if (filters.recipeId) params.set("recipeId", filters.recipeId);
  if (filters.outputItemId) params.set("outputItemId", filters.outputItemId);
  if (filters.customOrderId) params.set("customOrderId", filters.customOrderId);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useProductionRuns(filters: ListProductionRunsFilters = {}) {
  return useQuery({
    queryKey: productionRunsListKey(filters),
    queryFn: () =>
      api.get<ListProductionRunsResult>(`/production-runs${filtersToQueryString(filters)}`),
  });
}

export function useProductionRun(id: string | undefined) {
  return useQuery({
    queryKey: productionRunDetailKey(id ?? ""),
    queryFn: () => api.get<ProductionRunDto>(`/production-runs/${id}`),
    enabled: Boolean(id),
  });
}

function useInvalidateProductionRuns() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: PRODUCTION_RUNS_ROOT_KEY });
}

export function useRecordProductionRun() {
  const invalidate = useInvalidateProductionRuns();
  return useMutation({
    mutationFn: (command: RecordProductionRunCommand) =>
      api.post<RecordProductionRunResult>("/production-runs", command),
    onSuccess: invalidate,
  });
}

// --- Edit / delete / restore / impact preview ------------------------------------------------

export function useUpdateProductionRun(id: string) {
  const invalidate = useInvalidateProductionRuns();
  return useMutation({
    mutationFn: (command: UpdateProductionRunCommand) =>
      api.patch<UpdateProductionRunResult>(`/production-runs/${id}`, command),
    onSuccess: invalidate,
  });
}

export function useDeleteProductionRun(id: string) {
  const invalidate = useInvalidateProductionRuns();
  return useMutation({
    mutationFn: (command: DeleteProductionRunCommand) =>
      api.delete<DeleteProductionRunResult>(`/production-runs/${id}`, command),
    onSuccess: invalidate,
  });
}

export function useRestoreProductionRun(id: string) {
  const invalidate = useInvalidateProductionRuns();
  return useMutation({
    mutationFn: (command: DeleteProductionRunCommand) =>
      api.post<UpdateProductionRunResult>(`/production-runs/${id}/restore`, command),
    onSuccess: invalidate,
  });
}

/** Dry-run preview (no write, so no cache to invalidate) — used to render an ImpactConfirmDialog
 * BEFORE the caller ever attempts the real edit/delete, or composed with
 * `useReplayConfirmableMutation`'s own captured impact from a refused mutation. */
export function usePreviewProductionRunImpact() {
  return useMutation({
    mutationFn: (request: ProductionRunImpactRequest) =>
      api.post<ReplayImpactDto>("/production-runs/impact", request),
  });
}
