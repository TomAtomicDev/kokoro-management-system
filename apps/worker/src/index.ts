// Worker entry point: Hono app assembly + Cron Trigger dispatcher.
// See docs/system-design-knowledge-base/02-system-architecture.md §1 for the overall shape
// this file wires together, and §4.4 for the cron table.

import { Hono } from "hono";
import { healthRoute } from "./api/health.js";
import type { Env, Variables } from "./env.js";
import { structuredLogging } from "./middleware/logging.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", structuredLogging());

app.route("/api", healthRoute);

// Extension points for later backlog tasks — kept as comments so the file reads as an obvious
// map of where things go:
//
//   app.route("/api", apiRoutes);           // KOK-011+ — the rest of the Hono API (thin routes
//                                            // that call core/ services; see Doc 02 §3).
//   app.route("/telegram", telegramRoutes);  // KOK-038 — grammY webhook mounted on Hono.
//   app.get("*", serveStaticAssets);         // KOK-004 — SPA static-asset serving + SPA-fallback
//                                            // routing for everything that isn't /api or /telegram.

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
