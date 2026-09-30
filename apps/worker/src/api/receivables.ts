// Grouped all-dates receivables read (KOK-197, Doc 07 SC-21). Read-only by design.

import { listReceivablesQuerySchema } from "@kokoro/shared";
import { Hono } from "hono";

import { listGroupedReceivables } from "../core/finance/index.js";
import { createDb } from "../db/index.js";
import type { Env, Variables } from "../env.js";

export const receivablesRoute = new Hono<{ Bindings: Env; Variables: Variables }>().get(
  "/receivables",
  async (c) => {
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    const filters = listReceivablesQuerySchema.parse(query);
    return c.json(await listGroupedReceivables(createDb(c.env.DB), filters));
  },
);
