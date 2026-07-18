// Backup status card (KOK-022, SC-16) — mirrors components/finance/AccountCard.tsx's small-card
// styling precedent. Shows the last nightly "backup" Cron Trigger run's timestamp/status and a
// download link for the produced .sql file (Worker-proxied, ADR-015: no presigned URLs).

import type { BackupStatusDto } from "@kokoro/shared";

import { backupDownloadUrl } from "@/features/backups/api";
import { backupsLabels } from "@/lib/i18n-backups";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function BackupCard({ status }: { status: BackupStatusDto | null }) {
  if (!status) {
    return (
      <div className="flex flex-1 flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-sm">
        <span className="font-medium text-foreground text-sm">{backupsLabels.title}</span>
        <p className="text-muted-foreground text-sm">{backupsLabels.never}</p>
      </div>
    );
  }

  const failed = !status.ok;

  return (
    <div className="flex flex-1 flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground text-sm">{backupsLabels.title}</span>
        <span className={cn("text-xs", failed ? "text-negative" : "text-muted-foreground")}>
          {failed ? backupsLabels.statusFailed : backupsLabels.statusOk}
        </span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground text-xs">{backupsLabels.lastBackup}</span>
        <span className="text-foreground text-sm">
          {new Date(status.startedAt).toLocaleString("es-BO")}
        </span>
      </div>
      {status.sizeBytes !== null ? (
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground text-xs">{backupsLabels.sizeLabel}</span>
          <span className="numeric-cell text-foreground text-sm">
            {formatBytes(status.sizeBytes)}
          </span>
        </div>
      ) : null}
      {status.key && status.ok ? (
        <a
          href={backupDownloadUrl(status.key)}
          target="_blank"
          rel="noreferrer"
          className="text-primary text-sm underline"
        >
          {backupsLabels.download}
        </a>
      ) : null}
    </div>
  );
}
