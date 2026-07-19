// Route-level tests for the purchase edit/delete/restore/impact-preview endpoints (KOK-024 Phase
// F): PATCH/DELETE /api/purchases/:id, POST /api/purchases/:id/restore, POST /api/purchases/impact.
// The service-level assertions (kardex regeneration, WAC replay, R-4/R-5 math) live in
// test/purchasing.test.ts; this file only proves the Hono wiring — auth/CSRF gate, status codes,
// body shape, and that the R-5 confirmation contract (409 CONFLICT carrying `details.impact`,
// then a `confirm: true` retry) actually survives the HTTP boundary end to end. Mirrors
// test/catalog-routes.test.ts's exact pattern (`SELF.fetch`, the `login()` helper).
import { env, SELF } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../src/db/index.js";
import { auditLog, financialAccounts, financialTransactions, purchases } from "../src/db/schema.js";

const DEV_PASSWORD = "test-password-123";
const NOW = "2026-07-16T10:00:00.000Z";
const BUSINESS_DATE = "2026-07-16";

function getCookieValue(setCookieHeader: string | null, name: string): string | undefined {
  if (!setCookieHeader) return undefined;
  const match = new RegExp(`${name}=([^;,]+)`).exec(setCookieHeader);
  return match?.[1];
}

async function login(): Promise<{ cookie: string; csrf: string }> {
  const res = await SELF.fetch("https://example.com/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: DEV_PASSWORD }),
  });
  const setCookie = res.headers.get("set-cookie");
  const session = getCookieValue(setCookie, "kokoro_session");
  const csrf = getCookieValue(setCookie, "kokoro_csrf");
  if (!session || !csrf) throw new Error("login did not return session/csrf cookies");
  return { cookie: `kokoro_session=${session}; kokoro_csrf=${csrf}`, csrf };
}

function authHeaders(auth: { cookie: string; csrf: string }) {
  return { "content-type": "application/json", cookie: auth.cookie, "X-CSRF-Token": auth.csrf };
}

async function createItem(auth: { cookie: string; csrf: string }, name: string): Promise<string> {
  const res = await SELF.fetch("https://example.com/api/items", {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({ name, kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "KG" }),
  });
  expect(res.status).toBe(201);
  const created = (await res.json()) as { id: string };
  return created.id;
}

interface PurchaseLineBody {
  itemId: string;
  qty: number;
  lineTotal: number;
}

interface CreatePurchaseBody {
  accountId: string;
  occurredAt: string;
  businessDate: string;
  lines: PurchaseLineBody[];
  confirm?: boolean;
}

async function createPurchase(
  auth: { cookie: string; csrf: string },
  body: CreatePurchaseBody,
): Promise<{ res: Response; json: unknown }> {
  const res = await SELF.fetch("https://example.com/api/purchases", {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify(body),
  });
  return { res, json: await res.json() };
}

interface PurchaseDtoShape {
  purchase: { id: string; total: number; deletedAt?: string | null };
  account: { id: string; balance: number };
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(auditLog).where(eq(auditLog.entityType, "purchases"));
  await db
    .delete(financialTransactions)
    .where(eq(financialTransactions.sourceEventType, "purchase"));
  await db.delete(purchases);
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("PATCH /api/purchases/:id", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/purchases/whatever", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("edits a purchase and returns the updated purchase + account", async () => {
    const auth = await login();
    const itemId = await createItem(auth, "Purchase route — edit item");
    const { json: created } = await createPurchase(auth, {
      accountId: "acc_bank",
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId, qty: 1000, lineTotal: 2000 }],
    });
    const purchaseId = (created as PurchaseDtoShape).purchase.id;

    const res = await SELF.fetch(`https://example.com/api/purchases/${purchaseId}`, {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify({
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        supplierName: "Nuevo proveedor",
        lines: [{ itemId, qty: 1000, lineTotal: 5000 }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PurchaseDtoShape;
    expect(body.purchase.id).toBe(purchaseId);
    expect(body.purchase.total).toBe(5000);
    expect(body.account.balance).toBe(-5000);
  });

  it("rejects an empty lines array with 400 VALIDATION", async () => {
    const auth = await login();
    const itemId = await createItem(auth, "Purchase route — edit invalid item");
    const { json: created } = await createPurchase(auth, {
      accountId: "acc_bank",
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId, qty: 1000, lineTotal: 2000 }],
    });
    const purchaseId = (created as PurchaseDtoShape).purchase.id;

    const res = await SELF.fetch(`https://example.com/api/purchases/${purchaseId}`, {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify({
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VALIDATION");
  });

  it("returns 404 for a nonexistent purchase", async () => {
    const auth = await login();
    const res = await SELF.fetch("https://example.com/api/purchases/does-not-exist", {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify({
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: "irrelevant", qty: 100, lineTotal: 100 }],
      }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/purchases/:id", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/purchases/whatever", {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("soft-deletes a purchase with no body at all (plain delete, no confirmation needed)", async () => {
    const auth = await login();
    const itemId = await createItem(auth, "Purchase route — delete item");
    const { json: created } = await createPurchase(auth, {
      accountId: "acc_bank",
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId, qty: 1000, lineTotal: 2000 }],
    });
    const purchaseId = (created as PurchaseDtoShape).purchase.id;

    const res = await SELF.fetch(`https://example.com/api/purchases/${purchaseId}`, {
      method: "DELETE",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });
    expect(res.status).toBe(200);
    // DeletePurchaseResult carries no top-level `deletedAt` (unlike stock exits' result) — R-3's
    // soft-delete is proven below by the GET 404, the same signal getPurchase itself uses.
    const body = (await res.json()) as PurchaseDtoShape;
    expect(body.purchase.id).toBe(purchaseId);
    expect(body.account.balance).toBe(0);

    const getRes = await SELF.fetch(`https://example.com/api/purchases/${purchaseId}`, {
      headers: { cookie: auth.cookie },
    });
    expect(getRes.status).toBe(404);
  });

  it("rejects a non-boolean confirm with 400 VALIDATION", async () => {
    const auth = await login();
    const itemId = await createItem(auth, "Purchase route — delete invalid item");
    const { json: created } = await createPurchase(auth, {
      accountId: "acc_bank",
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId, qty: 1000, lineTotal: 2000 }],
    });
    const purchaseId = (created as PurchaseDtoShape).purchase.id;

    const res = await SELF.fetch(`https://example.com/api/purchases/${purchaseId}`, {
      method: "DELETE",
      headers: authHeaders(auth),
      body: JSON.stringify({ confirm: "yes" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VALIDATION");
  });

  it("returns 404 for a nonexistent purchase", async () => {
    const auth = await login();
    const res = await SELF.fetch("https://example.com/api/purchases/does-not-exist", {
      method: "DELETE",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/purchases/:id/restore", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/purchases/whatever/restore", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("restores a soft-deleted purchase, and it becomes visible via GET again", async () => {
    const auth = await login();
    const itemId = await createItem(auth, "Purchase route — restore item");
    const { json: created } = await createPurchase(auth, {
      accountId: "acc_bank",
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId, qty: 1000, lineTotal: 2000 }],
    });
    const purchaseId = (created as PurchaseDtoShape).purchase.id;

    await SELF.fetch(`https://example.com/api/purchases/${purchaseId}`, {
      method: "DELETE",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });

    const restoreRes = await SELF.fetch(`https://example.com/api/purchases/${purchaseId}/restore`, {
      method: "POST",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });
    expect(restoreRes.status).toBe(200);
    const restored = (await restoreRes.json()) as PurchaseDtoShape;
    expect(restored.purchase.id).toBe(purchaseId);
    expect(restored.account.balance).toBe(-2000);

    const getRes = await SELF.fetch(`https://example.com/api/purchases/${purchaseId}`, {
      headers: { cookie: auth.cookie },
    });
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as { id: string };
    expect(fetched.id).toBe(purchaseId);
  });

  it("rejects a non-boolean confirm with 400 VALIDATION", async () => {
    const auth = await login();
    const itemId = await createItem(auth, "Purchase route — restore invalid item");
    const { json: created } = await createPurchase(auth, {
      accountId: "acc_bank",
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId, qty: 1000, lineTotal: 2000 }],
    });
    const purchaseId = (created as PurchaseDtoShape).purchase.id;
    await SELF.fetch(`https://example.com/api/purchases/${purchaseId}`, {
      method: "DELETE",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });

    const res = await SELF.fetch(`https://example.com/api/purchases/${purchaseId}/restore`, {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({ confirm: "yes" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VALIDATION");
  });

  it("returns 404 for a purchase that is not currently deleted", async () => {
    const auth = await login();
    const itemId = await createItem(auth, "Purchase route — restore not-deleted item");
    const { json: created } = await createPurchase(auth, {
      accountId: "acc_bank",
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId, qty: 1000, lineTotal: 2000 }],
    });
    const purchaseId = (created as PurchaseDtoShape).purchase.id;

    const res = await SELF.fetch(`https://example.com/api/purchases/${purchaseId}/restore`, {
      method: "POST",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });
    expect(res.status).toBe(404);
  });
});

// R-5 (Doc 03 §7): a backdated edit/delete that re-weights already-booked cost is refused with 409
// CONFLICT carrying `details.impact`, and only proceeds once the caller retries with
// `confirm: true`. Reproduces purchasing.test.ts's canonical backdated scenario entirely through
// HTTP: P1 (07-10) -> an exit consuming it (07-11, freezing a WAC snapshot) -> P2 (07-12) -> now
// P1 is edited/deleted, which the exit's frozen snapshot contradicts.
async function seedReplayScenario(auth: { cookie: string; csrf: string }, itemName: string) {
  const itemId = await createItem(auth, itemName);
  const { json: p1 } = await createPurchase(auth, {
    accountId: "acc_bank",
    occurredAt: "2026-07-10T10:00:00.000Z",
    businessDate: "2026-07-10",
    lines: [{ itemId, qty: 10_000, lineTotal: 20_000 }], // unit cost 2
  });
  const exitRes = await SELF.fetch("https://example.com/api/inventory/exits", {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({
      itemId,
      qty: 8_000,
      reason: "WASTE",
      occurredAt: "2026-07-11T10:00:00.000Z",
      businessDate: "2026-07-11",
    }),
  });
  expect(exitRes.status).toBe(201);
  const exit = (await exitRes.json()) as { exit: { id: string } };
  await createPurchase(auth, {
    accountId: "acc_bank",
    occurredAt: "2026-07-12T10:00:00.000Z",
    businessDate: "2026-07-12",
    lines: [{ itemId, qty: 10_000, lineTotal: 40_000 }], // unit cost 4
  });
  return { itemId, purchaseId: (p1 as PurchaseDtoShape).purchase.id, exitId: exit.exit.id };
}

describe("R-5 confirmation flow through HTTP (PATCH /api/purchases/:id)", () => {
  it("refuses a backdated edit with 409 carrying the impact, then succeeds when retried with confirm:true", async () => {
    const auth = await login();
    const { itemId, purchaseId, exitId } = await seedReplayScenario(
      auth,
      "Purchase route — R-5 edit",
    );

    const editCommand = {
      accountId: "acc_bank",
      occurredAt: "2026-07-10T10:00:00.000Z",
      businessDate: "2026-07-10",
      lines: [{ itemId, qty: 10_000, lineTotal: 100_000 }], // unit cost 10 — lands ahead of the exit
    };

    const refuseRes = await SELF.fetch(`https://example.com/api/purchases/${purchaseId}`, {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify(editCommand),
    });
    expect(refuseRes.status).toBe(409);
    const refuseBody = (await refuseRes.json()) as {
      code: string;
      details: {
        reason: string;
        impact: { requiresConfirmation: boolean; affectedStockExitIds: string[] };
      };
    };
    expect(refuseBody.code).toBe("CONFLICT");
    expect(refuseBody.details.reason).toBe("REPLAY_CONFIRMATION_REQUIRED");
    expect(refuseBody.details.impact.requiresConfirmation).toBe(true);
    expect(refuseBody.details.impact.affectedStockExitIds).toEqual([exitId]);

    // Refused before any write: the purchase still holds its ORIGINAL total.
    const unchangedRes = await SELF.fetch(`https://example.com/api/purchases/${purchaseId}`, {
      headers: { cookie: auth.cookie },
    });
    const unchanged = (await unchangedRes.json()) as { total: number };
    expect(unchanged.total).toBe(20_000);

    const confirmRes = await SELF.fetch(`https://example.com/api/purchases/${purchaseId}`, {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify({ ...editCommand, confirm: true }),
    });
    expect(confirmRes.status).toBe(200);
    const confirmed = (await confirmRes.json()) as PurchaseDtoShape;
    expect(confirmed.purchase.total).toBe(100_000);
  });
});

describe("POST /api/purchases/impact", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/purchases/impact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "delete", id: "whatever" }),
    });
    expect(res.status).toBe(401);
  });

  it("op=create: returns a sane impact shape and writes nothing", async () => {
    const auth = await login();
    const itemId = await createItem(auth, "Purchase route — impact create item");

    const res = await SELF.fetch("https://example.com/api/purchases/impact", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({
        op: "create",
        command: {
          accountId: "acc_bank",
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [{ itemId, qty: 1000, lineTotal: 2000 }],
        },
      }),
    });
    expect(res.status).toBe(200);
    const impact = (await res.json()) as {
      requiresConfirmation: boolean;
      costDelta: number;
      affectedItemIds: string[];
    };
    expect(typeof impact.requiresConfirmation).toBe("boolean");
    expect(typeof impact.costDelta).toBe("number");
    expect(Array.isArray(impact.affectedItemIds)).toBe(true);

    // Nothing was persisted: a fresh list of purchases for this account has no new row.
    const listRes = await SELF.fetch("https://example.com/api/purchases?accountId=acc_bank", {
      headers: { cookie: auth.cookie },
    });
    const { purchases: listed } = (await listRes.json()) as { purchases: { id: string }[] };
    expect(listed).toHaveLength(0);
  });

  it("op=update and op=delete: refuse-then-confirm impact matches the real mutation's, and writes nothing", async () => {
    const auth = await login();
    const { itemId, purchaseId, exitId } = await seedReplayScenario(
      auth,
      "Purchase route — impact update/delete",
    );

    const updateImpactRes = await SELF.fetch("https://example.com/api/purchases/impact", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({
        op: "update",
        id: purchaseId,
        command: {
          accountId: "acc_bank",
          occurredAt: "2026-07-10T10:00:00.000Z",
          businessDate: "2026-07-10",
          lines: [{ itemId, qty: 10_000, lineTotal: 100_000 }],
        },
      }),
    });
    expect(updateImpactRes.status).toBe(200);
    const updateImpact = (await updateImpactRes.json()) as {
      requiresConfirmation: boolean;
      affectedStockExitIds: string[];
    };
    expect(updateImpact.requiresConfirmation).toBe(true);
    expect(updateImpact.affectedStockExitIds).toEqual([exitId]);

    const deleteImpactRes = await SELF.fetch("https://example.com/api/purchases/impact", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({ op: "delete", id: purchaseId }),
    });
    expect(deleteImpactRes.status).toBe(200);
    const deleteImpact = (await deleteImpactRes.json()) as { requiresConfirmation: boolean };
    expect(deleteImpact.requiresConfirmation).toBe(true);

    // Neither preview touched the purchase: still live, still its original total.
    const getRes = await SELF.fetch(`https://example.com/api/purchases/${purchaseId}`, {
      headers: { cookie: auth.cookie },
    });
    const fetched = (await getRes.json()) as { total: number };
    expect(fetched.total).toBe(20_000);
  });

  it("rejects a body with no op with 400 VALIDATION", async () => {
    const auth = await login();
    const res = await SELF.fetch("https://example.com/api/purchases/impact", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VALIDATION");
  });
});
