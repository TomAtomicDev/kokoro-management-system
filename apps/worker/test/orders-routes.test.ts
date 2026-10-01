// Authenticated route coverage for KOK-205's edit command and per-order receipt summary.
import { env, SELF } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createCustomer } from "../src/core/customers/index.js";
import { recordTransaction } from "../src/core/finance/index.js";
import { quoteOrder } from "../src/core/orders/index.js";
import { createDb } from "../src/db/index.js";
import {
  auditLog,
  customOrderLines,
  customOrders,
  financialAccounts,
  financialTransactions,
  saleLines,
  sales,
  stockMovements,
} from "../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;
const DEV_PASSWORD = "test-password-123";
const OCCURRED_AT = "2026-07-20T14:00:00.000Z";
const BUSINESS_DATE = "2026-07-20";

function cookieValue(header: string | null, name: string): string | undefined {
  return header ? new RegExp(`${name}=([^;,]+)`).exec(header)?.[1] : undefined;
}

async function login(): Promise<{ cookie: string; csrf: string }> {
  const response = await SELF.fetch("https://example.com/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: DEV_PASSWORD }),
  });
  const setCookie = response.headers.get("set-cookie");
  const session = cookieValue(setCookie, "kokoro_session");
  const csrf = cookieValue(setCookie, "kokoro_csrf");
  if (!session || !csrf) throw new Error("login did not return session/csrf cookies");
  return { cookie: `kokoro_session=${session}; kokoro_csrf=${csrf}`, csrf };
}

function headers(auth: { cookie: string; csrf: string }) {
  return { "content-type": "application/json", cookie: auth.cookie, "X-CSRF-Token": auth.csrf };
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.update(customOrders).set({ saleId: null, depositTxId: null });
  await db.update(financialTransactions).set({ counterpartTxId: null });
  await db.delete(auditLog).where(eq(auditLog.entityType, "custom_orders"));
  await db.delete(stockMovements).where(eq(stockMovements.sourceEventType, "sale"));
  await db.delete(saleLines);
  await db.delete(sales);
  await db.delete(financialTransactions);
  await db.delete(customOrderLines);
  await db.delete(customOrders);
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("KOK-205 order routes", () => {
  it("exposes qualifying receipts and applies the shared optimistic update contract", async () => {
    const auth = await login();
    const db = createDb(env.DB);
    const customer = await createCustomer(
      db,
      { name: `Order route ${crypto.randomUUID()}` },
      ACTOR,
    );
    const { order } = await quoteOrder(
      db,
      {
        customerId: customer.id,
        description: "Pedido para editar por ruta",
        agreedTotal: 10_000,
        additionalCharge: 500,
      },
      ACTOR,
    );
    await recordTransaction(
      db,
      {
        accountId: "acc_cash",
        type: "INCOME",
        category: "ORDER_DEPOSIT",
        amount: 12_000,
        customOrderId: order.id,
        occurredAt: OCCURRED_AT,
        businessDate: BUSINESS_DATE,
      },
      ACTOR,
    );

    const summaryResponse = await SELF.fetch(
      `https://example.com/api/orders/${order.id}/receipt-summary`,
      { headers: { cookie: auth.cookie } },
    );
    expect(summaryResponse.status).toBe(200);
    expect(await summaryResponse.json()).toEqual({
      qualifyingReceipts: 12_000,
      hasEverQualifyingReceipt: true,
    });

    const command = {
      expectedUpdatedAt: order.updatedAt,
      customerId: order.customerId,
      description: "Subtotal reducido tras recibo",
      agreedTotal: 8_000,
      additionalCharge: 1_000,
      deliveryDate: null,
      deliveryPlace: null,
      notes: null,
      lines: [],
    };
    const updateResponse = await SELF.fetch(`https://example.com/api/orders/${order.id}`, {
      method: "PATCH",
      headers: headers(auth),
      body: JSON.stringify(command),
    });
    expect(updateResponse.status).toBe(200);
    expect(
      (await updateResponse.json()) as { order: { agreedTotal: number; additionalCharge: number } },
    ).toMatchObject({
      order: { agreedTotal: 8_000, additionalCharge: 1_000 },
    });

    const staleResponse = await SELF.fetch(`https://example.com/api/orders/${order.id}`, {
      method: "PATCH",
      headers: headers(auth),
      body: JSON.stringify(command),
    });
    expect(staleResponse.status).toBe(409);
  });

  it("does not expose an edit route without authentication and rejects legacy confirm payment input", async () => {
    const db = createDb(env.DB);
    const customer = await createCustomer(
      db,
      { name: `Order unauth ${crypto.randomUUID()}` },
      ACTOR,
    );
    const { order } = await quoteOrder(
      db,
      { customerId: customer.id, description: "Pedido de auth" },
      ACTOR,
    );

    const unauthenticated = await SELF.fetch(`https://example.com/api/orders/${order.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(unauthenticated.status).toBe(401);

    const auth = await login();
    const legacyConfirm = await SELF.fetch(`https://example.com/api/orders/${order.id}/confirm`, {
      method: "POST",
      headers: headers(auth),
      body: JSON.stringify({ depositAmount: 1_000, accountId: "acc_cash" }),
    });
    expect(legacyConfirm.status).toBe(400);
  });
});
