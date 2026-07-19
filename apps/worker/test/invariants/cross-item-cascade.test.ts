// INVARIANT SUITE — KOK-024. R-2's recipe cascade: correcting a RAW MATERIAL's cost must move the
// WAC of the SEMI-FINISHED item produced from it, and the items must be replayed in dependency
// order (raw before semi) or the cascade silently computes nothing.
//
// GUARDRAIL (CLAUDE.md "Guardrails for AI Agents"): once merged, this directory is "fix code, not
// tests". A failure here means a service regressed, not that an assertion needs relaxing.
//
// ============================================================================================
// DOCUMENTED EXCEPTION TO D-2 — READ BEFORE COPYING THIS FILE'S PATTERN
// ============================================================================================
// CLAUDE.md D-2 says all writes go through `core/` services, and that "tests use service
// factories". This file writes `recipes`, `recipe_lines`, `production_runs`,
// `production_consumptions` and their PRODUCTION_OUT/PRODUCTION_IN `stock_movements` pair with
// DIRECT `db.insert` calls instead.
//
// That is a DELIBERATE, NARROW exception, not an oversight: the production services do not exist
// yet (KOK-026 is unshipped), so there is no factory to call. The alternative — leaving R-2's
// cascade untested until KOK-026 lands — is strictly worse, because the cascade is exactly the
// part the backlog rates 🧠5: a raw-material correction that fails to propagate leaves a
// semi-finished item's WAC quietly stale, and every margin computed from it wrong, with nothing
// that fails loudly.
//
// Scope of the exception:
//   - It covers ONLY the production/recipe fixtures below. Purchases and exits still go through
//     `recordPurchase` / `recordExit`, and the code UNDER TEST is always the real service.
//   - The hand-written rows reproduce exactly what KOK-026's service is specified to write
//     (Doc 03 C-4, Doc 04 §3.3): `direct = Σ(qty × unit_cost_snapshot)`,
//     `total = direct + indirect + allocated session cost`, `output unit cost = total / actual
//     output qty`. If KOK-026 writes something different, that is a spec disagreement to resolve
//     — not a licence to loosen these assertions.
//
// MIGRATE THIS WHEN KOK-026 SHIPS: replace `seedProductionRun` below with the real production
// service factory and delete this notice. Nothing else in the file should need to change; the
// assertions are about the replay, not about how the fixtures got there.
// ============================================================================================
import { env } from "cloudflare:test";
import { generateUuidV7 } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createItem } from "../../src/core/catalog/index.js";
import { planCostingReplay } from "../../src/core/costing/index.js";
import { recordPurchase } from "../../src/core/purchasing/index.js";
import { createDb } from "../../src/db/index.js";
import {
  auditLog,
  costingAdjustments,
  financialAccounts,
  financialTransactions,
  itemStock,
  items,
  productionConsumptions,
  productionRuns,
  purchases,
  recipeLines,
  recipes,
  stockExits,
  stockMovements,
} from "../../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;

type TestDb = ReturnType<typeof createDb>;

async function seedItem(db: TestDb, name: string, kind: "RAW_MATERIAL" | "SEMI_FINISHED") {
  return createItem(db, { name, kind, category: "INGREDIENT", unit: "KG" }, ACTOR);
}

/**
 * DIRECT-INSERT FIXTURE (see the D-2 exception notice in this file's header).
 *
 * Seeds one production run that consumed `consumedQty` of `rawItemId` at `consumedUnitCost` and
 * produced `outputQty` of `outputItemId`, together with the kardex pair the run would have written:
 * a PRODUCTION_OUT against the raw material and a PRODUCTION_IN against the output.
 *
 * The output's unit cost is C-4's rollup, computed here rather than passed in so the fixture can
 * never disagree with itself: `total / actualOutputQty` with `indirect` and `allocatedSessionCost`
 * both zero (deliberately — a non-zero overhead would add a constant to every expected number below
 * and obscure which part of the cascade a regression broke).
 */
async function seedProductionRun(
  db: TestDb,
  params: {
    recipeId: string;
    rawItemId: string;
    outputItemId: string;
    occurredAt: string;
    businessDate: string;
    consumedQty: number;
    consumedUnitCost: number;
    outputQty: number;
  },
): Promise<{ runId: string; outputUnitCost: number }> {
  const runId = generateUuidV7();
  const now = new Date().toISOString();
  const directCost = params.consumedQty * params.consumedUnitCost;
  const outputUnitCost = directCost / params.outputQty;

  await db.insert(productionRuns).values({
    id: runId,
    occurredAt: params.occurredAt,
    businessDate: params.businessDate,
    recipeId: params.recipeId,
    batches: 1,
    outputItemId: params.outputItemId,
    actualOutputQty: params.outputQty,
    indirectCost: 0,
    allocatedSessionCost: 0,
    directCost,
    totalCost: directCost,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(productionConsumptions).values({
    id: generateUuidV7(),
    productionRunId: runId,
    itemId: params.rawItemId,
    qty: params.consumedQty,
    unitCostSnapshot: params.consumedUnitCost,
  });

  // The kardex pair. Signs follow Doc 04 §3.4 (OUT negative, IN positive), matching what
  // core/inventory's `buildStockMovementStatements` would have enforced.
  await db.insert(stockMovements).values([
    {
      id: generateUuidV7(),
      occurredAt: params.occurredAt,
      businessDate: params.businessDate,
      itemId: params.rawItemId,
      type: "PRODUCTION_OUT",
      qty: -params.consumedQty,
      unitCost: params.consumedUnitCost,
      totalCost: -directCost,
      sourceEventType: "production_run",
      sourceEventId: runId,
      createdAt: now,
    },
    {
      id: generateUuidV7(),
      occurredAt: params.occurredAt,
      businessDate: params.businessDate,
      itemId: params.outputItemId,
      type: "PRODUCTION_IN",
      qty: params.outputQty,
      unitCost: outputUnitCost,
      totalCost: directCost,
      sourceEventType: "production_run",
      sourceEventId: runId,
      createdAt: now,
    },
  ]);

  return { runId, outputUnitCost };
}

/** DIRECT-INSERT FIXTURE. An ACTIVE recipe turning `rawItemId` into `outputItemId` — `is_active`
 * matters: `loadRecipeEdges` filters to `is_active = 1`, so an inactive recipe would not widen the
 * replay set at all and this whole file would be silently vacuous. */
async function seedRecipe(
  db: TestDb,
  rawItemId: string,
  outputItemId: string,
  lineQty: number,
  yieldQty: number,
): Promise<string> {
  const recipeId = generateUuidV7();
  const now = new Date().toISOString();
  await db.insert(recipes).values({
    id: recipeId,
    name: `Receta ${recipeId.slice(0, 8)}`,
    outputItemId,
    expectedYieldQty: yieldQty,
    isDefault: 1,
    isActive: 1,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(recipeLines).values({
    id: generateUuidV7(),
    recipeId,
    itemId: rawItemId,
    qty: lineQty,
  });
  return recipeId;
}

/** DIRECT-INSERT FIXTURE. Puts an item's derived caches where the (unshipped) production service
 * would have left them, so the replay has a stored value to disagree with. */
async function setDerivedState(
  db: TestDb,
  itemId: string,
  wac: number,
  qtyOnHand: number,
): Promise<void> {
  const now = new Date().toISOString();
  await db.update(items).set({ wac, updatedAt: now }).where(eq(items.id, itemId));
  await db.insert(itemStock).values({ itemId, qtyOnHand, negativeSince: null, updatedAt: now });
}

/** A built (never executed) statement's bound parameters, for asserting WHICH row it targets. */
function statementParams(statement: unknown): unknown[] {
  return (statement as { toSQL(): { params: unknown[] } }).toSQL().params;
}

function statementSql(statement: unknown): string {
  return (statement as { toSQL(): { sql: string } }).toSQL().sql;
}

// `loadRecipeEdges` reads EVERY active recipe in the database, not just this test's — so recipes
// and runs must be cleared between tests or a prior fixture would widen the replay set.
beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(costingAdjustments);
  await db.delete(productionConsumptions);
  await db.delete(productionRuns);
  await db.delete(recipeLines);
  await db.delete(recipes);
  await db.delete(stockExits);
  await db.delete(stockMovements);
  await db.delete(itemStock);
  await db.delete(purchases);
  await db
    .delete(financialTransactions)
    .where(eq(financialTransactions.sourceEventType, "purchase"));
  await db.delete(auditLog);
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

/**
 * THE SCENARIO, worked by hand. Raw material R (flour), semi-finished S (dough).
 *
 * Recorded:
 *   day 10  purchase R 10 000 @ 2                 -> R.wac 2, onHand 10 000
 *   day 12  production run: consumes 5 000 R @ 2  -> direct 10 000 centavos
 *           produces 1 000 S                       -> S PRODUCTION_IN @ 10 000/1 000 = 10
 *                                                  -> S.wac 10, onHand 1 000
 *
 * Then a purchase of R 10 000 @ 10 is BACKDATED to day 5, before everything.
 *
 * R's replay (chronological C, P, PRODUCTION_OUT):
 *   C  -> wac (0·0 + 10 000·10)/10 000 = 10, onHand 10 000
 *   P  -> wac (10 000·10 + 10 000·2)/20 000 = 6, onHand 20 000
 *   PRODUCTION_OUT -> consumed at a replayed wacBefore of 6 (it was booked at 2), onHand 15 000
 *   R final wac = 6.
 *
 * S's replay, which can only happen AFTER R's (dependency order):
 *   the run's direct cost is re-derived from R's REPLAYED consumption cost: 5 000 × 6 = 30 000
 *   corrected output unit cost = 30 000 / 1 000 = 30
 *   S -> wac (0·0 + 1 000·30)/1 000 = 30.
 *   S final wac = 30, up from the stored 10.
 *
 * Note what makes this a real test of ORDER rather than of arithmetic: if S were replayed before R,
 * `replayedConsumptionCost` would still be empty when S is reached, the PRODUCTION_IN would keep
 * its stored unit cost of 10, and S.wac would land back on 10 — a silent no-op. The 30 is
 * unreachable without raw-before-semi ordering.
 */
const RAW_PURCHASE_DAY = "2026-07-10";
const PRODUCTION_DAY = "2026-07-12";
const BACKDATE_DAY = "2026-07-05";

async function seedCascadeScenario(db: TestDb, suffix: string) {
  const raw = await seedItem(db, `INV — harina ${suffix}`, "RAW_MATERIAL");
  const semi = await seedItem(db, `INV — masa ${suffix}`, "SEMI_FINISHED");
  const recipeId = await seedRecipe(db, raw.id, semi.id, 5_000, 1_000);

  await recordPurchase(
    db,
    {
      accountId: "acc_bank",
      occurredAt: `${RAW_PURCHASE_DAY}T10:00:00.000Z`,
      businessDate: RAW_PURCHASE_DAY,
      lines: [{ itemId: raw.id, qty: 10_000, lineTotal: 20_000 }], // unit cost 2
    },
    ACTOR,
  );

  const run = await seedProductionRun(db, {
    recipeId,
    rawItemId: raw.id,
    outputItemId: semi.id,
    occurredAt: `${PRODUCTION_DAY}T10:00:00.000Z`,
    businessDate: PRODUCTION_DAY,
    consumedQty: 5_000,
    consumedUnitCost: 2,
    outputQty: 1_000,
  });
  expect(run.outputUnitCost).toBeCloseTo(10, 9);

  await setDerivedState(db, semi.id, run.outputUnitCost, 1_000);

  return { raw, semi, run };
}

const BACKDATED_RAW_PURCHASE = {
  occurredAt: `${BACKDATE_DAY}T10:00:00.000Z`,
  businessDate: BACKDATE_DAY,
  qty: 10_000,
  lineTotal: 100_000, // unit cost 10
};

describe("R-2 recipe cascade — a raw-material correction moves the semi-finished item's WAC", () => {
  it("propagates the corrected cost from the raw material to the item produced from it", async () => {
    const db = createDb(env.DB);
    const { raw, semi } = await seedCascadeScenario(db, "cascada");

    const semiBefore = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, semi.id),
    });
    expect(semiBefore?.wac).toBeCloseTo(10, 9);

    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: BACKDATED_RAW_PURCHASE.occurredAt,
        businessDate: BACKDATED_RAW_PURCHASE.businessDate,
        lines: [
          {
            itemId: raw.id,
            qty: BACKDATED_RAW_PURCHASE.qty,
            lineTotal: BACKDATED_RAW_PURCHASE.lineTotal,
          },
        ],
        // R-5: the replay touches a recorded production run, so it must be acknowledged.
        confirm: true,
      },
      ACTOR,
    );

    const rawAfter = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, raw.id),
    });
    const semiAfter = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, semi.id),
    });

    // The direct correction on the item that was actually purchased.
    expect(rawAfter?.wac).toBeCloseTo(6, 9);

    // THE cascade assertion: the semi-finished item was never purchased, never touched by the
    // command, and has no kardex row of its own after the backdated point — yet its WAC moved,
    // purely as a consequence of its INPUT's cost being corrected. 30 = (5 000 × 6) / 1 000.
    expect(semiAfter?.wac).toBeCloseTo(30, 9);
    // Explicitly NOT the stale stored value — the failure mode here is a silent no-op, so pinning
    // "it changed" matters as much as pinning what it changed to.
    expect(semiAfter?.wac).not.toBeCloseTo(10, 9);
  });

  it("replays items in dependency order: the raw material before the semi-finished item", async () => {
    const db = createDb(env.DB);
    const { raw, semi } = await seedCascadeScenario(db, "orden");

    // The plan is inspected directly rather than through the committed result, because ORDER is a
    // property of the statement list and is invisible once the batch has been applied.
    const purchaseId = generateUuidV7();
    const plan = await planCostingReplay(db, {
      trigger: {
        eventType: "purchase",
        eventId: purchaseId,
        businessDate: BACKDATED_RAW_PURCHASE.businessDate,
        occurredAt: BACKDATED_RAW_PURCHASE.occurredAt,
      },
      changes: [
        {
          sourceEventType: "purchase",
          sourceEventId: purchaseId,
          newMovements: [
            {
              itemId: raw.id,
              occurredAt: BACKDATED_RAW_PURCHASE.occurredAt,
              businessDate: BACKDATED_RAW_PURCHASE.businessDate,
              type: "PURCHASE_IN",
              qty: BACKDATED_RAW_PURCHASE.qty,
              unitCost: BACKDATED_RAW_PURCHASE.lineTotal / BACKDATED_RAW_PURCHASE.qty,
              sourceEventType: "purchase",
              sourceEventId: purchaseId,
            },
          ],
        },
      ],
      actor: ACTOR,
    });

    expect(plan.required).toBe(true);

    // `items` UPDATEs are emitted in replay order, one per item whose WAC moved. Both items must
    // appear, and the raw material must come first.
    const itemUpdateIndexes = plan.statements
      .map((statement, index) => ({ index, statement }))
      .filter(({ statement }) => /update\s+"items"/i.test(statementSql(statement)));
    expect(itemUpdateIndexes).toHaveLength(2);

    const rawIndex = itemUpdateIndexes.findIndex(({ statement }) =>
      statementParams(statement).includes(raw.id),
    );
    const semiIndex = itemUpdateIndexes.findIndex(({ statement }) =>
      statementParams(statement).includes(semi.id),
    );
    expect(rawIndex).toBeGreaterThanOrEqual(0);
    expect(semiIndex).toBeGreaterThanOrEqual(0);
    // Raw before semi. Reversed, the cascade would read an empty `replayedConsumptionCost` and
    // leave the semi-finished item on its stale WAC.
    expect(rawIndex).toBeLessThan(semiIndex);

    // Corroborates the ordering claim semantically: the run is reported as affected, which only
    // happens once the ingredient's replay has attributed a corrected consumption cost to it.
    expect(plan.impact.affectedProductionRunIds).toHaveLength(1);
    expect(plan.impact.affectedItemIds).toContain(raw.id);
    expect(plan.impact.affectedItemIds).toContain(semi.id);
  });

  it("requires confirmation (R-5) because the correction touches a recorded production run", async () => {
    const db = createDb(env.DB);
    const { raw } = await seedCascadeScenario(db, "confirmacion");

    await expect(
      recordPurchase(
        db,
        {
          accountId: "acc_bank",
          occurredAt: BACKDATED_RAW_PURCHASE.occurredAt,
          businessDate: BACKDATED_RAW_PURCHASE.businessDate,
          lines: [
            {
              itemId: raw.id,
              qty: BACKDATED_RAW_PURCHASE.qty,
              lineTotal: BACKDATED_RAW_PURCHASE.lineTotal,
            },
          ],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "REPLAY_CONFIRMATION_REQUIRED" },
    });
  });
});
