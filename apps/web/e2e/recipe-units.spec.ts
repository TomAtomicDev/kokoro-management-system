import { expect, type Page, test } from "@playwright/test";

interface CreatedItem {
  id: string;
}

interface RecipeLine {
  itemId: string;
  qty: number;
}

interface RecipeResult {
  recipe: {
    id: string;
    name: string;
    expectedYieldQty: number;
    lines: RecipeLine[];
  };
}

interface RecipeListResult {
  recipes: RecipeResult["recipe"][];
}

function uniqueName(label: string): string {
  return `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function authenticatedHeaders(page: Page): Promise<Record<string, string>> {
  const cookies = await page.context().cookies();
  const token = cookies.find((cookie) => cookie.name === "kokoro_csrf")?.value;
  expect(token).toBeTruthy();
  return {
    Cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
    "X-CSRF-Token": token ?? "",
  };
}

async function postJson<T>(page: Page, path: string, data: unknown): Promise<T> {
  const response = await page.request.post(path, {
    data,
    headers: await authenticatedHeaders(page),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

async function createItem(
  page: Page,
  name: string,
  kind: "RAW_MATERIAL" | "SEMI_FINISHED",
  unit: "KG" | "L" | "UNIT",
): Promise<CreatedItem> {
  return postJson<CreatedItem>(page, "/api/items", {
    name,
    kind,
    category: "INGREDIENT",
    unit,
    minStockQty: kind === "RAW_MATERIAL" ? 0 : undefined,
  });
}

async function selectItem(page: Page, placeholder: string, name: string): Promise<void> {
  const picker = page.getByPlaceholder(placeholder);
  await picker.fill(name);
  await page.getByRole("button", { name, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  const password = process.env.E2E_LOGIN_PASSWORD;
  test.skip(!password, "E2E_LOGIN_PASSWORD not set — skipping recipe unit checks");
  if (!password) return;

  const response = await page.request.post("/api/auth/login", { data: { password } });
  expect(response.ok()).toBe(true);
});

test("recipe ingredient units default, survive typing, reset on item change, and persist milli-units", async ({
  page,
}) => {
  const kgName = uniqueName("Harina e2e");
  const litreName = uniqueName("Leche e2e");
  const outputName = uniqueName("Masa e2e");
  const recipeName = uniqueName("Receta unidades e2e");
  await createItem(page, kgName, "RAW_MATERIAL", "KG");
  await createItem(page, litreName, "RAW_MATERIAL", "L");
  await createItem(page, outputName, "SEMI_FINISHED", "UNIT");

  await page.goto("/production/recipes");
  await page.getByRole("button", { name: "Nueva receta" }).click();
  await page.getByLabel("Nombre").fill(recipeName);

  await selectItem(page, "Ingrediente", kgName);
  const ingredientQty = page.getByLabel("Cantidad", { exact: true });
  const ingredientUnit = page.getByLabel("Cantidad — Unidad");
  await expect(ingredientQty).toHaveValue("");
  await expect(ingredientUnit).toHaveValue("G");
  await expect(ingredientUnit.locator("option:checked")).toHaveText("Gramos (g)");

  await ingredientQty.fill("321");
  await expect(ingredientUnit).toHaveValue("G");

  await selectItem(page, "Ingrediente", litreName);
  await expect(ingredientQty).toHaveValue("");
  await expect(ingredientUnit).toHaveValue("ML");
  await expect(ingredientUnit.locator("option:checked")).toHaveText("Mililitros (ml)");

  await selectItem(page, "Ingrediente", kgName);
  await expect(ingredientQty).toHaveValue("");
  await expect(ingredientUnit).toHaveValue("G");
  await ingredientQty.fill("580");

  await selectItem(page, "Buscar ítem…", outputName);
  await page.getByLabel("Rendimiento esperado", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Crear receta" }).click();
  await expect(page.getByText(recipeName, { exact: true })).toBeVisible();

  const recipesResponse = await page.request.get("/api/recipes", {
    headers: await authenticatedHeaders(page),
  });
  expect(recipesResponse.ok()).toBe(true);
  const recipes = (await recipesResponse.json()) as RecipeListResult;
  const recipe = recipes.recipes.find((candidate) => candidate.name === recipeName);
  expect(recipe).toBeDefined();
  expect(recipe?.expectedYieldQty).toBe(2_000);
  expect(recipe?.lines).toEqual([{ id: expect.any(String), itemId: expect.any(String), qty: 580 }]);
});

test("UNIT-family ingredients expose a single stable unit option", async ({ page }) => {
  const ingredientName = uniqueName("Huevos e2e");
  await createItem(page, ingredientName, "RAW_MATERIAL", "UNIT");

  await page.goto("/production/recipes");
  await page.getByRole("button", { name: "Nueva receta" }).click();
  await selectItem(page, "Ingrediente", ingredientName);

  const ingredientUnit = page.getByLabel("Cantidad — Unidad");
  await expect(ingredientUnit).toHaveValue("UNIT");
  await expect(ingredientUnit.locator("option")).toHaveCount(1);
  await expect(ingredientUnit.locator("option")).toHaveText("Unidad (u)");
  await page.getByLabel("Cantidad", { exact: true }).fill("3");
  await expect(ingredientUnit).toHaveValue("UNIT");
});

test("edit mode infers small and canonical units on opposite sides of the 1000 boundary", async ({
  page,
}) => {
  const kgName = uniqueName("Cacao e2e");
  const litreName = uniqueName("Jarabe e2e");
  const outputName = uniqueName("Relleno e2e");
  const recipeName = uniqueName("Receta edición e2e");
  const kgItem = await createItem(page, kgName, "RAW_MATERIAL", "KG");
  const litreItem = await createItem(page, litreName, "RAW_MATERIAL", "L");
  const outputItem = await createItem(page, outputName, "SEMI_FINISHED", "UNIT");
  await postJson<RecipeResult>(page, "/api/recipes", {
    name: recipeName,
    outputItemId: outputItem.id,
    expectedYieldQty: 1_000,
    isDefault: false,
    lines: [
      { itemId: kgItem.id, qty: 580 },
      { itemId: litreItem.id, qty: 1_250 },
    ],
  });

  await page.goto("/production/recipes");
  await page.getByText(recipeName, { exact: true }).click();
  await page.getByRole("button", { name: "Editar", exact: true }).click();

  const units = page.getByLabel("Cantidad — Unidad");
  await expect(units).toHaveCount(2);
  await expect(units.nth(0)).toHaveValue("G");
  await expect(units.nth(0).locator("option:checked")).toHaveText("Gramos (g)");
  await expect(units.nth(1)).toHaveValue("L");
  await expect(units.nth(1).locator("option:checked")).toHaveText("Litros (L)");
  await expect(page.getByLabel("Cantidad", { exact: true }).nth(0)).toHaveValue("580");
  await expect(page.getByLabel("Cantidad", { exact: true }).nth(1)).toHaveValue("1.25");
});
