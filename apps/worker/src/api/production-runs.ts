// Production run routes (KOK-026, Doc 03 UC-02). Mounted under /api in index.ts. Thin by design
// (D-2): parse with the shared Zod schema, call the core/production service, serialize —
// DomainErrors thrown by the service propagate to the global errorHandler. Mirrors
// api/purchasing.ts's structure exactly, minus the receipt-photo endpoints — production has no
// receipt photo (Doc 04 §3.3 has no such column on `production_runs`).

import {
  deleteProductionRunCommandSchema,
  listProductionRunsFiltersSchema,
  productionRunImpactRequestSchema,
  recordProductionRunCommandSchema,
  updateProductionRunCommandSchema,
} from "@kokoro/shared";
import { Hono } from "hono";

import {
  deleteProductionRun,
  getProductionRun,
  listProductionRuns,
  previewProductionRunImpact,
  recordProductionRun,
  restoreProductionRun,
  updateProductionRun,
} from "../core/production/index.js";
import { createDb } from "../db/index.js";
import type { Env, Variables } from "../env.js";

// Hardcoded here, not in core/ (core/ services take `actor` as a parameter): there is no
// Telegram/AI actor writing production runs yet, so every web request is attributed to the owner.
// Same precedent as purchasing.ts's identical constant.
const ACTOR = "OWNER_WEB" as const;

export const productionRunsRoute = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/production-runs", async (c) => {
    const db = createDb(c.env.DB);
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    const filters = listProductionRunsFiltersSchema.parse(query);
    return c.json(await listProductionRuns(db, filters));
  })
  .post("/production-runs", async (c) => {
    const db = createDb(c.env.DB);
    const body = recordProductionRunCommandSchema.parse(await c.req.json());
    return c.json(await recordProductionRun(db, body, ACTOR), 201);
  })
  .get("/production-runs/:id", async (c) => {
    const db = createDb(c.env.DB);
    return c.json(await getProductionRun(db, c.req.param("id")));
  })
  .patch("/production-runs/:id", async (c) => {
    const db = createDb(c.env.DB);
    const body = updateProductionRunCommandSchema.parse(await c.req.json());
    return c.json(await updateProductionRun(db, c.req.param("id"), body, ACTOR));
  })
  .delete("/production-runs/:id", async (c) => {
    const db = createDb(c.env.DB);
    // A plain delete with no confirmation needed sends no body at all — same empty-body handling
    // as purchasing.ts's identical route (`c.req.json()` throws on an empty body, so it falls back
    // to `{}`, and `deleteProductionRunCommandSchema`'s `confirm` then defaults to false).
    const body = deleteProductionRunCommandSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await deleteProductionRun(db, c.req.param("id"), body, ACTOR));
  })
  .post("/production-runs/:id/restore", async (c) => {
    const db = createDb(c.env.DB);
    const body = deleteProductionRunCommandSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await restoreProductionRun(db, c.req.param("id"), body, ACTOR));
  })
  .post("/production-runs/impact", async (c) => {
    const db = createDb(c.env.DB);
    const body = productionRunImpactRequestSchema.parse(await c.req.json());
    return c.json(await previewProductionRunImpact(db, body));
  });
