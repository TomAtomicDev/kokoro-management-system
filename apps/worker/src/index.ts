// Worker entry point: Hono app assembly + Cron Trigger dispatcher.
// See docs/system-design-knowledge-base/02-system-architecture.md §1 for the overall shape
// this file wires together, and §4.4 for the cron table.

import { Hono } from "hono";
import { authRoute } from "./api/auth.js";
import { errorHandler } from "./api/error-handler.js";
import { healthRoute } from "./api/health.js";
import type { Env, Variables } from "./env.js";
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

// Extension points for later backlog tasks — kept as comments so the file reads as an obvious
// map of where things go:
//
//   app.route("/api", apiRoutes);           // KOK-011+ — the rest of the Hono API (thin routes
//                                            // that call core/ services; see Doc 02 §3).
//   app.route("/telegram", telegramRoutes);  // KOK-038 — grammY webhook mounted on Hono.

// Static SPA (Doc 02 §1). `run_worker_first = true` in wrangler.toml means every request hits
// this fetch handler first, so /api/* and /telegram/* above are matched before this catch-all
// ever runs. Everything else — including client-side routes like /sales that have no matching
// file in the build output — falls through to the ASSETS binding, which applies
// `not_found_handling = "single-page-application"` and serves index.html (SPA-fallback routing).
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

/**
 * Cron Trigger dispatcher (Doc 02 §4.4). Job bodies don't exist yet (jobs/ is empty until
 * KOK-021+); for now every scheduled cron just logs which job would have run.
 */
async function scheduled(event: ScheduledEvent, _env: Env, _ctx: ExecutionContext): Promise<void> {
  const job = jobNameForCron(event.cron);
  console.log(JSON.stringify({ job, at: new Date().toISOString() }));
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
