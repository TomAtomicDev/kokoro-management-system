// Finance routes (KOK-014, Doc 03 UC-11/12/13). Mounted under /api in index.ts. Thin by design
// (D-2): parse with the shared Zod schema, call the core/finance service, serialize —
// DomainErrors thrown by the service propagate to the global errorHandler.

import {
  listTransactionsFiltersSchema,
  recordTransactionCommandSchema,
  transferCommandSchema,
  withdrawCommandSchema,
} from "@kokoro/shared";
import { Hono } from "hono";

import {
  listAccounts,
  listTransactions,
  recordTransaction,
  transfer,
  withdraw,
} from "../core/finance/index.js";
import { createDb } from "../db/index.js";
import type { Env, Variables } from "../env.js";

// Hardcoded here, not in core/ (core/ services take `actor` as a parameter): there is no
// Telegram/AI actor writing to finance yet (those channels land in later backlog items), so
// every web request is attributed to the owner. Update this the day a second writer exists.
const ACTOR = "OWNER_WEB" as const;

export const financeRoute = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/finance/accounts", async (c) => {
    const db = createDb(c.env.DB);
    return c.json(await listAccounts(db));
  })
  .get("/finance/transactions", async (c) => {
    const db = createDb(c.env.DB);
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    const filters = listTransactionsFiltersSchema.parse(query);
    return c.json(await listTransactions(db, filters));
  })
  .post("/finance/transactions", async (c) => {
    const db = createDb(c.env.DB);
    const body = recordTransactionCommandSchema.parse(await c.req.json());
    return c.json(await recordTransaction(db, body, ACTOR), 201);
  })
  .post("/finance/transfers", async (c) => {
    const db = createDb(c.env.DB);
    const body = transferCommandSchema.parse(await c.req.json());
    return c.json(await transfer(db, body, ACTOR), 201);
  })
  .post("/finance/withdrawals", async (c) => {
    const db = createDb(c.env.DB);
    const body = withdrawCommandSchema.parse(await c.req.json());
    return c.json(await withdraw(db, body, ACTOR), 201);
  });
