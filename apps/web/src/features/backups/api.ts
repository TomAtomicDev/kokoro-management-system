// TanStack Query hook over GET /api/backups/latest (KOK-022). Mirrors features/dashboard/api.ts's
// shape for a read-only feature: a plain useQuery, no mutations — this route never writes
// anything.

import type { BackupStatusDto } from "@kokoro/shared";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

export function useBackupStatus() {
  return useQuery({
    queryKey: ["backups", "latest"],
    queryFn: () => api.get<BackupStatusDto | null>("/backups/latest"),
  });
}

/** Worker-proxied download URL (ADR-015: no presigned URLs) for a backup's R2 key. The browser
 * navigates here directly — the session cookie is sent automatically on a same-origin request, so
 * a plain `<a href>` works with no fetch-then-blob dance (same precedent as
 * PurchaseDetailDrawer's receipt-photo link). `key` is URL-encoded since it contains `/`
 * (`backups/<date>-<timestamp>.sql`) — matches how the purchase-photo link encodes its own key. */
export function backupDownloadUrl(key: string): string {
  return `/api/backups/${encodeURIComponent(key)}/download`;
}
