import type {
  GetAssemblyDefinitionResult,
  ListAssemblyDefinitionsFilters,
  ListAssemblyDefinitionsResult,
  RecordAssemblyDefinitionCommand,
  RecordAssemblyDefinitionResult,
  SetAssemblyDefinitionActiveCommand,
  SetAssemblyDefinitionActiveResult,
  UpdateAssemblyDefinitionCommand,
  UpdateAssemblyDefinitionResult,
} from "@kokoro/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

const ASSEMBLY_DEFINITIONS_ROOT_KEY = ["assembly-definitions"] as const;

function assemblyDefinitionsListKey(filters: ListAssemblyDefinitionsFilters) {
  return [...ASSEMBLY_DEFINITIONS_ROOT_KEY, "list", filters] as const;
}

function assemblyDefinitionDetailKey(id: string) {
  return [...ASSEMBLY_DEFINITIONS_ROOT_KEY, "detail", id] as const;
}

function filtersToQueryString(filters: ListAssemblyDefinitionsFilters): string {
  const params = new URLSearchParams();
  if (filters.outputItemId) params.set("outputItemId", filters.outputItemId);
  if (filters.isActive !== undefined) params.set("isActive", String(filters.isActive));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useAssemblyDefinitions(filters: ListAssemblyDefinitionsFilters = {}) {
  return useQuery({
    queryKey: assemblyDefinitionsListKey(filters),
    queryFn: () =>
      api.get<ListAssemblyDefinitionsResult>(
        `/assembly-definitions${filtersToQueryString(filters)}`,
      ),
  });
}

export function useAssemblyDefinition(id: string | undefined) {
  return useQuery({
    queryKey: assemblyDefinitionDetailKey(id ?? ""),
    queryFn: () => api.get<GetAssemblyDefinitionResult>(`/assembly-definitions/${id}`),
    enabled: Boolean(id),
  });
}

function useInvalidateAssemblyDefinitions() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ASSEMBLY_DEFINITIONS_ROOT_KEY });
}

export function useRecordAssemblyDefinition() {
  const invalidate = useInvalidateAssemblyDefinitions();
  return useMutation({
    mutationFn: (command: RecordAssemblyDefinitionCommand) =>
      api.post<RecordAssemblyDefinitionResult>("/assembly-definitions", command),
    onSuccess: invalidate,
  });
}

export function useUpdateAssemblyDefinition(id: string) {
  const invalidate = useInvalidateAssemblyDefinitions();
  return useMutation({
    mutationFn: (command: UpdateAssemblyDefinitionCommand) =>
      api.patch<UpdateAssemblyDefinitionResult>(`/assembly-definitions/${id}`, command),
    onSuccess: invalidate,
  });
}

export function useSetAssemblyDefinitionActive() {
  const invalidate = useInvalidateAssemblyDefinitions();
  return useMutation({
    mutationFn: ({ id, isActive }: SetAssemblyDefinitionActiveCommand) =>
      api.post<SetAssemblyDefinitionActiveResult>(`/assembly-definitions/${id}/active`, {
        isActive,
      }),
    onSuccess: invalidate,
  });
}
