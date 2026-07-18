// Dashboard summary route (KOK-023, Doc 07 SC-01 reduced scope). Mounted under /api in index.ts.
// Thin by design (D-2): composes three existing read paths — core/finance's `listAccounts` and
// core/inventory's `getStockValueTotal` + `listStock({ lowStockOnly: true })` — into one
// `DashboardSummaryDto`. No new business logic, no writes, nothing else queried.
//
// Sales/profit/Bs-per-hour StatCards, deltas/sparklines, margin-at-risk top-5, upcoming orders,
// the 30-day sales chart, and the general alerts strip are KOK-052 "Dashboard v2" — out of scope
// here (see packages/shared/src/dashboard.ts's doc comment for the same note on the DTO side).

import type { DashboardSummaryDto } from "@kokoro/shared";
import { Hono } from "hono";

import { listAccounts } from "../core/finance/index.js";
import { getStockValueTotal, listStock } from "../core/inventory/index.js";
import { createDb } from "../db/index.js";
import type { Env, Variables } from "../env.js";

export const dashboardRoute = new Hono<{ Bindings: Env; Variables: Variables }>().get(
  "/dashboard/summary",
  async (c) => {
    const db = createDb(c.env.DB);
    const [{ accounts }, stockValue, { stock: lowStock }] = await Promise.all([
      listAccounts(db),
      getStockValueTotal(db),
      listStock(db, { lowStockOnly: true }),
    ]);

    // Matched by `type`, not a hardcoded account id (Doc 04 §7 seeds exactly one BANK and one CASH
    // account) — mirrors this task's own guidance over core/finance/accounts.ts's literal-id
    // precedent, which is for *writes* to the two known seed rows, not for reading an arbitrary
    // active account set back out.
    const bank = accounts.find((a) => a.type === "BANK")?.balance ?? 0;
    const cash = accounts.find((a) => a.type === "CASH")?.balance ?? 0;

    const summary: DashboardSummaryDto = {
      cash: { bank, cash, total: bank + cash },
      stockValue,
      lowStock,
    };
    return c.json(summary);
  },
);
