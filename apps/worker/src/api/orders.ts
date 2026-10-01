// Custom-order routes (KOK-033, Doc 03 UC-05…UC-08, Doc 07 SC-04). Mounted under /api in index.ts.
// Thin by design (D-2): parse with the shared Zod schema, call the core/orders service, serialize —
// DomainErrors thrown by the service propagate to the global errorHandler, which maps CONFLICT to
// 409 (every illegal state-machine transition) and VALIDATION to 400.
//
// Status transitions are named commands; PATCH /orders/:id is the one guarded agreement update.
// `/orders/impact` is the R-5 dry run for delivery/undo, which alone change kardex rows.

import {
  cancelOrderCommandSchema,
  confirmOrderCommandSchema,
  deliverOrderCommandSchema,
  listOrdersFiltersSchema,
  orderImpactRequestSchema,
  quoteOrderCommandSchema,
  recordOrderTransactionCommandSchema,
  undoDeliverOrderCommandSchema,
  updateOrderCommandSchema,
} from "@kokoro/shared";
import { Hono } from "hono";

import { recordTransaction } from "../core/finance/index.js";
import {
  cancelOrder,
  confirmOrder,
  deliverOrder,
  getOrder,
  getOrderReceiptSummary,
  listOrders,
  markOrderReady,
  previewOrderImpact,
  quoteOrder,
  startOrderProduction,
  undoDeliverOrder,
  undoMarkOrderReady,
  undoStartOrderProduction,
  updateOrder,
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
  .get("/orders/:id/receipt-summary", async (c) => {
    const db = createDb(c.env.DB);
    return c.json(await getOrderReceiptSummary(db, c.req.param("id")));
  })
  .patch("/orders/:id", async (c) => {
    const db = createDb(c.env.DB);
    const body = updateOrderCommandSchema.parse(await c.req.json());
    return c.json(await updateOrder(db, c.req.param("id"), body, ACTOR));
  })
  .post("/orders/:id/transactions", async (c) => {
    const db = createDb(c.env.DB);
    const body = recordOrderTransactionCommandSchema.parse(await c.req.json());
    const command = { ...body, customOrderId: c.req.param("id") };
    return c.json(await recordTransaction(db, command, ACTOR), 201);
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
  .post("/orders/:id/undo-start-production", async (c) => {
    const db = createDb(c.env.DB);
    return c.json(await undoStartOrderProduction(db, c.req.param("id"), ACTOR));
  })
  .post("/orders/:id/undo-ready", async (c) => {
    const db = createDb(c.env.DB);
    return c.json(await undoMarkOrderReady(db, c.req.param("id"), ACTOR));
  })
  .post("/orders/:id/deliver", async (c) => {
    const db = createDb(c.env.DB);
    const body = deliverOrderCommandSchema.parse(await c.req.json());
    return c.json(await deliverOrder(db, c.req.param("id"), body, ACTOR));
  })
  .post("/orders/:id/undo-deliver", async (c) => {
    const db = createDb(c.env.DB);
    const body = undoDeliverOrderCommandSchema.parse(await c.req.json());
    return c.json(await undoDeliverOrder(db, c.req.param("id"), body, ACTOR));
  })
  .post("/orders/:id/cancel", async (c) => {
    const db = createDb(c.env.DB);
    const body = cancelOrderCommandSchema.parse(await c.req.json());
    return c.json(await cancelOrder(db, c.req.param("id"), body, ACTOR));
  });
