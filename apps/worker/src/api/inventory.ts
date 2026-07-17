// Inventory routes (KOK-017 stock/kardex reads, KOK-018 non-commercial exits, KOK-019 inventory
// counts — Doc 03 §3 UC-09/UC-10, Doc 07 SC-08). Mounted under /api in index.ts. Thin by design
// (D-2): parse with the shared Zod schema, call the core/inventory service/query, serialize —
// DomainErrors (and, per apps/worker/src/api/error-handler.ts, bare ZodErrors too, e.g.
// `/inventory/kardex` called without the required `itemId`) propagate to the global errorHandler,
// which already maps a ZodError to a 400 with a Spanish message — no route-level try/catch needed
// here.

import {
  commitCountCommandSchema,
  listCountsFiltersSchema,
  listKardexFiltersSchema,
  listStockExitsFiltersSchema,
  listStockFiltersSchema,
  listWasteSummaryFiltersSchema,
  recordStockExitCommandSchema,
  startCountCommandSchema,
  updateCountLineCommandSchema,
} from "@kokoro/shared";
import { Hono } from "hono";

import {
  commitCount,
  getCount,
  getStockExit,
  listCounts,
  listKardex,
  listStock,
  listStockExits,
  listWasteSummary,
  recordExit,
  startCount,
  updateCountLine,
} from "../core/inventory/index.js";
import { createDb } from "../db/index.js";
import type { Env, Variables } from "../env.js";

// Hardcoded here, not in core/ (core/ services take `actor` as a parameter): mirrors
// api/purchasing.ts's identical precedent — there is no Telegram/AI actor writing exits yet.
const ACTOR = "OWNER_WEB" as const;

export const inventoryRoute = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/inventory/stock", async (c) => {
    const db = createDb(c.env.DB);
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    const filters = listStockFiltersSchema.parse(query);
    return c.json(await listStock(db, filters));
  })
  .get("/inventory/kardex", async (c) => {
    const db = createDb(c.env.DB);
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    const filters = listKardexFiltersSchema.parse(query);
    return c.json(await listKardex(db, filters));
  })
  .get("/inventory/waste-summary", async (c) => {
    const db = createDb(c.env.DB);
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    const filters = listWasteSummaryFiltersSchema.parse(query);
    return c.json(await listWasteSummary(db, filters));
  })
  .get("/inventory/exits", async (c) => {
    const db = createDb(c.env.DB);
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    const filters = listStockExitsFiltersSchema.parse(query);
    return c.json(await listStockExits(db, filters));
  })
  .post("/inventory/exits", async (c) => {
    const db = createDb(c.env.DB);
    const body = recordStockExitCommandSchema.parse(await c.req.json());
    return c.json(await recordExit(db, body, ACTOR), 201);
  })
  .get("/inventory/exits/:id", async (c) => {
    const db = createDb(c.env.DB);
    return c.json(await getStockExit(db, c.req.param("id")));
  })
  .post("/inventory/counts", async (c) => {
    const db = createDb(c.env.DB);
    const body = startCountCommandSchema.parse(await c.req.json());
    return c.json(await startCount(db, body, ACTOR), 201);
  })
  .get("/inventory/counts", async (c) => {
    const db = createDb(c.env.DB);
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    const filters = listCountsFiltersSchema.parse(query);
    return c.json(await listCounts(db, filters));
  })
  .get("/inventory/counts/:id", async (c) => {
    const db = createDb(c.env.DB);
    return c.json(await getCount(db, c.req.param("id")));
  })
  .patch("/inventory/counts/:id/lines/:itemId", async (c) => {
    const db = createDb(c.env.DB);
    const body = updateCountLineCommandSchema.parse({
      ...(await c.req.json()),
      countId: c.req.param("id"),
      itemId: c.req.param("itemId"),
    });
    return c.json(await updateCountLine(db, body, ACTOR));
  })
  .post("/inventory/counts/:id/commit", async (c) => {
    const db = createDb(c.env.DB);
    const body = commitCountCommandSchema.parse({ countId: c.req.param("id") });
    return c.json(await commitCount(db, body, ACTOR));
  });
