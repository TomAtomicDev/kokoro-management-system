// Read query for `v_waste`'s reporting shape (KOK-018, Doc 04 §4, Doc 03 §3's "the invisible"
// cost surface). The view is month-based for broad reports, but this screen accepts arbitrary day
// ranges, so this query applies the boundaries to stock_exits before the same projection.
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

/** Raw waste row shape (snake_case, matching the existing `v_waste` response contract). */
interface WasteViewRow {
  month: string;
  reason: StockExitReason;
  exit_count: number;
  total_cost: number;
}

/**
 * Doc 03 §3's "what's costing me the most lately" read: most-recent-month first, and within a
 * month, the reason bucket with the largest total_cost first. Date filters apply to raw
 * `business_date` rows before this month/reason projection, so partial-month ranges are exact.
 */
export async function listWasteSummary(
  db: Db,
  filters: ListWasteSummaryFilters = {},
): Promise<ListWasteSummaryResult> {
  const conditions: SQL[] = [sql`deleted_at IS NULL`];
  if (filters.fromDate) conditions.push(sql`business_date >= ${filters.fromDate}`);
  if (filters.toDate) conditions.push(sql`business_date <= ${filters.toDate}`);

  const whereClause = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

  const rows = await db.all<WasteViewRow>(sql`
    SELECT
      strftime('%Y-%m', business_date) AS month,
      reason,
      COUNT(*) AS exit_count,
      SUM(CAST(ROUND(qty * unit_cost_snapshot_mc / 1000000.0) AS INTEGER)) AS total_cost
    FROM stock_exits
    ${whereClause}
    GROUP BY strftime('%Y-%m', business_date), reason
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
