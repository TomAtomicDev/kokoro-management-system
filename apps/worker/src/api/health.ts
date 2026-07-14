// GET /api/health — liveness probe. No auth, no DB access: just proves the Worker is up.
// Mounted under /api in index.ts.

import { Hono } from "hono";
import type { Env, Variables } from "../env.js";

export const healthRoute = new Hono<{ Bindings: Env; Variables: Variables }>().get(
  "/health",
  (c) => {
    return c.json({ ok: true, ts: new Date().toISOString() });
  },
);
