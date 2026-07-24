# jobs/

Plain functions implementing the scheduled Cron Trigger jobs (Doc 02 §4.4): `daily-snapshot`,
`replacement-cost-refresh`, `alerts`, `backup`, `weekly-digest`. Dispatched from the Worker's
`scheduled()` handler in `src/index.ts` via `index.ts`'s `runJob(db, jobName, bucket)` registry
(`bucket` was added for `backup`'s R2 access — every other handler ignores it); every run is
recorded in the `job_runs` table for observability, even the two jobs with no real
implementation yet (they write an `ok=1`/`'not yet implemented'` row via a shared stub).

- `daily-snapshot.ts` — `runDailySnapshot` (KOK-021): the `daily_snapshots` row (INV-5) and
  INV-5's stock/balance/WAC consistency sentinel — `core/inventory`'s
  `getStockConsistencyMismatches`, `core/finance`'s `getBalanceConsistencyMismatches`, and (as of
  KOK-024/ADR-016) `core/costing`'s `detectWacDrift` across all active items. All three are
  detection only, logged into `job_runs.detail`, no auto-repair; see the file's header for why —
  WAC drift used to be silently repaired here (ADR-009), but the synchronous replay
  (`core/costing/replay.ts`) now owns that correction R-4/R-5-correctly.
- `backup.ts` — `runBackup` (KOK-022): dumps every business/event/derived/system table as SQL
  `INSERT` text, uploads it to R2 under `backups/<businessDate>-<isoTimestamp>.sql`, and sweeps
  `backups/` for objects past `app_settings.backup_retention_days`. See the file's header for the
  exact table list/exclusions and `docs/runbooks/backup-restore.md` for the restore-format pointer
  (full restore tooling is KOK-056).
- `replacement-cost-refresh.ts` — `runReplacementCostRefresh` (KOK-029): recomputes
  `items.replacement_cost` (C-3) for every SEMI_FINISHED/FINISHED item with an active default
  recipe, via `core/costing`'s `planReplacementCostRefresh` — dependency-ordered so nested BOMs
  (raw material -> semi-finished -> finished) settle within one run. See the file's header.
- `alerts`, `weekly-digest` — not yet implemented (KOK-046 for the first; `weekly-digest` has no
  confirmed backlog id yet — the original KOK-021 draft of this README guessed `KOK-022` for it,
  but KOK-022 is "Backups to R2", the `backup` job above); `index.ts`'s registry stubs them for
  now.
