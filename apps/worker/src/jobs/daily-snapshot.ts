// jobs/daily-snapshot.ts — the "daily-snapshot" Cron Trigger job (KOK-021, Doc 02 §4.4, runs
// 05:00 America/La_Paz / 09:00 UTC). Writes the day's `daily_snapshots` row (INV-5, Doc 04 §3.5)
// and runs INV-5's consistency sentinel for stock, cash, and WAC.
//
// WAC DRIFT IS DETECTION-ONLY (KOK-024 / ADR-016 demoted this job from repair to backstop
// auditor — see `core/costing/repair.ts`'s header for the full reasoning). Before KOK-024 this
// job was the sole corrector of `items.wac` drift; now the synchronous replay
// (`core/costing/replay.ts`, INV-11) corrects it immediately, R-4/R-5-correctly, inside the
// triggering command's own batch. This job now treats a WAC mismatch exactly like the stock-qty
// and account-balance ones below: something the synchronous path should have already prevented,
// so finding one means investigating a bug or a direct DB fix, not silently overwriting the
// column.
//
// SCOPE BOUNDARY (judgment call — flagged per CLAUDE.md "put doubt in the PR description" since
// the KB doesn't spell this out explicitly): none of the three consistency checks below (WAC
// drift, stock-qty mismatch via `getStockConsistencyMismatches`, account-balance mismatch via
// `getBalanceConsistencyMismatches`) are auto-repaired by this job. All three are recorded
// verbatim into `job_runs.detail` for a human to see; real alerting on them is KOK-046, out of
// scope here.
//
// D-2: this function never issues a raw `db.insert()`/`db.update()` itself — `core/jobs.ts`'s
// `buildDailySnapshotUpsert`/`buildJobRunInsert` build every statement, this file only batches
// them, same "build, don't execute" split every other core/ building block in this codebase uses.
//
// ATOMICITY (D-3): this function's own writes are not one batch, they are (at most) two —
// documented deliberately, not a violation of D-3's "one atomic batch per command" so much as an
// exception D-3 doesn't anticipate: a job's own observability row (`job_runs`) needs to be written
// EVEN WHEN the job's main batch fails, so the failure path cannot be inside the same batch that
// might roll back. The happy path is exactly one batch (`daily_snapshots` upsert + one `job_runs`
// insert with `ok=1` — no WAC-drift statements, since drift is detected, never repaired, here);
// the catch path is a single separate `job_runs` insert (its own one-statement batch) with `ok=0`
// if anything above throws.
//
// IDEMPOTENCY: `daily_snapshots` is keyed by `business_date` (text PK, Doc 04 §3.5) — a second run
// for the same business date upserts (`onConflictDoUpdate`) rather than colliding.

import { nowIso, toBusinessDate } from "@kokoro/shared";
import { sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { WacDrift } from "../core/costing/index.js";
import { detectWacDrift } from "../core/costing/index.js";
import { getBalanceConsistencyMismatches, listAccounts } from "../core/finance/index.js";
import {
  getStockConsistencyMismatches,
  getStockValueTotal,
  listStock,
} from "../core/inventory/index.js";
import { buildDailySnapshotUpsert, buildJobRunInsert } from "../core/jobs.js";
import type { Db } from "../db/index.js";

type Statement = BatchItem<"sqlite">;

const JOB_NAME = "daily-snapshot";

interface ReceivablesTotalRow {
  total: number | null;
}

interface LiabilityRow {
  customer_deposits: number | null;
}

/** Runs the daily-snapshot job. Never throws — any failure is caught and recorded as a
 * `job_runs` row with `ok=0` instead, per this module's header note on why a job must not let an
 * exception escape `scheduled()` silently. */
export async function runDailySnapshot(db: Db): Promise<void> {
  const startedAt = nowIso();
  try {
    const businessDate = toBusinessDate(startedAt);

    const [
      stockValue,
      activeStock,
      accounts,
      receivablesRows,
      liabilityRows,
      stockMismatches,
      balanceMismatches,
    ] = await Promise.all([
      getStockValueTotal(db),
      listStock(db), // v_stock, already filtered to is_active = 1 (Doc 04 §4) — source of the item-id list below
      listAccounts(db),
      db.all<ReceivablesTotalRow>(sql`SELECT COALESCE(SUM(total), 0) AS total FROM v_receivables`),
      db.all<LiabilityRow>(sql`SELECT customer_deposits FROM v_liability`),
      getStockConsistencyMismatches(db),
      getBalanceConsistencyMismatches(db),
    ]);

    const bankBalance = accounts.accounts.find((a) => a.type === "BANK")?.balance ?? 0;
    const cashBalance = accounts.accounts.find((a) => a.type === "CASH")?.balance ?? 0;
    const accountsReceivable = receivablesRows[0]?.total ?? 0;
    const customerDeposits = liabilityRows[0]?.customer_deposits ?? 0;

    // R-2 backstop (KOK-024/ADR-016): detect WAC drift, once per active item — never repair it.
    // `items.wac` is corrected exclusively by the synchronous replay now; a drift found here means
    // that path missed something and a human needs to look, same as stockMismatches/
    // balanceMismatches below.
    const wacDrift: WacDrift[] = [];
    for (const row of activeStock.stock) {
      const drift = await detectWacDrift(db, row.itemId);
      if (drift) wacDrift.push(drift);
    }

    const finishedAt = nowIso();
    const detail = JSON.stringify({ stockMismatches, balanceMismatches, wacDrift });

    const statements: [Statement, ...Statement[]] = [
      buildDailySnapshotUpsert(db, {
        businessDate,
        stockValue,
        bankBalance,
        cashBalance,
        accountsReceivable,
        customerDeposits,
        createdAt: finishedAt,
      }),
      buildJobRunInsert(db, { job: JOB_NAME, startedAt, finishedAt, ok: 1, detail }),
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
