declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { eager: true; import: "default"; query: "?raw" },
    ): Record<string, string>;
  }
}

import { env } from "cloudflare:test";
import { toMilliCentavosPerUnit } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { validateAssemblyItemKinds } from "../src/core/assemblies/index.js";
import { computeAssemblyCost } from "../src/core/assembly-events/cost.js";
import { updateRecipe } from "../src/core/recipes/index.js";
import { createDb } from "../src/db/index.js";
import {
  assemblyDefinitionLines,
  assemblyDefinitions,
  items,
  recipeLines,
  recipes,
} from "../src/db/schema.js";

const fixtureModules = import.meta.glob("../src/db/seed-fixtures.sql", {
  eager: true,
  import: "default",
  query: "?raw",
});
const fixtureSql = fixtureModules["../src/db/seed-fixtures.sql"];

const ACTOR = "OWNER_WEB" as const;
const db = createDb(env.DB);

beforeAll(async () => {
  if (fixtureSql === undefined) throw new Error("The seed fixture SQL was not loaded");
  const statements = fixtureSql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
});

describe("seed fixtures", () => {
  it("passes every recipe and assembly-definition line through the domain validators", async () => {
    const recipeRows = await db.select().from(recipes);
    let validatedRecipeLineCount = 0;
    for (const recipe of recipeRows) {
      const lines = await db.select().from(recipeLines).where(eq(recipeLines.recipeId, recipe.id));
      validatedRecipeLineCount += lines.length;

      // updateRecipe invokes validateRecipeItemKinds before preparing its atomic batch. Exercising
      // the fixture through the public service keeps the private validator as an implementation detail.
      await updateRecipe(
        db,
        recipe.id,
        {
          name: recipe.name,
          outputItemId: recipe.outputItemId,
          expectedYieldQty: recipe.expectedYieldQty,
          estLaborMin: recipe.estLaborMin,
          isDefault: recipe.isDefault === 1,
          notes: recipe.notes,
          lines: lines.map((line) => ({ itemId: line.itemId, qty: line.qty })),
        },
        ACTOR,
      );
    }

    const definitionRows = await db.select().from(assemblyDefinitions);
    let validatedDefinitionLineCount = 0;
    const defaultsByOutput = new Map<string, number>();
    for (const definition of definitionRows) {
      const lines = await db
        .select()
        .from(assemblyDefinitionLines)
        .where(eq(assemblyDefinitionLines.definitionId, definition.id));
      validatedDefinitionLineCount += lines.length;
      await validateAssemblyItemKinds(db, definition.outputItemId, lines);

      if (definition.isActive === 1) {
        const defaultCount = defaultsByOutput.get(definition.outputItemId) ?? 0;
        defaultsByOutput.set(
          definition.outputItemId,
          defaultCount + (definition.isDefault === 1 ? 1 : 0),
        );
      }
    }

    expect(validatedRecipeLineCount).toBe((await db.select().from(recipeLines)).length);
    expect(validatedDefinitionLineCount).toBe(
      (await db.select().from(assemblyDefinitionLines)).length,
    );
    expect([...defaultsByOutput.values()].every((count) => count === 1)).toBe(true);
  });

  it("reproduces the Desayuno Kokoro worked-example unit costs", async () => {
    const itemRows = await db.select().from(items);
    const definitionRows = await db.select().from(assemblyDefinitions);
    const lineRows = await db.select().from(assemblyDefinitionLines);
    const itemWacById = new Map(itemRows.map((item) => [item.id, item.wacMc]));
    const defaultDefinitionByOutput = new Map(
      definitionRows
        .filter((definition) => definition.isActive === 1 && definition.isDefault === 1)
        .map((definition) => [definition.outputItemId, definition]),
    );

    const costByOutput = new Map<string, number>();
    const computeDefaultCost = (outputItemId: string, path: ReadonlySet<string>): number => {
      const cached = costByOutput.get(outputItemId);
      if (cached !== undefined) return cached;
      if (path.has(outputItemId))
        throw new Error(`Cycle in fixture definitions at ${outputItemId}`);

      const definition = defaultDefinitionByOutput.get(outputItemId);
      if (!definition) {
        const wacMc = itemWacById.get(outputItemId);
        if (wacMc === undefined) throw new Error(`Missing fixture item ${outputItemId}`);
        return wacMc;
      }

      const nextPath = new Set(path).add(outputItemId);
      const lines = lineRows.filter((line) => line.definitionId === definition.id);
      const result = computeAssemblyCost(
        lines.map((line) => ({
          qty: line.qty,
          unitCostSnapshotMc: toMilliCentavosPerUnit(computeDefaultCost(line.itemId, nextPath)),
        })),
        definition.outputQty,
      );
      costByOutput.set(outputItemId, result.outputUnitCostMc);
      return result.outputUnitCostMc;
    };

    expect(computeDefaultCost("item_pan_500g", new Set())).toBe(1_300_000);
    expect(computeDefaultCost("item_ghee_200g", new Set())).toBe(1_800_000);
    expect(computeDefaultCost("item_kefir_500ml", new Set())).toBe(570_000);
    expect(computeDefaultCost("item_desayuno_kokoro", new Set())).toBe(4_070_000);
  });
});
