// core/jobs.ts — builders for the "System & observability" tables the Cron Trigger jobs
// (jobs/, Doc 02 §4.4) write to: `daily_snapshots` (INV-5's nightly snapshot, Doc 04 §3.5) and
// `job_runs` (every job's own per-run observability row, same section). Mirrors core/audit.ts's
// `buildAuditLogInsert` — "build, don't execute": neither function here calls `db.batch()`
// itself; `jobs/` includes the returned statement in its OWN `db.batch()` (D-3). This keeps every
// write, even a job's own bookkeeping row, going through a `core/` builder instead of a raw
// `db.insert()` call from inside `jobs/` (D-2: routes/bot handlers/assistant tools/jobs/tests
// never write business or system tables directly).

import { generateUuidV7 } from "@kokoro/shared";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../db/index.js";
import { dailySnapshots, jobRuns } from "../db/schema.js";

type Statement = BatchItem<"sqlite">;

export interface DailySnapshotValues {
  /** `YYYY-MM-DD`, America/La_Paz local calendar date (Doc 04 §1, INV-3) — the table's PK. */
  businessDate: string;
  /** Centavos (INV-6): `SUM(v_stock.stock_value)` across active items. */
  stockValue: number;
  /** Centavos: the BANK account's live balance. */
  bankBalance: number;
  /** Centavos: the CASH account's live balance. */
  cashBalance: number;
  /** Centavos: `SUM(v_receivables.total)` for outstanding ON_CREDIT sales. */
  accountsReceivable: number;
  /** Centavos: `v_liability`'s single-row `customer_deposits` total. */
  customerDeposits: number;
  createdAt: string;
}

/**
 * Builds (does not execute) the `daily_snapshots` upsert for one business date. `business_date`
 * is the table's PK (Doc 04 §3.5), so a second run for the same day overwrites the existing row
 * instead of conflicting — mirrors `core/settings/index.ts`'s `onConflictDoUpdate` precedent, the
 * only other plain-overwrite upsert in this codebase.
 */
export function buildDailySnapshotUpsert(db: Db, values: DailySnapshotValues): Statement {
  const { businessDate, ...set } = values;
  return db
    .insert(dailySnapshots)
    .values({ businessDate, ...set })
    .onConflictDoUpdate({ target: dailySnapshots.businessDate, set });
}

export interface JobRunValues {
  job: string;
  startedAt: string;
  finishedAt: string;
  ok: 0 | 1;
  detail: string;
}

/**
 * Builds (does not execute) one `job_runs` insert — every Cron Trigger job's own per-run
 * observability row (Doc 02 §4.4). `id` is a fresh uuid every call, so multiple runs (even for the
 * same job on the same day) never collide on the primary key.
 */
export function buildJobRunInsert(db: Db, values: JobRunValues): Statement {
  return db.insert(jobRuns).values({ id: generateUuidV7(), ...values });
}

/**
 * Reads the most recent `job_runs` row for `job` (ordered by `started_at` desc), or `null` if that
 * job has never run. This is a plain read (not a builder — no statement to batch), added for
 * KOK-022's `GET /api/backups/latest`: api/backups.ts calls this instead of querying `job_runs`
 * directly from the route, keeping every business/system table access routed through `core/`
 * (D-2's spirit, even though this specific read is not a write).
 */
export async function getLatestJobRun(
  db: Db,
  job: string,
): Promise<typeof jobRuns.$inferSelect | null> {
  const row = await db.query.jobRuns.findFirst({
    where: (t, { eq }) => eq(t.job, job),
    orderBy: (t, { desc }) => desc(t.startedAt),
  });
  return row ?? null;
}
