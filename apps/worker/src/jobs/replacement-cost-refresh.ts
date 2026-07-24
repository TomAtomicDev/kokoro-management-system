// jobs/replacement-cost-refresh.ts — the "replacement-cost-refresh" Cron Trigger job (KOK-029,
// Doc 02 §4.4, runs 05:05 America/La_Paz / 09:05 UTC, five minutes after daily-snapshot and five
// minutes before alerts so the morning price-health check sees fresh replacement costs the same
// day). Refreshes `items.replacement_cost` for every SEMI_FINISHED/FINISHED item with an active
// default recipe (C-3) via core/costing's `planReplacementCostRefresh` — see that module's header
// for the dependency-order reasoning and why it (not this file) owns the computation.
//
// Same shape as jobs/daily-snapshot.ts (D-2: this file never issues a raw db.insert/update
// itself — planReplacementCostRefresh and core/jobs.ts's buildJobRunInsert build every statement,
// this file only batches them):
//   - happy path: ONE batch containing every `items` UPDATE the plan returned plus one `job_runs`
//     row (ok=1, detail = refreshed/skipped counts and ids)
//   - catch path: a single separate `job_runs` insert (ok=0) if anything above throws — most
//     notably `topoOrderAffectedItems` refusing a cyclical recipe book (Doc 03 §4), which is
//     exactly the kind of data problem a human needs to see, not one this job silently papers over
//
// IDEMPOTENCY: re-running same-day always recomputes from the CURRENT catalog/recipe state (no
// business-date keying, unlike daily_snapshots) — running it twice in a row is a genuine no-op
// whenever nothing in the catalog changed between runs.

import { nowIso } from "@kokoro/shared";
import type { BatchItem } from "drizzle-orm/batch";

import { planReplacementCostRefresh } from "../core/costing/index.js";
import { buildJobRunInsert } from "../core/jobs.js";
import type { Db } from "../db/index.js";

type Statement = BatchItem<"sqlite">;

const JOB_NAME = "replacement-cost-refresh";

/** Runs the replacement-cost-refresh job. Never throws — any failure is caught and recorded as a
 * `job_runs` row with `ok=0` instead, per daily-snapshot.ts's identical precedent. */
export async function runReplacementCostRefresh(db: Db): Promise<void> {
  const startedAt = nowIso();
  try {
    const plan = await planReplacementCostRefresh(db);
    const finishedAt = nowIso();
    const detail = JSON.stringify({
      refreshedCount: plan.refreshedItemIds.length,
      refreshedItemIds: plan.refreshedItemIds,
      skippedItemIds: plan.skippedItemIds,
      refreshedAt: plan.refreshedAt,
    });

    const statements: [Statement, ...Statement[]] = [
      buildJobRunInsert(db, { job: JOB_NAME, startedAt, finishedAt, ok: 1, detail }),
      ...plan.statements,
    ];

    await db.batch(statements);
  } catch (error) {
    const finishedAt = nowIso();
    const message = error instanceof Error ? error.message : String(error);
    await db.batch([
      buildJobRunInsert(db, { job: JOB_NAME, startedAt, finishedAt, ok: 0, detail: message }),
    ]);
  }
}
