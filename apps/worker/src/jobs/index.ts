// jobs/ registry (KOK-021, Doc 02 §4.4). `runJob` is the single entry point `src/index.ts`'s
// `scheduled()` handler calls — it looks up `jobName` (from `jobNameForCron`) in `JOB_REGISTRY`
// and invokes the matching handler, so wiring in a new job is a one-line registry change with no
// ripple into `index.ts`.
//
// `daily-snapshot` (KOK-021) and `backup` (KOK-022) have real implementations. The other three
// cron names — `replacement-cost-refresh` (KOK-029), `alerts` (KOK-046), `weekly-digest` — don't
// have a service to call yet, so each maps to `runNotImplementedJob`, a shared stub that still
// writes a `job_runs` row (`ok=1`, `detail: 'not yet implemented'`) via `core/jobs.ts`'s
// `buildJobRunInsert` (D-2: no raw `db.insert()` from `jobs/` itself). This keeps `job_runs` a
// complete nightly log from day one instead of having three of five crons produce silence until
// their own backlog tasks land.
//
// `JobHandler` takes `(db, bucket)` — only `runBackup` (KOK-022) needs the R2 binding, but a
// single signature keeps the registry a plain `Record` instead of a discriminated union per job.
// Handlers that don't need `bucket` (every other job) simply don't declare that parameter; a
// function with fewer parameters than a callback type expects is structurally assignable to it, so
// `runDailySnapshot: (db: Db) => Promise<void>` is registered as-is, with no wrapper needed.

import { nowIso } from "@kokoro/shared";

import { buildJobRunInsert } from "../core/jobs.js";
import type { Db } from "../db/index.js";
import { runBackup } from "./backup.js";
import { runDailySnapshot } from "./daily-snapshot.js";

type JobHandler = (db: Db, bucket: R2Bucket) => Promise<void>;

async function runNotImplementedJob(db: Db, job: string): Promise<void> {
  const now = nowIso();
  await db.batch([
    buildJobRunInsert(db, {
      job,
      startedAt: now,
      finishedAt: now,
      ok: 1,
      detail: "not yet implemented",
    }),
  ]);
}

const JOB_REGISTRY: Record<string, JobHandler> = {
  "daily-snapshot": runDailySnapshot,
  "replacement-cost-refresh": (db) => runNotImplementedJob(db, "replacement-cost-refresh"),
  alerts: (db) => runNotImplementedJob(db, "alerts"),
  backup: runBackup,
  "weekly-digest": (db) => runNotImplementedJob(db, "weekly-digest"),
};

/**
 * Looks up `jobName` in the registry and invokes it. `jobName === 'unknown'` — `index.ts`'s
 * `jobNameForCron` fallback for a cron expression it doesn't recognize, which should never happen
 * given `wrangler.toml`'s crons all map to a known name — logs and returns rather than writing a
 * `job_runs` row, since there is no real job name to attribute one to.
 */
export async function runJob(db: Db, jobName: string, bucket: R2Bucket): Promise<void> {
  const handler = JOB_REGISTRY[jobName];
  if (!handler) {
    console.log(JSON.stringify({ level: "error", msg: "unknown job", jobName, at: nowIso() }));
    return;
  }
  await handler(db, bucket);
}
