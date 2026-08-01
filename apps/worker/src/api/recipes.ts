// Recipe routes (KOK-025, Doc 07 SC-06). Mounted under /api in index.ts. Thin by design (D-2):
// parse with the shared Zod schema, call the core/recipes service, serialize — DomainErrors thrown
// by the service propagate to the global errorHandler. Mirrors api/catalog.ts.

import {
  listRecipesFiltersSchema,
  recordRecipeCommandSchema,
  setRecipeActiveCommandSchema,
  updateRecipeCommandSchema,
} from "@kokoro/shared";
import { Hono } from "hono";

import {
  getRecipe,
  listRecipes,
  recordRecipe,
  setRecipeActive,
  updateRecipe,
} from "../core/recipes/index.js";
import { createDb } from "../db/index.js";
import type { Env, Variables } from "../env.js";

// Same rationale as api/catalog.ts's ACTOR constant: no Telegram/AI actor writes recipes yet, so
// every web request is attributed to the owner.
const ACTOR = "OWNER_WEB" as const;

export const recipesRoute = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/recipes", async (c) => {
    const db = createDb(c.env.DB);
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    const filters = listRecipesFiltersSchema.parse(query);
    return c.json(await listRecipes(db, filters));
  })
  .post("/recipes", async (c) => {
    const db = createDb(c.env.DB);
    const body = recordRecipeCommandSchema.parse(await c.req.json());
    return c.json(await recordRecipe(db, body, ACTOR), 201);
  })
  .get("/recipes/:id", async (c) => {
    const db = createDb(c.env.DB);
    return c.json(await getRecipe(db, c.req.param("id")));
  })
  .patch("/recipes/:id", async (c) => {
    const db = createDb(c.env.DB);
    // updateRecipeCommandSchema carries no `id` field (recipes.ts's own doc comment: id travels via
    // the URL, not the body, matching purchasing's PATCH) — so unlike catalog's PATCH, nothing is
    // merged into the parsed body; the id goes straight to the service as its own parameter.
    const body = updateRecipeCommandSchema.parse(await c.req.json());
    return c.json(await updateRecipe(db, c.req.param("id"), body, ACTOR));
  })
  .post("/recipes/:id/active", async (c) => {
    const db = createDb(c.env.DB);
    const body = setRecipeActiveCommandSchema.parse({
      ...(await c.req.json()),
      id: c.req.param("id"),
    });
    return c.json(await setRecipeActive(db, body, ACTOR));
  });
