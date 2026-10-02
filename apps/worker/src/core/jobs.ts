// core/jobs.ts — builders for the "System & observability" tables the Cron Trigger jobs
// (jobs/, Doc 02 §4.4) write to: `daily_snapshots` (INV-5's nightly snapshot, Doc 04 §3.5) and
// `job_runs` (every job's own per-run observability row, same section). Mirrors core/audit.ts's
// `buildAuditLogInsert` — "build, don't execute": neither function here calls `db.batch()`
// itself; `jobs/` includes the returned statement in its OWN `db.batch()` (D-3). This keeps every
// write, even a job's own bookkeeping row, going through a `core/` builder instead of a raw
// `db.insert()` call from inside `jobs/` (D-2: routes/bot handlers/assistant tools/jobs/tests
// never write business or system tables directly).

import { generateUuidV7 } from "@kokoro/shared";
import { sql } from "drizzle-orm";
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
  /** Centavos (INV-6): catalog-sale debt plus positive delivered-order outstanding. */
  accountsReceivable: number;
  /** Historical ADR-012 observations are not re-derived after the ADR-022 cutover. */
  customerDepositsAdr012: number | null;
  /** Centavos (INV-6): distinct ADR-022 operational exposure measure. */
  preDeliveryOrderCashExposure: number | null;
  createdAt: string;
}

/**
 * Builds (does not execute) one daily_snapshots upsert. `business_date` is its PK (Doc 04 §3.5),
 * so reruns update the day's snapshot. A NULL post-cutover ADR-012 input preserves any historical
 * observation already captured on that same cutover date; the new exposure remains a separate field.
 */
export function buildDailySnapshotUpsert(db: Db, values: DailySnapshotValues): Statement {
  const { businessDate, ...set } = values;
  return db
    .insert(dailySnapshots)
    .values({ businessDate, ...set })
    .onConflictDoUpdate({
      target: dailySnapshots.businessDate,
      set: {
        ...set,
        // Do not erase an ADR-012 value already captured earlier on the cutover business date.
        customerDepositsAdr012: sql`COALESCE(excluded.customer_deposits_adr012, ${dailySnapshots.customerDepositsAdr012})`,
      },
    });
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
