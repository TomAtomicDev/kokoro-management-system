// Sales routes (KOK-030, Doc 03 UC-03, Doc 07 SC-02/03). Mounted under /api in index.ts. Thin by
// design (D-2): parse with the shared Zod schema, call the core/sales service, serialize —
// DomainErrors thrown by the service propagate to the global errorHandler.
//
// Scope: CREATE + READ (KOK-030) — POST /sales, GET /sales, GET /sales/:id — plus UC-04's
// collectPayment/listReceivables (KOK-031): POST /sales/:id/collect-payment,
// GET /sales/receivables. `/sales/receivables` is registered before the `/sales/:id` param route
// (Hono's router prioritizes static segments regardless, but this keeps reading order honest).
// Edit/delete/restore + the dry-run impact endpoint (KOK-064) mirror api/purchasing.ts's shape
// exactly: PATCH/DELETE /sales/:id, POST /sales/:id/restore, POST /sales/impact.

import {
  collectPaymentCommandSchema,
  deleteSaleCommandSchema,
  listSalesFiltersSchema,
  recordSaleCommandSchema,
  saleImpactRequestSchema,
  updateSaleCommandSchema,
} from "@kokoro/shared";
import { Hono } from "hono";

import {
  collectPayment,
  deleteSale,
  getSale,
  listReceivables,
  listSales,
  previewSaleImpact,
  recordSale,
  restoreSale,
  updateSale,
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
  .post("/sales/impact", async (c) => {
    const db = createDb(c.env.DB);
    const body = saleImpactRequestSchema.parse(await c.req.json());
    return c.json(await previewSaleImpact(db, body));
  })
  .get("/sales/:id", async (c) => {
    const db = createDb(c.env.DB);
    return c.json(await getSale(db, c.req.param("id")));
  })
  .patch("/sales/:id", async (c) => {
    const db = createDb(c.env.DB);
    const body = updateSaleCommandSchema.parse(await c.req.json());
    return c.json(await updateSale(db, c.req.param("id"), body, ACTOR));
  })
  .delete("/sales/:id", async (c) => {
    const db = createDb(c.env.DB);
    // A plain delete with no confirmation needed sends no body at all — `c.req.json()` throws on
    // an empty body, so it falls back to `{}` (deleteSaleCommandSchema's `confirm` then defaults to
    // false, the same as an explicit `{ confirm: false }`). Mirrors api/purchasing.ts's delete route.
    const body = deleteSaleCommandSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await deleteSale(db, c.req.param("id"), body, ACTOR));
  })
  .post("/sales/:id/restore", async (c) => {
    const db = createDb(c.env.DB);
    // Same empty-body handling as the delete route, and the same schema — a restore's body is only
    // ever `{ confirm }`.
    const body = deleteSaleCommandSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await restoreSale(db, c.req.param("id"), body, ACTOR));
  })
  .post("/sales/:id/collect-payment", async (c) => {
    const db = createDb(c.env.DB);
    const body = collectPaymentCommandSchema.parse(await c.req.json());
    return c.json(await collectPayment(db, c.req.param("id"), body, ACTOR));
  });
