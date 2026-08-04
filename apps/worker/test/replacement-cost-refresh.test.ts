// Integration tests for core/costing's C-3 replacement-cost refresh (KOK-029, Doc 03 Ãƒâ€šÃ‚Â§4,
// Doc 11 Ãƒâ€šÃ‚Â§3 template): seed real state via core/ service factories (createItem, recordRecipe ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â
// the same seams recipes.test.ts uses), run planReplacementCostRefresh / runReplacementCostRefresh
// against real D1 (test/setup.ts applies migrations/0001_init.sql first), then assert
// items.replacement_cost_mc / replacement_cost_mc_updated_at, dependency order across a multi-level BOM,
// the no-default-recipe skip path, and the job's job_runs ok=1/ok=0 bookkeeping.
import { env } from "cloudflare:test";
import type { RecordRecipeCommand } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { beforeEach, describe, expect, it } from "vitest";

import { createItem } from "../src/core/catalog/index.js";
import { planReplacementCostRefresh } from "../src/core/costing/index.js";
import { recordRecipe } from "../src/core/recipes/index.js";
import { createDb } from "../src/db/index.js";
import { items, jobRuns, recipes } from "../src/db/schema.js";
import { runReplacementCostRefresh } from "../src/jobs/replacement-cost-refresh.js";

const ACTOR = "OWNER_WEB" as const;
type TestDb = ReturnType<typeof createDb>;
type Statement = BatchItem<"sqlite">;

async function seedItem(
  db: TestDb,
  kind: "RAW_MATERIAL" | "SEMI_FINISHED" | "FINISHED",
  replacementCostMc = 0,
) {
  const item = await createItem(
    db,
    { name: `Item ${crypto.randomUUID()}`, kind, category: "INGREDIENT", unit: "KG" },
    ACTOR,
  );
  if (replacementCostMc !== 0) {
    await db.update(items).set({ replacementCostMc }).where(eq(items.id, item.id));
  }
  return item;
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
  await db.delete(recipes); // cascades to recipe_lines (db/schema.ts's onDelete: "cascade")
});

describe("planReplacementCostRefresh (C-3, SEMI_FINISHED/FINISHED)", () => {
  it("computes a SEMI_FINISHED item from its default recipe's RAW_MATERIAL ingredients", async () => {
    const db = createDb(env.DB);
    const flour = await seedItem(db, "RAW_MATERIAL", 12); // 12 centavos/milli-unit
    const masa = await seedItem(db, "SEMI_FINISHED");
    await seedDefaultRecipe(db, masa.id, 1000, [{ itemId: flour.id, qty: 500 }]);

    const plan = await planReplacementCostRefresh(db);
    expect(plan.refreshedItemIds).toContain(masa.id);
    expect(plan.skippedItemIds).not.toContain(masa.id);

    await db.batch(plan.statements as [Statement, ...Statement[]]);

    const updated = await readItem(db, masa.id);
    // 500 * 12 / 1000 = 6 centavos/milli-unit.
    expect(updated.replacementCostMc).toBe(6);
    expect(updated.replacementCostUpdatedAt).not.toBeNull();
  });

  it("propagates through a multi-level BOM in dependency order (RAW_MATERIAL -> SEMI_FINISHED -> FINISHED) within one run", async () => {
    const db = createDb(env.DB);
    const flour = await seedItem(db, "RAW_MATERIAL", 12);
    const masa = await seedItem(db, "SEMI_FINISHED"); // starts at 0 — must refresh BEFORE pan reads it
    const pan = await seedItem(db, "FINISHED");
    await seedDefaultRecipe(db, masa.id, 1000, [{ itemId: flour.id, qty: 500 }]);
    await seedDefaultRecipe(db, pan.id, 500, [{ itemId: masa.id, qty: 500 }]);

    const plan = await planReplacementCostRefresh(db);
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

    const plan = await planReplacementCostRefresh(db);
    expect(plan.skippedItemIds).toContain(orphan.id);
    expect(plan.refreshedItemIds).not.toContain(orphan.id);

    const row = await readItem(db, orphan.id);
    expect(row.replacementCostMc).toBe(999);
  });

  it("never refreshes RAW_MATERIAL items — C-3's other branch (last purchase unit cost) owns them", async () => {
    const db = createDb(env.DB);
    const flour = await seedItem(db, "RAW_MATERIAL", 12);

    const plan = await planReplacementCostRefresh(db);
    expect(plan.refreshedItemIds).not.toContain(flour.id);
    expect(plan.skippedItemIds).not.toContain(flour.id);
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
