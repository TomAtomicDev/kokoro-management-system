// Integration tests for core/costing's C-3 replacement-cost refresh (KOK-029, Doc 03 Ãƒâ€šÃ‚Â§4,
// Doc 11 Ãƒâ€šÃ‚Â§3 template): seed real state via core/ service factories (createItem, recordRecipe ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â
// the same seams recipes.test.ts uses), run planReplacementCostRefresh / runReplacementCostRefresh
// against real D1 (test/setup.ts applies migrations/0001_init.sql first), then assert
// items.replacement_cost_mc / replacement_cost_mc_updated_at, dependency order across a multi-level BOM,
// the no-default-recipe skip path, and the job's job_runs ok=1/ok=0 bookkeeping.
import { env } from "cloudflare:test";
import {
  type RecordAssemblyDefinitionCommand,
  type RecordRecipeCommand,
  toMilliCentavosPerUnit,
  totalCentavos,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { beforeEach, describe, expect, it } from "vitest";

import { computeAssemblyMargin } from "../src/core/assemblies/cost-preview.js";
import { recordAssemblyDefinition } from "../src/core/assemblies/index.js";
import { createItem } from "../src/core/catalog/index.js";
import { planReplacementCostRefresh } from "../src/core/costing/index.js";
import { recordRecipe } from "../src/core/recipes/index.js";
import { createDb } from "../src/db/index.js";
import { assemblyDefinitions, items, jobRuns, recipes } from "../src/db/schema.js";
import { runReplacementCostRefresh } from "../src/jobs/replacement-cost-refresh.js";

const ACTOR = "OWNER_WEB" as const;
type TestDb = ReturnType<typeof createDb>;
type Statement = BatchItem<"sqlite">;

async function seedItem(
  db: TestDb,
  kind: "RAW_MATERIAL" | "SEMI_FINISHED" | "FINISHED" | "PACKAGING",
  replacementCostMc = 0,
  wacMc = 0,
) {
  const item = await createItem(
    db,
    {
      name: `Item ${crypto.randomUUID()}`,
      kind,
      category: kind === "PACKAGING" ? "NOT_EATABLE" : "INGREDIENT",
      unit: kind === "FINISHED" || kind === "PACKAGING" ? "UNIT" : "KG",
    },
    ACTOR,
  );
  if (replacementCostMc !== 0 || wacMc !== 0) {
    await db
      .update(items)
      .set({
        replacementCostMc,
        replacementCostUpdatedAt: replacementCostMc === 0 ? null : "2026-08-07T00:00:00.000Z",
        wacMc,
      })
      .where(eq(items.id, item.id));
  }
  return item;
}

function seedDefaultAssemblyDefinition(
  db: TestDb,
  outputItemId: string,
  outputQty: number,
  lines: readonly { itemId: string; qty: number }[],
) {
  const command: RecordAssemblyDefinitionCommand = {
    name: `Definición ${crypto.randomUUID()}`,
    outputItemId,
    outputQty,
    isDefault: true,
    notes: null,
    lines: [...lines],
  };
  return recordAssemblyDefinition(db, command, ACTOR);
}

function seedDefaultRecipe(
  db: TestDb,
  outputItemId: string,
  expectedYieldQty: number,
  lines: readonly { itemId: string; qty: number }[],
) {
  const command: RecordRecipeCommand = {
    name: `Receta ${crypto.randomUUID()}`,
    outputItemId,
    expectedYieldQty,
    estLaborMin: null,
    isDefault: true,
    notes: null,
    lines: [...lines],
  };
  return recordRecipe(db, command, ACTOR);
}

async function readItem(db: TestDb, id: string) {
  const row = await db.query.items.findFirst({ where: (t, { eq: eqOp }) => eqOp(t.id, id) });
  if (!row) throw new Error(`item ${id} not found`);
  return row;
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(jobRuns).where(eq(jobRuns.job, "replacement-cost-refresh"));
  await db.delete(assemblyDefinitions);
  await db.delete(recipes); // cascades to recipe_lines (db/schema.ts's onDelete: "cascade")
});

describe("planReplacementCostRefresh (C-3, SEMI_FINISHED/FINISHED)", () => {
  it("computes a SEMI_FINISHED item from its default recipe's RAW_MATERIAL ingredients", async () => {
    const db = createDb(env.DB);
    const flour = await seedItem(db, "RAW_MATERIAL", 12); // 12 centavos/milli-unit
    const masa = await seedItem(db, "SEMI_FINISHED");
    await seedDefaultRecipe(db, masa.id, 1000, [{ itemId: flour.id, qty: 500 }]);

    const plan = await planReplacementCostRefresh(db, "MANUAL");
    expect(plan.refreshedItemIds).toContain(masa.id);
    expect(plan.skippedItemIds).not.toContain(masa.id);

    await db.batch(plan.statements as [Statement, ...Statement[]]);

    const updated = await readItem(db, masa.id);
    // 500 * 12 / 1000 = 6 centavos/milli-unit.
    expect(updated.replacementCostMc).toBe(6);
    expect(updated.replacementCostUpdatedAt).not.toBeNull();
    const observations = await db.query.replacementCostHistory.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, masa.id),
    });
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      replacementCostMc: 6,
      observedAt: updated.replacementCostUpdatedAt,
      source: "MANUAL",
    });
  });

  it("rolls up opening-balance WAC from a never-purchased leaf ingredient", async () => {
    const db = createDb(env.DB);
    const flour = await seedItem(db, "RAW_MATERIAL", 0, 12);
    const masa = await seedItem(db, "SEMI_FINISHED");
    await seedDefaultRecipe(db, masa.id, 1000, [{ itemId: flour.id, qty: 500 }]);

    const plan = await planReplacementCostRefresh(db, "MANUAL");
    await db.batch(plan.statements as [Statement, ...Statement[]]);

    const storedFlour = await readItem(db, flour.id);
    const updatedMasa = await readItem(db, masa.id);
    expect(storedFlour.replacementCostMc).toBe(0);
    expect(storedFlour.replacementCostUpdatedAt).toBeNull();
    expect(updatedMasa.replacementCostMc).toBe(6);
  });

  it("propagates through a multi-level BOM in dependency order (RAW_MATERIAL -> SEMI_FINISHED -> FINISHED) within one run", async () => {
    const db = createDb(env.DB);
    const flour = await seedItem(db, "RAW_MATERIAL", 12);
    const masa = await seedItem(db, "SEMI_FINISHED"); // starts at 0 — must refresh BEFORE pan reads it
    const pan = await seedItem(db, "FINISHED");
    await seedDefaultRecipe(db, masa.id, 1000, [{ itemId: flour.id, qty: 500 }]);
    await seedDefaultRecipe(db, pan.id, 500, [{ itemId: masa.id, qty: 500 }]);

    const plan = await planReplacementCostRefresh(db, "MANUAL");
    expect(plan.refreshedItemIds.indexOf(masa.id)).toBeLessThan(
      plan.refreshedItemIds.indexOf(pan.id),
    );

    await db.batch(plan.statements as [Statement, ...Statement[]]);

    const updatedMasa = await readItem(db, masa.id);
    const updatedPan = await readItem(db, pan.id);
    // masa: 500*12/1000 = 6. pan: 500*6/500 = 6 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â uses masa's FRESHLY computed value, not its
    // stale pre-run 0, which is exactly what the dependency-order requirement above proves.
    expect(updatedMasa.replacementCostMc).toBe(6);
    expect(updatedPan.replacementCostMc).toBe(6);
  });

  it("skips an active SEMI_FINISHED/FINISHED item with no active default recipe, leaving replacement_cost_mc untouched", async () => {
    const db = createDb(env.DB);
    const orphan = await seedItem(db, "FINISHED", 999);

    const plan = await planReplacementCostRefresh(db, "MANUAL");
    expect(plan.skippedItemIds).toContain(orphan.id);
    expect(plan.refreshedItemIds).not.toContain(orphan.id);

    const row = await readItem(db, orphan.id);
    expect(row.replacementCostMc).toBe(999);
  });

  it("never refreshes RAW_MATERIAL items — C-3's other branch (last purchase unit cost) owns them", async () => {
    const db = createDb(env.DB);
    const flour = await seedItem(db, "RAW_MATERIAL", 12);

    const plan = await planReplacementCostRefresh(db, "MANUAL");
    expect(plan.refreshedItemIds).not.toContain(flour.id);
    expect(plan.skippedItemIds).not.toContain(flour.id);
  });
});

describe("planReplacementCostRefresh (C-3d, presentations and combos)", () => {
  it("refreshes Desayuno Kokoro to Bs 44,50 and feeds the below-30% margin alert", async () => {
    const db = createDb(env.DB);
    const components = [
      await seedItem(db, "FINISHED", 14_500_000),
      await seedItem(db, "FINISHED", 19_500_000),
      await seedItem(db, "FINISHED", 6_200_000),
      await seedItem(db, "PACKAGING", 4_300_000),
    ];
    const output = await seedItem(db, "FINISHED");
    await db.update(items).set({ salePriceMc: 60_000_000 }).where(eq(items.id, output.id));
    await seedDefaultAssemblyDefinition(
      db,
      output.id,
      1000,
      components.map((component) => ({ itemId: component.id, qty: 1000 })),
    );

    const plan = await planReplacementCostRefresh(db, "MANUAL");
    await db.batch(plan.statements as [Statement, ...Statement[]]);

    const updated = await readItem(db, output.id);
    expect(updated.replacementCostMc).toBe(44_500_000);
    const replacementCostPerUnit = totalCentavos(
      toMilliCentavosPerUnit(updated.replacementCostMc),
      WHOLE_UNIT_MILLI_UNITS,
    );
    const margin = computeAssemblyMargin(
      toMilliCentavosPerUnit(updated.salePriceMc ?? 0),
      replacementCostPerUnit,
    );
    expect(margin).toEqual({ amount: 15_500, pctBasisPoints: 2583 });
    const minMarginSetting = await db.query.appSettings.findFirst({
      where: (table, { eq: eqOp }) => eqOp(table.key, "min_margin_pct"),
    });
    expect(Number(minMarginSetting?.value)).toBe(3000);
    expect((margin?.pctBasisPoints ?? 0) < Number(minMarginSetting?.value)).toBe(true);
  });

  it("uses the assembly definition when an output also has a default recipe", async () => {
    const db = createDb(env.DB);
    const recipeIngredient = await seedItem(db, "RAW_MATERIAL", 2_000_000);
    const assemblyComponent = await seedItem(db, "PACKAGING", 9_000_000);
    const output = await seedItem(db, "FINISHED");
    await seedDefaultRecipe(db, output.id, 1000, [{ itemId: recipeIngredient.id, qty: 1000 }]);
    await seedDefaultAssemblyDefinition(db, output.id, 1000, [
      { itemId: assemblyComponent.id, qty: 1000 },
    ]);

    const plan = await planReplacementCostRefresh(db, "MANUAL");
    await db.batch(plan.statements as [Statement, ...Statement[]]);

    expect((await readItem(db, output.id)).replacementCostMc).toBe(9_000_000);
  });

  it("refreshes a presentation before a combo and uses the presentation's fresh cost", async () => {
    const db = createDb(env.DB);
    const component = await seedItem(db, "PACKAGING", 7_000_000);
    const presentation = await seedItem(db, "FINISHED", 1_000_000);
    const combo = await seedItem(db, "FINISHED");
    await seedDefaultAssemblyDefinition(db, presentation.id, 1000, [
      { itemId: component.id, qty: 1000 },
    ]);
    await seedDefaultAssemblyDefinition(db, combo.id, 1000, [
      { itemId: presentation.id, qty: 2000 },
    ]);

    const plan = await planReplacementCostRefresh(db, "MANUAL");
    expect(plan.refreshedItemIds.indexOf(presentation.id)).toBeLessThan(
      plan.refreshedItemIds.indexOf(combo.id),
    );
    await db.batch(plan.statements as [Statement, ...Statement[]]);

    expect((await readItem(db, presentation.id)).replacementCostMc).toBe(7_000_000);
    expect((await readItem(db, combo.id)).replacementCostMc).toBe(14_000_000);
  });
});

describe("runReplacementCostRefresh (the nightly Cron Trigger job)", () => {
  it("writes an ok=1 job_runs row reporting refreshed/skipped counts on success", async () => {
    const db = createDb(env.DB);
    const flour = await seedItem(db, "RAW_MATERIAL", 10);
    const masa = await seedItem(db, "SEMI_FINISHED");
    await seedDefaultRecipe(db, masa.id, 1000, [{ itemId: flour.id, qty: 1000 }]);

    await runReplacementCostRefresh(db);

    const run = await db.query.jobRuns.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.job, "replacement-cost-refresh"),
    });
    expect(run?.ok).toBe(1);
    const detail = JSON.parse(run?.detail ?? "{}") as {
      refreshedCount: number;
      refreshedItemIds: string[];
    };
    expect(detail.refreshedCount).toBeGreaterThanOrEqual(1);
    expect(detail.refreshedItemIds).toContain(masa.id);

    const updated = await readItem(db, masa.id);
    expect(updated.replacementCostMc).toBe(10);
    const observations = await db.query.replacementCostHistory.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, masa.id),
    });
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      replacementCostMc: 10,
      observedAt: updated.replacementCostUpdatedAt,
      source: "NIGHTLY",
    });

    await runReplacementCostRefresh(db);
    expect(
      await db.query.replacementCostHistory.findMany({
        where: (t, { eq: eqOp }) => eqOp(t.itemId, masa.id),
      }),
    ).toHaveLength(1);
  });

  it("writes an ok=0 job_runs row instead of throwing when the recipe book has a cycle", async () => {
    const db = createDb(env.DB);
    const x = await seedItem(db, "SEMI_FINISHED");
    const y = await seedItem(db, "SEMI_FINISHED");
    // x's default recipe consumes y, and y's default recipe consumes x ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â a cycle the recipe rules
    // (Doc 03 Ãƒâ€šÃ‚Â§4) forbid in principle but nothing in the schema itself prevents.
    await seedDefaultRecipe(db, x.id, 1000, [{ itemId: y.id, qty: 500 }]);
    await seedDefaultRecipe(db, y.id, 1000, [{ itemId: x.id, qty: 500 }]);

    await runReplacementCostRefresh(db);

    const run = await db.query.jobRuns.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.job, "replacement-cost-refresh"),
    });
    expect(run?.ok).toBe(0);
    expect(run?.detail).toContain("ciclo");
  });
});
