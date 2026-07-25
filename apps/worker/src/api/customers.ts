// Customer routes (KOK-032). Mounted under /api in index.ts. Thin by design (D-2): parse with the
// shared Zod schema, call the core/customers service, serialize — DomainErrors propagate to the
// global errorHandler.

import {
  createCustomerCommandSchema,
  listCustomersFiltersSchema,
  updateCustomerCommandSchema,
} from "@kokoro/shared";
import { Hono } from "hono";

import {
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
} from "../core/customers/index.js";
import { createDb } from "../db/index.js";
import type { Env, Variables } from "../env.js";

// Hardcoded here, not in core/ (core/ services take `actor` as a parameter): there is no
// Telegram/AI actor writing to customers yet, so every web request is attributed to the owner.
// Same precedent as api/catalog.ts's ACTOR.
const ACTOR = "OWNER_WEB" as const;

export const customersRoute = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/customers", async (c) => {
    const db = createDb(c.env.DB);
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    const filters = listCustomersFiltersSchema.parse(query);
    return c.json(await listCustomers(db, filters));
  })
  .post("/customers", async (c) => {
    const db = createDb(c.env.DB);
    const body = createCustomerCommandSchema.parse(await c.req.json());
    return c.json(await createCustomer(db, body, ACTOR), 201);
  })
  .get("/customers/:id", async (c) => {
    const db = createDb(c.env.DB);
    return c.json(await getCustomer(db, c.req.param("id")));
  })
  .patch("/customers/:id", async (c) => {
    const db = createDb(c.env.DB);
    const body = updateCustomerCommandSchema.parse({
      ...(await c.req.json()),
      id: c.req.param("id"),
    });
    return c.json(await updateCustomer(db, body, ACTOR));
  });
