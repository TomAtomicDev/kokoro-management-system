// Purchasing routes (KOK-016, Doc 03 UC-01). Mounted under /api in index.ts. Thin by design (D-2):
// parse with the shared Zod schema, call the core/purchasing service, serialize — DomainErrors
// thrown by the service propagate to the global errorHandler.
//
// Photo upload shape (judgment call, no established precedent elsewhere in the codebase — this is
// the first R2 consumer): a dedicated `POST /purchases/photos` that generates the R2 key
// server-side and returns it, rather than a client-supplied-key `PUT /purchases/photos/:key`. A
// client never gets to choose (or overwrite) an arbitrary key; it may only hint at a file
// extension via `?ext=`, which is sanitized before use. The web form then includes the returned
// key in `recordPurchaseCommandSchema.receiptPhotoKey` when it submits the purchase itself — photo
// upload and purchase recording are two separate requests, not one multipart request, which keeps
// `recordPurchase`'s body a plain JSON document like every other command in this codebase.
// Retrieval mirrors this with `GET /purchases/photos/:key{.+}` (Hono's regex-param syntax for a
// path segment that itself contains `/`, since keys are `receipts/<uuid>.<ext>`).

import {
  deletePurchaseCommandSchema,
  generateUuidV7,
  listPurchasesFiltersSchema,
  purchaseImpactRequestSchema,
  recordPurchaseCommandSchema,
  updatePurchaseCommandSchema,
} from "@kokoro/shared";
import { Hono } from "hono";

import { notFound } from "../core/errors.js";
import {
  deletePurchase,
  getPurchase,
  listPurchases,
  previewPurchaseImpact,
  recordPurchase,
  restorePurchase,
  updatePurchase,
} from "../core/purchasing/index.js";
import { createDb } from "../db/index.js";
import type { Env, Variables } from "../env.js";
import { getObject, putObject } from "../lib/r2.js";

// Hardcoded here, not in core/ (core/ services take `actor` as a parameter): there is no
// Telegram/AI actor writing purchases yet (those channels land in later backlog items), so every
// web request is attributed to the owner. Update this the day a second writer exists.
const ACTOR = "OWNER_WEB" as const;

/** Content-type -> file extension for the common receipt-photo formats. Falls back to the
 * client's `?ext=` hint (sanitized) or `bin` when neither is recognized — the extension is purely
 * cosmetic (it never affects how the object is served back, which always uses the stored
 * Content-Type), so an unrecognized format still uploads successfully. */
const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

function resolveExtension(contentType: string, hint: string | null): string {
  const known = CONTENT_TYPE_EXTENSIONS[contentType];
  if (known) return known;
  if (hint) {
    const cleaned = hint
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase()
      .slice(0, 10);
    if (cleaned.length > 0) return cleaned;
  }
  return "bin";
}

export const purchasingRoute = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/purchases", async (c) => {
    const db = createDb(c.env.DB);
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    const filters = listPurchasesFiltersSchema.parse(query);
    return c.json(await listPurchases(db, filters));
  })
  .post("/purchases", async (c) => {
    const db = createDb(c.env.DB);
    const body = recordPurchaseCommandSchema.parse(await c.req.json());
    return c.json(await recordPurchase(db, body, ACTOR), 201);
  })
  .get("/purchases/photos/:key{.+}", async (c) => {
    const key = c.req.param("key");
    const object = await getObject(c.env.BUCKET, key);
    if (!object) {
      throw notFound("No se encontró la foto del recibo.", { key });
    }
    return c.body(object.body, 200, {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
    });
  })
  .post("/purchases/photos", async (c) => {
    const contentType = c.req.header("Content-Type") ?? "application/octet-stream";
    const ext = resolveExtension(contentType, new URL(c.req.url).searchParams.get("ext"));
    const key = `receipts/${generateUuidV7()}.${ext}`;
    const body = await c.req.arrayBuffer();
    await putObject(c.env.BUCKET, key, body, contentType);
    return c.json({ key }, 201);
  })
  .get("/purchases/:id", async (c) => {
    const db = createDb(c.env.DB);
    return c.json(await getPurchase(db, c.req.param("id")));
  })
  .patch("/purchases/:id", async (c) => {
    const db = createDb(c.env.DB);
    const body = updatePurchaseCommandSchema.parse(await c.req.json());
    return c.json(await updatePurchase(db, c.req.param("id"), body, ACTOR));
  })
  .delete("/purchases/:id", async (c) => {
    const db = createDb(c.env.DB);
    // A plain delete with no confirmation needed sends no body at all — `c.req.json()` throws on
    // an empty body, so it falls back to `{}` (deletePurchaseCommandSchema's `confirm` then
    // defaults to false, the same as an explicit `{ confirm: false }`).
    const body = deletePurchaseCommandSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await deletePurchase(db, c.req.param("id"), body, ACTOR));
  })
  .post("/purchases/:id/restore", async (c) => {
    const db = createDb(c.env.DB);
    // Same empty-body handling as the delete route, and the same schema — a restore's body is
    // only ever `{ confirm }`.
    const body = deletePurchaseCommandSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await restorePurchase(db, c.req.param("id"), body, ACTOR));
  })
  .post("/purchases/impact", async (c) => {
    const db = createDb(c.env.DB);
    const body = purchaseImpactRequestSchema.parse(await c.req.json());
    return c.json(await previewPurchaseImpact(db, body));
  });
