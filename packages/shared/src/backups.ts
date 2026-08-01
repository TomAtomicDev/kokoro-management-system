// Backup status DTO (KOK-022, Doc 02 §4.4 "backup" Cron Trigger). Served by GET
// /api/backups/latest — a read of the most recent `job_runs` row for job='backup', with
// `key`/`sizeBytes` parsed out of that row's `detail` JSON (the shape jobs/backup.ts itself writes
// there). Follows the per-feature DTO-file convention (dashboard.ts, finance.ts) from this
// package's barrel (index.ts).

export interface BackupStatusDto {
  /** UTC ISO-8601 — when the last backup job run started. */
  startedAt: string;
  /** UTC ISO-8601 — when it finished. jobs/backup.ts always sets this (its try/catch always
   * records a finishedAt), so null is defensive typing for job_runs.finished_at's nullable column,
   * not an expected state. */
  finishedAt: string | null;
  /** Whether the last run succeeded (`job_runs.ok = 1`). */
  ok: boolean;
  /** R2 object key of the produced backup file (e.g. `backups/2026-07-18-<timestamp>.sql`) — null
   * if the last run failed before producing one. */
  key: string | null;
  /** Size in bytes of the uploaded backup file — null if the last run failed. */
  sizeBytes: number | null;
}
