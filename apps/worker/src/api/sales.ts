// Sales routes (KOK-030, Doc 03 UC-03, Doc 07 SC-02/03). Mounted under /api in index.ts. Thin by
// design (D-2): parse with the shared Zod schema, call the core/sales service, serialize —
// DomainErrors thrown by the service propagate to the global errorHandler.
//
// Scope: CREATE + READ only (KOK-030) — POST /sales, GET /sales, GET /sales/:id. Edit/delete/restore
// and the dry-run impact endpoint are a separate follow-up task, exactly as core/purchasing shipped.

import { listSalesFiltersSchema, recordSaleCommandSchema } from "@kokoro/shared";
import { Hono } from "hono";

import { getSale, listSales, recordSale } from "../core/sales/index.js";
import { createDb } from "../db/index.js";
import type { Env, Variables } from "../env.js";

// Hardcoded here, not in core/ (core/ services take `actor` as a parameter): there is no Telegram/AI
// actor writing sales yet (those channels land in later backlog items), so every web request is
// attributed to the owner. Update this the day a second writer exists. Same precedent as
// api/purchasing.ts.
const ACTOR = "OWNER_WEB" as const;

export const salesRoute = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/sales", async (c) => {
    const db = createDb(c.env.DB);
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    const filters = listSalesFiltersSchema.parse(query);
    return c.json(await listSales(db, filters));
  })
  .post("/sales", async (c) => {
    const db = createDb(c.env.DB);
    const body = recordSaleCommandSchema.parse(await c.req.json());
    return c.json(await recordSale(db, body, ACTOR), 201);
  })
  .get("/sales/:id", async (c) => {
    const db = createDb(c.env.DB);
    return c.json(await getSale(db, c.req.param("id")));
  });
