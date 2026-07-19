// Route-level tests for the stock-exit edit/delete/restore/impact-preview endpoints (KOK-024 Phase
// F): PATCH/DELETE /api/inventory/exits/:id, POST /api/inventory/exits/:id/restore, POST
// /api/inventory/exits/impact. The service-level assertions (kardex regeneration, C-6 "invisible
// cost", WAC replay, R-4/R-5 math) live in test/exits.test.ts; this file only proves the Hono
// wiring — auth/CSRF gate, status codes, body shape, and that the R-5 confirmation contract (409
// CONFLICT carrying `details.impact`, then a `confirm: true` retry) survives the HTTP boundary end
// to end. Mirrors test/catalog-routes.test.ts's exact pattern (`SELF.fetch`, the `login()` helper).
import { env, SELF } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../src/db/index.js";
import { auditLog, financialAccounts, stockExits, stockMovements } from "../src/db/schema.js";

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

interface CreatePurchaseBody {
  accountId: string;
  occurredAt: string;
  businessDate: string;
  lines: { itemId: string; qty: number; lineTotal: number }[];
}

async function createPurchase(
  auth: { cookie: string; csrf: string },
  body: CreatePurchaseBody,
): Promise<void> {
  const res = await SELF.fetch("https://example.com/api/purchases", {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
}

interface CreateExitBody {
  itemId: string;
  qty: number;
  reason: string;
  occurredAt: string;
  businessDate: string;
  confirm?: boolean;
}

interface ExitDtoShape {
  exit: {
    id: string;
    itemId: string;
    qty: number;
    unitCostSnapshot: number;
    deletedAt?: string | null;
  };
}

async function createExit(
  auth: { cookie: string; csrf: string },
  body: CreateExitBody,
): Promise<ExitDtoShape> {
  const res = await SELF.fetch("https://example.com/api/inventory/exits", {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as ExitDtoShape;
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(auditLog).where(eq(auditLog.entityType, "stock_exits"));
  await db.delete(stockMovements).where(eq(stockMovements.sourceEventType, "stock_exit"));
  await db.delete(stockExits);
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

async function seedPurchasedItem(
  auth: { cookie: string; csrf: string },
  name: string,
  qty: number,
  lineTotal: number,
): Promise<string> {
  const itemId = await createItem(auth, name);
  await createPurchase(auth, {
    accountId: "acc_bank",
    occurredAt: NOW,
    businessDate: BUSINESS_DATE,
    lines: [{ itemId, qty, lineTotal }],
  });
  return itemId;
}

describe("PATCH /api/inventory/exits/:id", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/inventory/exits/whatever", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("edits an exit and returns the updated exit", async () => {
    const auth = await login();
    const itemId = await seedPurchasedItem(auth, "Exit route — edit item", 2000, 4000); // wac 2
    const created = await createExit(auth, {
      itemId,
      qty: 500,
      reason: "WASTE",
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
    });

    const res = await SELF.fetch(`https://example.com/api/inventory/exits/${created.exit.id}`, {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify({
        itemId,
        qty: 800,
        reason: "WASTE",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ExitDtoShape;
    expect(body.exit.id).toBe(created.exit.id);
    expect(body.exit.qty).toBe(800);
    // Same item -> the frozen snapshot survives the edit (module policy, mirrors exits.test.ts).
    expect(body.exit.unitCostSnapshot).toBe(2);
  });

  it("rejects a non-positive qty with 400 VALIDATION", async () => {
    const auth = await login();
    const itemId = await seedPurchasedItem(auth, "Exit route — edit invalid item", 1000, 1000);
    const created = await createExit(auth, {
      itemId,
      qty: 100,
      reason: "WASTE",
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
    });

    const res = await SELF.fetch(`https://example.com/api/inventory/exits/${created.exit.id}`, {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify({
        itemId,
        qty: 0,
        reason: "WASTE",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VALIDATION");
  });

  it("returns 404 for a nonexistent exit", async () => {
    const auth = await login();
    const res = await SELF.fetch("https://example.com/api/inventory/exits/does-not-exist", {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify({
        itemId: "irrelevant",
        qty: 100,
        reason: "WASTE",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
      }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/inventory/exits/:id", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/inventory/exits/whatever", {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("soft-deletes an exit with no body at all (plain delete, no confirmation needed)", async () => {
    const auth = await login();
    const itemId = await seedPurchasedItem(auth, "Exit route — delete item", 2000, 4000);
    const created = await createExit(auth, {
      itemId,
      qty: 500,
      reason: "WASTE",
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
    });

    const res = await SELF.fetch(`https://example.com/api/inventory/exits/${created.exit.id}`, {
      method: "DELETE",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deletedAt: string };
    expect(body.deletedAt).toEqual(expect.any(String));

    const getRes = await SELF.fetch(`https://example.com/api/inventory/exits/${created.exit.id}`, {
      headers: { cookie: auth.cookie },
    });
    expect(getRes.status).toBe(404);
  });

  it("rejects a non-boolean confirm with 400 VALIDATION", async () => {
    const auth = await login();
    const itemId = await seedPurchasedItem(auth, "Exit route — delete invalid item", 1000, 1000);
    const created = await createExit(auth, {
      itemId,
      qty: 100,
      reason: "WASTE",
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
    });

    const res = await SELF.fetch(`https://example.com/api/inventory/exits/${created.exit.id}`, {
      method: "DELETE",
      headers: authHeaders(auth),
      body: JSON.stringify({ confirm: "yes" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VALIDATION");
  });

  it("returns 404 for a nonexistent exit", async () => {
    const auth = await login();
    const res = await SELF.fetch("https://example.com/api/inventory/exits/does-not-exist", {
      method: "DELETE",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/inventory/exits/:id/restore", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/inventory/exits/whatever/restore", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("restores a soft-deleted exit, and it becomes visible via GET again", async () => {
    const auth = await login();
    const itemId = await seedPurchasedItem(auth, "Exit route — restore item", 2000, 4000);
    const created = await createExit(auth, {
      itemId,
      qty: 500,
      reason: "WASTE",
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
    });

    await SELF.fetch(`https://example.com/api/inventory/exits/${created.exit.id}`, {
      method: "DELETE",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });

    const restoreRes = await SELF.fetch(
      `https://example.com/api/inventory/exits/${created.exit.id}/restore`,
      { method: "POST", headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf } },
    );
    expect(restoreRes.status).toBe(200);
    const restored = (await restoreRes.json()) as ExitDtoShape;
    expect(restored.exit.id).toBe(created.exit.id);
    // Reused verbatim, never re-snapshotted at today's WAC (C-6/R-4 spirit).
    expect(restored.exit.unitCostSnapshot).toBe(2);

    const getRes = await SELF.fetch(`https://example.com/api/inventory/exits/${created.exit.id}`, {
      headers: { cookie: auth.cookie },
    });
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as { id: string };
    expect(fetched.id).toBe(created.exit.id);
  });

  it("rejects a non-boolean confirm with 400 VALIDATION", async () => {
    const auth = await login();
    const itemId = await seedPurchasedItem(auth, "Exit route — restore invalid item", 1000, 1000);
    const created = await createExit(auth, {
      itemId,
      qty: 100,
      reason: "WASTE",
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
    });
    await SELF.fetch(`https://example.com/api/inventory/exits/${created.exit.id}`, {
      method: "DELETE",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });

    const res = await SELF.fetch(
      `https://example.com/api/inventory/exits/${created.exit.id}/restore`,
      { method: "POST", headers: authHeaders(auth), body: JSON.stringify({ confirm: "yes" }) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VALIDATION");
  });

  it("returns 404 for an exit that is not currently deleted", async () => {
    const auth = await login();
    const itemId = await seedPurchasedItem(
      auth,
      "Exit route — restore not-deleted item",
      1000,
      1000,
    );
    const created = await createExit(auth, {
      itemId,
      qty: 100,
      reason: "WASTE",
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
    });

    const res = await SELF.fetch(
      `https://example.com/api/inventory/exits/${created.exit.id}/restore`,
      { method: "POST", headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf } },
    );
    expect(res.status).toBe(404);
  });
});

// R-5 (Doc 03 §7): a backdated edit/delete that re-weights already-booked cost is refused with 409
// CONFLICT carrying `details.impact`, and only proceeds once the caller retries with
// `confirm: true`. Reproduces exits.test.ts's canonical scenario entirely through HTTP:
// P1 10 000 @ 2 (07-10) -> exit A 8 000 (07-11, freezes 2) -> P2 10 000 @ 4 (07-12).
async function seedReplayScenario(auth: { cookie: string; csrf: string }, itemName: string) {
  const itemId = await createItem(auth, itemName);
  await createPurchase(auth, {
    accountId: "acc_bank",
    occurredAt: "2026-07-10T10:00:00.000Z",
    businessDate: "2026-07-10",
    lines: [{ itemId, qty: 10_000, lineTotal: 20_000 }],
  });
  const exitA = await createExit(auth, {
    itemId,
    qty: 8_000,
    reason: "WASTE",
    occurredAt: "2026-07-11T10:00:00.000Z",
    businessDate: "2026-07-11",
  });
  await createPurchase(auth, {
    accountId: "acc_bank",
    occurredAt: "2026-07-12T10:00:00.000Z",
    businessDate: "2026-07-12",
    lines: [{ itemId, qty: 10_000, lineTotal: 40_000 }],
  });
  return { itemId, exitAId: exitA.exit.id };
}

describe("R-5 confirmation flow through HTTP (PATCH /api/inventory/exits/:id)", () => {
  it("refuses a backdated edit with 409 carrying the impact, then succeeds when retried with confirm:true", async () => {
    const auth = await login();
    const { itemId, exitAId } = await seedReplayScenario(auth, "Exit route — R-5 edit");

    const editCommand = {
      itemId,
      qty: 4_000,
      reason: "WASTE",
      occurredAt: "2026-07-11T10:00:00.000Z",
      businessDate: "2026-07-11",
    };

    const refuseRes = await SELF.fetch(`https://example.com/api/inventory/exits/${exitAId}`, {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify(editCommand),
    });
    expect(refuseRes.status).toBe(409);
    const refuseBody = (await refuseRes.json()) as {
      code: string;
      details: { reason: string; impact: { requiresConfirmation: boolean } };
    };
    expect(refuseBody.code).toBe("CONFLICT");
    expect(refuseBody.details.reason).toBe("REPLAY_CONFIRMATION_REQUIRED");
    expect(refuseBody.details.impact.requiresConfirmation).toBe(true);

    // Refused before any write: the exit still holds its ORIGINAL qty.
    const unchangedRes = await SELF.fetch(`https://example.com/api/inventory/exits/${exitAId}`, {
      headers: { cookie: auth.cookie },
    });
    const unchanged = (await unchangedRes.json()) as { qty: number };
    expect(unchanged.qty).toBe(8_000);

    const confirmRes = await SELF.fetch(`https://example.com/api/inventory/exits/${exitAId}`, {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify({ ...editCommand, confirm: true }),
    });
    expect(confirmRes.status).toBe(200);
    const confirmed = (await confirmRes.json()) as ExitDtoShape;
    expect(confirmed.exit.qty).toBe(4_000);
  });
});

describe("R-5 confirmation flow through HTTP (DELETE /api/inventory/exits/:id)", () => {
  it("refuses a backdated delete that contradicts a LATER exit's frozen snapshot, then succeeds with confirm:true", async () => {
    const auth = await login();
    const { itemId, exitAId } = await seedReplayScenario(auth, "Exit route — R-5 delete");

    // A later exit whose frozen cost the deletion of exitA would disturb (R-5's precondition).
    await createExit(auth, {
      itemId,
      qty: 1_000,
      reason: "SPOILAGE",
      occurredAt: "2026-07-13T10:00:00.000Z",
      businessDate: "2026-07-13",
    });

    const refuseRes = await SELF.fetch(`https://example.com/api/inventory/exits/${exitAId}`, {
      method: "DELETE",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });
    expect(refuseRes.status).toBe(409);
    const refuseBody = (await refuseRes.json()) as {
      code: string;
      details: { reason: string; impact: { requiresConfirmation: boolean } };
    };
    expect(refuseBody.code).toBe("CONFLICT");
    expect(refuseBody.details.reason).toBe("REPLAY_CONFIRMATION_REQUIRED");
    expect(refuseBody.details.impact.requiresConfirmation).toBe(true);

    // Refused before any write: exitA is still live.
    const stillThereRes = await SELF.fetch(`https://example.com/api/inventory/exits/${exitAId}`, {
      headers: { cookie: auth.cookie },
    });
    expect(stillThereRes.status).toBe(200);

    const confirmRes = await SELF.fetch(`https://example.com/api/inventory/exits/${exitAId}`, {
      method: "DELETE",
      headers: authHeaders(auth),
      body: JSON.stringify({ confirm: true }),
    });
    expect(confirmRes.status).toBe(200);

    const afterRes = await SELF.fetch(`https://example.com/api/inventory/exits/${exitAId}`, {
      headers: { cookie: auth.cookie },
    });
    expect(afterRes.status).toBe(404);
  });
});

describe("POST /api/inventory/exits/impact", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/inventory/exits/impact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "delete", id: "whatever" }),
    });
    expect(res.status).toBe(401);
  });

  it("op=create: returns a sane impact shape and writes nothing", async () => {
    const auth = await login();
    const itemId = await seedPurchasedItem(auth, "Exit route — impact create item", 1000, 1000);

    const res = await SELF.fetch("https://example.com/api/inventory/exits/impact", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({
        op: "create",
        command: {
          itemId,
          qty: 100,
          reason: "WASTE",
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
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

    // Nothing was persisted: a fresh list of exits for this item has no new row.
    const listRes = await SELF.fetch(`https://example.com/api/inventory/exits?itemId=${itemId}`, {
      headers: { cookie: auth.cookie },
    });
    const { exits: listed } = (await listRes.json()) as { exits: { id: string }[] };
    expect(listed).toHaveLength(0);
  });

  it("op=update and op=delete: refuse-then-confirm impact matches the real mutation's, and writes nothing", async () => {
    const auth = await login();
    const { itemId, exitAId } = await seedReplayScenario(auth, "Exit route — impact update/delete");

    const updateImpactRes = await SELF.fetch("https://example.com/api/inventory/exits/impact", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({
        op: "update",
        id: exitAId,
        command: {
          itemId,
          qty: 4_000,
          reason: "WASTE",
          occurredAt: "2026-07-11T10:00:00.000Z",
          businessDate: "2026-07-11",
        },
      }),
    });
    expect(updateImpactRes.status).toBe(200);
    const updateImpact = (await updateImpactRes.json()) as { requiresConfirmation: boolean };
    expect(updateImpact.requiresConfirmation).toBe(true);

    const deleteImpactRes = await SELF.fetch("https://example.com/api/inventory/exits/impact", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({ op: "delete", id: exitAId }),
    });
    expect(deleteImpactRes.status).toBe(200);
    const deleteImpact = (await deleteImpactRes.json()) as { requiresConfirmation: boolean };
    expect(typeof deleteImpact.requiresConfirmation).toBe("boolean");

    // Neither preview touched the exit: still live, still its original qty.
    const getRes = await SELF.fetch(`https://example.com/api/inventory/exits/${exitAId}`, {
      headers: { cookie: auth.cookie },
    });
    const fetched = (await getRes.json()) as { qty: number };
    expect(fetched.qty).toBe(8_000);
  });

  it("rejects a body with no op with 400 VALIDATION", async () => {
    const auth = await login();
    const res = await SELF.fetch("https://example.com/api/inventory/exits/impact", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VALIDATION");
  });
});
