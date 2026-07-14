// Structured request logging middleware.
//
// Emits one JSON line per request via `console.log` (picked up by Workers Logs), shape per
// docs/system-design-knowledge-base/02-system-architecture.md §7:
//   { command, source_channel, duration_ms, ok }
//
// `event_id` from the Doc 02 §7 shape is intentionally omitted here — it only exists once a
// request produces a business event, and gets attached by the command-handling code in later
// backlog tasks (core/ services), not by this generic HTTP middleware.

import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import type { Env, Variables } from "../env.js";

type Bindings = { Bindings: Env; Variables: Variables };

interface RequestLogLine {
  command: string;
  source_channel: string;
  duration_ms: number;
  ok: boolean;
}

/**
 * Infers the logical `source_channel` for a request. Only `/telegram/*` and `/api/assistant/*`
 * are distinguished today, per Doc 02 §1's channel list; everything else is the plain HTTP API.
 * An explicit `headerOverride` (e.g. from a `X-Kokoro-Source-Channel` header), if present,
 * always wins (useful for tests / future channels without having to touch this file again).
 */
function inferSourceChannel(path: string, headerOverride: string | undefined): string {
  if (headerOverride) return headerOverride;
  if (path.startsWith("/telegram")) return "telegram";
  if (path.startsWith("/api/assistant")) return "assistant";
  return "api";
}

/** Logs one structured JSON line per request: `{ command, source_channel, duration_ms, ok }`. */
export function structuredLogging(): MiddlewareHandler<Bindings> {
  return async (c, next) => {
    const start = Date.now();
    await next();
    const duration_ms = Date.now() - start;

    // The matched route pattern (e.g. "/api/health") stands in for "command" until real
    // command names exist (per-channel command dispatch lands with core/ services).
    const command = routePath(c);
    const source_channel = inferSourceChannel(c.req.path, c.req.header("X-Kokoro-Source-Channel"));
    const ok = c.res.status < 500;

    const logLine: RequestLogLine = { command, source_channel, duration_ms, ok };
    console.log(JSON.stringify(logLine));
  };
}
