// Reusable read for Finance and Dashboard summary routes (KOK-037), extracted from daily-snapshot.

import { sql } from "drizzle-orm";

import type { Db } from "../../db/index.js";

interface ReceivablesTotalRow {
  total: number | null;
}

interface LiabilityRow {
  customer_deposits: number | null;
}

export interface LiabilityReceivableSummary {
  /** Centavos (INV-6): current customer_deposits from v_liability (ADR-012, derived not stored). */
  liability: number;
  /** Centavos (INV-6): SUM(total) over v_receivables — every ON_CREDIT sale's uncollected remainder. */
  receivablesTotal: number;
}

export async function getLiabilityReceivableSummary(db: Db): Promise<LiabilityReceivableSummary> {
  const [receivablesRows, liabilityRows] = await Promise.all([
    db.all<ReceivablesTotalRow>(sql`SELECT COALESCE(SUM(total), 0) AS total FROM v_receivables`),
    db.all<LiabilityRow>(sql`SELECT customer_deposits FROM v_liability`),
  ]);

  return {
    liability: liabilityRows[0]?.customer_deposits ?? 0,
    receivablesTotal: receivablesRows[0]?.total ?? 0,
  };
}
