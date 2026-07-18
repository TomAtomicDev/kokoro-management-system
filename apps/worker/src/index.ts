// Worker entry point: Hono app assembly + Cron Trigger dispatcher.
// See docs/system-design-knowledge-base/02-system-architecture.md §1 for the overall shape
// this file wires together, and §4.4 for the cron table.

import { Hono } from "hono";
import { authRoute } from "./api/auth.js";
import { backupsRoute } from "./api/backups.js";
import { catalogRoute } from "./api/catalog.js";
import { dashboardRoute } from "./api/dashboard.js";
import { errorHandler } from "./api/error-handler.js";
import { financeRoute } from "./api/finance.js";
import { healthRoute } from "./api/health.js";
import { inventoryRoute } from "./api/inventory.js";
import { onboardingRoute } from "./api/onboarding.js";
import { purchasingRoute } from "./api/purchasing.js";
import { createDb } from "./db/index.js";
import type { Env, Variables } from "./env.js";
import { runJob } from "./jobs/index.js";
import { requireCsrf, requireSession } from "./middleware/auth.js";
import { structuredLogging } from "./middleware/logging.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", structuredLogging());
app.onError(errorHandler);

// Auth (KOK-007, ADR-007): every /api/* route needs a valid session except /api/health and
// POST /api/auth/login; every mutating /api/* request needs a matching CSRF token except
// POST /api/auth/login (Doc 02 §6). Both mounted ahead of the route tree they guard.
app.use("/api/*", requireSession());
app.use("/api/*", requireCsrf());

app.route("/api", healthRoute);
app.route("/api", authRoute);
app.route("/api", catalogRoute); // KOK-011 — items & aliases (Doc 07 SC-15).
app.route("/api", financeRoute); // KOK-014 — standalone transactions, transfers, withdrawals (Doc 03 UC-11/12/13).
app.route("/api", purchasingRoute); // KOK-016 — purchases (Doc 03 UC-01), the template event vertical.
app.route("/api", inventoryRoute); // KOK-017 — v_stock/v_kardex reads (Doc 07 SC-08).
app.route("/api", onboardingRoute); // KOK-020 — onboarding wizard (Doc 07 steps 1-5).
app.route("/api", dashboardRoute); // KOK-023 — dashboard summary (Doc 07 SC-01 reduced).
app.route("/api", backupsRoute); // KOK-022 — backup status + download (Doc 07 SC-16).

// Extension point for a later backlog task — kept as a comment so the file reads as an obvious
// map of where things go:
//
//   app.route("/telegram", telegramRoutes);  // KOK-038 — grammY webhook mounted on Hono.

// Static SPA (Doc 02 §1). `run_worker_first = true` in wrangler.toml means every request hits
// this fetch handler first, so /api/* and /telegram/* above are matched before this catch-all
// ever runs. Everything else — including client-side routes like /sales that have no matching
// file in the build output — falls through to the ASSETS binding, which applies
// `not_found_handling = "single-page-application"` and serves index.html (SPA-fallback routing).
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

/**
 * Cron Trigger dispatcher (Doc 02 §4.4). Maps the firing cron expression to a job name
 * (`jobNameForCron`) and dispatches into the `jobs/` registry (`runJob`, KOK-021) — every job run
 * is recorded in `job_runs`, so this handler itself never needs its own logging: a failure inside
 * `runJob`'s dispatched handler is caught there, not here (see `jobs/daily-snapshot.ts`'s header).
 */
async function scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
  const job = jobNameForCron(event.cron);
  await runJob(createDb(env.DB), job, env.BUCKET);
}

/** Maps a cron expression (Doc 02 §4.4) to its job name. */
function jobNameForCron(cron: string): string {
  switch (cron) {
    case "0 9 * * *":
      return "daily-snapshot";
    case "5 9 * * *":
      return "replacement-cost-refresh";
    case "10 9 * * *":
      return "alerts";
    case "0 7 * * *":
      return "backup";
    case "15 9 * * 1":
      return "weekly-digest";
    default:
      return "unknown";
  }
}

export default {
  fetch: app.fetch,
  scheduled,
};
