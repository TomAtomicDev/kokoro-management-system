// KOK-205/KOK-208 order agreement, canonical detail, and cash-free lifecycle coverage against the real Worker API.

import { type OrderDto, toBusinessDate } from "@kokoro/shared";
import { expect, type Page, test } from "@playwright/test";

import { ordersLabels } from "../src/lib/i18n-orders";
import { authenticatedHeaders, postJson, selectFromPicker, uniqueName } from "./helpers";

interface CreatedCustomer {
  id: string;
}

interface CreatedItem {
  id: string;
}

interface AccountBalanceResponse {
  accounts: Array<{ id: string; balance: number }>;
}

interface TransactionsResponse {
  transactions: Array<{
    id: string;
    category: string;
    amount: number;
    deletedAt: string | null;
    relatedOrder?: { id: string; code: string | null };
  }>;
}

function futureDeliveryDate(daysAhead: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

function mockedActiveOrder(index: number): OrderDto {
  const timestamp = "2026-09-30T12:00:00.000Z";
  return {
    id: `mock-order-${index}`,
    status: "QUOTING",
    customerId: "mock-customer",
    customerName: "Cliente de prueba",
    description: `Pedido paginado ${index}`,
    agreedTotal: 10_000,
    additionalCharge: 0,
    balance: {
      customerAmount: 10_000,
      qualifyingReceipts: 0,
      expectedBalance: 10_000,
      receivableBalance: null,
      excess: 0,
    },
    deliveryDate: null,
    deliveryPlace: null,
    saleId: null,
    code: null,
    notes: null,
    lines: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function createCustomer(page: Page, name: string): Promise<CreatedCustomer> {
  return postJson<CreatedCustomer>(page, "/api/customers", { name });
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

async function accountBalances(page: Page): Promise<Array<{ id: string; balance: number }>> {
  const response = await page.request.get("/api/finance/accounts", {
    headers: await authenticatedHeaders(page),
    timeout: 10_000,
  });
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as AccountBalanceResponse;
  return payload.accounts
    .map(({ id, balance }) => ({ id, balance }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function orderReceiptRows(page: Page, orderId: string) {
  const response = await page.request.get("/api/finance/transactions?category=ORDER_DEPOSIT", {
    headers: await authenticatedHeaders(page),
    timeout: 10_000,
  });
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as TransactionsResponse;
  return payload.transactions.filter((row) => row.relatedOrder?.id === orderId);
}

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(15_000);
  const password = process.env.E2E_LOGIN_PASSWORD;
  test.skip(!password, "E2E_LOGIN_PASSWORD not set — skipping order flow checks");
  const response = await page.request.post("/api/auth/login", {
    data: { password },
    timeout: 10_000,
  });
  expect(response.ok()).toBe(true);
});

test("quoting an order accepts a future promised delivery date", async ({ page }) => {
  const customerName = uniqueName("Cliente futuro e2e");
  const description = uniqueName("Pedido fecha futura e2e");
  const deliveryDate = futureDeliveryDate(60);
  await createCustomer(page, customerName);

  await page.goto("/orders");
  await page.getByRole("link", { name: ordersLabels.actionQuote, exact: true }).click();
  await selectFromPicker(page, "Buscar cliente…", customerName);
  await page.getByLabel(ordersLabels.fieldDescription, { exact: true }).fill(description);
  await page.getByLabel(ordersLabels.fieldDeliveryDate).fill(deliveryDate);
  await page.getByRole("button", { name: ordersLabels.submit, exact: true }).click();

  const card = page.getByRole("button", { name: new RegExp(description) });
  await expect(card).toBeVisible();
  await expect(card.getByText(deliveryDate, { exact: true })).toBeVisible();
});

test("the active board loads every bounded page beyond 500 orders", async ({ page }) => {
  test.setTimeout(90_000);
  const requestedCursors: (string | null)[] = [];
  await page.route("**/api/orders**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }

    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    requestedCursors.push(cursor);
    const pageResult =
      cursor === null
        ? {
            orders: Array.from({ length: 500 }, (_, index) => mockedActiveOrder(index + 1)),
            nextCursor: {
              deliveryDate: null,
              createdAt: "2026-09-30T12:00:00.000Z",
              id: "mock-order-500",
            },
          }
        : { orders: [mockedActiveOrder(501)], nextCursor: null };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pageResult),
    });
  });

  await page.goto("/orders", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Pedido paginado 501/ })).toBeVisible();
  expect(await page.getByRole("button", { name: /Pedido paginado/ }).count()).toBe(501);
  expect(requestedCursors).toHaveLength(2);
  expect(requestedCursors[0]).toBeNull();
  expect(requestedCursors[1]).not.toBeNull();
});

test("legacy order links resolve to the canonical page and preserve browser navigation", async ({
  page,
}) => {
  const customer = await createCustomer(page, uniqueName("Cliente enlace pedido e2e"));
  const description = uniqueName("Pedido enlace URL e2e");
  const { order } = await postJson<{ order: { id: string; code: string } }>(page, "/api/orders", {
    customerId: customer.id,
    description,
  });

  const boardSearch = new URLSearchParams({
    ordersView: "history",
    historyFilter: "paid",
    fromDate: "2026-09-01",
    toDate: "2026-09-30",
  });
  const legacySearch = new URLSearchParams({
    ...Object.fromEntries(boardSearch.entries()),
    open: order.id,
  });

  await page.goto(`/orders?${boardSearch.toString()}`, { timeout: 15_000 });
  await page.goto(`/orders?${legacySearch.toString()}`, { timeout: 15_000 });
  const orderDetail = page.getByRole("main");
  await expect(orderDetail.getByRole("heading", { name: order.code, exact: true })).toBeVisible();
  await expect(
    orderDetail.getByRole("heading", { name: ordersLabels.detailTitle, exact: true }),
  ).toBeVisible();
  await expect(orderDetail).toContainText(description);
  await expect(page).toHaveURL(new RegExp(`/orders/${order.id}(?:\\?|$)`));
  await expect(page).not.toHaveURL(/(?:\?|&)open=/);
  await expect(page).toHaveURL(/ordersView=history/);
  await expect(page).toHaveURL(/historyFilter=paid/);
  await expect(page).toHaveURL(/fromDate=2026-09-01/);
  await expect(page).toHaveURL(/toDate=2026-09-30/);

  await page.reload({ timeout: 15_000 });
  await expect(
    page.getByRole("main").getByRole("heading", { name: order.code, exact: true }),
  ).toBeVisible();
  await page.goBack({ timeout: 15_000 });
  await expect(page).toHaveURL(/ordersView=history/);
  await expect(page).toHaveURL(/historyFilter=paid/);
  await expect(page).toHaveURL(/fromDate=2026-09-01/);
  await expect(page).toHaveURL(/toDate=2026-09-30/);
  await expect(page).not.toHaveURL(/(?:\?|&)open=/);
  await page.goForward({ timeout: 15_000 });
  await expect(page).toHaveURL(new RegExp(`/orders/${order.id}(?:\\?|$)`));
  await expect(
    page.getByRole("main").getByRole("heading", { name: order.code, exact: true }),
  ).toBeVisible();
});

test("edit order agreement, preview excess, and run cash-free delivery/undo on the detail page", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const customerName = uniqueName("Cliente ciclo efectivo e2e");
  const description = uniqueName("Pedido efectivo e2e");
  const itemName = uniqueName("Producto pedido e2e");
  await createCustomer(page, customerName);
  await createFinishedItem(page, itemName);

  await page.goto("/orders");
  await page.getByRole("link", { name: ordersLabels.actionQuote, exact: true }).click();
  await selectFromPicker(page, "Buscar cliente…", customerName);
  await page.getByLabel(ordersLabels.fieldDescription, { exact: true }).fill(description);
  await page.getByLabel(ordersLabels.fieldAgreedTotal, { exact: true }).fill("100");
  await page.getByLabel(ordersLabels.fieldAdditionalCharge, { exact: true }).fill("10");
  await selectFromPicker(page, ordersLabels.lineItem, itemName);
  const quoteResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/orders") && response.request().method() === "POST",
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: ordersLabels.submit, exact: true }).click();
  const quoteResponse = await quoteResponsePromise;
  expect(quoteResponse.ok()).toBe(true);
  const quote = (await quoteResponse.json()) as { order: { id: string; code: string } };

  const receiptDate = new Date(Date.now() - 60_000);
  const receipt = await postJson<{ transaction: { id: string; amount: number } }>(
    page,
    `/api/orders/${quote.order.id}/transactions`,
    {
      accountId: "acc_cash",
      type: "INCOME",
      category: "ORDER_DEPOSIT",
      amount: 13_000,
      occurredAt: receiptDate.toISOString(),
      businessDate: toBusinessDate(receiptDate),
    },
  );
  expect(receipt.transaction.amount).toBe(13_000);

  await page.getByRole("button", { name: new RegExp(description) }).click();
  const orderDetail = page.getByRole("main");
  await expect(
    orderDetail.getByRole("heading", { name: quote.order.code, exact: true }),
  ).toBeVisible();
  await orderDetail
    .getByRole("link", { name: ordersLabels.actionEditAgreement, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/orders/${quote.order.id}/edit`));
  await expect(page.getByText(ordersLabels.qualifyingReceipts)).toBeVisible();
  await expect(page.getByText("Bs 130,00", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Buscar cliente…")).toBeDisabled();

  await page.getByLabel(ordersLabels.fieldAgreedTotal, { exact: true }).fill("90");
  await page.getByLabel(ordersLabels.fieldAdditionalCharge, { exact: true }).fill("20");
  await expect(page.getByText(ordersLabels.draftExcess)).toBeVisible();
  await expect(
    page.getByText(ordersLabels.draftExcess).locator("..").getByText("Bs 20,00", { exact: true }),
  ).toBeVisible();

  const balancesBeforeTransitions = await accountBalances(page);
  const receiptRowsBeforeTransitions = await orderReceiptRows(page, quote.order.id);
  const updateResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/orders/${quote.order.id}`) &&
      response.request().method() === "PATCH",
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: ordersLabels.save, exact: true }).click();
  const updateResponse = await updateResponsePromise;
  expect(updateResponse.ok()).toBe(true);
  const updated = (await updateResponse.json()) as {
    order: { agreedTotal: number; additionalCharge: number };
  };
  expect(updated.order).toMatchObject({ agreedTotal: 9_000, additionalCharge: 2_000 });
  await expect(page.getByText("Bs 20,00", { exact: true })).toBeVisible();
  await expect(page.getByText("Bs 130,00", { exact: true })).toBeVisible();

  await page.goto("/orders");
  await page.getByRole("button", { name: new RegExp(description) }).click();
  const orderDetailPage = page.getByRole("main");
  await expect(
    orderDetailPage.getByRole("heading", { name: quote.order.code, exact: true }),
  ).toBeVisible();
  await orderDetailPage
    .getByRole("button", { name: ordersLabels.actionConfirm, exact: true })
    .click();
  const confirmationDialog = page.getByRole("dialog", { name: ordersLabels.confirmDialogTitle });
  await expect(confirmationDialog.getByText("Bs 110,00", { exact: true })).toBeVisible();
  await confirmationDialog
    .getByRole("button", { name: ordersLabels.confirmSubmit, exact: true })
    .click();
  await expect(
    orderDetailPage.getByText(ordersLabels.statusLabels.CONFIRMED, { exact: true }),
  ).toBeVisible();
  await orderDetailPage
    .getByRole("button", { name: ordersLabels.actionStartProduction, exact: true })
    .click();
  await expect(
    orderDetailPage.getByText(ordersLabels.statusLabels.IN_PRODUCTION, { exact: true }),
  ).toBeVisible();
  await orderDetailPage
    .getByRole("button", { name: ordersLabels.actionMarkReady, exact: true })
    .click();
  await page
    .getByRole("dialog", { name: ordersLabels.actionMarkReady })
    .getByRole("button", { name: "Confirmar", exact: true })
    .click();
  await expect(
    orderDetailPage.getByText(ordersLabels.statusLabels.READY, { exact: true }),
  ).toBeVisible();

  await orderDetailPage
    .getByRole("button", { name: ordersLabels.actionDeliver, exact: true })
    .click();
  await expect(page.getByLabel(ordersLabels.deliverFieldDate, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: ordersLabels.deliverDialogTitle }).getByRole("combobox"),
  ).toHaveCount(0);
  const deliveryResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/orders/${quote.order.id}/deliver`) &&
      response.request().method() === "POST",
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: ordersLabels.deliverSubmit, exact: true }).click();
  const deliveryResponse = await deliveryResponsePromise;
  const delivered = (await deliveryResponse.json()) as {
    order: { status: string };
    sale: { id: string; total: number; additionalCharge: number; paymentStatus: string };
  };
  expect(deliveryResponse.ok()).toBe(true);
  expect(delivered).toMatchObject({
    order: { status: "DELIVERED" },
    sale: { total: 11_000, additionalCharge: 2_000, paymentStatus: "ON_CREDIT" },
  });
  await expect(
    orderDetailPage.getByText(ordersLabels.statusLabels.DELIVERED, { exact: true }),
  ).toBeVisible();

  await orderDetailPage
    .getByRole("button", { name: ordersLabels.actionUndoDeliver, exact: true })
    .click();
  await page
    .getByRole("dialog", { name: ordersLabels.actionUndoDeliver })
    .getByRole("button", { name: "Confirmar", exact: true })
    .click();
  await expect(
    orderDetailPage.getByText(ordersLabels.statusLabels.READY, { exact: true }),
  ).toBeVisible();
  expect(await accountBalances(page)).toEqual(balancesBeforeTransitions);
  expect(await orderReceiptRows(page, quote.order.id)).toEqual(receiptRowsBeforeTransitions);
  const summaryResponse = await page.request.get(`/api/orders/${quote.order.id}/receipt-summary`, {
    headers: await authenticatedHeaders(page),
    timeout: 10_000,
  });
  expect(summaryResponse.ok()).toBe(true);
  expect(await summaryResponse.json()).toMatchObject({
    qualifyingReceipts: 13_000,
    hasEverQualifyingReceipt: true,
  });

  const redeliveryResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/orders/${quote.order.id}/deliver`) &&
      response.request().method() === "POST",
    { timeout: 10_000 },
  );
  await orderDetailPage
    .getByRole("button", { name: ordersLabels.actionDeliver, exact: true })
    .click();
  await page.getByRole("button", { name: ordersLabels.deliverSubmit, exact: true }).click();
  const redeliveryResponse = await redeliveryResponsePromise;
  const redelivered = (await redeliveryResponse.json()) as {
    order: { status: string };
    sale: { id: string; total: number; additionalCharge: number; paymentStatus: string };
  };
  expect(redeliveryResponse.ok()).toBe(true);
  expect(redelivered).toMatchObject({
    order: { status: "DELIVERED" },
    sale: { total: 11_000, additionalCharge: 2_000, paymentStatus: "ON_CREDIT" },
  });
  expect(redelivered.sale.id).not.toBe(delivered.sale.id);
  expect(await accountBalances(page)).toEqual(balancesBeforeTransitions);
  expect(await orderReceiptRows(page, quote.order.id)).toEqual(receiptRowsBeforeTransitions);
});
