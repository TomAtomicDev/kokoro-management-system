import type { ListAssemblyDefinitionsFilters, ListAssemblyDefinitionsResult } from "@kokoro/shared";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

const ASSEMBLY_DEFINITIONS_ROOT_KEY = ["assembly-definitions"] as const;

function assemblyDefinitionsListKey(filters: ListAssemblyDefinitionsFilters) {
  return [...ASSEMBLY_DEFINITIONS_ROOT_KEY, "list", filters] as const;
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
