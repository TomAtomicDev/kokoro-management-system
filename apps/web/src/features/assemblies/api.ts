// TanStack Query hooks over /api/assemblies. Mirrors features/production-runs/api.ts: a root key,
// list/detail key helpers, one query hook per resource, and mutations that invalidate the root key.
// R-5 retry-with-confirm orchestration belongs to the caller via useReplayConfirmableMutation.

import type {
  AssemblyImpactRequest,
  DeleteAssemblyCommand,
  DeleteAssemblyResult,
  GetAssemblyResult,
  ListAssembliesFilters,
  ListAssembliesResult,
  RecordAssemblyCommand,
  RecordAssemblyResult,
  ReplayImpactDto,
  UpdateAssemblyCommand,
  UpdateAssemblyResult,
} from "@kokoro/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

const ASSEMBLIES_ROOT_KEY = ["assemblies"] as const;

function assembliesListKey(filters: ListAssembliesFilters) {
  return [...ASSEMBLIES_ROOT_KEY, "list", filters] as const;
}

function assemblyDetailKey(id: string) {
  return [...ASSEMBLIES_ROOT_KEY, "detail", id] as const;
}

function filtersToQueryString(filters: ListAssembliesFilters): string {
  const params = new URLSearchParams();
  if (filters.outputItemId) params.set("outputItemId", filters.outputItemId);
  if (filters.customOrderId) params.set("customOrderId", filters.customOrderId);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useAssemblies(filters: ListAssembliesFilters = {}) {
  return useQuery({
    queryKey: assembliesListKey(filters),
    queryFn: () => api.get<ListAssembliesResult>(`/assemblies${filtersToQueryString(filters)}`),
  });
}

export function useAssembly(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: assemblyDetailKey(id ?? ""),
    queryFn: () => api.get<GetAssemblyResult>(`/assemblies/${id}`),
    enabled: Boolean(id) && enabled,
  });
}

function useInvalidateAssemblies() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ASSEMBLIES_ROOT_KEY });
}

function useInvalidateAssemblyLists() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: [...ASSEMBLIES_ROOT_KEY, "list"] });
}

export function useRecordAssembly() {
  const invalidate = useInvalidateAssemblies();
  return useMutation({
    mutationFn: (command: RecordAssemblyCommand) =>
      api.post<RecordAssemblyResult>("/assemblies", command),
    onSuccess: invalidate,
  });
}

export function useUpdateAssembly(id: string) {
  const invalidate = useInvalidateAssemblies();
  return useMutation({
    mutationFn: (command: UpdateAssemblyCommand) =>
      api.patch<UpdateAssemblyResult>(`/assemblies/${id}`, command),
    onSuccess: invalidate,
  });
}

export function useDeleteAssembly(id: string) {
  // The deleted detail stops existing immediately. Invalidating the root here would refetch the
  // still-mounted drawer once before its success callback closes it, producing a spurious 404.
  const invalidate = useInvalidateAssemblyLists();
  return useMutation({
    mutationFn: (command: DeleteAssemblyCommand) =>
      api.delete<DeleteAssemblyResult>(`/assemblies/${id}`, command),
    onSuccess: invalidate,
  });
}

export function useRestoreAssembly(id: string) {
  const invalidate = useInvalidateAssemblies();
  return useMutation({
    mutationFn: (command: DeleteAssemblyCommand) =>
      api.post<UpdateAssemblyResult>(`/assemblies/${id}/restore`, command),
    onSuccess: invalidate,
  });
}

/** Dry-run preview: no write and therefore no cache invalidation. */
export function usePreviewAssemblyImpact() {
  return useMutation({
    mutationFn: (request: AssemblyImpactRequest) =>
      api.post<ReplayImpactDto>("/assemblies/impact", request),
  });
}
