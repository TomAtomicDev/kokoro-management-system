// TanStack Query hook over /api/audit/:entityType/:entityId (KOK-067). Single generic hook shared
// by every DetailDrawer's edit-history footer — mirrors the read-only shape of usePreviewPurchaseImpact
// (features/purchases/api.ts): no invalidation of its own since nothing here ever writes.

import type { ListAuditLogResult } from "@kokoro/shared";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

/** `enabled: Boolean(entityId)` — mirrors `usePurchase`'s precedent: only fetches once the
 * DetailDrawer actually has an entity loaded. */
export function useAuditLog(entityType: string, entityId: string | undefined) {
  return useQuery({
    queryKey: ["audit", entityType, entityId ?? ""] as const,
    queryFn: () => api.get<ListAuditLogResult>(`/audit/${entityType}/${entityId}`),
    enabled: Boolean(entityId),
  });
}
