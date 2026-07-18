// SC-16 · Backups — /settings/backups (Doc 07). Status-only screen for KOK-021's "backup" Cron
// Trigger job (KOK-022): last run's timestamp/status plus a download link for the produced .sql
// file. Restore tooling and the drill procedure are KOK-056 — see
// docs/runbooks/backup-restore.md.

import { BackupCard } from "@/components/backups/BackupCard";
import { useBackupStatus } from "@/features/backups/api";
import { backupsLabels } from "@/lib/i18n-backups";

export function SettingsBackupsRoute() {
  const backupStatusQuery = useBackupStatus();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">{backupsLabels.title}</h1>
        <p className="text-muted-foreground text-sm">{backupsLabels.subtitle}</p>
      </div>

      {backupStatusQuery.isLoading ? (
        <p className="text-muted-foreground text-sm">{backupsLabels.loading}</p>
      ) : backupStatusQuery.isError ? (
        <p className="text-negative text-sm">{backupsLabels.error}</p>
      ) : (
        <BackupCard status={backupStatusQuery.data ?? null} />
      )}
    </div>
  );
}
