// F-31 regression (KOK-179): editing a saved production run and changing "Tandas" must recompute
// the output quantity and every untouched ingredient line — the bug was a line-key mismatch
// (saved-production-line-${index} vs recipe.lines[].id) that silently froze every line in edit
// mode. Fixture (recipe + a matching production run) is created via the API; the edit itself is
// driven through the real UI, mirroring recipe-units.spec.ts's createItem/postJson pattern.
import { nowIso, toBusinessDate } from "@kokoro/shared";
import { expect, type Page, test } from "@playwright/test";

import { productionLabels } from "../src/lib/i18n-production";
import { postJson, uniqueName } from "./helpers";

interface CreatedItem {
  id: string;
}
interface CreatedRecipe {
  recipe: { id: string };
}

async function createItem(
  page: Page,
  name: string,
  kind: "RAW_MATERIAL" | "SEMI_FINISHED",
  unit: "KG" | "UNIT",
): Promise<CreatedItem> {
  return postJson<CreatedItem>(page, "/api/items", {
    name,
    kind,
    category: "INGREDIENT",
    unit,
    minStockQty: kind === "RAW_MATERIAL" ? 0 : undefined,
  });
}

test.beforeEach(async ({ page }) => {
  const password = process.env.E2E_LOGIN_PASSWORD;
  test.skip(!password, "E2E_LOGIN_PASSWORD not set — skipping production edit-recompute check");
  const response = await page.request.post("/api/auth/login", { data: { password } });
  expect(response.ok()).toBe(true);
});

test("editing a production run's batches recomputes output and untouched lines", async ({
  page,
}) => {
  const ingredientName = uniqueName("Harina edición e2e");
  const outputName = uniqueName("Masa edición e2e");
  const recipeName = uniqueName("Receta edición e2e");

  const ingredient = await createItem(page, ingredientName, "RAW_MATERIAL", "KG");
  const output = await createItem(page, outputName, "SEMI_FINISHED", "UNIT");

  const { recipe } = await postJson<CreatedRecipe>(page, "/api/recipes", {
    name: recipeName,
    outputItemId: output.id,
    expectedYieldQty: 1_000, // "1" output unit per batch (scale 3)
    isDefault: false,
    lines: [{ itemId: ingredient.id, qty: 500 }], // "0.5" kg per batch
  });

  const businessDate = toBusinessDate(nowIso());
  await postJson(page, "/api/production-runs", {
    recipeId: recipe.id,
    batches: 1,
    actualOutputQty: 1_000,
    lines: [{ itemId: ingredient.id, qty: 500 }],
    occurredAt: nowIso(),
    businessDate,
  });

  await page.goto("/production");
  await page.getByText(recipeName, { exact: true }).click();
  await page.getByRole("button", { name: productionLabels.edit, exact: true }).click();

  // Scoped to the edit dialog: "Tandas" is also a sortable EventTable column header (KOK-184)
  // elsewhere on the page, and getByLabel alone matches both the header button and this input.
  const editDialog = page.getByRole("dialog", { name: productionLabels.editTitle });

  const batches = editDialog.getByLabel(productionLabels.fieldBatches, { exact: true });
  await expect(batches).toHaveValue("1");
  await batches.fill("3");

  const actualOutputQty = editDialog.getByLabel(productionLabels.fieldActualOutputQty, {
    exact: true,
  });
  await expect(actualOutputQty).toHaveValue("3");

  const lineQty = editDialog.getByLabel("Cantidad", { exact: true });
  await expect(lineQty).toHaveValue("1.5");

  await editDialog.getByRole("button", { name: productionLabels.save, exact: true }).click();
  await expect(editDialog).toBeHidden();
});
