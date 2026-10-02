// SC-21's split catalog/order collection behavior against the real Worker API.

import { toBusinessDate } from "@kokoro/shared";
import { expect, type Page, test } from "@playwright/test";

import { receivablesLabels } from "../src/lib/i18n-receivables";
import { salesLabels } from "../src/lib/i18n-sales";
import { authenticatedHeaders, postJson, uniqueName } from "./helpers";

interface CreatedCustomer {
  id: string;
}

interface CreatedItem {
  id: string;
}

async function createFinishedItem(page: Page, name: string): Promise<CreatedItem> {
  return postJson<CreatedItem>(page, "/api/items", {
    name,
    kind: "FINISHED",
    category: "OTHER",
    unit: "UNIT",
    salePriceMc: 10_000_000,
    minStockQty: null,
  });
}

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(15_000);
  const password = process.env.E2E_LOGIN_PASSWORD;
  test.skip(!password, "E2E_LOGIN_PASSWORD not set — skipping receivables checks");
  const response = await page.request.post("/api/auth/login", {
    data: { password },
    timeout: 10_000,
  });
  expect(response.ok()).toBe(true);
});

test("SC-21 sends only catalog sales to full-balance collectPayment", async ({ page }) => {
  const customerName = uniqueName("Cliente deudas agrupadas e2e");
  const customer = await postJson<CreatedCustomer>(page, "/api/customers", { name: customerName });
  const item = await createFinishedItem(page, uniqueName("Producto deudas e2e"));
  const occurredAt = new Date(Date.now() - 60_000).toISOString();
  const businessDate = toBusinessDate(occurredAt);

  const catalogSale = await postJson<{ sale: { id: string; code: string; total: number } }>(
    page,
    "/api/sales",
    {
      paymentStatus: "ON_CREDIT",
      customerId: customer.id,
      occurredAt,
      businessDate,
      lines: [{ itemId: item.id, qty: 1_000, unitPriceMc: 10_000_000 }],
    },
  );
  const { order } = await postJson<{
    order: { id: string; code: string };
  }>(page, "/api/orders", {
    customerId: customer.id,
    description: uniqueName("Pedido con recibos e2e"),
    agreedTotal: 30_000,
    additionalCharge: 500,
    lines: [{ itemId: item.id, qty: 1_000 }],
  });

  await postJson(page, `/api/orders/${order.id}/transactions`, {
    accountId: "acc_cash",
    type: "INCOME",
    category: "ORDER_DEPOSIT",
    amount: 10_000,
    occurredAt,
    businessDate,
  });
  await postJson(page, `/api/orders/${order.id}/confirm`, {});
  await postJson(page, `/api/orders/${order.id}/start-production`, {});
  await postJson(page, `/api/orders/${order.id}/ready`, {});
  await postJson(page, `/api/orders/${order.id}/deliver`, { occurredAt, businessDate });
  await postJson(page, `/api/orders/${order.id}/transactions`, {
    accountId: "acc_cash",
    type: "INCOME",
    category: "ORDER_BALANCE",
    amount: 5_000,
    occurredAt,
    businessDate,
  });

  await page.goto("/receivables");
  await page.getByLabel(receivablesLabels.searchLabel).fill(customerName);
  const customerGroup = page.getByRole("button", { name: new RegExp(customerName) });
  await expect(customerGroup).toBeVisible();
  await customerGroup.click();

  await expect(page.getByRole("link", { name: order.code, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: catalogSale.sale.code, exact: true })).toBeVisible();
  const orderRow = page.locator("article").filter({ hasText: order.code });
  await expect(orderRow).toContainText("Bs 155,00");
  await expect(
    orderRow.getByRole("button", { name: receivablesLabels.collectBalance }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: receivablesLabels.collectBalance })).toHaveCount(1);

  await page.getByRole("button", { name: receivablesLabels.collectBalance }).click();
  const collectDialog = page.getByRole("dialog", { name: salesLabels.collectTitle });
  await expect(collectDialog).toBeVisible();
  await expect(collectDialog.getByText("Bs 100,00", { exact: true })).toBeVisible();
  await collectDialog.getByRole("button", { name: salesLabels.collectSubmit, exact: true }).click();
  await expect(collectDialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: receivablesLabels.collectBalance })).toHaveCount(0);
  await expect(page.getByRole("link", { name: order.code, exact: true })).toBeVisible();

  const orderResponse = await page.request.get(`/api/orders/${order.id}`, {
    headers: await authenticatedHeaders(page),
    timeout: 10_000,
  });
  expect(orderResponse.ok()).toBe(true);
  const currentOrder = (await orderResponse.json()) as {
    balance: {
      customerAmount: number;
      qualifyingReceipts: number;
      expectedBalance: number | null;
      receivableBalance: number | null;
      excess: number | null;
    };
  };
  expect(currentOrder.balance).toEqual({
    customerAmount: 30_500,
    qualifyingReceipts: 15_000,
    expectedBalance: null,
    receivableBalance: 15_500,
    excess: 0,
  });
});
