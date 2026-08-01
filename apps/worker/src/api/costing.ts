// Costing routes (KOK-029, Doc 03 §4 C-3). Mounted under /api in index.ts. Thin by design (D-2):
// call the core/costing service, serialize — this route never touches `db.batch()` itself,
// `core/costing`'s `applyReplacementCostRefresh` does (same convention every other route in this
// app follows: the actual batch execution happens inside a `core/` function).
//
// The on-demand replacement-cost refresh uses the same planner the nightly
// `replacement-cost-refresh` Cron Trigger job uses (jobs/replacement-cost-refresh.ts), so a manual
// "Recalcular" click can never disagree with what tonight's job would have computed for the same
// catalog state.
//
// No `audit_log` row: `replacement_cost` is a derived/cached column (C-3, like `items.wac_mc`), not a
// directly user-edited fact — the nightly job's own bookkeeping is `job_runs`, scoped to Cron
// Trigger runs (Doc 04 §3.5), which an HTTP-triggered recompute is not; this route's response body
// is itself the record of what changed, mirroring `previewPurchaseImpact`'s "compute and report,
// nothing to audit per-row" precedent for a multi-item derived recalculation.
//
// `/price-health` (KOK-035) and `/pricing-settings` (KOK-036) are both plain reads over
// `core/costing`'s own state — no batch, no audit row.

import type {
  ListPriceHealthResult,
  PricingSettingsDto,
  ReplacementCostRefreshResultDto,
} from "@kokoro/shared";
import { Hono } from "hono";

import {
  applyReplacementCostRefresh,
  getPricingSettingsDto,
  listPriceHealth,
} from "../core/costing/index.js";
import { createDb } from "../db/index.js";
import type { Env, Variables } from "../env.js";

export const costingRoute = new Hono<{ Bindings: Env; Variables: Variables }>()
  .post("/costing/replacement-cost-refresh", async (c) => {
    const db = createDb(c.env.DB);
    const plan = await applyReplacementCostRefresh(db);

    const result: ReplacementCostRefreshResultDto = {
      refreshedItemIds: plan.refreshedItemIds,
      skippedItemIds: plan.skippedItemIds,
      refreshedAt: plan.refreshedAt,
    };
    return c.json(result);
  })
  // KOK-035 — Doc 07 SC-12's table (built by KOK-036); Doc 03 §4 C-5.
  .get("/price-health", async (c) => {
    const db = createDb(c.env.DB);
    const result: ListPriceHealthResult = await listPriceHealth(db);
    return c.json(result);
  })
  // KOK-036 — the C-5 threshold on its own, for screens that render a replacement-cost
  // `MarginBadge` without needing a full `listPriceHealth`/`listRecipes` payload (SC-03's
  // per-line margin preview, first).
  .get("/pricing-settings", async (c) => {
    const db = createDb(c.env.DB);
    const result: PricingSettingsDto = await getPricingSettingsDto(db);
    return c.json(result);
  });
