// TanStack Query hooks over /api/items + /api/item-aliases (KOK-011). Every mutation invalidates
// the "items" query key so the catalog table and any ItemPicker instance on screen reconcile
// automatically (Doc 06 §6: "every mutation gives optimistic UI + server reconciliation").

import type {
  AddItemAliasCommand,
  CreateItemCommand,
  ItemDto,
  ListItemsFilters,
  ListItemsResult,
  MergeItemsCommand,
  MergeItemsResult,
  SetItemActiveCommand,
  UpdateItemCommand,
} from "@kokoro/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

const ITEMS_ROOT_KEY = ["items"] as const;

function itemsListKey(filters: ListItemsFilters) {
  return [...ITEMS_ROOT_KEY, "list", filters] as const;
}

function itemDetailKey(id: string) {
  return [...ITEMS_ROOT_KEY, "detail", id] as const;
}

function filtersToQueryString(filters: ListItemsFilters): string {
  const params = new URLSearchParams();
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.category) params.set("category", filters.category);
  if (filters.isActive !== undefined) params.set("isActive", String(filters.isActive));
  if (filters.search) params.set("search", filters.search);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useItemsQuery(filters: ListItemsFilters = {}) {
  return useQuery({
    queryKey: itemsListKey(filters),
    queryFn: () => api.get<ListItemsResult>(`/items${filtersToQueryString(filters)}`),
  });
}

export function useItemQuery(id: string | undefined) {
  return useQuery({
    queryKey: itemDetailKey(id ?? ""),
    queryFn: () => api.get<ItemDto>(`/items/${id}`),
    enabled: Boolean(id),
  });
}

function useInvalidateItems() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ITEMS_ROOT_KEY });
}

export function useCreateItemMutation() {
  const invalidate = useInvalidateItems();
  return useMutation({
    mutationFn: (command: CreateItemCommand) => api.post<ItemDto>("/items", command),
    onSuccess: invalidate,
  });
}

export function useUpdateItemMutation() {
  const invalidate = useInvalidateItems();
  return useMutation({
    mutationFn: (command: UpdateItemCommand) => api.patch<ItemDto>(`/items/${command.id}`, command),
    onSuccess: invalidate,
  });
}

export function useSetItemActiveMutation() {
  const invalidate = useInvalidateItems();
  return useMutation({
    mutationFn: (command: SetItemActiveCommand) =>
      api.post<ItemDto>(`/items/${command.id}/active`, command),
    onSuccess: invalidate,
  });
}

export function useAddItemAliasMutation() {
  const invalidate = useInvalidateItems();
  return useMutation({
    mutationFn: (command: AddItemAliasCommand) =>
      api.post(`/items/${command.itemId}/aliases`, command),
    onSuccess: invalidate,
  });
}

export function useRemoveItemAliasMutation() {
  const invalidate = useInvalidateItems();
  return useMutation({
    mutationFn: (aliasId: string) => api.delete(`/item-aliases/${aliasId}`),
    onSuccess: invalidate,
  });
}

export function useMergeItemsMutation() {
  const invalidate = useInvalidateItems();
  return useMutation({
    mutationFn: (command: MergeItemsCommand) => api.post<MergeItemsResult>("/items/merge", command),
    onSuccess: invalidate,
  });
}
