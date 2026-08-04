// Integration tests for core/production (KOK-026, Doc 03 UC-02). Follows the same Doc 11 §3
// template as test/purchasing.test.ts: seed -> execute command -> assert event rows + kardex +
// WAC + audit_log + atomicity, run against real D1 via @cloudflare/vitest-pool-workers
// (test/setup.ts applies migrations/0001_init.sql first).
//
// The R-5 backdated-conflict scenario below deliberately reuses purchasing.test.ts's exact,
// hand-verified numbers (P1 10 000 @ 2 -> exit 8 000 -> P2 10 000 @ 4 -> backdated 10 000 @ 10,
// costDelta -32 000): core/costing/wac.ts treats PURCHASE_IN and PRODUCTION_IN identically
// (`WAC_ENTRY_TYPES`), so the same kardex math applies verbatim with the OUTPUT item of a
// production run standing in for a purchased item. To decouple "which unit cost the run books"
// from "what a consumption item's own WAC happens to be", these runs consume a throwaway item
// (`itemX`) that is NEVER purchased (wac stays 0 by default) at a fixed qty, and use `indirectCost`
// to dial in the exact totalCost/outputUnitCost the scenario needs — direct cost is always 0 for
// these particular runs, so `totalCost = indirectCost` exactly.
//
// Storage is isolated per test FILE, not per test — the `beforeEach` below restores the guarantee
// this file's tests were written against.
import { env } from "cloudflare:test";
import { addMoney, toMilliCentavosPerUnit, toMilliUnits, totalCentavos } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";

import { createItem, updateItem } from "../src/core/catalog/index.js";
import { recordExit } from "../src/core/inventory/exits.js";
import {
  computeProductionCosts,
  deleteProductionRun,
  getProductionRun,
  listProductionRuns,
  previewProductionRunImpact,
  recordProductionRun,
  restoreProductionRun,
  updateProductionRun,
} from "../src/core/production/index.js";
import { recordPurchase } from "../src/core/purchasing/index.js";
import { recordRecipe, setRecipeActive } from "../src/core/recipes/index.js";
import { createDb } from "../src/db/index.js";
import {
  auditLog,
  costingAdjustments,
  financialTransactions,
  productionRuns,
  stockMovements,
} from "../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;
const NOW = "2026-07-16T10:00:00.000Z";
const BUSINESS_DATE = "2026-07-16";

type TestDb = ReturnType<typeof createDb>;

async function seedItem(
  db: TestDb,
  name: string,
  kind: "RAW_MATERIAL" | "SEMI_FINISHED" | "FINISHED" = "RAW_MATERIAL",
) {
  return createItem(db, { name, kind, category: "INGREDIENT", unit: "KG" }, ACTOR);
}

async function seedRecipe(
  db: TestDb,
  outputItemId: string,
  lines: { itemId: string; qty: number }[],
  expectedYieldQty = 1000,
) {
  const { recipe } = await recordRecipe(
    db,
    { name: `Recipe for ${outputItemId}`, outputItemId, expectedYieldQty, lines },
    ACTOR,
  );
  return recipe;
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(auditLog).where(eq(auditLog.entityType, "production_runs"));
  await db.delete(stockMovements).where(eq(stockMovements.sourceEventType, "production_run"));
  // Cascades to production_consumptions (onDelete: cascade FK, schema.ts).
  await db.delete(productionRuns);
});

async function runMovements(db: TestDb, runId: string) {
  return db.query.stockMovements.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, runId),
  });
}

async function runConsumptions(db: TestDb, runId: string) {
  return db.query.productionConsumptions.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.productionRunId, runId),
  });
}

describe("recordProductionRun (UC-02)", () => {
  it("records a run: N PRODUCTION_OUT + 1 PRODUCTION_IN movements, C-4 direct/total/output costs, C-1 output WAC, unchanged consumption WAC, no financial_transactions, audit_log", async () => {
    const db = createDb(env.DB);
    const itemA = await seedItem(db, "Production A — harina");
    const itemB = await seedItem(db, "Production B — azucar");
    const output = await seedItem(db, "Production output — masa", "SEMI_FINISHED");

    // Give itemA/itemB known WACs via ordinary purchases (already-proven path).
    const { recordPurchase } = await import("../src/core/purchasing/index.js");
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: itemA.id, qty: 1000, lineTotal: 500_000 }], // unit cost 500
      },
      ACTOR,
    );
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: itemB.id, qty: 1000, lineTotal: 300_000 }], // unit cost 300
      },
      ACTOR,
    );

    const recipe = await seedRecipe(db, output.id, [
      { itemId: itemA.id, qty: 200 },
      { itemId: itemB.id, qty: 100 },
    ]);

    const result = await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        batches: 1,
        actualOutputQty: 1000,
        indirectCost: 150,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [
          { itemId: itemA.id, qty: 200 },
          { itemId: itemB.id, qty: 100 },
        ],
      },
      ACTOR,
    );

    // C-4: direct = 200*500 + 100*300 = 130000; total = 130150; outputUnitCostMc =
    // rateFromTotal(130150, 1000) = round(130150 * 1e6/1000) = 130150000 (exact).
    expect(result.productionRun.directCost).toBe(130_000);
    expect(result.productionRun.totalCost).toBe(130_150);
    expect(result.productionRun.outputUnitCostMc).toBe(130_150_000);
    expect(result.productionRun.outputItemId).toBe(output.id);
    expect(result.productionRun.allocatedSessionCost).toBe(0);
    expect(result.productionRun.lines).toHaveLength(2);

    const movements = await runMovements(db, result.productionRun.id);
    expect(movements).toHaveLength(3);
    const outMovements = movements.filter((m) => m.type === "PRODUCTION_OUT");
    const inMovements = movements.filter((m) => m.type === "PRODUCTION_IN");
    expect(outMovements).toHaveLength(2);
    expect(inMovements).toHaveLength(1);

    const movementA = outMovements.find((m) => m.itemId === itemA.id);
    const movementB = outMovements.find((m) => m.itemId === itemB.id);
    expect(movementA).toMatchObject({ qty: -200, unitCostMc: 500_000_000 });
    expect(movementB).toMatchObject({ qty: -100, unitCostMc: 300_000_000 });
    // outputUnitCostMc = rateFromTotal(totalCost, actualOutputQty) = round(130150 * 1e6/1000) =
    // 130150000 exactly — same convention as items.wac_mc.
    expect(inMovements[0]).toMatchObject({ itemId: output.id, qty: 1000, unitCostMc: 130_150_000 });

    // C-1: output item is a brand-new WAC seed (onHand=0, wac=0) -> first entry yields exactly the
    // entry's own unit cost.
    const outputItemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, output.id),
    });
    expect(outputItemRow?.wacMc).toBe(130_150_000);

    // C-6: consumption items' WAC is UNCHANGED by this run.
    const itemARow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, itemA.id),
    });
    const itemBRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, itemB.id),
    });
    expect(itemARow?.wacMc).toBe(500_000_000);
    expect(itemBRow?.wacMc).toBe(300_000_000);

    // item_stock: output +1000, consumption items netted down.
    const outputStock = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, output.id),
    });
    expect(outputStock?.qtyOnHand).toBe(1000);
    const stockA = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, itemA.id),
    });
    expect(stockA?.qtyOnHand).toBe(800); // 1000 purchased - 200 consumed

    // production_consumptions persisted with the frozen snapshot.
    const consumptions = await runConsumptions(db, result.productionRun.id);
    expect(consumptions).toHaveLength(2);
    expect(consumptions.find((c) => c.itemId === itemA.id)).toMatchObject({
      qty: 200,
      unitCostSnapshotMc: 500_000_000,
    });

    // C-6 / this module's header: NEVER a financial_transactions row for this vertical.
    const txRows = await db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.sourceEventType, "production_run"));
    expect(txRows).toHaveLength(0);

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, result.productionRun.id), eqOp(t.action, "create")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "production_runs" });
  });

  it("prices an unmetered consumption from replacement cost and emits no PRODUCTION_OUT movement", async () => {
    const db = createDb(env.DB);
    const unmetered = await seedItem(db, "Agua no medible para producción");
    const output = await seedItem(db, "Producto con agua no medible", "SEMI_FINISHED");

    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: unmetered.id, qty: 1000, lineTotal: 500_000 }],
      },
      ACTOR,
    );
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: unmetered.id, qty: 1000, lineTotal: 300_000 }],
      },
      ACTOR,
    );
    await updateItem(db, { id: unmetered.id, isUnmetered: true }, ACTOR);

    const recipe = await seedRecipe(db, output.id, [{ itemId: unmetered.id, qty: 100 }]);
    const result = await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        batches: 1,
        actualOutputQty: 1000,
        lines: [{ itemId: unmetered.id, qty: 100 }],
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
      },
      ACTOR,
    );

    const storedItem = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, unmetered.id),
    });
    expect(storedItem).toMatchObject({ wacMc: 400_000_000, replacementCostMc: 300_000_000 });

    const consumption = (await runConsumptions(db, result.productionRun.id))[0];
    expect(consumption).toMatchObject({
      itemId: unmetered.id,
      unitCostSnapshotMc: 300_000_000,
    });
    expect(result.productionRun.directCost).toBe(
      totalCentavos(toMilliCentavosPerUnit(300_000_000), toMilliUnits(100)),
    );

    const movements = await runMovements(db, result.productionRun.id);
    expect(movements.filter((movement) => movement.type === "PRODUCTION_OUT")).toHaveLength(0);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      type: "PRODUCTION_IN",
      itemId: output.id,
      qty: 1000,
    });
  });

  it("keeps C-4 direct cost equal to every integer qty × selected WAC/replacement rate", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            qty: fc.integer({ min: 1, max: 1_000_000 }),
            wacMc: fc.integer({ min: 0, max: 10_000_000 }),
            replacementCostMc: fc.integer({ min: 0, max: 10_000_000 }),
            isUnmetered: fc.boolean(),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (lines) => {
          const consumptions = lines.map((line) => ({
            qty: line.qty,
            unitCostSnapshotMc: toMilliCentavosPerUnit(
              line.isUnmetered ? line.replacementCostMc : line.wacMc,
            ),
          }));
          const expectedDirectCost = addMoney(
            ...consumptions.map((line) =>
              totalCentavos(line.unitCostSnapshotMc, toMilliUnits(line.qty)),
            ),
          );
          const costs = computeProductionCosts(consumptions, 0, 0, 1_000_000);

          expect(costs.directCost).toBe(expectedDirectCost);
          expect(Number.isSafeInteger(costs.directCost)).toBe(true);
          expect(Number.isSafeInteger(costs.totalCost)).toBe(true);
          expect(Number.isSafeInteger(costs.outputUnitCostMc)).toBe(true);
        },
      ),
    );
  });

  it("rejects a consumption line referencing a FINISHED item with VALIDATION", async () => {
    const db = createDb(env.DB);
    const finishedItem = await seedItem(db, "Production — producto terminado", "FINISHED");
    const output = await seedItem(db, "Production output — reject finished", "SEMI_FINISHED");
    const rawItem = await seedItem(db, "Production raw — reject finished");
    const recipe = await seedRecipe(db, output.id, [{ itemId: rawItem.id, qty: 100 }]);

    await expect(
      recordProductionRun(
        db,
        {
          recipeId: recipe.id,
          batches: 1,
          actualOutputQty: 500,
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [{ itemId: finishedItem.id, qty: 100 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects a nonexistent recipe with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    const rawItem = await seedItem(db, "Production raw — recipe not found");

    await expect(
      recordProductionRun(
        db,
        {
          recipeId: "does_not_exist",
          batches: 1,
          actualOutputQty: 500,
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [{ itemId: rawItem.id, qty: 100 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an INACTIVE recipe with VALIDATION", async () => {
    const db = createDb(env.DB);
    const output = await seedItem(db, "Production output — recipe inactive", "SEMI_FINISHED");
    const rawItem = await seedItem(db, "Production raw — recipe inactive");
    const recipe = await seedRecipe(db, output.id, [{ itemId: rawItem.id, qty: 100 }]);
    await setRecipeActive(db, { id: recipe.id, isActive: false }, ACTOR);

    await expect(
      recordProductionRun(
        db,
        {
          recipeId: recipe.id,
          batches: 1,
          actualOutputQty: 500,
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [{ itemId: rawItem.id, qty: 100 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects an empty lines array with VALIDATION (defensive re-check, D-2)", async () => {
    const db = createDb(env.DB);
    const output = await seedItem(db, "Production output — empty lines", "SEMI_FINISHED");
    const rawItem = await seedItem(db, "Production raw — empty lines");
    const recipe = await seedRecipe(db, output.id, [{ itemId: rawItem.id, qty: 100 }]);

    await expect(
      recordProductionRun(
        db,
        {
          recipeId: recipe.id,
          batches: 1,
          actualOutputQty: 500,
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

// ---------------------------------------------------------------------------
// Hand-calculated golden-number fixture (Doc 11 §6 P2 gate: "C-3/C-4 verified against a
// hand-calculated spreadsheet fixture, golden numbers checked into repo").
//
// Scenario: item A, WAC 500 centavos/g, qty 200g consumed. Item B, WAC 300 centavos/g, qty 100g
// consumed. indirectCost 150 centavos. actualOutputQty 1000g.
//   direct = 200*500 + 100*300 = 100000 + 30000 = 130000
//   total  = direct + indirectCost = 130000 + 150 = 130150
//   outputUnitCostMc (ADR-017) = rateFromTotal(130150, 1000) = round(130150 * 1e6/1000)
//     = 130150000 exactly — same milli-centavos-per-WHOLE-unit convention as items.wac_mc.
// Asserted EXACTLY, no tolerance (INV-6: money is exact integer centavos).
// ---------------------------------------------------------------------------
describe("golden-number fixture: C-4 direct/total/output cost", () => {
  it("produces the exact hand-calculated integers", async () => {
    const db = createDb(env.DB);
    const { recordPurchase } = await import("../src/core/purchasing/index.js");
    const itemA = await seedItem(db, "Golden A");
    const itemB = await seedItem(db, "Golden B");
    const output = await seedItem(db, "Golden output", "SEMI_FINISHED");

    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: itemA.id, qty: 1000, lineTotal: 500_000 }], // unit cost 500
      },
      ACTOR,
    );
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: itemB.id, qty: 1000, lineTotal: 300_000 }], // unit cost 300
      },
      ACTOR,
    );

    const recipe = await seedRecipe(db, output.id, [
      { itemId: itemA.id, qty: 200 },
      { itemId: itemB.id, qty: 100 },
    ]);

    const result = await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        batches: 1,
        actualOutputQty: 1000,
        indirectCost: 150,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [
          { itemId: itemA.id, qty: 200 },
          { itemId: itemB.id, qty: 100 },
        ],
      },
      ACTOR,
    );

    expect(result.productionRun.directCost).toBe(130_000);
    expect(result.productionRun.totalCost).toBe(130_150);
    expect(result.productionRun.outputUnitCostMc).toBe(130_150_000);

    const outMovement = (await runMovements(db, result.productionRun.id)).find(
      (m) => m.type === "PRODUCTION_IN",
    );
    expect(outMovement?.unitCostMc).toBe(130_150_000);
  });
});

describe("batch atomicity (INV-1)", () => {
  it("a failing statement in the same shape of batch as recordProductionRun leaves nothing persisted", async () => {
    const db = createDb(env.DB);
    const rawItem = await seedItem(db, "Production atomicity item");

    // Mirrors the statement shape recordProductionRun() builds (run insert + a
    // production_consumptions insert), but the consumption row violates
    // production_consumptions_qty_check (qty must be > 0) — run as a raw D1 batch (not through
    // recordProductionRun, whose own defensive checks would reject qty<=0 before ever reaching
    // db.batch) to prove the run insert ahead of it never lands either.
    await expect(
      env.DB.batch([
        env.DB.prepare(
          `INSERT INTO production_runs (id, occurred_at, business_date, recipe_id, batches, output_item_id, actual_output_qty, created_at, updated_at)
           VALUES ('run_atomicity_test', ?, ?, 'does_not_matter', 1, ?, 500, ?, ?)`,
        ).bind(NOW, BUSINESS_DATE, rawItem.id, NOW, NOW),
        env.DB.prepare(
          `INSERT INTO production_consumptions (id, production_run_id, item_id, qty, unit_cost_snapshot_mc)
           VALUES ('consumption_atomicity_test', 'run_atomicity_test', ?, 0, 1)`,
        ).bind(rawItem.id),
      ]),
    ).rejects.toThrow();

    const runRow = await env.DB.prepare(
      "SELECT id FROM production_runs WHERE id = 'run_atomicity_test'",
    ).first();
    expect(runRow).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R-5 backdated-create conflict (mirrors purchasing.test.ts's canonical scenario exactly — see
// this file's header for why the numbers are identical).
// ---------------------------------------------------------------------------
describe("recordProductionRun — backdated capture: INV-11 replay guard (R-2/R-5, ADR-016)", () => {
  async function seedScenario(db: TestDb, namePrefix: string) {
    const itemX = await seedItem(db, `${namePrefix} — insumo neutro`);
    const output = await seedItem(db, `${namePrefix} — salida`, "SEMI_FINISHED");
    const recipe = await seedRecipe(db, output.id, [{ itemId: itemX.id, qty: 1 }], 10_000);

    const pr1 = await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        batches: 1,
        actualOutputQty: 10_000,
        indirectCost: 20_000, // direct=0 (itemX wac=0) -> total=20000 -> unit cost 2
        occurredAt: "2026-07-10T10:00:00.000Z",
        businessDate: "2026-07-10",
        lines: [{ itemId: itemX.id, qty: 1 }],
      },
      ACTOR,
    );
    const exit = await recordExit(
      db,
      {
        itemId: output.id,
        qty: 8_000,
        reason: "WASTE",
        occurredAt: "2026-07-11T10:00:00.000Z",
        businessDate: "2026-07-11",
      },
      ACTOR,
    );
    await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        batches: 1,
        actualOutputQty: 10_000,
        indirectCost: 40_000, // unit cost 4
        occurredAt: "2026-07-12T10:00:00.000Z",
        businessDate: "2026-07-12",
        lines: [{ itemId: itemX.id, qty: 1 }],
      },
      ACTOR,
    );

    return { itemX, output, recipe, pr1, exit };
  }

  it("refuses a backdated production run landing behind an existing exit without `confirm`, carrying the impact that matches previewProductionRunImpact", async () => {
    const db = createDb(env.DB);
    const { itemX, output, recipe, exit } = await seedScenario(db, "Backdated refused");

    const command = {
      recipeId: recipe.id,
      batches: 1,
      actualOutputQty: 10_000,
      indirectCost: 100_000, // unit cost 10
      occurredAt: "2026-07-10T12:00:00.000Z",
      businessDate: "2026-07-10",
      lines: [{ itemId: itemX.id, qty: 1 }],
    };

    const preview = await previewProductionRunImpact(db, { op: "create", command });
    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.costDelta).toBe(-32_000);
    expect(preview.affectedItemIds).toEqual([output.id]);
    expect(preview.affectedStockExitIds).toEqual([exit.exit.id]);

    await expect(recordProductionRun(db, command, ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
      details: {
        reason: "REPLAY_CONFIRMATION_REQUIRED",
        impact: {
          costDelta: -32_000,
          requiresConfirmation: true,
          affectedItemIds: [output.id],
          affectedStockExitIds: [exit.exit.id],
        },
      },
    });

    // Thrown BEFORE db.batch: nothing about the refused run exists.
    const movementRows = await db.query.stockMovements.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, output.id),
    });
    expect(movementRows).toHaveLength(3); // PR1 + exit + PR2 only
  });

  it("commits the same backdated run with `confirm: true`, landing the FULL-KARDEX WAC and booking the correction forward (R-4), matching the preview", async () => {
    const db = createDb(env.DB);
    const { itemX, output, recipe, exit } = await seedScenario(db, "Backdated confirmed");

    const command = {
      recipeId: recipe.id,
      batches: 1,
      actualOutputQty: 10_000,
      indirectCost: 100_000,
      occurredAt: "2026-07-10T12:00:00.000Z",
      businessDate: "2026-07-10",
      lines: [{ itemId: itemX.id, qty: 1 }],
    };

    const preview = await previewProductionRunImpact(db, { op: "create", command });

    const result = await recordProductionRun(db, { ...command, confirm: true }, ACTOR);

    expect(result.productionRun.totalCost).toBe(100_000);

    const outputRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, output.id),
    });
    // (12000·6 000 000 + 10000·4 000 000)/22000 = 112 000 000 000/22 000 = 5 090 909.0909… ->
    // roundHalfUpToInt -> 5 090 909 (same arithmetic as purchasing.test.ts's identical scenario).
    expect(outputRow?.wacMc).toBe(5_090_909);

    const adjustments = await db
      .select()
      .from(costingAdjustments)
      .where(eq(costingAdjustments.itemId, output.id));
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({
      itemId: output.id,
      triggerEventType: "production_run",
      triggerEventId: result.productionRun.id,
      costDelta: preview.costDelta,
    });
    expect(adjustments[0]?.costDelta).toBe(-32_000);

    // R-4: the exit's own frozen snapshot survives, unrewritten.
    const exitRow = await db.query.stockExits.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, exit.exit.id),
    });
    expect(exitRow?.unitCostSnapshotMc).toBe(2_000_000);
  });
});

describe("reads: getProductionRun / listProductionRuns", () => {
  it("getProductionRun returns the run with its lines; NOT_FOUND for a missing id", async () => {
    const db = createDb(env.DB);
    const rawItem = await seedItem(db, "Read production item");
    const output = await seedItem(db, "Read production output", "SEMI_FINISHED");
    const recipe = await seedRecipe(db, output.id, [{ itemId: rawItem.id, qty: 100 }]);

    const result = await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        batches: 1,
        actualOutputQty: 500,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: rawItem.id, qty: 100 }],
      },
      ACTOR,
    );

    const fetched = await getProductionRun(db, result.productionRun.id);
    expect(fetched.id).toBe(result.productionRun.id);
    expect(fetched.lines).toHaveLength(1);

    await expect(getProductionRun(db, "does_not_exist")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("listProductionRuns filters by recipeId and orders businessDate/createdAt desc", async () => {
    const db = createDb(env.DB);
    const rawItem = await seedItem(db, "List production item");
    const output = await seedItem(db, "List production output", "SEMI_FINISHED");
    const recipe = await seedRecipe(db, output.id, [{ itemId: rawItem.id, qty: 100 }]);
    // A DIFFERENT consumption item for the other recipe (not `rawItem`) — two runs sharing a
    // consumption item recorded out of temporal order legitimately trips R-2/R-5 (any reordering
    // around a shared item's kardex flags every production run whose consumption movement lands in
    // the disturbed suffix, core/costing/replay.ts's own conservative rule), which is not what this
    // read-path test is about.
    const otherRawItem = await seedItem(db, "List production other item");
    const otherOutput = await seedItem(db, "List production other output", "SEMI_FINISHED");
    const otherRecipe = await seedRecipe(db, otherOutput.id, [
      { itemId: otherRawItem.id, qty: 50 },
    ]);

    await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        batches: 1,
        actualOutputQty: 500,
        occurredAt: "2026-07-14T10:00:00.000Z",
        businessDate: "2026-07-14",
        lines: [{ itemId: rawItem.id, qty: 100 }],
      },
      ACTOR,
    );
    await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        batches: 1,
        actualOutputQty: 500,
        occurredAt: "2026-07-16T10:00:00.000Z",
        businessDate: "2026-07-16",
        lines: [{ itemId: rawItem.id, qty: 100 }],
      },
      ACTOR,
    );
    await recordProductionRun(
      db,
      {
        recipeId: otherRecipe.id,
        batches: 1,
        actualOutputQty: 250,
        occurredAt: "2026-07-15T10:00:00.000Z",
        businessDate: "2026-07-15",
        lines: [{ itemId: otherRawItem.id, qty: 50 }],
      },
      ACTOR,
    );

    const { productionRuns: runs } = await listProductionRuns(db, { recipeId: recipe.id });
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.businessDate)).toEqual(["2026-07-16", "2026-07-14"]);
    expect(runs.every((r) => r.recipeId === recipe.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateProductionRun / deleteProductionRun / restoreProductionRun (R-1/R-3/R-5, INV-8/9/10, D-8).
// Mirrors purchasing.test.ts's identical section, minus the cash-side assertions.
// ---------------------------------------------------------------------------
describe("updateProductionRun (R-1)", () => {
  it("descriptive-only edit (notes) leaves the kardex byte-identical, writes no items UPDATE, no costing_adjustments, needs no confirmation", async () => {
    const db = createDb(env.DB);
    const rawItem = await seedItem(db, "Update descriptive raw");
    const output = await seedItem(db, "Update descriptive output", "SEMI_FINISHED");
    const recipe = await seedRecipe(db, output.id, [{ itemId: rawItem.id, qty: 100 }]);

    const created = await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        batches: 1,
        actualOutputQty: 500,
        notes: "antes",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: rawItem.id, qty: 100 }],
      },
      ACTOR,
    );

    const outputBefore = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, output.id),
    });
    const movementsBefore = await runMovements(db, created.productionRun.id);
    const outputMovementIdBefore = movementsBefore.find((m) => m.type === "PRODUCTION_IN")?.id;

    const updated = await updateProductionRun(
      db,
      created.productionRun.id,
      {
        recipeId: recipe.id,
        batches: 1,
        actualOutputQty: 500,
        notes: "después",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: rawItem.id, qty: 100 }],
      },
      ACTOR,
    );

    expect(updated.productionRun.notes).toBe("después");

    const movementsAfter = await runMovements(db, created.productionRun.id);
    expect(movementsAfter).toHaveLength(2);
    expect(movementsAfter.find((m) => m.type === "PRODUCTION_IN")?.id).toBe(outputMovementIdBefore);

    const outputAfter = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, output.id),
    });
    expect(outputAfter?.wacMc).toBe(outputBefore?.wacMc);
    expect(outputAfter?.updatedAt).toBe(outputBefore?.updatedAt);

    expect(
      await db.select().from(costingAdjustments).where(eq(costingAdjustments.itemId, output.id)),
    ).toHaveLength(0);
    const replayAuditRow = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, created.productionRun.id), eqOp(t.action, "costing_replay")),
    });
    expect(replayAuditRow).toBeUndefined();
  });

  it("edit changing a line's qty with no downstream history recomputes direct/total cost and the output WAC automatically, no confirmation needed", async () => {
    const db = createDb(env.DB);
    const rawItem = await seedItem(db, "Update qty raw");
    const output = await seedItem(db, "Update qty output", "SEMI_FINISHED");
    const { recordPurchase } = await import("../src/core/purchasing/index.js");
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: rawItem.id, qty: 10_000, lineTotal: 10_000 }], // unit cost 1
      },
      ACTOR,
    );
    const recipe = await seedRecipe(db, output.id, [{ itemId: rawItem.id, qty: 100 }]);

    const created = await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        batches: 1,
        actualOutputQty: 500,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: rawItem.id, qty: 100 }], // direct = 100*1 = 100
      },
      ACTOR,
    );
    expect(created.productionRun.directCost).toBe(100);

    const updated = await updateProductionRun(
      db,
      created.productionRun.id,
      {
        recipeId: recipe.id,
        batches: 1,
        actualOutputQty: 500,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: rawItem.id, qty: 400 }], // same item -> KEEPS frozen snapshot (unit cost 1)
      },
      ACTOR,
    );
    // Snapshot preserved (same item) => direct = 400*1 = 400.
    expect(updated.productionRun.directCost).toBe(400);
    expect(updated.productionRun.totalCost).toBe(400);

    const movements = await runMovements(db, created.productionRun.id);
    const outMovement = movements.find((m) => m.type === "PRODUCTION_OUT");
    expect(outMovement).toMatchObject({ qty: -400, unitCostMc: 1_000_000 });

    const outputRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, output.id),
    });
    // total=400, actualOutputQty=500mu -> rateFromTotal(400,500) = round(400*1e6/500) = 800000
    // exactly, first-ever entry.
    expect(outputRow?.wacMc).toBe(800_000);

    expect(
      await db.select().from(costingAdjustments).where(eq(costingAdjustments.itemId, output.id)),
    ).toHaveLength(0);
  });

  it("rejects an unknown or already-deleted run with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    const rawItem = await seedItem(db, "Update not found raw");
    const output = await seedItem(db, "Update not found output", "SEMI_FINISHED");
    const recipe = await seedRecipe(db, output.id, [{ itemId: rawItem.id, qty: 100 }]);
    const command = {
      recipeId: recipe.id,
      batches: 1,
      actualOutputQty: 500,
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId: rawItem.id, qty: 100 }],
    };

    await expect(updateProductionRun(db, "does_not_exist", command, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const created = await recordProductionRun(db, command, ACTOR);
    await deleteProductionRun(db, created.productionRun.id, {}, ACTOR);
    await expect(
      updateProductionRun(db, created.productionRun.id, command, ACTOR),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("deleteProductionRun (R-3, D-8)", () => {
  it("delete of an untouched run reverses kardex/WAC as if it never existed, but production_consumptions survive (R-3)", async () => {
    const db = createDb(env.DB);
    const rawItem = await seedItem(db, "Delete production raw");
    const output = await seedItem(db, "Delete production output", "SEMI_FINISHED");
    const recipe = await seedRecipe(db, output.id, [{ itemId: rawItem.id, qty: 100 }]);

    const created = await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        batches: 1,
        actualOutputQty: 500,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: rawItem.id, qty: 100 }],
      },
      ACTOR,
    );

    await deleteProductionRun(db, created.productionRun.id, {}, ACTOR);

    const row = await db.query.productionRuns.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, created.productionRun.id),
    });
    expect(row?.deletedAt).not.toBeNull();

    // INV-9: kardex hard-deleted (D-8's carve-out).
    expect(await runMovements(db, created.productionRun.id)).toHaveLength(0);
    // production_consumptions are components of the event aggregate and survive (mirrors
    // purchase_lines).
    expect(await runConsumptions(db, created.productionRun.id)).toHaveLength(1);

    const outputStock = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, output.id),
    });
    expect(outputStock?.qtyOnHand).toBe(0);

    const outputRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, output.id),
    });
    expect(outputRow?.wacMc).toBe(0); // no kardex left to average

    await expect(getProductionRun(db, created.productionRun.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, created.productionRun.id), eqOp(t.action, "delete")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "production_runs" });
  });

  it("rejects an unknown or already-deleted run with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    const rawItem = await seedItem(db, "Delete not found raw");
    const output = await seedItem(db, "Delete not found output", "SEMI_FINISHED");
    const recipe = await seedRecipe(db, output.id, [{ itemId: rawItem.id, qty: 100 }]);
    const created = await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        batches: 1,
        actualOutputQty: 100,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: rawItem.id, qty: 10 }],
      },
      ACTOR,
    );

    await expect(deleteProductionRun(db, "does_not_exist", {}, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    await deleteProductionRun(db, created.productionRun.id, {}, ACTOR);
    await expect(
      deleteProductionRun(db, created.productionRun.id, {}, ACTOR),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("restoreProductionRun (Doc 06 principle 6 — 'Deshacer')", () => {
  it("restores a run that touched nothing downstream: kardex/WAC come back exactly as they were, audit row carries action 'restore'", async () => {
    const db = createDb(env.DB);
    const rawItem = await seedItem(db, "Restore production raw");
    const output = await seedItem(db, "Restore production output", "SEMI_FINISHED");
    const recipe = await seedRecipe(db, output.id, [{ itemId: rawItem.id, qty: 100 }]);

    const created = await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        batches: 1,
        actualOutputQty: 500,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: rawItem.id, qty: 100 }],
      },
      ACTOR,
    );

    await deleteProductionRun(db, created.productionRun.id, {}, ACTOR);
    const outputAfterDelete = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, output.id),
    });
    expect(outputAfterDelete?.wacMc).toBe(0);

    const restored = await restoreProductionRun(db, created.productionRun.id, {}, ACTOR);

    expect(restored.productionRun.id).toBe(created.productionRun.id);
    expect(restored.productionRun.totalCost).toBe(created.productionRun.totalCost);
    expect(restored.productionRun.lines).toEqual(created.productionRun.lines);

    const movementsAfter = await runMovements(db, created.productionRun.id);
    expect(movementsAfter).toHaveLength(2);
    const outMovement = movementsAfter.find((m) => m.type === "PRODUCTION_OUT");
    const inMovement = movementsAfter.find((m) => m.type === "PRODUCTION_IN");
    expect(outMovement).toMatchObject({ qty: -100 });
    expect(inMovement).toMatchObject({ qty: 500 });

    const outputRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, output.id),
    });
    // First-ever entry for a brand-new output item -> wacMc lands exactly on the run's own
    // outputUnitCostMc (both are rateFromTotal(totalCost, actualOutputQty)); comparing
    // against the pre-delete DTO value is also the "exactly as they were" claim this test makes.
    expect(outputRow?.wacMc).toBe(created.productionRun.outputUnitCostMc);

    const fetched = await getProductionRun(db, created.productionRun.id);
    expect(fetched.id).toBe(created.productionRun.id);

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, created.productionRun.id), eqOp(t.action, "restore")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "production_runs" });
  });

  it("rejects an id that does not exist or is not currently deleted with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    const rawItem = await seedItem(db, "Restore not found raw");
    const output = await seedItem(db, "Restore not found output", "SEMI_FINISHED");
    const recipe = await seedRecipe(db, output.id, [{ itemId: rawItem.id, qty: 100 }]);

    await expect(restoreProductionRun(db, "does_not_exist", {}, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const created = await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        batches: 1,
        actualOutputQty: 100,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: rawItem.id, qty: 10 }],
      },
      ACTOR,
    );

    await expect(
      restoreProductionRun(db, created.productionRun.id, {}, ACTOR),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
