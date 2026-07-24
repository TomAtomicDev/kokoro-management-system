// Route-level smoke test for GET /api/audit/:entityType/:entityId (KOK-067). Mirrors
// test/costing-routes.test.ts's exact pattern (`SELF.fetch`, the `login()` helper). Service-level
// assertions (ordering, entity scoping, DTO shape) live in test/audit.test.ts; this file only
// proves the Hono wiring — auth gate, that a real recordPurchase's own "create" audit row is
// readable through this generic route with the SAME entityType string core/purchasing writes.
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../src/db/index.js";
import { purchases } from "../src/db/schema.js";

const DEV_PASSWORD = "test-password-123";

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

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(purchases); // cascades to purchase_lines
});

describe("GET /api/audit/:entityType/:entityId", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/audit/purchases/anything");
    expect(res.status).toBe(401);
  });

  it("returns the create audit row a real recordPurchase writes, under the same entityType", async () => {
    const auth = await login();

    const itemRes = await SELF.fetch("https://example.com/api/items", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({
        name: `Harina ${crypto.randomUUID()}`,
        kind: "RAW_MATERIAL",
        category: "INGREDIENT",
        unit: "KG",
      }),
    });
    const item = (await itemRes.json()) as { id: string };

    const purchaseRes = await SELF.fetch("https://example.com/api/purchases", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({
        accountId: "acc_cash",
        occurredAt: "2026-07-14T10:00:00.000Z",
        businessDate: "2026-07-14",
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 800 }],
      }),
    });
    const { purchase } = (await purchaseRes.json()) as { purchase: { id: string } };

    const res = await SELF.fetch(`https://example.com/api/audit/purchases/${purchase.id}`, {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { action: string; entityId: string }[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ action: "create", entityId: purchase.id });
  });
});
