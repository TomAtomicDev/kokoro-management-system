import {
  assemblyImpactRequestSchema,
  deleteAssemblyCommandSchema,
  listAssembliesFiltersSchema,
  recordAssemblyCommandSchema,
  updateAssemblyCommandSchema,
} from "@kokoro/shared";
import { Hono } from "hono";

import {
  deleteAssembly,
  getAssembly,
  listAssemblies,
  previewAssemblyImpact,
  recordAssembly,
  restoreAssembly,
  updateAssembly,
} from "../core/assembly-events/index.js";
import { createDb } from "../db/index.js";
import type { Env, Variables } from "../env.js";

const ACTOR = "OWNER_WEB" as const;

export const assembliesRoute = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/assemblies", async (c) => {
    const db = createDb(c.env.DB);
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    return c.json(await listAssemblies(db, listAssembliesFiltersSchema.parse(query)));
  })
  .post("/assemblies", async (c) => {
    const db = createDb(c.env.DB);
    const body = recordAssemblyCommandSchema.parse(await c.req.json());
    return c.json(await recordAssembly(db, body, ACTOR), 201);
  })
  .get("/assemblies/:id", async (c) => {
    return c.json(await getAssembly(createDb(c.env.DB), c.req.param("id")));
  })
  .patch("/assemblies/:id", async (c) => {
    const db = createDb(c.env.DB);
    const body = updateAssemblyCommandSchema.parse(await c.req.json());
    return c.json(await updateAssembly(db, c.req.param("id"), body, ACTOR));
  })
  .delete("/assemblies/:id", async (c) => {
    const db = createDb(c.env.DB);
    const body = deleteAssemblyCommandSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await deleteAssembly(db, c.req.param("id"), body, ACTOR));
  })
  .post("/assemblies/:id/restore", async (c) => {
    const db = createDb(c.env.DB);
    const body = deleteAssemblyCommandSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await restoreAssembly(db, c.req.param("id"), body, ACTOR));
  })
  .post("/assemblies/impact", async (c) => {
    const db = createDb(c.env.DB);
    const body = assemblyImpactRequestSchema.parse(await c.req.json());
    return c.json(await previewAssemblyImpact(db, body));
  });
