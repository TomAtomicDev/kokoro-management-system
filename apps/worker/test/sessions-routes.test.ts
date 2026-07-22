// Route-level tests for the sessions endpoints (KOK-027): GET/POST /api/sessions,
// GET/PATCH/DELETE /api/sessions/:id, POST /api/sessions/:id/restore. The service-level assertions
// (cost-line transaction reversal/recreation, the one-OPEN-per-type warning, close-duration
// validation) live in test/sessions.test.ts; this file only proves the Hono wiring — auth/CSRF
// gate, status codes, body shape. Mirrors test/purchasing-routes.test.ts's/
// test/production-runs-routes.test.ts's exact pattern (`SELF.fetch`, the `login()` helper).
import { env, SELF } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../src/db/index.js";
import {
  auditLog,
  financialAccounts,
  financialTransactions,
  purchases,
  sessions,
} from "../src/db/schema.js";

const DEV_PASSWORD = "test-password-123";
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

interface SessionCostLineBody {
  label: string;
  amount: number;
  isEstimate?: boolean;
  accountId?: string;
}

interface CreateSessionBody {
  type: string;
  businessDate: string;
  startedAt?: string;
  endedAt?: string;
  durationMin?: number;
  costLines?: SessionCostLineBody[];
}

async function createSession(
  auth: { cookie: string; csrf: string },
  body: CreateSessionBody,
): Promise<{ res: Response; json: unknown }> {
  const res = await SELF.fetch("https://example.com/api/sessions", {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify(body),
  });
  return { res, json: await res.json() };
}

interface SessionDtoShape {
  session: {
    id: string;
    status: string;
    costLines: { id: string; amount: number; accountId: string | null }[];
  };
  openSessionWarning?: string | null;
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(auditLog).where(eq(auditLog.entityType, "sessions"));
  await db
    .delete(financialTransactions)
    .where(eq(financialTransactions.sourceEventType, "session_cost"));
  await db.delete(purchases);
  await db.delete(sessions);
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("POST /api/sessions", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "OTHER", businessDate: BUSINESS_DATE }),
    });
    expect(res.status).toBe(401);
  });

  it("creates a session with a non-estimate cost line and books cash", async () => {
    const auth = await login();
    const { res, json } = await createSession(auth, {
      type: "PRODUCTION",
      businessDate: BUSINESS_DATE,
      costLines: [{ label: "Transporte", amount: 2000, isEstimate: false, accountId: "acc_bank" }],
    });
    expect(res.status).toBe(201);
    const body = json as SessionDtoShape;
    expect(body.session.status).toBe("OPEN");
    expect(body.session.costLines).toHaveLength(1);
    expect(body.openSessionWarning).toBeNull();

    const accountRes = await SELF.fetch("https://example.com/api/finance/accounts", {
      headers: { cookie: auth.cookie },
    });
    const { accounts } = (await accountRes.json()) as {
      accounts: { id: string; balance: number }[];
    };
    expect(accounts.find((a) => a.id === "acc_bank")?.balance).toBe(-2000);
  });

  it("rejects a non-estimate line with no accountId with 400 VALIDATION", async () => {
    const auth = await login();
    const { res, json } = await createSession(auth, {
      type: "OTHER",
      businessDate: BUSINESS_DATE,
      costLines: [{ label: "Sin cuenta", amount: 1000 }],
    });
    expect(res.status).toBe(400);
    expect((json as { code: string }).code).toBe("VALIDATION");
  });

  it("surfaces the one-OPEN-per-type warning without blocking the second create", async () => {
    const auth = await login();
    await createSession(auth, { type: "DELIVERY_RUN", businessDate: BUSINESS_DATE });
    const { res, json } = await createSession(auth, {
      type: "DELIVERY_RUN",
      businessDate: BUSINESS_DATE,
    });
    expect(res.status).toBe(201);
    const body = json as SessionDtoShape;
    expect(body.openSessionWarning).toEqual(expect.stringContaining("DELIVERY_RUN"));
  });
});

describe("GET /api/sessions and /api/sessions/:id", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/sessions");
    expect(res.status).toBe(401);
  });

  it("lists sessions and filters by type", async () => {
    const auth = await login();
    await createSession(auth, { type: "PRODUCTION", businessDate: BUSINESS_DATE, durationMin: 30 });
    await createSession(auth, { type: "ADMIN", businessDate: BUSINESS_DATE });

    const res = await SELF.fetch("https://example.com/api/sessions?type=PRODUCTION", {
      headers: { cookie: auth.cookie },
    });
    expect(res.status).toBe(200);
    const { sessions: rows } = (await res.json()) as { sessions: { type: string }[] };
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("PRODUCTION");
  });

  it("gets a session by id with its linked-events viewer shape, and 404s for a missing one", async () => {
    const auth = await login();
    const { json: created } = await createSession(auth, {
      type: "OTHER",
      businessDate: BUSINESS_DATE,
    });
    const sessionId = (created as SessionDtoShape).session.id;

    const res = await SELF.fetch(`https://example.com/api/sessions/${sessionId}`, {
      headers: { cookie: auth.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session: { id: string };
      linkedEvents: {
        purchases: unknown[];
        productionRuns: unknown[];
        sales: unknown[];
        stockExits: unknown[];
      };
    };
    expect(body.session.id).toBe(sessionId);
    expect(body.linkedEvents).toMatchObject({
      purchases: [],
      productionRuns: [],
      sales: [],
      stockExits: [],
    });

    const missingRes = await SELF.fetch("https://example.com/api/sessions/does-not-exist", {
      headers: { cookie: auth.cookie },
    });
    expect(missingRes.status).toBe(404);
  });
});

describe("PATCH /api/sessions/:id", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/sessions/whatever", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("edits a session's cost lines, reversing the old transaction and booking the new one", async () => {
    const auth = await login();
    const { json: created } = await createSession(auth, {
      type: "PRODUCTION",
      businessDate: BUSINESS_DATE,
      costLines: [{ label: "Antes", amount: 1000, isEstimate: false, accountId: "acc_bank" }],
    });
    const sessionId = (created as SessionDtoShape).session.id;

    const res = await SELF.fetch(`https://example.com/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify({
        type: "PRODUCTION",
        businessDate: BUSINESS_DATE,
        status: "OPEN",
        costLines: [{ label: "Después", amount: 4000, isEstimate: false, accountId: "acc_bank" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SessionDtoShape;
    expect(body.session.costLines).toHaveLength(1);
    expect(body.session.costLines[0]?.amount).toBe(4000);

    const accountRes = await SELF.fetch("https://example.com/api/finance/accounts", {
      headers: { cookie: auth.cookie },
    });
    const { accounts } = (await accountRes.json()) as {
      accounts: { id: string; balance: number }[];
    };
    expect(accounts.find((a) => a.id === "acc_bank")?.balance).toBe(-4000);
  });

  it("rejects closing without a resolvable duration with 400 VALIDATION", async () => {
    const auth = await login();
    const { json: created } = await createSession(auth, {
      type: "OTHER",
      businessDate: BUSINESS_DATE,
    });
    const sessionId = (created as SessionDtoShape).session.id;

    const res = await SELF.fetch(`https://example.com/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify({ type: "OTHER", businessDate: BUSINESS_DATE, status: "CLOSED" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("VALIDATION");
  });

  it("returns 404 for a nonexistent session", async () => {
    const auth = await login();
    const res = await SELF.fetch("https://example.com/api/sessions/does-not-exist", {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify({ type: "OTHER", businessDate: BUSINESS_DATE, status: "OPEN" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/sessions/:id and POST /api/sessions/:id/restore", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/sessions/whatever", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("soft-deletes a session with no body, reversing its cash, and restores it back", async () => {
    const auth = await login();
    const { json: created } = await createSession(auth, {
      type: "OTHER",
      businessDate: BUSINESS_DATE,
      costLines: [{ label: "x", amount: 1500, isEstimate: false, accountId: "acc_cash" }],
    });
    const sessionId = (created as SessionDtoShape).session.id;

    const deleteRes = await SELF.fetch(`https://example.com/api/sessions/${sessionId}`, {
      method: "DELETE",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });
    expect(deleteRes.status).toBe(200);

    const getRes = await SELF.fetch(`https://example.com/api/sessions/${sessionId}`, {
      headers: { cookie: auth.cookie },
    });
    expect(getRes.status).toBe(404);

    const restoreRes = await SELF.fetch(`https://example.com/api/sessions/${sessionId}/restore`, {
      method: "POST",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });
    expect(restoreRes.status).toBe(200);
    const restored = (await restoreRes.json()) as SessionDtoShape;
    expect(restored.session.id).toBe(sessionId);

    const getAfterRestore = await SELF.fetch(`https://example.com/api/sessions/${sessionId}`, {
      headers: { cookie: auth.cookie },
    });
    expect(getAfterRestore.status).toBe(200);
  });

  it("blocks deletion with 409 CONFLICT while a purchase still links to the session", async () => {
    const auth = await login();
    const itemRes = await SELF.fetch("https://example.com/api/items", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({
        name: "Sessions route — linked item",
        kind: "RAW_MATERIAL",
        category: "INGREDIENT",
        unit: "KG",
      }),
    });
    const item = (await itemRes.json()) as { id: string };

    const { json: created } = await createSession(auth, {
      type: "PURCHASE_TRIP",
      businessDate: BUSINESS_DATE,
    });
    const sessionId = (created as SessionDtoShape).session.id;

    const purchaseRes = await SELF.fetch("https://example.com/api/purchases", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({
        accountId: "acc_bank",
        occurredAt: `${BUSINESS_DATE}T10:00:00.000Z`,
        businessDate: BUSINESS_DATE,
        sessionId,
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 1000 }],
      }),
    });
    expect(purchaseRes.status).toBe(201);

    const deleteRes = await SELF.fetch(`https://example.com/api/sessions/${sessionId}`, {
      method: "DELETE",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });
    expect(deleteRes.status).toBe(409);
    const body = (await deleteRes.json()) as { code: string };
    expect(body.code).toBe("CONFLICT");
  });

  it("returns 404 restoring a session that is not currently deleted", async () => {
    const auth = await login();
    const { json: created } = await createSession(auth, {
      type: "OTHER",
      businessDate: BUSINESS_DATE,
    });
    const sessionId = (created as SessionDtoShape).session.id;

    const res = await SELF.fetch(`https://example.com/api/sessions/${sessionId}/restore`, {
      method: "POST",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });
    expect(res.status).toBe(404);
  });
});
