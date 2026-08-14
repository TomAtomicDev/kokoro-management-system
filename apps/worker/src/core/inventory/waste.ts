// Read query for `v_waste`'s reporting shape (KOK-018, Doc 04 §4, Doc 03 §3's "the invisible"
// cost surface). The view is month-based for broad reports, but this screen accepts arbitrary day
// ranges, so this query applies the boundaries to stock_exits before the same projection.
//
// Kept in its own file, separate from exits.ts (the WRITE command module for `stock_exits`) —
// same read/write split as queries.ts vs movements.ts. READ-ONLY: no commands, no db.batch().

import type {
  Centavos,
  ListWasteSummaryFilters,
  ListWasteSummaryResult,
  StockExitReason,
} from "@kokoro/shared";
import {
  addMoney,
  toCentavos,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
} from "@kokoro/shared";
import { type SQL, sql } from "drizzle-orm";

import type { Db } from "../../db/index.js";

/** Raw stock-exit row shape (snake_case, matching the persisted column names). */
interface RawWasteRow {
  business_date: string;
  reason: StockExitReason;
  qty: number;
  unit_cost_snapshot_mc: number;
}

interface WasteGroup {
  month: string;
  reason: StockExitReason;
  exitCount: number;
  totalCost: Centavos;
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

  const rows = await db.all<RawWasteRow>(sql`
    SELECT
      business_date,
      reason,
      qty,
      unit_cost_snapshot_mc
    FROM stock_exits
    ${whereClause}
  `);

  const groups = new Map<string, WasteGroup>();
  for (const row of rows) {
    const month = row.business_date.slice(0, 7);
    const key = `${month}:${row.reason}`;
    const rowCost = totalCentavos(
      toMilliCentavosPerUnit(row.unit_cost_snapshot_mc),
      toMilliUnits(row.qty),
    );
    const group = groups.get(key);
    if (group) {
      group.exitCount += 1;
      group.totalCost = addMoney(group.totalCost, rowCost);
    } else {
      groups.set(key, {
        month,
        reason: row.reason,
        exitCount: 1,
        totalCost: addMoney(toCentavos(0), rowCost),
      });
    }
  }

  const summary = [...groups.values()].sort((left, right) => {
    if (left.month !== right.month) return left.month > right.month ? -1 : 1;
    if (left.totalCost === right.totalCost) return 0;
    return left.totalCost > right.totalCost ? -1 : 1;
  });

  return { summary };
}
