// TanStack Query hook over GET /api/dashboard/summary (KOK-023, Doc 07 SC-01 reduced scope).
// Mirrors features/onboarding/api.ts's shape for a read-only feature: a plain useQuery, no
// mutations — this route never writes anything.

import type { DashboardSummaryDto } from "@kokoro/shared";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

export function useDashboardSummary() {
  return useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: () => api.get<DashboardSummaryDto>("/dashboard/summary"),
  });
}
