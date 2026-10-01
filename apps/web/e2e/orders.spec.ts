// KOK-205 order agreement editing and cash-free lifecycle coverage against the real Worker API.

import { type OrderDto, toBusinessDate } from "@kokoro/shared";
import { expect, type Page, test } from "@playwright/test";

import { catalogLabels } from "../src/lib/i18n-catalog";
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
    depositRequired: null,
    depositPaid: 0,
    depositTxId: null,
    deliveryDate: null,
    deliveryPlace: null,
    saleId: null,
    salePaymentStatus: null,
    outstandingAmount: null,
    cancelResolution: null,
    code: null,
    notes: null,
    lines: [],
    balanceDue: null,
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

test("the order drawer follows its URL through direct links and browser navigation", async ({
  page,
}) => {
  const customer = await createCustomer(page, uniqueName("Cliente enlace pedido e2e"));
  const description = uniqueName("Pedido enlace URL e2e");
  const { order } = await postJson<{ order: { id: string } }>(page, "/api/orders", {
    customerId: customer.id,
    description,
  });
  const search = new URLSearchParams({
    ordersView: "active",
    historyFilter: "paid",
    fromDate: "2026-09-01",
    toDate: "2026-09-30",
    open: order.id,
  });

  await page.goto(`/orders?${search.toString()}`, { timeout: 15_000 });
  const orderDrawer = page.getByRole("dialog", { name: ordersLabels.detailTitle });
  await expect(orderDrawer).toBeVisible();
  await expect(orderDrawer).toContainText(description);
  await expect(page).toHaveURL(/ordersView=active/);
  await expect(page).toHaveURL(/historyFilter=paid/);
  await expect(page).toHaveURL(/fromDate=2026-09-01/);
  await expect(page).toHaveURL(/toDate=2026-09-30/);

  await page.reload({ timeout: 15_000 });
  await expect(page.getByRole("dialog", { name: ordersLabels.detailTitle })).toBeVisible();
  await orderDrawer.getByRole("button", { name: catalogLabels.close, exact: true }).click();
  await expect(page.getByRole("dialog", { name: ordersLabels.detailTitle })).toHaveCount(0);
  await expect(page).not.toHaveURL(/(?:\?|&)open=/);
  await page.goBack({ timeout: 15_000 });
  await expect(page).not.toHaveURL(/(?:\?|&)open=/);
  await page.goForward({ timeout: 15_000 });
  await expect(page).toHaveURL(new RegExp(`open=${order.id}`));
  await expect(page.getByRole("dialog", { name: ordersLabels.detailTitle })).toBeVisible();
});

test("edit order agreement, preview excess, and run cash-free delivery/undo", async ({ page }) => {
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
  const orderDrawer = page.getByRole("dialog", { name: ordersLabels.detailTitle });
  await expect(orderDrawer).toBeVisible();
  await orderDrawer.getByRole("button", { name: ordersLabels.actionEdit, exact: true }).click();
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
  const freshDrawer = page.getByRole("dialog", { name: ordersLabels.detailTitle });
  await freshDrawer.getByRole("button", { name: ordersLabels.actionConfirm, exact: true }).click();
  const confirmationDialog = page.getByRole("dialog", { name: ordersLabels.confirmDialogTitle });
  await expect(confirmationDialog.getByText("Bs 110,00", { exact: true })).toBeVisible();
  await confirmationDialog
    .getByRole("button", { name: ordersLabels.confirmSubmit, exact: true })
    .click();
  await expect(
    freshDrawer.getByText(ordersLabels.statusLabels.CONFIRMED, { exact: true }),
  ).toBeVisible();
  await freshDrawer
    .getByRole("button", { name: ordersLabels.actionStartProduction, exact: true })
    .click();
  await expect(
    freshDrawer.getByText(ordersLabels.statusLabels.IN_PRODUCTION, { exact: true }),
  ).toBeVisible();
  await freshDrawer
    .getByRole("button", { name: ordersLabels.actionMarkReady, exact: true })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(
    freshDrawer.getByText(ordersLabels.statusLabels.READY, { exact: true }),
  ).toBeVisible();

  await freshDrawer.getByRole("button", { name: ordersLabels.actionDeliver, exact: true }).click();
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
    freshDrawer.getByText(ordersLabels.statusLabels.DELIVERED, { exact: true }),
  ).toBeVisible();

  await freshDrawer
    .getByRole("button", { name: ordersLabels.actionUndoDeliver, exact: true })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(
    freshDrawer.getByText(ordersLabels.statusLabels.READY, { exact: true }),
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
  await freshDrawer.getByRole("button", { name: ordersLabels.actionDeliver, exact: true }).click();
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
