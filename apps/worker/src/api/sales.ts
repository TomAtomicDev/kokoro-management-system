// Sales routes (KOK-030, Doc 03 UC-03, Doc 07 SC-02/03). Mounted under /api in index.ts. Thin by
// design (D-2): parse with the shared Zod schema, call the core/sales service, serialize —
// DomainErrors thrown by the service propagate to the global errorHandler.
//
// Scope: CREATE + READ (KOK-030) — POST /sales, GET /sales, GET /sales/:id — plus UC-04's
// collectPayment/listReceivables (KOK-031): POST /sales/:id/collect-payment,
// GET /sales/receivables. `/sales/receivables` is registered before the `/sales/:id` param route
// (Hono's router prioritizes static segments regardless, but this keeps reading order honest).
// Generic edit/delete/restore for a sale and the dry-run impact endpoint remain a separate
// follow-up task (KOK-064), exactly as core/purchasing shipped.

import {
  collectPaymentCommandSchema,
  listSalesFiltersSchema,
  recordSaleCommandSchema,
} from "@kokoro/shared";
import { Hono } from "hono";

import {
  collectPayment,
  getSale,
  listReceivables,
  listSales,
  recordSale,
} from "../core/sales/index.js";
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
  .get("/sales/receivables", async (c) => {
    const db = createDb(c.env.DB);
    return c.json(await listReceivables(db));
  })
  .get("/sales/:id", async (c) => {
    const db = createDb(c.env.DB);
    return c.json(await getSale(db, c.req.param("id")));
  })
  .post("/sales/:id/collect-payment", async (c) => {
    const db = createDb(c.env.DB);
    const body = collectPaymentCommandSchema.parse(await c.req.json());
    return c.json(await collectPayment(db, c.req.param("id"), body, ACTOR));
  });
