// KOK-165: recording an Envasado from a definition — selecting a definition should prefill "Salida
// real" from its outputQty (KOK-181) and submitting should create the assembly and return to
// /packing. Fixture items/definition are created via the API first (same pattern as
// recipe-units.spec.ts's createItem), the definition selection and submit are driven through the
// real UI.
import { expect, type Page, test } from "@playwright/test";

import { assembliesLabels } from "../src/lib/i18n-assemblies";
import { postJson, uniqueName } from "./helpers";

interface CreatedItem {
  id: string;
}

async function createItem(
  page: Page,
  name: string,
  kind: "PACKAGING" | "FINISHED",
): Promise<CreatedItem> {
  return postJson<CreatedItem>(page, "/api/items", {
    name,
    kind,
    category: kind === "FINISHED" ? "OTHER" : "NOT_EATABLE",
    unit: "UNIT",
    minStockQty: kind === "PACKAGING" ? 0 : undefined,
    salePriceMc: kind === "FINISHED" ? 8_000_000 : undefined,
  });
}

test.beforeEach(async ({ page }) => {
  const password = process.env.E2E_LOGIN_PASSWORD;
  test.skip(!password, "E2E_LOGIN_PASSWORD not set — skipping Envasado flow check");
  const response = await page.request.post("/api/auth/login", { data: { password } });
  expect(response.ok()).toBe(true);
});

test("recording an Envasado from a definition prefills and submits", async ({ page }) => {
  const outputName = uniqueName("Combo envasado e2e");
  const componentName = uniqueName("Componente envasado e2e");
  const definitionName = uniqueName("Definición envasado e2e");

  const outputItem = await createItem(page, outputName, "FINISHED");
  const componentItem = await createItem(page, componentName, "PACKAGING");

  await postJson(page, "/api/assembly-definitions", {
    name: definitionName,
    outputItemId: outputItem.id,
    outputQty: 2_000, // milli-units (Doc 04 §2) — "2" whole units
    lines: [{ itemId: componentItem.id, qty: 2_000 }],
  });

  await page.goto("/packing/new");

  const definitionSelect = page.getByLabel(assembliesLabels.fieldDefinition, { exact: true });
  await definitionSelect.selectOption({ label: definitionName });

  const actualOutputQty = page.getByLabel(assembliesLabels.fieldActualOutputQty, { exact: true });
  await expect(actualOutputQty).toHaveValue("2");

  await page.getByRole("button", { name: assembliesLabels.submit, exact: true }).click();

  await expect(page).toHaveURL(/\/packing(\?|$)/);
});
