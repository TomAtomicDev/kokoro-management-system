// Route-level test for GET /api/price-health (KOK-035, Doc 07 SC-12). Mirrors
// test/costing-routes.test.ts's exact pattern (`SELF.fetch`, the `login()` helper).

import { env, SELF } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb } from "../src/db/index.js";
import { items } from "../src/db/schema.js";

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

interface PriceHealthRow {
  itemId: string;
  salePriceMc: number | null;
  wac: number;
  replacementCostMc: number;
  marginWac: { amount: number; pctBasisPoints: number } | null;
  marginReplacement: { amount: number; pctBasisPoints: number } | null;
  priceSuggested: number | null;
  lastPriceChangeAt: string | null;
}

describe("GET /api/price-health", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/price-health");
    expect(res.status).toBe(401);
  });

  it("returns C-5 margins, the suggested price, min_margin_pct, and the last price-change date for FINISHED items only", async () => {
    const auth = await login();
    const db = createDb(env.DB);

    const cake = await SELF.fetch("https://example.com/api/items", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({
        name: `Torta ${crypto.randomUUID()}`,
        kind: "FINISHED",
        category: "BAKERY",
        unit: "UNIT",
        salePriceMc: 10_000_000, // Bs 100.00
      }),
    }).then((r) => r.json() as Promise<{ id: string }>);

    // wac/replacementCostMc are system-derived (never settable via the API) â€” set directly, same
    // pattern costing-routes.test.ts uses for its precondition setup. KOK-071: wacMc is
    // milli-centavos per WHOLE unit; 5_000_000 here reproduces the old wac=5-per-milli-unit
    // example via price-health.ts's own bridge (Ã·1,000,000) â€” replacementCostMc is not migrated yet.
    await db
      .update(items)
      .set({ wacMc: 5_000_000, replacementCostMc: 7_000_000 })
      .where(eq(items.id, cake.id));

    const rawMaterial = await SELF.fetch("https://example.com/api/items", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({
        name: `Harina ${crypto.randomUUID()}`,
        kind: "RAW_MATERIAL",
        category: "INGREDIENT",
        unit: "KG",
      }),
    }).then((r) => r.json() as Promise<{ id: string }>);

    const res = await SELF.fetch("https://example.com/api/price-health", {
      headers: authHeaders(auth),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: PriceHealthRow[]; minMarginPct: number };

    expect(body.minMarginPct).toBe(3000); // seeded default (Doc 04 Â§7)
    expect(body.rows.map((r) => r.itemId)).not.toContain(rawMaterial.id); // FINISHED-only

    const row = body.rows.find((r) => r.itemId === cake.id);
    expect(row).toBeDefined();
    // wac=5/milli-unit -> 5000/unit; margin = 10000-5000=5000, 50% -> 5000bp.
    expect(row?.marginWac).toEqual({ amount: 5000, pctBasisPoints: 5000 });
    // replacementCostMc=7/milli-unit -> 7000/unit; margin = 3000, 30% -> 3000bp.
    expect(row?.marginReplacement).toEqual({ amount: 3000, pctBasisPoints: 3000 });
    // price_suggested = 7000 / (1 - 0.30) = 10000.
    expect(row?.priceSuggested).toBe(10000);
    expect(row?.lastPriceChangeAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("omits FINISHED items with no sale price from margin comparisons but still lists them", async () => {
    const auth = await login();

    const unpriced = await SELF.fetch("https://example.com/api/items", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({
        name: `Sin precio ${crypto.randomUUID()}`,
        kind: "FINISHED",
        category: "BAKERY",
        unit: "UNIT",
      }),
    }).then((r) => r.json() as Promise<{ id: string }>);

    const res = await SELF.fetch("https://example.com/api/price-health", {
      headers: authHeaders(auth),
    });
    const body = (await res.json()) as { rows: PriceHealthRow[] };
    const row = body.rows.find((r) => r.itemId === unpriced.id);
    expect(row).toBeDefined();
    expect(row?.marginWac).toBeNull();
    expect(row?.marginReplacement).toBeNull();
    expect(row?.priceSuggested).toBeNull(); // replacementCostMc defaults to 0 (C-3 hasn't run yet)
    expect(row?.lastPriceChangeAt).toBeNull();
  });
});
