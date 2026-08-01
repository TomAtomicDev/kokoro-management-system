# Runbook: Backup restore (stub)

> This is a pointer stub, not a full runbook. Full restore tooling and a drill procedure are
> **KOK-056** (not yet started). Until that lands, restoring from a backup is a manual, unverified
> process — treat it as a last resort, not a rehearsed operation.

## What gets backed up

Every night (`backup` Cron Trigger, `0 7 * * *` UTC / 03:00 America/La_Paz, see
`apps/worker/wrangler.toml` and Doc 02 §4.4), `apps/worker/src/jobs/backup.ts` dumps every
business/event/derived/system table (catalog, sessions, purchases, sales, production, inventory,
financial accounts/transactions, `app_settings`, `daily_snapshots`, `audit_log` — see that file's
own header comment for the exact list and the tables it deliberately excludes, e.g.
`telegram_updates`, `assistant_interactions`) as plain SQL text: one `INSERT INTO <table> (...)
VALUES (...);` statement per row, grouped by table in roughly FK-parent-before-child order.

The result is uploaded to the `BUCKET` R2 binding under `backups/<businessDate>-<isoTimestamp>.sql`
(e.g. `backups/2026-07-18-2026-07-18T07:00:00.000Z.sql`), and objects older than
`app_settings.backup_retention_days` (seeded to `30`) are deleted in the same run.

## Known limitations (why this isn't a one-command restore yet)

- **No `CREATE TABLE` statements.** The dump assumes it is being replayed against a database
  already migrated to the matching schema version (`apps/worker/migrations/0001_init.sql` at time
  of writing).
- **Circular FK:** `sales.custom_order_id` and `custom_orders.sale_id` reference each other. A
  naive top-to-bottom replay of the dump file will hit a foreign-key violation on whichever of the
  two tables is inserted first, unless foreign-key enforcement is deferred or disabled for the
  restore.
- **No verification step.** Nothing today confirms a given backup file is restorable, or diffs a
  restored database against the source. That's the "drill procedure" part of KOK-056's scope.

## Checking / downloading a backup today

- `GET /api/backups/latest` returns the most recent run's status (timestamp, ok/failed, key, size).
- `GET /api/backups/<key>/download` streams the `.sql` file back (Worker-proxied, per ADR-015 — no
  presigned URLs). The web app's Settings → Respaldos screen (`/settings/backups`) surfaces both.

## Until KOK-056 lands

If a restore is ever actually needed: download the desired `.sql` file, apply
`apps/worker/migrations/0001_init.sql` (and any later migrations) to a fresh D1 database first, then
replay the dump file's statements by hand — table by table, working around the circular FK above —
rather than a single blind `sqlite3 < backup.sql`. Treat this as an emergency procedure, not a
tested one.
