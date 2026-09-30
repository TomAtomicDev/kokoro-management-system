// KOK-165: order regressions (F-46, F-47) plus the confirm → deliver → undo lifecycle (KOK-170's
// ConfirmDialog replaced this drawer's window.confirm popups on this same branch, so the undo step
// drives that dialog's Confirm button, not a native `page.on('dialog')` handler).

import { toBusinessDate } from "@kokoro/shared";
import { expect, type Page, test } from "@playwright/test";

import { ordersLabels } from "../src/lib/i18n-orders";
import { authenticatedHeaders, postJson, selectFromPicker, uniqueName } from "./helpers";

interface CreatedCustomer {
  id: string;
}
interface CreatedItem {
  id: string;
}

interface DeliverOrderResponse {
  order: {
    status: string;
    salePaymentStatus: string | null;
    outstandingAmount: number | null;
    balanceDue: number | null;
  };
  sale: { id: string; paymentStatus: string; total: number };
}

interface ReceivablesResponse {
  groups: Array<{
    sales: Array<{
      saleId: string;
      customOrderId: string | null;
      outstandingAmount: number;
    }>;
  }>;
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

function futureDeliveryDate(daysAhead: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
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

// F-46 regression: a delivery date weeks in the future must be accepted (KOK-177) — the no-future-
// dates rule covers transaction dates only, never a promised delivery date.
test("quoting an order accepts a future delivery date", async ({ page }) => {
  const customerName = uniqueName("Cliente futuro e2e");
  const description = uniqueName("Pedido fecha futura e2e");
  const deliveryDate = futureDeliveryDate(60);
  await createCustomer(page, customerName);

  await page.goto("/orders");
  // KOK-141: "Nuevo pedido" now links to the full-page /orders/new form, not a drawer trigger.
  await page.getByRole("link", { name: ordersLabels.actionQuote, exact: true }).click();
  await selectFromPicker(page, "Buscar cliente…", customerName);
  await page.getByLabel(ordersLabels.fieldDescription, { exact: true }).fill(description);
  await page.getByLabel(ordersLabels.fieldDeliveryDate).fill(deliveryDate);
  await page.getByRole("button", { name: ordersLabels.submit, exact: true }).click();

  // F-47 regression, same act: the freshly quoted order must appear on the board immediately, no
  // reload — this is the browser-visible symptom of listOrders's UTC/business-date boundary bug.
  // Scoped to this order's own card (the whole card is one <button>, description text included)
  // since a leftover order from an earlier local run can share the same computed delivery date.
  const card = page.getByRole("button", { name: new RegExp(description) });
  await expect(card).toBeVisible();
  await expect(card.getByText(deliveryDate, { exact: true })).toBeVisible();
});

test("an order's confirm, start production, mark ready, deliver and undo-deliver cycle", async ({
  page,
}) => {
  const customerName = uniqueName("Cliente ciclo e2e");
  const description = uniqueName("Pedido ciclo e2e");
  const itemName = uniqueName("Producto ciclo e2e");
  await createCustomer(page, customerName);
  await createFinishedItem(page, itemName);

  await page.goto("/orders");
  // KOK-141: "Nuevo pedido" now links to the full-page /orders/new form, not a drawer trigger.
  await page.getByRole("link", { name: ordersLabels.actionQuote, exact: true }).click();
  await selectFromPicker(page, "Buscar cliente…", customerName);
  await page.getByLabel(ordersLabels.fieldDescription, { exact: true }).fill(description);
  await page.getByLabel(ordersLabels.fieldAgreedTotal).fill("100");
  await selectFromPicker(page, ordersLabels.lineItem, itemName);
  await page.getByRole("button", { name: ordersLabels.submit, exact: true }).click();

  await page.getByText(description, { exact: true }).click();

  // Leave half of the agreed total to exercise the paid-balance delivery branch.
  await page.getByRole("button", { name: ordersLabels.actionConfirm, exact: true }).click();
  await page.getByLabel(ordersLabels.confirmFieldDepositAmount).fill("50");
  await page.getByRole("button", { name: ordersLabels.confirmSubmit, exact: true }).click();
  await expect(page.getByText(ordersLabels.statusLabels.CONFIRMED, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: ordersLabels.actionStartProduction, exact: true }).click();
  await expect(
    page.getByText(ordersLabels.statusLabels.IN_PRODUCTION, { exact: true }),
  ).toBeVisible();

  // No linked production run/assembly — the "mark ready" ConfirmDialog fires first.
  await page.getByRole("button", { name: ordersLabels.actionMarkReady, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.getByText(ordersLabels.statusLabels.READY, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: ordersLabels.actionDeliver, exact: true }).click();
  await expect(
    page.getByLabel(ordersLabels.deliverFieldPaymentAccount, { exact: true }),
  ).toBeVisible();
  const paidDeliveryResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/orders/") &&
      response.url().endsWith("/deliver") &&
      response.request().method() === "POST",
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: ordersLabels.deliverSubmit, exact: true }).click();
  const paidDeliveryResponse = await paidDeliveryResponsePromise;
  const paidDeliveryPayload: unknown = await paidDeliveryResponse.json();
  expect(paidDeliveryResponse.ok(), JSON.stringify(paidDeliveryPayload)).toBe(true);
  expect(paidDeliveryPayload).toMatchObject({
    order: {
      status: "DELIVERED",
      salePaymentStatus: "PAID",
      outstandingAmount: 0,
      balanceDue: null,
    },
    sale: { paymentStatus: "PAID", total: 10_000 },
  });
  await expect(page.getByText(ordersLabels.statusLabels.DELIVERED, { exact: true })).toBeVisible();
  const orderDrawer = page.getByRole("dialog", { name: ordersLabels.detailTitle });
  await expect(
    orderDrawer
      .getByText(ordersLabels.columnSalePaymentStatus, { exact: true })
      .locator("..")
      .getByText(ordersLabels.paymentStatusLabels.PAID, { exact: true }),
  ).toBeVisible();
  await expect(
    orderDrawer
      .getByText(ordersLabels.columnOutstandingAmount, { exact: true })
      .locator("..")
      .getByText("Bs 0,00", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: ordersLabels.actionUndoDeliver, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.getByText(ordersLabels.statusLabels.READY, { exact: true })).toBeVisible();
});

test("zero-deposit confirmation and credit delivery require separate risk acknowledgments", async ({
  page,
}) => {
  test.setTimeout(90_000);

  const customerName = uniqueName("Cliente riesgo e2e");
  const description = uniqueName("Pedido riesgo e2e");
  const itemName = uniqueName("Producto riesgo e2e");
  await createCustomer(page, customerName);
  await createFinishedItem(page, itemName);

  await page.goto("/orders", { timeout: 15_000 });
  await page.getByRole("link", { name: ordersLabels.actionQuote, exact: true }).click();
  await selectFromPicker(page, "Buscar cliente…", customerName);
  await page.getByLabel(ordersLabels.fieldDescription, { exact: true }).fill(description);
  await page.getByLabel(ordersLabels.fieldAgreedTotal).fill("100");
  await selectFromPicker(page, ordersLabels.lineItem, itemName);

  const quoteResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/orders") && response.request().method() === "POST",
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: ordersLabels.submit, exact: true }).click();
  const quoteResponse = await quoteResponsePromise;
  expect(quoteResponse.ok()).toBe(true);
  const quotePayload = (await quoteResponse.json()) as { order: { id: string } };

  await page.getByText(description, { exact: true }).click();
  const orderDrawer = page.getByRole("dialog", { name: "Pedido" });
  await page.getByRole("button", { name: ordersLabels.actionConfirm, exact: true }).click();
  await page.getByLabel(ordersLabels.confirmFieldDepositAmount, { exact: true }).fill("0");
  await expect(page.getByText(ordersLabels.confirmNoDepositRiskDescription)).toBeVisible();
  await page
    .getByRole("button", { name: ordersLabels.confirmSubmitNoDeposit, exact: true })
    .click();
  await expect(
    page.getByText("Confirma que aceptas el riesgo de iniciar el pedido sin recibir un anticipo."),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: ordersLabels.confirmNoDepositRiskAcknowledgment })
    .check();
  await page
    .getByRole("button", { name: ordersLabels.confirmSubmitNoDeposit, exact: true })
    .click();
  await expect(page.getByText(ordersLabels.statusLabels.CONFIRMED, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: ordersLabels.actionStartProduction, exact: true }).click();
  await expect(
    page.getByText(ordersLabels.statusLabels.IN_PRODUCTION, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: ordersLabels.actionMarkReady, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.getByText(ordersLabels.statusLabels.READY, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: ordersLabels.actionDeliver, exact: true }).click();
  await page
    .getByRole("button", { name: ordersLabels.deliverBalanceOnCredit, exact: true })
    .click();
  const creditRiskSection = page
    .locator("section")
    .filter({ hasText: ordersLabels.deliverCreditRiskDescription });
  await expect(creditRiskSection).toBeVisible();
  await expect(creditRiskSection.getByText("Bs 100,00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: ordersLabels.deliverSubmit, exact: true }).click();
  await expect(
    page.getByText("Confirma que aceptas el riesgo de entregar el pedido con el saldo por cobrar."),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: ordersLabels.deliverCreditRiskAcknowledgment }).check();
  const deliveryResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/orders/${quotePayload.order.id}/deliver`) &&
      response.request().method() === "POST",
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: ordersLabels.deliverSubmit, exact: true }).click();
  const deliveryResponse = await deliveryResponsePromise;
  const deliveryPayload = (await deliveryResponse.json()) as DeliverOrderResponse;
  expect(deliveryResponse.ok(), JSON.stringify(deliveryPayload)).toBe(true);
  expect(deliveryPayload).toMatchObject({
    order: {
      status: "DELIVERED",
      salePaymentStatus: "ON_CREDIT",
      outstandingAmount: 10_000,
      balanceDue: null,
    },
    sale: { paymentStatus: "ON_CREDIT", total: 10_000 },
  });
  await expect(
    orderDrawer.getByText(ordersLabels.statusLabels.DELIVERED, { exact: true }),
  ).toBeVisible();
  await expect(
    orderDrawer
      .getByText(ordersLabels.columnSalePaymentStatus, { exact: true })
      .locator("..")
      .getByText(ordersLabels.paymentStatusLabels.ON_CREDIT, { exact: true }),
  ).toBeVisible();
  await expect(
    orderDrawer
      .getByText(ordersLabels.columnOutstandingAmount, { exact: true })
      .locator("..")
      .getByText("Bs 100,00", { exact: true }),
  ).toBeVisible();

  const receivablesResponse = await page.request.get("/api/receivables", {
    headers: await authenticatedHeaders(page),
    timeout: 10_000,
  });
  const receivablesPayload: unknown = await receivablesResponse.json();
  expect(receivablesResponse.ok(), JSON.stringify(receivablesPayload)).toBe(true);
  const receivables = receivablesPayload as ReceivablesResponse;
  const orderReceivable = receivables.groups
    .flatMap((group) => group.sales)
    .find((sale) => sale.saleId === deliveryPayload.sale.id);
  expect(orderReceivable).toMatchObject({
    customOrderId: quotePayload.order.id,
    outstandingAmount: 10_000,
  });

  const collectedAt = new Date(Date.now() - 60_000);
  const collectionResponse = await page.request.post(
    `/api/sales/${deliveryPayload.sale.id}/collect-payment`,
    {
      data: {
        occurredAt: collectedAt.toISOString(),
        businessDate: toBusinessDate(collectedAt),
        paymentMethod: "CASH",
        accountId: "acc_cash",
      },
      headers: await authenticatedHeaders(page),
      timeout: 10_000,
    },
  );
  const collectionPayload: unknown = await collectionResponse.json();
  expect(collectionResponse.ok(), JSON.stringify(collectionPayload)).toBe(true);

  await page.goto("/orders", { timeout: 15_000 });
  const paidOrderCard = page.getByRole("button", { name: new RegExp(description) });
  await expect(
    paidOrderCard.getByText(ordersLabels.paymentStatusLabels.PAID, { exact: true }),
  ).toBeVisible();
  await expect(
    paidOrderCard
      .getByText(ordersLabels.cardOutstandingBalance, { exact: true })
      .locator("..")
      .getByText("Bs 0,00", { exact: true }),
  ).toBeVisible();
  await paidOrderCard.click();
  const paidOrderDrawer = page.getByRole("dialog", { name: ordersLabels.detailTitle });
  await expect(
    paidOrderDrawer
      .getByText(ordersLabels.columnSalePaymentStatus, { exact: true })
      .locator("..")
      .getByText(ordersLabels.paymentStatusLabels.PAID, { exact: true }),
  ).toBeVisible();
  await expect(
    paidOrderDrawer
      .getByText(ordersLabels.columnOutstandingAmount, { exact: true })
      .locator("..")
      .getByText("Bs 0,00", { exact: true }),
  ).toBeVisible();
});
