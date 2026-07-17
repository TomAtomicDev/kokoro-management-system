// Onboarding wizard routes (KOK-020, Doc 07 steps 1-5). Mounted under /api in index.ts. Thin by
// design (D-2): parse with the shared Zod schema, call the core/ service, serialize —
// DomainErrors thrown by the service propagate to the global errorHandler.

import {
  bulkCreateItemsCommandSchema,
  nowIso,
  type OnboardingCompleteResult,
  type OnboardingStatusResult,
  setOpeningBalancesCommandSchema,
} from "@kokoro/shared";
import { Hono } from "hono";

import { bulkCreateItems } from "../core/catalog/index.js";
import { setOpeningBalances } from "../core/finance/index.js";
import { getSetting, setSetting } from "../core/settings/index.js";
import { createDb } from "../db/index.js";
import type { Env, Variables } from "../env.js";

// Hardcoded here, not in core/ (core/ services take `actor` as a parameter): there is no
// Telegram/AI actor writing to onboarding — every wizard request is attributed to the owner
// (mirrors api/finance.ts's identical precedent).
const ACTOR = "OWNER_WEB" as const;

const ONBOARDING_COMPLETED_AT_KEY = "onboarding_completed_at";

export const onboardingRoute = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/onboarding/status", async (c) => {
    const db = createDb(c.env.DB);
    const completedAt = await getSetting(db, ONBOARDING_COMPLETED_AT_KEY);
    const result: OnboardingStatusResult = { completed: !!completedAt };
    return c.json(result);
  })
  .post("/onboarding/opening-balances", async (c) => {
    const db = createDb(c.env.DB);
    const body = setOpeningBalancesCommandSchema.parse(await c.req.json());
    return c.json(await setOpeningBalances(db, body, ACTOR), 201);
  })
  .post("/onboarding/catalog", async (c) => {
    const db = createDb(c.env.DB);
    const body = bulkCreateItemsCommandSchema.parse(await c.req.json());
    return c.json(await bulkCreateItems(db, body, ACTOR), 201);
  })
  .post("/onboarding/complete", async (c) => {
    const db = createDb(c.env.DB);
    const completedAt = nowIso();
    await setSetting(db, ONBOARDING_COMPLETED_AT_KEY, completedAt);
    const result: OnboardingCompleteResult = { completed: true, completedAt };
    return c.json(result);
  });
