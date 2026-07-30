// TanStack Query hooks over /api/price-health + /api/pricing-settings (KOK-036, Doc 07 SC-12).
// "Actualizar precio" (Doc 07: "writes price_history + items.sale_price") reuses catalog.ts's
// `updateItemCommandSchema`/`updateItem` — no new command here (D-4) — so `useUpdatePriceMutation`
// is a thin PATCH wrapper that additionally invalidates the price-health cache the plain
// `useUpdateItemMutation` (features/catalog/api.ts) doesn't know about.

import type {
  ItemDto,
  ListPriceHealthResult,
  PricingSettingsDto,
  UpdateItemCommand,
} from "@kokoro/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

const PRICE_HEALTH_ROOT_KEY = ["price-health"] as const;

export function usePriceHealth() {
  return useQuery({
    queryKey: PRICE_HEALTH_ROOT_KEY,
    queryFn: () => api.get<ListPriceHealthResult>("/price-health"),
  });
}

/** Standalone C-5 threshold read (KOK-036) for screens that need the badge threshold without a
 * full price-health/recipes payload — SC-03's per-line margin preview. */
export function usePricingSettings() {
  return useQuery({
    queryKey: ["pricing-settings"] as const,
    queryFn: () => api.get<PricingSettingsDto>("/pricing-settings"),
  });
}

/** "Actualizar precio" (SC-12): a plain `updateItem` PATCH, but invalidating both the "items" key
 * (so ItemPicker/catalog screens reconcile) and price-health's own key (this table's source). */
export function useUpdatePriceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: UpdateItemCommand) => api.patch<ItemDto>(`/items/${command.id}`, command),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRICE_HEALTH_ROOT_KEY });
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
  });
}
