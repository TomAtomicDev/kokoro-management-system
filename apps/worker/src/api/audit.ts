// Audit-log read route (KOK-067, Doc 04 §3.5). Thin by design (D-2): call the core/audit query,
// serialize. Generic and mounted once — reusable by every event vertical's DetailDrawer footer —
// rather than duplicated per resource (`/purchases/:id/audit`, `/inventory/exits/:id/audit`, ...):
// `entityType`/`entityId` are the same free-text pair every core/ service already writes via
// buildAuditLogInsert, so one route over both is the natural shape, not a second implementation.

import type { ListAuditLogResult } from "@kokoro/shared";
import { Hono } from "hono";

import { listAuditLogForEntity } from "../core/audit.js";
import { createDb } from "../db/index.js";
import type { Env, Variables } from "../env.js";

export const auditRoute = new Hono<{ Bindings: Env; Variables: Variables }>().get(
  "/audit/:entityType/:entityId",
  async (c) => {
    const db = createDb(c.env.DB);
    const entries = await listAuditLogForEntity(
      db,
      c.req.param("entityType"),
      c.req.param("entityId"),
    );
    const result: ListAuditLogResult = { entries };
    return c.json(result);
  },
);
