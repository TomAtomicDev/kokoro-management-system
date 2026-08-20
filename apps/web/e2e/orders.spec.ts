// KOK-165: order regressions (F-46, F-47) plus the confirm → deliver → undo lifecycle (KOK-170's
// ConfirmDialog replaced this drawer's window.confirm popups on this same branch, so the undo step
// drives that dialog's Confirm button, not a native `page.on('dialog')` handler).
import { expect, type Page, test } from "@playwright/test";

import { ordersLabels } from "../src/lib/i18n-orders";
import { postJson, selectFromPicker, uniqueName } from "./helpers";

interface CreatedCustomer {
  id: string;
}
interface CreatedItem {
  id: string;
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
  const password = process.env.E2E_LOGIN_PASSWORD;
  test.skip(!password, "E2E_LOGIN_PASSWORD not set — skipping order flow checks");
  const response = await page.request.post("/api/auth/login", { data: { password } });
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

  // Confirmar: deposit == full agreed total, so the delivery step has zero balance due.
  await page.getByRole("button", { name: ordersLabels.actionConfirm, exact: true }).click();
  await page.getByLabel(ordersLabels.confirmFieldDepositAmount).fill("100");
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
  await expect(page.getByText(ordersLabels.deliverBalanceZero)).toBeVisible();
  await page.getByRole("button", { name: ordersLabels.deliverSubmit, exact: true }).click();
  await expect(page.getByText(ordersLabels.statusLabels.DELIVERED, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: ordersLabels.actionUndoDeliver, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.getByText(ordersLabels.statusLabels.READY, { exact: true })).toBeVisible();
});
