// TanStack Query hooks over /api/recipes (KOK-025 frontend). Mirrors features/purchases/api.ts's
// shape exactly: a root key + list/detail key helpers, a query hook per resource, and a mutation
// whose onSuccess invalidates the whole root key (covering both list and detail entries, since
// detail keys are prefixed by it).
//
// No replay-confirmation dance here (unlike purchases' edit/delete) — recipes.ts's header comment
// is explicit: a recipe is catalog/config, not a movement-affecting business event, so `update`
// and `setActive` are plain mutations.

import type {
  GetRecipeResult,
  ListRecipesFilters,
  ListRecipesResult,
  RecordRecipeCommand,
  RecordRecipeResult,
  SetRecipeActiveCommand,
  SetRecipeActiveResult,
  UpdateRecipeCommand,
  UpdateRecipeResult,
} from "@kokoro/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

const RECIPES_ROOT_KEY = ["recipes"] as const;

function recipesListKey(filters: ListRecipesFilters) {
  return [...RECIPES_ROOT_KEY, "list", filters] as const;
}

function recipeDetailKey(id: string) {
  return [...RECIPES_ROOT_KEY, "detail", id] as const;
}

function filtersToQueryString(filters: ListRecipesFilters): string {
  const params = new URLSearchParams();
  if (filters.outputItemId) params.set("outputItemId", filters.outputItemId);
  if (filters.isActive !== undefined) params.set("isActive", String(filters.isActive));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useRecipesQuery(filters: ListRecipesFilters = {}) {
  return useQuery({
    queryKey: recipesListKey(filters),
    queryFn: () => api.get<ListRecipesResult>(`/recipes${filtersToQueryString(filters)}`),
  });
}

export function useRecipeQuery(id: string | undefined) {
  return useQuery({
    queryKey: recipeDetailKey(id ?? ""),
    queryFn: () => api.get<GetRecipeResult>(`/recipes/${id}`),
    enabled: Boolean(id),
  });
}

function useInvalidateRecipes() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: RECIPES_ROOT_KEY });
}

export function useRecordRecipe() {
  const invalidate = useInvalidateRecipes();
  return useMutation({
    mutationFn: (command: RecordRecipeCommand) => api.post<RecordRecipeResult>("/recipes", command),
    onSuccess: invalidate,
  });
}

export function useUpdateRecipe(id: string) {
  const invalidate = useInvalidateRecipes();
  return useMutation({
    mutationFn: (command: UpdateRecipeCommand) =>
      api.patch<UpdateRecipeResult>(`/recipes/${id}`, command),
    onSuccess: invalidate,
  });
}

export function useSetRecipeActive() {
  const invalidate = useInvalidateRecipes();
  return useMutation({
    mutationFn: (command: SetRecipeActiveCommand) =>
      api.post<SetRecipeActiveResult>(`/recipes/${command.id}/active`, command),
    onSuccess: invalidate,
  });
}
