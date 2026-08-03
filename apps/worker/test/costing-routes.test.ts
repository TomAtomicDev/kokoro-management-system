// Route-level smoke test for POST /api/costing/replacement-cost-refresh (KOK-029). Mirrors
// test/backups-routes.test.ts's exact pattern (`SELF.fetch`, the `login()` helper). Service-level
// assertions (dependency order, skip path, job_runs bookkeeping) live in
// test/replacement-cost-refresh.test.ts; this file only proves the Hono wiring Ã¢â‚¬â€ auth gate, body
// shape Ã¢â‚¬â€ and that the on-demand endpoint reuses the exact same planner the nightly job does.
import { env, SELF } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../src/db/index.js";
import { items, recipes } from "../src/db/schema.js";

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
  await db.delete(recipes); // cascades to recipe_lines
});

describe("POST /api/costing/replacement-cost-refresh", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/costing/replacement-cost-refresh", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("recomputes replacement_cost_mc for every SEMI_FINISHED/FINISHED item with an active default recipe", async () => {
    const auth = await login();
    const db = createDb(env.DB);

    const flourRes = await SELF.fetch("https://example.com/api/items", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({
        name: `Harina ${crypto.randomUUID()}`,
        kind: "RAW_MATERIAL",
        category: "INGREDIENT",
        unit: "KG",
        minStockQty: 0,
      }),
    });
    const flour = (await flourRes.json()) as { id: string };
    await db.update(items).set({ replacementCostMc: 8 }).where(eq(items.id, flour.id));

    const masaRes = await SELF.fetch("https://example.com/api/items", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({
        name: `Masa ${crypto.randomUUID()}`,
        kind: "SEMI_FINISHED",
        category: "BAKERY",
        unit: "KG",
      }),
    });
    const masa = (await masaRes.json()) as { id: string };

    await SELF.fetch("https://example.com/api/recipes", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({
        name: "Masa base",
        outputItemId: masa.id,
        expectedYieldQty: 1000,
        estLaborMin: null,
        isDefault: true,
        notes: null,
        lines: [{ itemId: flour.id, qty: 1000 }],
      }),
    });

    const res = await SELF.fetch("https://example.com/api/costing/replacement-cost-refresh", {
      method: "POST",
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      refreshedItemIds: string[];
      skippedItemIds: string[];
      refreshedAt: string;
    };
    expect(body.refreshedItemIds).toContain(masa.id);
    expect(body.refreshedAt).not.toBe("");

    const updated = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, masa.id),
    });
    expect(updated?.replacementCostMc).toBe(8);
  });
});
