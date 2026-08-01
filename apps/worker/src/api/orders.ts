// Custom-order routes (KOK-033, Doc 03 UC-05…UC-08, Doc 07 SC-04). Mounted under /api in index.ts.
// Thin by design (D-2): parse with the shared Zod schema, call the core/orders service, serialize —
// DomainErrors thrown by the service propagate to the global errorHandler, which maps CONFLICT to
// 409 (every illegal state-machine transition) and VALIDATION to 400.
//
// The verbs ARE the state machine (Doc 04 §5): there is deliberately no PATCH /orders/:id that
// free-edits columns, and no DELETE — `POST /orders/:id/cancel` is how an order stops existing.
// `/orders/impact` is the R-5 dry run for delivery, the only transition that writes kardex rows;
// it is registered before `/orders/:id` so the static segment reads unambiguously.
//
// `/orders/:id/lines/:lineId/resolve` (KOK-034) is the one exception, and a narrow one: it attaches
// a catalog item to a single free-text line so `deliverOrder`'s item-linked-lines gate (Doc 04 §5)
// can be satisfied without a generic line editor — see resolveOrderLine's own header.

import {
  cancelOrderCommandSchema,
  confirmOrderCommandSchema,
  deliverOrderCommandSchema,
  listOrdersFiltersSchema,
  orderImpactRequestSchema,
  quoteOrderCommandSchema,
  resolveOrderLineCommandSchema,
} from "@kokoro/shared";
import { Hono } from "hono";

import {
  cancelOrder,
  confirmOrder,
  deliverOrder,
  getOrder,
  listOrders,
  markOrderReady,
  previewOrderImpact,
  quoteOrder,
  resolveOrderLine,
  startOrderProduction,
} from "../core/orders/index.js";
import { createDb } from "../db/index.js";
import type { Env, Variables } from "../env.js";

// Hardcoded here, not in core/ (core/ services take `actor` as a parameter): every order write is a
// web request today. Same precedent as api/sales.ts.
const ACTOR = "OWNER_WEB" as const;

export const ordersRoute = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/orders", async (c) => {
    const db = createDb(c.env.DB);
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    const filters = listOrdersFiltersSchema.parse(query);
    return c.json(await listOrders(db, filters));
  })
  .post("/orders", async (c) => {
    const db = createDb(c.env.DB);
    const body = quoteOrderCommandSchema.parse(await c.req.json());
    return c.json(await quoteOrder(db, body, ACTOR), 201);
  })
  .post("/orders/impact", async (c) => {
    const db = createDb(c.env.DB);
    const body = orderImpactRequestSchema.parse(await c.req.json());
    return c.json(await previewOrderImpact(db, body));
  })
  .get("/orders/:id", async (c) => {
    const db = createDb(c.env.DB);
    return c.json(await getOrder(db, c.req.param("id")));
  })
  .post("/orders/:id/confirm", async (c) => {
    const db = createDb(c.env.DB);
    const body = confirmOrderCommandSchema.parse(await c.req.json());
    return c.json(await confirmOrder(db, c.req.param("id"), body, ACTOR));
  })
  .post("/orders/:id/start-production", async (c) => {
    const db = createDb(c.env.DB);
    // A pure status transition carries no payload at all — nothing to parse.
    return c.json(await startOrderProduction(db, c.req.param("id"), ACTOR));
  })
  .post("/orders/:id/ready", async (c) => {
    const db = createDb(c.env.DB);
    return c.json(await markOrderReady(db, c.req.param("id"), ACTOR));
  })
  .post("/orders/:id/deliver", async (c) => {
    const db = createDb(c.env.DB);
    const body = deliverOrderCommandSchema.parse(await c.req.json());
    return c.json(await deliverOrder(db, c.req.param("id"), body, ACTOR));
  })
  .post("/orders/:id/cancel", async (c) => {
    const db = createDb(c.env.DB);
    const body = cancelOrderCommandSchema.parse(await c.req.json());
    return c.json(await cancelOrder(db, c.req.param("id"), body, ACTOR));
  })
  .post("/orders/:id/lines/:lineId/resolve", async (c) => {
    const db = createDb(c.env.DB);
    const body = resolveOrderLineCommandSchema.parse(await c.req.json());
    return c.json(
      await resolveOrderLine(db, c.req.param("id"), c.req.param("lineId"), body, ACTOR),
    );
  });
