// Integration tests for core/recipes (KOK-025), following the Doc 11 Â§3 template: seed -> execute
// command -> assert event rows + audit_log entries + atomicity, run against real D1 via
// @cloudflare/vitest-pool-workers (test/setup.ts applies migrations/0001_init.sql first).
import { env } from "cloudflare:test";
import { rateFromTotal, toCentavos, toMilliUnits } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createItem } from "../src/core/catalog/index.js";
import {
  getRecipe,
  listRecipes,
  recordRecipe,
  setRecipeActive,
  updateRecipe,
} from "../src/core/recipes/index.js";
import { createDb } from "../src/db/index.js";
import { items } from "../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;

/** A FINISHED item with a `wac`/`replacementCostMc`/`salePrice` set directly (createItem always
 * zeroes those two, per its own doc comment) so the cost/margin arithmetic below is hand-verifiable
 * against recipes-theoretical-cost.test.ts's own worked examples. */
async function createOutputItem(
  db: ReturnType<typeof createDb>,
  salePriceMc: number | null = 8_000_000,
) {
  const item = await createItem(
    db,
    {
      name: `Pan de molde ${crypto.randomUUID()}`,
      kind: "FINISHED",
      category: "BAKERY",
      unit: "UNIT",
    },
    ACTOR,
  );
  await db.update(items).set({ salePriceMc }).where(eq(items.id, item.id));
  return item;
}

async function createIngredientItem(
  db: ReturnType<typeof createDb>,
  wac: number,
  replacementCostMc: number,
  kind: "RAW_MATERIAL" | "SEMI_FINISHED" = "RAW_MATERIAL",
) {
  const item = await createItem(
    db,
    { name: `Harina ${crypto.randomUUID()}`, kind, category: "INGREDIENT", unit: "KG" },
    ACTOR,
  );
  // `wac` and `replacementCostMc` are given in simplified units (1 = 1,000,000 mc) for
  // readability; `rateFromTotal` below converts each to its integer MilliCentavosPerUnit form, so
  // the seeded values are exact, not approximations.
  await db
    .update(items)
    .set({
      wacMc: rateFromTotal(toCentavos(wac), toMilliUnits(1)),
      replacementCostMc: rateFromTotal(toCentavos(replacementCostMc), toMilliUnits(1)),
    })
    .where(eq(items.id, item.id));
  return item;
}

describe("recordRecipe", () => {
  it("creates a recipe with lines and computes theoreticalCostWac/theoreticalCostReplacement/margin", async () => {
    const db = createDb(env.DB);
    const output = await createOutputItem(db, 8_000_000); // Bs 80.00 sale price
    // Mirrors recipes-theoretical-cost.test.ts's "sums multiple lines and divides by yield" example:
    // WAC batch cost = 500*10 + 200*3 = 5600 -> /2000*1000 = 2800 centavos/unit.
    const flour = await createIngredientItem(db, 10, 12);
    const sugar = await createIngredientItem(db, 3, 4);

    const result = await recordRecipe(
      db,
      {
        name: "Receta base",
        outputItemId: output.id,
        expectedYieldQty: 2000,
        estLaborMin: 30,
        isDefault: true,
        notes: null,
        lines: [
          { itemId: flour.id, qty: 500 },
          { itemId: sugar.id, qty: 200 },
        ],
      },
      ACTOR,
    );

    expect(result.recipe.isDefault).toBe(true);
    expect(result.recipe.isActive).toBe(true);
    expect(result.recipe.lines).toHaveLength(2);

    // WAC basis: 500*10 + 200*3 = 5600 -> /2000*1000 = 2800; margin = 8000-2800=5200, 65.00%.
    expect(result.recipe.theoreticalCostWac.costPerOutputUnit).toBe(2800);
    expect(result.recipe.theoreticalCostWac.margin).toEqual({ amount: 5200, pctBasisPoints: 6500 });

    // Replacement basis: 500*12 + 200*4 = 6800 -> /2000*1000 = 3400; margin = 8000-3400=4600, 57.50%.
    expect(result.recipe.theoreticalCostReplacement.costPerOutputUnit).toBe(3400);
    expect(result.recipe.theoreticalCostReplacement.margin).toEqual({
      amount: 4600,
      pctBasisPoints: 5750,
    });

    expect(result.settings.minMarginPct).toBe(3000); // seeded default (min_margin_pct = '3000')

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { eq: eqOp, and }) =>
        and(eqOp(t.entityId, result.recipe.id), eqOp(t.action, "create")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "recipe" });
  });

  it("rejects an output item of kind RAW_MATERIAL with VALIDATION", async () => {
    const db = createDb(env.DB);
    const rawOutput = await createIngredientItem(db, 0, 0);
    const flour = await createIngredientItem(db, 5, 5);

    await expect(
      recordRecipe(
        db,
        {
          name: "Receta inválida",
          outputItemId: rawOutput.id,
          expectedYieldQty: 1000,
          estLaborMin: null,
          isDefault: false,
          notes: null,
          lines: [{ itemId: flour.id, qty: 100 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects an output item of kind PACKAGING with VALIDATION (Doc 03 §3, PACKAGING is never a recipe output)", async () => {
    const db = createDb(env.DB);
    const packagingOutput = await createItem(
      db,
      {
        name: `Bolsa ${crypto.randomUUID()}`,
        kind: "PACKAGING",
        category: "NOT_EATABLE",
        unit: "UNIT",
        minStockQty: 0,
      },
      ACTOR,
    );
    const flour = await createIngredientItem(db, 5, 5);

    await expect(
      recordRecipe(
        db,
        {
          name: "Receta inválida",
          outputItemId: packagingOutput.id,
          expectedYieldQty: 1000,
          estLaborMin: null,
          isDefault: false,
          notes: null,
          lines: [{ itemId: flour.id, qty: 100 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects a line item of kind PACKAGING with VALIDATION (Doc 03 §3, PACKAGING is never a recipe input)", async () => {
    const db = createDb(env.DB);
    const output = await createOutputItem(db);
    const packagingLine = await createItem(
      db,
      {
        name: `Caja ${crypto.randomUUID()}`,
        kind: "PACKAGING",
        category: "NOT_EATABLE",
        unit: "UNIT",
        minStockQty: 0,
      },
      ACTOR,
    );

    await expect(
      recordRecipe(
        db,
        {
          name: "Receta inválida",
          outputItemId: output.id,
          expectedYieldQty: 1000,
          estLaborMin: null,
          isDefault: false,
          notes: null,
          lines: [{ itemId: packagingLine.id, qty: 100 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects a line item of kind FINISHED with VALIDATION", async () => {
    const db = createDb(env.DB);
    const output = await createOutputItem(db);
    const finishedLine = await createItem(
      db,
      { name: `Torta ${crypto.randomUUID()}`, kind: "FINISHED", category: "BAKERY", unit: "UNIT" },
      ACTOR,
    );

    await expect(
      recordRecipe(
        db,
        {
          name: "Receta inválida",
          outputItemId: output.id,
          expectedYieldQty: 1000,
          estLaborMin: null,
          isDefault: false,
          notes: null,
          lines: [{ itemId: finishedLine.id, qty: 100 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects a line item that is the recipe's own output item with VALIDATION", async () => {
    const db = createDb(env.DB);
    // SEMI_FINISHED is a legal output kind AND a legal ingredient kind, so nothing about the
    // per-line kind check (above) would catch a starter feeding itself — this is the KOK-029
    // staging incident: a sourdough-starter recipe listing the starter as its own ingredient
    // makes the C-3 recipe graph cyclical, silently zeroing replacement_cost_mc catalog-wide.
    const starter = await createIngredientItem(db, 5, 5, "SEMI_FINISHED");
    const flour = await createIngredientItem(db, 5, 5);

    await expect(
      recordRecipe(
        db,
        {
          name: "Alimentar la masa madre",
          outputItemId: starter.id,
          expectedYieldQty: 1000,
          estLaborMin: null,
          isDefault: false,
          notes: null,
          lines: [
            { itemId: starter.id, qty: 100 },
            { itemId: flour.id, qty: 100 },
          ],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("creating a second recipe with isDefault:true flips the first one's isDefault to false", async () => {
    const db = createDb(env.DB);
    const output = await createOutputItem(db);
    const flour = await createIngredientItem(db, 5, 5);

    const first = await recordRecipe(
      db,
      {
        name: "Receta A",
        outputItemId: output.id,
        expectedYieldQty: 1000,
        estLaborMin: null,
        isDefault: true,
        notes: null,
        lines: [{ itemId: flour.id, qty: 100 }],
      },
      ACTOR,
    );
    expect(first.recipe.isDefault).toBe(true);

    const second = await recordRecipe(
      db,
      {
        name: "Receta B",
        outputItemId: output.id,
        expectedYieldQty: 1000,
        estLaborMin: null,
        isDefault: true,
        notes: null,
        lines: [{ itemId: flour.id, qty: 200 }],
      },
      ACTOR,
    );
    expect(second.recipe.isDefault).toBe(true);

    // Direct row read (not just the returned DTO) â€” the whole point of the clear-other-defaults guard.
    const firstRow = await db.query.recipes.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, first.recipe.id),
    });
    expect(firstRow?.isDefault).toBe(0);
  });

  it("rejects a duplicate active recipe name with CONFLICT (KOK-025 KB amendment, ux_recipes_name)", async () => {
    const db = createDb(env.DB);
    const output = await createOutputItem(db);
    const flour = await createIngredientItem(db, 5, 5);

    await recordRecipe(
      db,
      {
        name: "Alimentar masa madre",
        outputItemId: output.id,
        expectedYieldQty: 1000,
        estLaborMin: null,
        isDefault: false,
        notes: null,
        lines: [{ itemId: flour.id, qty: 100 }],
      },
      ACTOR,
    );

    await expect(
      recordRecipe(
        db,
        {
          name: "Alimentar masa madre",
          outputItemId: output.id,
          expectedYieldQty: 2000,
          estLaborMin: null,
          isDefault: false,
          notes: null,
          lines: [{ itemId: flour.id, qty: 200 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("allows reusing a name once the original recipe is deactivated (ux_recipes_name is active-only)", async () => {
    const db = createDb(env.DB);
    const output = await createOutputItem(db);
    const flour = await createIngredientItem(db, 5, 5);

    const original = await recordRecipe(
      db,
      {
        name: "Receta reciclable",
        outputItemId: output.id,
        expectedYieldQty: 1000,
        estLaborMin: null,
        isDefault: false,
        notes: null,
        lines: [{ itemId: flour.id, qty: 100 }],
      },
      ACTOR,
    );
    await setRecipeActive(db, { id: original.recipe.id, isActive: false }, ACTOR);

    const reused = await recordRecipe(
      db,
      {
        name: "Receta reciclable",
        outputItemId: output.id,
        expectedYieldQty: 1000,
        estLaborMin: null,
        isDefault: false,
        notes: null,
        lines: [{ itemId: flour.id, qty: 100 }],
      },
      ACTOR,
    );
    expect(reused.recipe.name).toBe("Receta reciclable");
  });
});

describe("updateRecipe", () => {
  it("full-replaces lines and recomputes cost", async () => {
    const db = createDb(env.DB);
    const output = await createOutputItem(db, 8_000_000);
    const flour = await createIngredientItem(db, 10, 10);
    const butter = await createIngredientItem(db, 20, 20);

    const created = await recordRecipe(
      db,
      {
        name: "Receta original",
        outputItemId: output.id,
        expectedYieldQty: 1000,
        estLaborMin: 10,
        isDefault: false,
        notes: "v1",
        lines: [{ itemId: flour.id, qty: 1000 }],
      },
      ACTOR,
    );
    // Single-line example from recipes-theoretical-cost.test.ts: 1000*10 -> /1000*1000 = 10000.
    expect(created.recipe.theoreticalCostWac.costPerOutputUnit).toBe(10000);

    const updated = await updateRecipe(
      db,
      created.recipe.id,
      {
        name: "Receta actualizada",
        outputItemId: output.id,
        expectedYieldQty: 1000,
        estLaborMin: 15,
        isDefault: false,
        notes: "v2",
        lines: [{ itemId: butter.id, qty: 1000 }],
      },
      ACTOR,
    );

    expect(updated.recipe.name).toBe("Receta actualizada");
    expect(updated.recipe.notes).toBe("v2");
    expect(updated.recipe.lines).toEqual([
      { id: expect.any(String), itemId: butter.id, qty: 1000 },
    ]);
    // 1000*20 -> /1000*1000 = 20000, proving the old flour line no longer contributes.
    expect(updated.recipe.theoreticalCostWac.costPerOutputUnit).toBe(20000);

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { eq: eqOp, and }) =>
        and(eqOp(t.entityId, created.recipe.id), eqOp(t.action, "update")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "recipe" });
  });

  it("throws NOT_FOUND for a missing id", async () => {
    const db = createDb(env.DB);
    const output = await createOutputItem(db);
    const flour = await createIngredientItem(db, 5, 5);
    await expect(
      updateRecipe(
        db,
        "does_not_exist",
        {
          name: "x",
          outputItemId: output.id,
          expectedYieldQty: 1000,
          estLaborMin: null,
          isDefault: false,
          notes: null,
          lines: [{ itemId: flour.id, qty: 100 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects editing a line item to be the recipe's own output item with VALIDATION", async () => {
    const db = createDb(env.DB);
    const starter = await createIngredientItem(db, 5, 5, "SEMI_FINISHED");
    const flour = await createIngredientItem(db, 5, 5);

    const created = await recordRecipe(
      db,
      {
        name: "Alimentar la masa madre",
        outputItemId: starter.id,
        expectedYieldQty: 1000,
        estLaborMin: null,
        isDefault: false,
        notes: null,
        lines: [{ itemId: flour.id, qty: 100 }],
      },
      ACTOR,
    );

    await expect(
      updateRecipe(
        db,
        created.recipe.id,
        {
          name: "Alimentar la masa madre",
          outputItemId: starter.id,
          expectedYieldQty: 1000,
          estLaborMin: null,
          isDefault: false,
          notes: null,
          lines: [
            { itemId: starter.id, qty: 100 },
            { itemId: flour.id, qty: 100 },
          ],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects renaming into another active recipe's name with CONFLICT", async () => {
    const db = createDb(env.DB);
    const output = await createOutputItem(db);
    const flour = await createIngredientItem(db, 5, 5);

    // Distinct from the recordRecipe describe block's "Receta A"/"Receta B" fixtures above â€”
    // this test file's D1 storage persists across `it()`s, so recipe names must stay unique
    // file-wide now that ux_recipes_name is enforced.
    await recordRecipe(
      db,
      {
        name: "Receta única A",
        outputItemId: output.id,
        expectedYieldQty: 1000,
        estLaborMin: null,
        isDefault: false,
        notes: null,
        lines: [{ itemId: flour.id, qty: 100 }],
      },
      ACTOR,
    );
    const recipeB = await recordRecipe(
      db,
      {
        name: "Receta única B",
        outputItemId: output.id,
        expectedYieldQty: 1000,
        estLaborMin: null,
        isDefault: false,
        notes: null,
        lines: [{ itemId: flour.id, qty: 100 }],
      },
      ACTOR,
    );

    await expect(
      updateRecipe(
        db,
        recipeB.recipe.id,
        {
          name: "Receta única A",
          outputItemId: output.id,
          expectedYieldQty: 1000,
          estLaborMin: null,
          isDefault: false,
          notes: null,
          lines: [{ itemId: flour.id, qty: 100 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("allows an update that keeps the recipe's own unchanged name", async () => {
    const db = createDb(env.DB);
    const output = await createOutputItem(db);
    const flour = await createIngredientItem(db, 5, 5);

    const created = await recordRecipe(
      db,
      {
        name: "Receta estable",
        outputItemId: output.id,
        expectedYieldQty: 1000,
        estLaborMin: null,
        isDefault: false,
        notes: null,
        lines: [{ itemId: flour.id, qty: 100 }],
      },
      ACTOR,
    );

    const updated = await updateRecipe(
      db,
      created.recipe.id,
      {
        name: "Receta estable",
        outputItemId: output.id,
        expectedYieldQty: 1500,
        estLaborMin: null,
        isDefault: false,
        notes: null,
        lines: [{ itemId: flour.id, qty: 150 }],
      },
      ACTOR,
    );
    expect(updated.recipe.name).toBe("Receta estable");
  });
});

describe("setRecipeActive", () => {
  it("round-trips deactivate then reactivate", async () => {
    const db = createDb(env.DB);
    const output = await createOutputItem(db);
    const flour = await createIngredientItem(db, 5, 5);
    const created = await recordRecipe(
      db,
      {
        name: "Receta",
        outputItemId: output.id,
        expectedYieldQty: 1000,
        estLaborMin: null,
        isDefault: false,
        notes: null,
        lines: [{ itemId: flour.id, qty: 100 }],
      },
      ACTOR,
    );

    const deactivated = await setRecipeActive(
      db,
      { id: created.recipe.id, isActive: false },
      ACTOR,
    );
    expect(deactivated.recipe.isActive).toBe(false);

    const reactivated = await setRecipeActive(db, { id: created.recipe.id, isActive: true }, ACTOR);
    expect(reactivated.recipe.isActive).toBe(true);

    const auditRows = await db.query.auditLog.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.entityId, created.recipe.id),
    });
    expect(auditRows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["create", "deactivate", "activate"]),
    );
  });

  it("reactivating a recipe whose stored isDefault=1 clears the OTHER recipe that became default while it was inactive", async () => {
    const db = createDb(env.DB);
    const output = await createOutputItem(db);
    const flour = await createIngredientItem(db, 5, 5);

    const recipeA = await recordRecipe(
      db,
      {
        name: "A",
        outputItemId: output.id,
        expectedYieldQty: 1000,
        estLaborMin: null,
        isDefault: true,
        notes: null,
        lines: [{ itemId: flour.id, qty: 100 }],
      },
      ACTOR,
    );
    // A is now the default. Deactivate it WITHOUT touching isDefault (setRecipeActive never
    // changes isDefault on its own) â€” its stored isDefault stays 1 while isActive goes to 0.
    await setRecipeActive(db, { id: recipeA.recipe.id, isActive: false }, ACTOR);
    const aRowAfterDeactivate = await db.query.recipes.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, recipeA.recipe.id),
    });
    expect(aRowAfterDeactivate).toMatchObject({ isActive: 0, isDefault: 1 });

    // While A is inactive, B becomes the new (only eligible) active default.
    const recipeB = await recordRecipe(
      db,
      {
        name: "B",
        outputItemId: output.id,
        expectedYieldQty: 1000,
        estLaborMin: null,
        isDefault: true,
        notes: null,
        lines: [{ itemId: flour.id, qty: 200 }],
      },
      ACTOR,
    );
    expect(recipeB.recipe.isDefault).toBe(true);

    // Reactivating A â€” which still thinks it's the default â€” must clear B, not collide with it.
    const reactivatedA = await setRecipeActive(
      db,
      { id: recipeA.recipe.id, isActive: true },
      ACTOR,
    );
    expect(reactivatedA.recipe.isActive).toBe(true);
    expect(reactivatedA.recipe.isDefault).toBe(true);

    const bRowAfter = await db.query.recipes.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, recipeB.recipe.id),
    });
    expect(bRowAfter?.isDefault).toBe(0);

    // Other direction: reactivating a NON-default recipe must not disturb the current default at all.
    await setRecipeActive(db, { id: recipeA.recipe.id, isActive: false }, ACTOR);
    const recipeC = await recordRecipe(
      db,
      {
        name: "C",
        outputItemId: output.id,
        expectedYieldQty: 1000,
        estLaborMin: null,
        isDefault: false,
        notes: null,
        lines: [{ itemId: flour.id, qty: 300 }],
      },
      ACTOR,
    );
    await setRecipeActive(db, { id: recipeC.recipe.id, isActive: false }, ACTOR);
    const reactivatedC = await setRecipeActive(
      db,
      { id: recipeC.recipe.id, isActive: true },
      ACTOR,
    );
    expect(reactivatedC.recipe.isDefault).toBe(false);

    // A is the CURRENT default after step 4 above (it cleared B's isDefault on its own reactivation);
    // C is a non-default recipe, so reactivating it must not disturb A's default status at all.
    const aRowStillDefault = await db.query.recipes.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, recipeA.recipe.id),
    });
    expect(aRowStillDefault?.isDefault).toBe(1);
  });

  it("rejects reactivating into a name collision created while the recipe was inactive", async () => {
    const db = createDb(env.DB);
    const output = await createOutputItem(db);
    const flour = await createIngredientItem(db, 5, 5);

    const original = await recordRecipe(
      db,
      {
        name: "Receta compartida",
        outputItemId: output.id,
        expectedYieldQty: 1000,
        estLaborMin: null,
        isDefault: false,
        notes: null,
        lines: [{ itemId: flour.id, qty: 100 }],
      },
      ACTOR,
    );
    await setRecipeActive(db, { id: original.recipe.id, isActive: false }, ACTOR);

    // A new active recipe now holds the name the deactivated one used to have.
    await recordRecipe(
      db,
      {
        name: "Receta compartida",
        outputItemId: output.id,
        expectedYieldQty: 1000,
        estLaborMin: null,
        isDefault: false,
        notes: null,
        lines: [{ itemId: flour.id, qty: 200 }],
      },
      ACTOR,
    );

    await expect(
      setRecipeActive(db, { id: original.recipe.id, isActive: true }, ACTOR),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("listRecipes", () => {
  it("filters by outputItemId and isActive", async () => {
    const db = createDb(env.DB);
    const outputA = await createOutputItem(db);
    const outputB = await createOutputItem(db);
    const flour = await createIngredientItem(db, 5, 5);

    const recipeA = await recordRecipe(
      db,
      {
        name: "Recipe A",
        outputItemId: outputA.id,
        expectedYieldQty: 1000,
        estLaborMin: null,
        isDefault: false,
        notes: null,
        lines: [{ itemId: flour.id, qty: 100 }],
      },
      ACTOR,
    );
    const recipeB = await recordRecipe(
      db,
      {
        name: "Recipe B",
        outputItemId: outputB.id,
        expectedYieldQty: 1000,
        estLaborMin: null,
        isDefault: false,
        notes: null,
        lines: [{ itemId: flour.id, qty: 100 }],
      },
      ACTOR,
    );
    await setRecipeActive(db, { id: recipeB.recipe.id, isActive: false }, ACTOR);

    const byOutput = await listRecipes(db, { outputItemId: outputA.id });
    expect(byOutput.recipes.map((r) => r.id)).toEqual([recipeA.recipe.id]);

    const onlyActive = await listRecipes(db, { isActive: true });
    expect(onlyActive.recipes.map((r) => r.id)).toContain(recipeA.recipe.id);
    expect(onlyActive.recipes.map((r) => r.id)).not.toContain(recipeB.recipe.id);

    // Scoped by outputItemId too (not isActive alone) â€” the D1 test DB persists across `it()`
    // blocks in this file, so an unscoped isActive:false query would also pick up inactive recipes
    // left over by earlier tests in this file.
    const onlyInactive = await listRecipes(db, { outputItemId: outputB.id, isActive: false });
    expect(onlyInactive.recipes.map((r) => r.id)).toEqual([recipeB.recipe.id]);
  });
});

describe("getRecipe", () => {
  it("throws NOT_FOUND for a missing id", async () => {
    const db = createDb(env.DB);
    await expect(getRecipe(db, "does_not_exist")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
