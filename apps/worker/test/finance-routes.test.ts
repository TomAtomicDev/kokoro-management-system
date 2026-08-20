// Route-level coverage for KOK-146. Service tests own balance/pair invariants; this file proves
// the authenticated PATCH/DELETE/restore wiring and its empty-body handling.
import { env, SELF } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../src/db/index.js";
import { auditLog, financialAccounts, financialTransactions } from "../src/db/schema.js";

const DEV_PASSWORD = "test-password-123";
const OCCURRED_AT = "2026-07-16T10:00:00.000Z";
const BUSINESS_DATE = "2026-07-16";

function getCookieValue(setCookieHeader: string | null, name: string): string | undefined {
  if (!setCookieHeader) return undefined;
  return new RegExp(`${name}=([^;,]+)`).exec(setCookieHeader)?.[1];
}

async function login(): Promise<{ cookie: string; csrf: string }> {
  const response = await SELF.fetch("https://example.com/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: DEV_PASSWORD }),
  });
  const setCookie = response.headers.get("set-cookie");
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
  await db.delete(auditLog).where(eq(auditLog.entityType, "financial_transactions"));
  await db.update(financialTransactions).set({ counterpartTxId: null });
  await db.delete(financialTransactions);
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("KOK-146 finance transaction routes", () => {
  it("updates, soft-deletes, and restores a manual transaction", async () => {
    const auth = await login();
    const headers = authHeaders(auth);
    const createdResponse = await SELF.fetch("https://example.com/api/finance/transactions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        accountId: "acc_bank",
        type: "INCOME",
        category: "OTHER_INCOME",
        amount: 2500,
        businessDate: BUSINESS_DATE,
        occurredAt: OCCURRED_AT,
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { transaction: { id: string } };

    const updateResponse = await SELF.fetch(
      `https://example.com/api/finance/transactions/${created.transaction.id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          accountId: "acc_cash",
          type: "EXPENSE",
          category: "OPERATING_EXPENSE",
          amount: 800,
          businessDate: BUSINESS_DATE,
          occurredAt: OCCURRED_AT,
          description: "Editado",
        }),
      },
    );
    expect(updateResponse.status).toBe(200);
    expect(
      ((await updateResponse.json()) as { transactions: [{ amount: number }] }).transactions[0]
        ?.amount,
    ).toBe(800);

    const deleteResponse = await SELF.fetch(
      `https://example.com/api/finance/transactions/${created.transaction.id}`,
      { method: "DELETE", headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf } },
    );
    expect(deleteResponse.status).toBe(200);

    const restoreResponse = await SELF.fetch(
      `https://example.com/api/finance/transactions/${created.transaction.id}/restore`,
      { method: "POST", headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf } },
    );
    expect(restoreResponse.status).toBe(200);

    const listResponse = await SELF.fetch("https://example.com/api/finance/transactions", {
      headers: { cookie: auth.cookie },
    });
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as {
      transactions: { id: string; amount: number }[];
    };
    expect(listed.transactions).toEqual([
      { ...listed.transactions[0], id: created.transaction.id, amount: 800 },
    ]);
  });

  it("requires authentication for transaction mutation routes", async () => {
    const response = await SELF.fetch("https://example.com/api/finance/transactions/unknown", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(401);
  });
});
