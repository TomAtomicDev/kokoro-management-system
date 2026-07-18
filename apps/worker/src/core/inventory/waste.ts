// Read query against `v_waste` (KOK-018, Doc 04 §4, Doc 03 §3's "the invisible cost" reporting
// surface). Like `v_stock`/`v_kardex` (queries.ts), `v_waste` is defined only in
// apps/worker/migrations/0001_init.sql — a partial aggregation Drizzle's SQLite dialect has no
// table binding for — so this queries it via `db.all(sql\`...\`)` and hand-maps the raw
// snake_case rows into `WasteSummaryRowDto` (packages/shared/src/exits.ts), mirroring queries.ts's
// exact technique.
//
// Kept in its own file, separate from exits.ts (the WRITE command module for `stock_exits`) —
// same read/write split as queries.ts vs movements.ts. READ-ONLY: no commands, no db.batch().

import type {
  ListWasteSummaryFilters,
  ListWasteSummaryResult,
  StockExitReason,
} from "@kokoro/shared";
import { type SQL, sql } from "drizzle-orm";

import type { Db } from "../../db/index.js";

/** Raw `v_waste` row shape (snake_case, exactly the view's SELECT list — Doc 04 §4). */
interface WasteViewRow {
  month: string;
  reason: StockExitReason;
  exit_count: number;
  total_cost: number;
}

/**
 * Doc 03 §3's "what's costing me the most lately" read: most-recent-month first, and within a
 * month, the reason bucket with the largest total_cost first. `fromDate`/`toDate` filter on the
 * view's `month` column (YYYY-MM) using their own YYYY-MM-DD business-date filters truncated to
 * the month boundary — a caller passing a `YYYY-MM-DD` string still compares correctly against
 * `month` because `'YYYY-MM' <= 'YYYY-MM-DD'[0..7]` lexicographic comparison holds for the shared
 * prefix, so this just compares the two strings' shared `YYYY-MM` prefix directly.
 */
export async function listWasteSummary(
  db: Db,
  filters: ListWasteSummaryFilters = {},
): Promise<ListWasteSummaryResult> {
  const conditions: SQL[] = [];
  if (filters.fromDate) conditions.push(sql`month >= ${filters.fromDate.slice(0, 7)}`);
  if (filters.toDate) conditions.push(sql`month <= ${filters.toDate.slice(0, 7)}`);

  const whereClause =
    conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

  const rows = await db.all<WasteViewRow>(sql`
    SELECT * FROM v_waste
    ${whereClause}
    ORDER BY month DESC, total_cost DESC
  `);

  return {
    summary: rows.map((row) => ({
      month: row.month,
      reason: row.reason,
      exitCount: row.exit_count,
      totalCost: row.total_cost,
    })),
  };
}
