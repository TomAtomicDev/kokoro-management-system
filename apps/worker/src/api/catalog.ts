// Items + item alias routes (KOK-011, Doc 07 SC-15). Mounted under /api in index.ts. Thin by
// design (D-2): parse with the shared Zod schema, call the core/catalog service, serialize —
// DomainErrors thrown by the service propagate to the global errorHandler.

import {
  addItemAliasCommandSchema,
  createItemCommandSchema,
  listItemsFiltersSchema,
  mergeItemsCommandSchema,
  removeItemAliasCommandSchema,
  setItemActiveCommandSchema,
  updateItemCommandSchema,
} from "@kokoro/shared";
import { Hono } from "hono";

import {
  addItemAlias,
  createItem,
  getItem,
  listItems,
  mergeItems,
  removeItemAlias,
  setItemActive,
  updateItem,
} from "../core/catalog/index.js";
import { createDb } from "../db/index.js";
import type { Env, Variables } from "../env.js";

// Hardcoded here, not in core/ (core/ services take `actor` as a parameter): there is no
// Telegram/AI actor writing to the catalog yet (those channels land in later backlog items), so
// every web request is attributed to the owner. Update this the day a second writer exists.
const ACTOR = "OWNER_WEB" as const;

export const catalogRoute = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/items", async (c) => {
    const db = createDb(c.env.DB);
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    const filters = listItemsFiltersSchema.parse(query);
    return c.json(await listItems(db, filters));
  })
  .post("/items", async (c) => {
    const db = createDb(c.env.DB);
    const body = createItemCommandSchema.parse(await c.req.json());
    return c.json(await createItem(db, body, ACTOR), 201);
  })
  .post("/items/merge", async (c) => {
    const db = createDb(c.env.DB);
    const body = mergeItemsCommandSchema.parse(await c.req.json());
    return c.json(await mergeItems(db, body, ACTOR));
  })
  .get("/items/:id", async (c) => {
    const db = createDb(c.env.DB);
    return c.json(await getItem(db, c.req.param("id")));
  })
  .patch("/items/:id", async (c) => {
    const db = createDb(c.env.DB);
    const body = updateItemCommandSchema.parse({
      ...(await c.req.json()),
      id: c.req.param("id"),
    });
    return c.json(await updateItem(db, body, ACTOR));
  })
  .post("/items/:id/active", async (c) => {
    const db = createDb(c.env.DB);
    const body = setItemActiveCommandSchema.parse({
      ...(await c.req.json()),
      id: c.req.param("id"),
    });
    return c.json(await setItemActive(db, body, ACTOR));
  })
  .post("/items/:id/aliases", async (c) => {
    const db = createDb(c.env.DB);
    const body = addItemAliasCommandSchema.parse({
      ...(await c.req.json()),
      itemId: c.req.param("id"),
    });
    return c.json(await addItemAlias(db, body, ACTOR), 201);
  })
  .delete("/item-aliases/:aliasId", async (c) => {
    const db = createDb(c.env.DB);
    const body = removeItemAliasCommandSchema.parse({ aliasId: c.req.param("aliasId") });
    await removeItemAlias(db, body, ACTOR);
    return c.json({ ok: true });
  });
