import {
  listAssemblyDefinitionsFiltersSchema,
  recordAssemblyDefinitionCommandSchema,
  setAssemblyDefinitionActiveCommandSchema,
  updateAssemblyDefinitionCommandSchema,
} from "@kokoro/shared";
import { Hono } from "hono";

import {
  getAssemblyDefinition,
  listAssemblyDefinitions,
  recordAssemblyDefinition,
  setAssemblyDefinitionActive,
  updateAssemblyDefinition,
} from "../core/assemblies/index.js";
import { createDb } from "../db/index.js";
import type { Env, Variables } from "../env.js";

// No Telegram/AI actor writes definitions yet, so every web request is attributed to the owner.
const ACTOR = "OWNER_WEB" as const;

export const assemblyDefinitionsRoute = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/assembly-definitions", async (c) => {
    const db = createDb(c.env.DB);
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    return c.json(
      await listAssemblyDefinitions(db, listAssemblyDefinitionsFiltersSchema.parse(query)),
    );
  })
  .post("/assembly-definitions", async (c) => {
    const db = createDb(c.env.DB);
    const body = recordAssemblyDefinitionCommandSchema.parse(await c.req.json());
    return c.json(await recordAssemblyDefinition(db, body, ACTOR), 201);
  })
  .get("/assembly-definitions/:id", async (c) => {
    return c.json(await getAssemblyDefinition(createDb(c.env.DB), c.req.param("id")));
  })
  .patch("/assembly-definitions/:id", async (c) => {
    const db = createDb(c.env.DB);
    const body = updateAssemblyDefinitionCommandSchema.parse(await c.req.json());
    return c.json(await updateAssemblyDefinition(db, c.req.param("id"), body, ACTOR));
  })
  .post("/assembly-definitions/:id/active", async (c) => {
    const db = createDb(c.env.DB);
    const body = setAssemblyDefinitionActiveCommandSchema.parse({
      ...(await c.req.json()),
      id: c.req.param("id"),
    });
    return c.json(await setAssemblyDefinitionActive(db, body, ACTOR));
  });
