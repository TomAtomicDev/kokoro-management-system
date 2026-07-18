// Route-level smoke test for GET /api/dashboard/summary (KOK-023, Doc 07 SC-01 reduced scope).
// Mirrors test/catalog-routes.test.ts's shape: proves the Hono wiring (auth gate, body shape) end
// to end via SELF.fetch, composing real writes through the existing services (recordPurchase,
// recordTransaction) rather than any direct SQL (D-2). The aggregation logic itself (SUM over
// v_stock, bank/cash split) is covered more thoroughly at the service level in
// test/inventory-queries.test.ts (getStockValueTotal) and test/finance.test.ts (listAccounts).

import { env, SELF } from "cloudflare:test";
import type { DashboardSummaryDto } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../src/db/index.js";
import { financialAccounts } from "../src/db/schema.js";

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

beforeEach(async () => {
  const db = createDb(env.DB);
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("GET /api/dashboard/summary", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/dashboard/summary");
    expect(res.status).toBe(401);
  });

  it("composes cash (bank+cash split), stockValue, and lowStock from real writes", async () => {
    const { cookie, csrf } = await login();
    const headers = { "content-type": "application/json", cookie, "X-CSRF-Token": csrf };

    // Bank +5000 via a purchase (also creates stock value + qty on hand).
    const itemRes = await SELF.fetch("https://example.com/api/items", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Dashboard summary low-stock item",
        kind: "RAW_MATERIAL",
        category: "INGREDIENT",
        unit: "KG",
        minStockQty: 10000,
      }),
    });
    expect(itemRes.status).toBe(201);
    const item = (await itemRes.json()) as { id: string };

    const purchaseRes = await SELF.fetch("https://example.com/api/purchases", {
      method: "POST",
      headers,
      body: JSON.stringify({
        accountId: "acc_bank",
        occurredAt: "2026-07-16T10:00:00.000Z",
        businessDate: "2026-07-16",
        lines: [{ itemId: item.id, qty: 2000, lineTotal: 5000 }], // below minStockQty=10000
      }),
    });
    expect(purchaseRes.status).toBe(201);

    // Cash +1500 via a standalone income transaction.
    const incomeRes = await SELF.fetch("https://example.com/api/finance/transactions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        accountId: "acc_cash",
        type: "INCOME",
        category: "OTHER_INCOME",
        amount: 1500,
        businessDate: "2026-07-16",
        occurredAt: "2026-07-16T10:00:00.000Z",
      }),
    });
    expect(incomeRes.status).toBe(201);

    const summaryRes = await SELF.fetch("https://example.com/api/dashboard/summary", {
      headers: { cookie },
    });
    expect(summaryRes.status).toBe(200);
    const summary = (await summaryRes.json()) as DashboardSummaryDto;

    // The purchase paid from acc_bank moves acc_bank's balance DOWN by the purchase total, so bank
    // ends at -5000; cash ends at +1500 from the income transaction.
    expect(summary.cash).toEqual({ bank: -5000, cash: 1500, total: -3500 });
    expect(summary.stockValue).toBeGreaterThanOrEqual(5000);
    expect(summary.lowStock.some((row) => row.itemId === item.id)).toBe(true);
    const lowRow = summary.lowStock.find((row) => row.itemId === item.id);
    expect(lowRow?.isLowStock).toBe(true);
  });
});
