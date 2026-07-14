# jobs/

Plain functions implementing the scheduled Cron Trigger jobs (Doc 02 §4.4): `daily-snapshot`,
`replacement-cost-refresh`, `alerts`, `backup`, `weekly-digest`. Dispatched from the Worker's
`scheduled()` handler in `src/index.ts` (currently a logging-only stub); each run is recorded in
the `job_runs` table for observability. First populated by KOK-021+.
