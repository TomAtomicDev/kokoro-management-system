// Session routes (KOK-027, Doc 03 §6 UC-14). Mounted under /api in index.ts. Thin by design (D-2):
// parse with the shared Zod schema, call the core/sessions service, serialize — DomainErrors
// thrown by the service propagate to the global errorHandler. Mirrors api/production-runs.ts's
// structure exactly (no receipt-photo endpoints, same as production — sessions have no such
// column), minus the impact-preview endpoint: sessions trigger no costing replay at all (see
// core/sessions/index.ts's header), so there is nothing to dry-run.

import {
  closeAndStartSessionCommandSchema,
  deleteSessionCommandSchema,
  listSessionsFiltersSchema,
  recordSessionCommandSchema,
  sessionHoursFiltersSchema,
  updateSessionCommandSchema,
} from "@kokoro/shared";
import { Hono } from "hono";

import {
  closeAndStartSession,
  deleteSession,
  getDeduplicatedSessionHours,
  getSession,
  listSessions,
  recordSession,
  restoreSession,
  updateSession,
} from "../core/sessions/index.js";
import { createDb } from "../db/index.js";
import type { Env, Variables } from "../env.js";

// Hardcoded here, not in core/ (core/ services take `actor` as a parameter): there is no
// Telegram/AI actor writing sessions yet, so every web request is attributed to the owner. Same
// precedent as purchasing.ts's/production-runs.ts's identical constant.
const ACTOR = "OWNER_WEB" as const;

export const sessionsRoute = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/sessions", async (c) => {
    const db = createDb(c.env.DB);
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    const filters = listSessionsFiltersSchema.parse(query);
    return c.json(await listSessions(db, filters));
  })
  .get("/sessions/hours", async (c) => {
    const db = createDb(c.env.DB);
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    const filters = sessionHoursFiltersSchema.parse(query);
    return c.json({ hours: await getDeduplicatedSessionHours(db, filters) });
  })
  .post("/sessions", async (c) => {
    const db = createDb(c.env.DB);
    const body = recordSessionCommandSchema.parse(await c.req.json());
    return c.json(await recordSession(db, body, ACTOR), 201);
  })
  .post("/sessions/close-and-start", async (c) => {
    const db = createDb(c.env.DB);
    const body = closeAndStartSessionCommandSchema.parse(await c.req.json());
    return c.json(await closeAndStartSession(db, body, ACTOR), 201);
  })
  .get("/sessions/:id", async (c) => {
    const db = createDb(c.env.DB);
    return c.json(await getSession(db, c.req.param("id")));
  })
  .patch("/sessions/:id", async (c) => {
    const db = createDb(c.env.DB);
    const body = updateSessionCommandSchema.parse(await c.req.json());
    return c.json(await updateSession(db, c.req.param("id"), body, ACTOR));
  })
  .delete("/sessions/:id", async (c) => {
    const db = createDb(c.env.DB);
    // A plain delete sends no body at all — same empty-body handling as purchasing.ts's identical
    // route (`c.req.json()` throws on an empty body, so it falls back to `{}`, which
    // `deleteSessionCommandSchema` — an empty object schema, no `confirm` field at all here — parses
    // trivially).
    const body = deleteSessionCommandSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await deleteSession(db, c.req.param("id"), body, ACTOR));
  })
  .post("/sessions/:id/restore", async (c) => {
    const db = createDb(c.env.DB);
    const body = deleteSessionCommandSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await restoreSession(db, c.req.param("id"), body, ACTOR));
  });
