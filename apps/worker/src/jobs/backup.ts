// jobs/backup.ts — the "backup" Cron Trigger job (KOK-022, Doc 02 §4.4, runs `0 7 * * *` UTC /
// 03:00 America/La_Paz per wrangler.toml). Dumps every business/event/derived/system table this
// app cannot afford to lose as one SQL text file (one `INSERT` statement per row) and uploads it
// to R2 under `backups/<businessDate>-<isoTimestamp>.sql`, then sweeps `backups/` for objects
// older than `app_settings.backup_retention_days` (seeded to '30', Doc 04 §7) and deletes them.
//
// Same try/catch shape as jobs/daily-snapshot.ts (see its header for the full rationale): the
// job's own `job_runs` observability row must survive even when the dump/upload/sweep throws, so
// the happy path writes one `ok=1` row via core/jobs.ts's `buildJobRunInsert` inside its own
// `db.batch([...])` (one statement, but still routed through the D-3 "build, don't execute"
// pattern), and the catch path writes a separate `ok=0` row in its own one-statement batch.
//
// D-2 SCOPE NOTE: the table dump below reads business tables directly via `db.all(sql\`SELECT *
// FROM ...\`)` instead of a core/ query function — these are bulk read-only exports for a file
// download, not the write path D-2 guards (no INSERT/UPDATE/DELETE against a business table ever
// happens here). The one write this job makes — its own `job_runs` row — goes through
// core/jobs.ts's `buildJobRunInsert`, same as every other job; the retention setting is read via
// core/settings's `getSetting`, per this task's own instructions.
//
// TABLE LIST / EXCLUSIONS (judgment call, flagged per CLAUDE.md "put the doubt in the PR
// description" since the KB doesn't enumerate a backup scope): every table in db/schema.ts's
// catalog/sessions/business-events/derived-ledgers sections is included, plus `app_settings` and
// `daily_snapshots` from the system section. Excluded, all from the system/observability section
// (Doc 04 §3.5), because none of them is data a restore should reconstruct:
//   - telegram_updates / idempotency_keys: pure request-dedupe logs, explicitly called out as
//     excludable in this task's own brief.
//   - assistant_interactions: an AI observability/eval log (prompts, token counts, latencies), not
//     a business record — large and ever-growing, and losing it changes nothing about the state of
//     the business.
//   - pending_drafts: ephemeral Telegram draft state with its own `expires_at`; ceases to be valid
//     the moment a restore would use it.
//   - job_runs itself: this job's own run log. Dumping it mid-run adds no restore value and would
//     require the job to special-case its own table.
//
// TABLE ORDER: follows db/schema.ts's own section order (catalog -> sessions -> business events ->
// derived ledgers -> system), which is FK-parent-before-child almost everywhere. Two forward
// references in the schema itself are NOT resolved by this ordering (`sales` <-> `custom_orders`
// is a genuine circular FK, and `session_costs`/`purchases`/`sales` reference `financial_accounts`,
// declared later in the file) — this is a known limitation, not a bug: full restore-order handling
// (deferred FKs or a two-pass import) is explicitly KOK-056's job, not this one's. See
// docs/runbooks/backup-restore.md.

import { nowIso, toBusinessDate } from "@kokoro/shared";
import { sql } from "drizzle-orm";

import { buildJobRunInsert } from "../core/jobs.js";
import { getSetting } from "../core/settings/index.js";
import type { Db } from "../db/index.js";
import { deleteObject, listObjects, putObject } from "../lib/r2.js";

const JOB_NAME = "backup";
const BACKUP_PREFIX = "backups/";
const DEFAULT_RETENTION_DAYS = 30;

const BACKUP_TABLES: readonly string[] = [
  // Catalog (Doc 04 §3.1)
  "items",
  "item_aliases",
  "recipes",
  "recipe_lines",
  "price_history",
  // Sessions (Doc 04 §3.2)
  "sessions",
  "session_costs",
  // Business events (Doc 04 §3.3)
  "purchases",
  "purchase_lines",
  "production_runs",
  "production_consumptions",
  "customers",
  "sales",
  "sale_lines",
  "custom_orders",
  "custom_order_lines",
  "stock_exits",
  "inventory_counts",
  "inventory_count_lines",
  // Derived ledgers (Doc 04 §3.4)
  "stock_movements",
  "item_stock",
  "financial_accounts",
  "financial_transactions",
  // System & observability (Doc 04 §3.5) — only the two config/rollup tables, see header note.
  "app_settings",
  "daily_snapshots",
  "audit_log",
];

/** Serializes one D1 cell value as a SQL literal for an `INSERT` statement text blob. D1 rows only
 * ever surface `string | number | null` for the columns this schema defines (no BLOB columns) —
 * anything else is a defensive fallback, not an expected path. */
function serializeSqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

interface TableDump {
  text: string;
  rowCount: number;
}

/** Dumps one table's rows as `INSERT INTO <table> (...) VALUES (...);` lines. Reads via raw SQL
 * (not the table's Drizzle binding) so the returned row keys are the actual DB column names
 * (snake_case) — exactly what an INSERT's column list needs, with no camelCase round-trip. */
async function dumpTable(db: Db, tableName: string): Promise<TableDump> {
  const rows = await db.all<Record<string, unknown>>(
    sql`SELECT * FROM ${sql.identifier(tableName)}`,
  );
  if (rows.length === 0) {
    return { text: `-- ${tableName}: 0 rows\n`, rowCount: 0 };
  }
  const columns = Object.keys(rows[0] as Record<string, unknown>);
  const columnList = columns.map((c) => `"${c}"`).join(", ");
  const lines = rows.map((row) => {
    const values = columns.map((col) => serializeSqlValue(row[col]));
    return `INSERT INTO ${tableName} (${columnList}) VALUES (${values.join(", ")});`;
  });
  return {
    text: `-- ${tableName}: ${rows.length} rows\n${lines.join("\n")}\n`,
    rowCount: rows.length,
  };
}

/** Runs the backup job: dump every table in BACKUP_TABLES, upload the concatenated SQL text to R2,
 * sweep `backups/` for objects past retention. Never throws — any failure is caught and recorded
 * as a `job_runs` row with `ok=0` instead (mirrors jobs/daily-snapshot.ts's runDailySnapshot). */
export async function runBackup(db: Db, bucket: R2Bucket): Promise<void> {
  const startedAt = nowIso();
  try {
    // Retention sweep runs FIRST, against whatever backups/ already holds from prior runs — never
    // against the object this run is about to create below. Ordering it this way is deliberate,
    // not incidental: sweeping after the upload would mean a small/zero `backup_retention_days`
    // could delete the backup this very run just produced, which defeats the point of running a
    // backup job at all. R2Object.uploaded is the authoritative timestamp per this task's own
    // guidance — preferred over parsing a date back out of the key format.
    const retentionDaysRaw = await getSetting(db, "backup_retention_days");
    // NOT `parseInt(...) || DEFAULT_RETENTION_DAYS`: `||` treats a legitimately-configured `0`
    // (retain nothing) as falsy and would silently coerce it back to the 30-day default. Only fall
    // back when parsing actually failed (missing setting, empty/non-numeric string -> NaN).
    const parsedRetentionDays = Number.parseInt(retentionDaysRaw ?? "", 10);
    const retentionDays = Number.isNaN(parsedRetentionDays)
      ? DEFAULT_RETENTION_DAYS
      : parsedRetentionDays;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const existingObjects = await listObjects(bucket, BACKUP_PREFIX);
    let deletedCount = 0;
    for (const object of existingObjects) {
      // <= (not strictly <): an object uploaded exactly at the cutoff instant counts as expired.
      // At real retention_days=30 this boundary is never exact enough to matter; it does matter
      // for a fast successive put()-then-sweep in tests/low-latency runtimes, where the workerd
      // clock can return the same millisecond for both timestamps.
      if (object.uploaded.getTime() <= cutoff) {
        await deleteObject(bucket, object.key);
        deletedCount += 1;
      }
    }

    const businessDate = toBusinessDate(startedAt);

    let totalRows = 0;
    const sections: string[] = [];
    for (const tableName of BACKUP_TABLES) {
      const dump = await dumpTable(db, tableName);
      sections.push(dump.text);
      totalRows += dump.rowCount;
    }

    const body = sections.join("\n");
    const bodyBytes = new TextEncoder().encode(body);
    const key = `${BACKUP_PREFIX}${businessDate}-${startedAt}.sql`;
    await putObject(bucket, key, bodyBytes, "application/sql");
    const sizeBytes = bodyBytes.byteLength;

    const finishedAt = nowIso();
    const detail = JSON.stringify({
      key,
      sizeBytes,
      deletedCount,
      tableCount: BACKUP_TABLES.length,
      totalRows,
    });

    await db.batch([
      buildJobRunInsert(db, { job: JOB_NAME, startedAt, finishedAt, ok: 1, detail }),
    ]);
  } catch (error) {
    const finishedAt = nowIso();
    const message = error instanceof Error ? error.message : String(error);
    await db.batch([
      buildJobRunInsert(db, { job: JOB_NAME, startedAt, finishedAt, ok: 0, detail: message }),
    ]);
  }
}
