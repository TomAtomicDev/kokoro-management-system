// Integration tests for KOK-028 (S-3, ADR-010c): shared-cost allocation on a PRODUCTION session's
// close. Follows the Doc 11 §3 template (seed via real service factories -> execute -> assert
// derived rows + atomicity), mirroring costing-replay.test.ts's cross-module shape (purchases +
// recipes + production runs + exits, all through their own core/ services, never a raw INSERT).
//
// The two load-bearing assertions in this file are:
//   - Doc 11 §2's exactness property: Σ `production_runs.allocated_session_cost` across a
//     session's runs equals the session's total shared cost EXACTLY (largest-remainder, no centavo
//     lost or invented) — verified both by a 1-run 100% case and a 3-run proportional split using
//     the same numbers money.test.ts's own `allocateLargestRemainder` example already proves.
//   - the WAC cascade actually reaches the kardex: an already-committed stock exit's frozen cost
//     snapshot disagreeing with a session-triggered reallocation produces a `costing_adjustments`
//     row (`trigger_event_type: 'session'`) WITHOUT the caller needing to pass any confirmation —
//     core/sessions's `updateSession` header explains why that gate is deliberately not enforced
//     for this system-derived recompute.
//
// Storage is isolated per test FILE, not per test — items get a unique name per test (items.name is
// UNIQUE, mirrors costing-replay.test.ts's identical note), so only cross-test state that ISN'T
// item-scoped (sessions, production_runs, stock_exits, costing_adjustments, account balances) needs
// resetting in `beforeEach`.
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createItem } from "../src/core/catalog/index.js";
import { recordExit } from "../src/core/inventory/exits.js";
import { recordProductionRun } from "../src/core/production/index.js";
import { recordRecipe } from "../src/core/recipes/index.js";
import {
  closeAndStartSession,
  recordSession as recordSessionCore,
  updateSession as updateSessionCore,
} from "../src/core/sessions/index.js";
import { createDb } from "../src/db/index.js";
import {
  auditLog,
  costingAdjustments,
  financialAccounts,
  financialTransactions,
  productionRuns,
  purchases,
  sessions,
  stockExits,
  stockMovements,
} from "../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;
const BUSINESS_DATE = "2026-07-16";
const SESSION_STARTED_AT = "2026-07-16T09:00:00.000Z";

type TestDb = ReturnType<typeof createDb>;

function recordSession(
  db: TestDb,
  command: Omit<Parameters<typeof recordSessionCore>[1], "startedAt"> & { startedAt?: string },
  actor: Parameters<typeof recordSessionCore>[2],
) {
  return recordSessionCore(db, { startedAt: SESSION_STARTED_AT, ...command }, actor);
}

function updateSession(
  db: TestDb,
  id: string,
  command: Omit<Parameters<typeof updateSessionCore>[2], "startedAt"> & { startedAt?: string },
  actor: Parameters<typeof updateSessionCore>[3],
) {
  return updateSessionCore(db, id, { startedAt: SESSION_STARTED_AT, ...command }, actor);
}

async function seedItem(
  db: TestDb,
  name: string,
  kind: "RAW_MATERIAL" | "SEMI_FINISHED" = "RAW_MATERIAL",
) {
  return createItem(db, { name, kind, category: "INGREDIENT", unit: "KG" }, ACTOR);
}

/** A purchase of `qty` milli-units whose C-2 unit cost is exactly `unitCost` centavos/milli-unit —
 * mirrors costing-replay.test.ts's identical helper. */
async function seedPurchase(db: TestDb, itemId: string, qty: number, unitCost: number) {
  const { recordPurchase } = await import("../src/core/purchasing/index.js");
  return recordPurchase(
    db,
    {
      accountId: "acc_bank",
      occurredAt: `${BUSINESS_DATE}T08:00:00.000Z`,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId, qty, lineTotal: qty * unitCost }],
    },
    ACTOR,
  );
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

async function seedOpenProductionSession(db: TestDb) {
  const { session } = await recordSession(
    db,
    {
      type: "PRODUCTION",
      businessDate: BUSINESS_DATE,
      durationMin: 60,
      costLines: [],
    },
    ACTOR,
  );
  return session;
}

async function closeSession(
  db: TestDb,
  id: string,
  costLines: { label: string; amount: number; isEstimate?: boolean; accountId?: string }[],
) {
  return updateSession(
    db,
    id,
    {
      type: "PRODUCTION",
      businessDate: BUSINESS_DATE,
      durationMin: 60,
      status: "CLOSED",
      costLines,
    },
    ACTOR,
  );
}

async function runRow(db: TestDb, id: string) {
  const row = await db.query.productionRuns.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, id),
  });
  if (!row) throw new Error(`production run ${id} not found`);
  return row;
}

/** Returns `items.wac_mc` (ADR-017: milli-centavos per WHOLE unit). */
async function itemWac(db: TestDb, id: string): Promise<number> {
  const row = await db.query.items.findFirst({ where: (t, { eq: eqOp }) => eqOp(t.id, id) });
  if (!row) throw new Error(`item ${id} not found`);
  return row.wacMc;
}

async function productionInMovement(db: TestDb, runId: string) {
  return db.query.stockMovements.findFirst({
    where: (t, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(t.sourceEventId, runId), eqOp(t.type, "PRODUCTION_IN")),
  });
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(costingAdjustments);
  await db.delete(auditLog).where(eq(auditLog.entityType, "sessions"));
  await db.delete(auditLog).where(eq(auditLog.entityType, "production_runs"));
  await db
    .delete(financialTransactions)
    .where(eq(financialTransactions.sourceEventType, "session_cost"));
  await db
    .delete(financialTransactions)
    .where(eq(financialTransactions.sourceEventType, "purchase"));
  await db.delete(stockExits);
  await db.delete(stockMovements).where(eq(stockMovements.sourceEventType, "production_run"));
  await db.delete(stockMovements).where(eq(stockMovements.sourceEventType, "purchase"));
  await db.delete(productionRuns); // cascades production_consumptions
  await db.delete(purchases);
  await db.delete(sessions); // cascades session_costs
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("planSessionCostAllocation via updateSession (KOK-028, S-3)", () => {
  it("closeAndStartSession allocates the closing PRODUCTION session's existing costs in the same batch", async () => {
    const db = createDb(env.DB);
    const input = await seedItem(db, "KOK-130 swap — input");
    const output = await seedItem(db, "KOK-130 swap — output", "SEMI_FINISHED");
    await seedPurchase(db, input.id, 1000, 100);
    const recipe = await seedRecipe(db, output.id, [{ itemId: input.id, qty: 1000 }]);
    const { session } = await recordSession(
      db,
      {
        type: "PRODUCTION",
        businessDate: BUSINESS_DATE,
        costLines: [{ label: "Gas", amount: 50_000, isEstimate: true }],
      },
      ACTOR,
    );
    const { productionRun } = await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        sessionId: session.id,
        batches: 1,
        actualOutputQty: 1000,
        occurredAt: `${BUSINESS_DATE}T09:00:00.000Z`,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: input.id, qty: 1000 }],
      },
      ACTOR,
    );

    const result = await closeAndStartSession(
      db,
      {
        closeSessionId: session.id,
        newSession: {
          type: "PRODUCTION",
          businessDate: "2026-07-17",
          startedAt: "2026-07-17T09:00:00.000Z",
        },
      },
      ACTOR,
    );
    expect(result.closedSession.status).toBe("CLOSED");
    expect(result.newSession).toMatchObject({ type: "PRODUCTION", status: "OPEN" });
    expect((await runRow(db, productionRun.id)).allocatedSessionCost).toBe(50_000);
  });

  it("a single linked run gets 100% of the shared cost; total_cost/output unit cost update and the output item's WAC is corrected via the no-downstream fallback path", async () => {
    const db = createDb(env.DB);
    const itemA = await seedItem(db, "KOK-028 single-run — harina");
    const output = await seedItem(db, "KOK-028 single-run — masa", "SEMI_FINISHED");
    await seedPurchase(db, itemA.id, 1000, 100); // WAC(itemA) = 100

    const recipe = await seedRecipe(db, output.id, [{ itemId: itemA.id, qty: 1000 }]);
    const session = await seedOpenProductionSession(db);

    const { productionRun } = await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        sessionId: session.id,
        batches: 1,
        actualOutputQty: 1000,
        indirectCost: 0,
        occurredAt: `${BUSINESS_DATE}T09:00:00.000Z`,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: itemA.id, qty: 1000 }],
      },
      ACTOR,
    );
    expect(productionRun.directCost).toBe(100_000);
    expect(productionRun.allocatedSessionCost).toBe(0);
    // First-ever entry: outputUnitCostMc = rateFromTotal(100_000, 1000) = 100_000_000 exactly.
    expect(await itemWac(db, output.id)).toBe(100_000_000);

    await closeSession(db, session.id, [
      { label: "Gas", amount: 100_000, isEstimate: false, accountId: "acc_bank" },
    ]);

    const updatedRun = await runRow(db, productionRun.id);
    expect(updatedRun.allocatedSessionCost).toBe(100_000);
    expect(updatedRun.directCost).toBe(100_000);
    expect(updatedRun.totalCost).toBe(200_000);

    // Reallocation raises totalCost to 200_000 -> rateFromTotal(200_000, 1000) = 200_000_000.
    expect(await itemWac(db, output.id)).toBe(200_000_000);
    const movement = await productionInMovement(db, productionRun.id);
    expect(movement?.unitCostMc).toBe(200_000_000);

    // Nothing downstream of this run's output — no costing_adjustments row should exist.
    const adjustments = await db.query.costingAdjustments.findMany({});
    expect(adjustments).toHaveLength(0);
  });

  it("three runs split proportionally to direct cost via largest-remainder — Σ allocations = total exactly (Doc 11 §2)", async () => {
    const db = createDb(env.DB);
    const itemA = await seedItem(db, "KOK-028 three-run — harina");
    const out1 = await seedItem(db, "KOK-028 three-run — out1", "SEMI_FINISHED");
    const out2 = await seedItem(db, "KOK-028 three-run — out2", "SEMI_FINISHED");
    const out3 = await seedItem(db, "KOK-028 three-run — out3", "SEMI_FINISHED");
    await seedPurchase(db, itemA.id, 10_000, 100); // WAC(itemA) = 100, ample stock for 1+2+3 consumed

    const recipe1 = await seedRecipe(db, out1.id, [{ itemId: itemA.id, qty: 1 }]);
    const recipe2 = await seedRecipe(db, out2.id, [{ itemId: itemA.id, qty: 2 }]);
    const recipe3 = await seedRecipe(db, out3.id, [{ itemId: itemA.id, qty: 3 }]);
    const session = await seedOpenProductionSession(db);

    const makeRun = async (recipeId: string, qty: number) =>
      (
        await recordProductionRun(
          db,
          {
            recipeId,
            sessionId: session.id,
            batches: 1,
            actualOutputQty: 1000,
            indirectCost: 0,
            occurredAt: `${BUSINESS_DATE}T09:00:00.000Z`,
            businessDate: BUSINESS_DATE,
            lines: [{ itemId: itemA.id, qty }],
          },
          ACTOR,
        )
      ).productionRun;

    const run1 = await makeRun(recipe1.id, 1); // direct = 100
    const run2 = await makeRun(recipe2.id, 2); // direct = 200
    const run3 = await makeRun(recipe3.id, 3); // direct = 300

    await closeSession(db, session.id, [
      { label: "Gas", amount: 100, isEstimate: false, accountId: "acc_bank" },
    ]);

    const [r1, r2, r3] = await Promise.all([
      runRow(db, run1.id),
      runRow(db, run2.id),
      runRow(db, run3.id),
    ]);

    // Same weights/total as money.test.ts's own allocateLargestRemainder([1,2,3], 100) example.
    expect(r1.allocatedSessionCost).toBe(17);
    expect(r2.allocatedSessionCost).toBe(33);
    expect(r3.allocatedSessionCost).toBe(50);
    expect(r1.allocatedSessionCost + r2.allocatedSessionCost + r3.allocatedSessionCost).toBe(100);

    expect(r1.totalCost).toBe(117);
    expect(r2.totalCost).toBe(233);
    expect(r3.totalCost).toBe(350);
  });

  it("estimate cost lines are included in the allocation basis, not just cash lines (Doc 03 §6 does not carve them out)", async () => {
    const db = createDb(env.DB);
    const itemA = await seedItem(db, "KOK-028 estimate-basis — harina");
    const output = await seedItem(db, "KOK-028 estimate-basis — masa", "SEMI_FINISHED");
    await seedPurchase(db, itemA.id, 1000, 100);

    const recipe = await seedRecipe(db, output.id, [{ itemId: itemA.id, qty: 1000 }]);
    const session = await seedOpenProductionSession(db);
    const { productionRun } = await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        sessionId: session.id,
        batches: 1,
        actualOutputQty: 1000,
        indirectCost: 0,
        occurredAt: `${BUSINESS_DATE}T09:00:00.000Z`,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: itemA.id, qty: 1000 }],
      },
      ACTOR,
    );

    await closeSession(db, session.id, [
      { label: "Gasolina", amount: 6000, isEstimate: false, accountId: "acc_bank" },
      { label: "Energía (estimado)", amount: 4000, isEstimate: true },
    ]);

    const updatedRun = await runRow(db, productionRun.id);
    // 6000 + 4000 = 10000, not just the 6000 cash line.
    expect(updatedRun.allocatedSessionCost).toBe(10_000);
  });

  it("re-closing an already-closed session is idempotent (no statement) when nothing changed, and reallocates when a cost line is corrected", async () => {
    const db = createDb(env.DB);
    const itemA = await seedItem(db, "KOK-028 idempotent — harina");
    const output = await seedItem(db, "KOK-028 idempotent — masa", "SEMI_FINISHED");
    await seedPurchase(db, itemA.id, 1000, 100);

    const recipe = await seedRecipe(db, output.id, [{ itemId: itemA.id, qty: 1000 }]);
    const session = await seedOpenProductionSession(db);
    const { productionRun } = await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        sessionId: session.id,
        batches: 1,
        actualOutputQty: 1000,
        indirectCost: 0,
        occurredAt: `${BUSINESS_DATE}T09:00:00.000Z`,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: itemA.id, qty: 1000 }],
      },
      ACTOR,
    );

    await closeSession(db, session.id, [
      { label: "Gas", amount: 1000, isEstimate: false, accountId: "acc_bank" },
    ]);
    const afterFirstClose = await runRow(db, productionRun.id);
    expect(afterFirstClose.allocatedSessionCost).toBe(1000);

    // Re-save the already-CLOSED session with the SAME cost line: the allocation is unchanged, so
    // no statement should touch this run — updatedAt stays exactly what it was.
    await closeSession(db, session.id, [
      { label: "Gas", amount: 1000, isEstimate: false, accountId: "acc_bank" },
    ]);
    const afterNoOpReClose = await runRow(db, productionRun.id);
    expect(afterNoOpReClose.allocatedSessionCost).toBe(1000);
    expect(afterNoOpReClose.updatedAt).toBe(afterFirstClose.updatedAt);

    // Correcting the cost line then re-closing IS the correction path (R-1-style).
    await closeSession(db, session.id, [
      { label: "Gas", amount: 2000, isEstimate: false, accountId: "acc_bank" },
    ]);
    const afterCorrection = await runRow(db, productionRun.id);
    expect(afterCorrection.allocatedSessionCost).toBe(2000);
    expect(afterCorrection.totalCost).toBe(102_000);
  });

  it("a PRODUCTION session with no linked runs closes cleanly with nothing to allocate to", async () => {
    const db = createDb(env.DB);
    const session = await seedOpenProductionSession(db);

    const result = await closeSession(db, session.id, [
      { label: "Gas", amount: 5000, isEstimate: false, accountId: "acc_bank" },
    ]);

    expect(result.session.status).toBe("CLOSED");
  });

  it("a non-PRODUCTION session closes without invoking production allocation", async () => {
    const db = createDb(env.DB);
    const itemA = await seedItem(db, "KOK-028 non-production — harina");
    const output = await seedItem(db, "KOK-028 non-production — masa", "SEMI_FINISHED");
    await seedPurchase(db, itemA.id, 1000, 100);
    const recipe = await seedRecipe(db, output.id, [{ itemId: itemA.id, qty: 1000 }]);

    const { session } = await recordSession(
      db,
      { type: "PRODUCTION", businessDate: BUSINESS_DATE, durationMin: 30, costLines: [] },
      ACTOR,
    );
    const { productionRun } = await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        sessionId: session.id,
        batches: 1,
        actualOutputQty: 1000,
        indirectCost: 0,
        occurredAt: `${BUSINESS_DATE}T09:00:00.000Z`,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: itemA.id, qty: 1000 }],
      },
      ACTOR,
    );

    await updateSession(
      db,
      session.id,
      {
        type: "DELIVERY_RUN",
        businessDate: BUSINESS_DATE,
        durationMin: 30,
        status: "CLOSED",
        costLines: [{ label: "Gasolina", amount: 5000, isEstimate: false, accountId: "acc_bank" }],
      },
      ACTOR,
    );

    const updatedRun = await runRow(db, productionRun.id);
    expect(updatedRun.allocatedSessionCost).toBe(0);
    expect(updatedRun.totalCost).toBe(productionRun.totalCost);
  });

  it("cascades through an already-frozen stock exit WITHOUT a confirmation gate, booking a costing_adjustments row with trigger_event_type 'session'", async () => {
    const db = createDb(env.DB);
    const itemA = await seedItem(db, "KOK-028 cascade — harina");
    const output = await seedItem(db, "KOK-028 cascade — masa", "SEMI_FINISHED");
    await seedPurchase(db, itemA.id, 1000, 100); // WAC(itemA) = 100

    const recipe = await seedRecipe(db, output.id, [{ itemId: itemA.id, qty: 1000 }]);
    const session = await seedOpenProductionSession(db);

    const { productionRun } = await recordProductionRun(
      db,
      {
        recipeId: recipe.id,
        sessionId: session.id,
        batches: 1,
        actualOutputQty: 1000,
        indirectCost: 0,
        occurredAt: `${BUSINESS_DATE}T09:00:00.000Z`,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: itemA.id, qty: 1000 }],
      },
      ACTOR,
    );
    // First-ever entry: outputUnitCostMc = rateFromTotal(100_000, 1000) = 100_000_000 exactly.
    expect(await itemWac(db, output.id)).toBe(100_000_000); // output WAC before any reallocation

    // A stock exit AFTER the run freezes its unit_cost_snapshot at the CURRENT wac (C-6) — this is
    // the "already-recorded downstream consumer" R-5 normally gates a plain edit behind.
    const { exit } = await recordExit(
      db,
      {
        itemId: output.id,
        qty: 500,
        reason: "WASTE",
        occurredAt: `${BUSINESS_DATE}T10:00:00.000Z`,
        businessDate: BUSINESS_DATE,
      },
      ACTOR,
    );
    expect(exit.unitCostSnapshotMc).toBe(100_000_000);

    // No `confirm` field exists on this command at all (packages/shared/src/sessions.ts) — if the
    // allocation enforced planCostingReplay's confirmationRequired gate the way a plain production
    // -run edit does, this call would have nothing to set to bypass it and would need to throw.
    await expect(
      closeSession(db, session.id, [
        { label: "Gas", amount: 100_000, isEstimate: false, accountId: "acc_bank" },
      ]),
    ).resolves.toBeDefined();

    const updatedRun = await runRow(db, productionRun.id);
    expect(updatedRun.allocatedSessionCost).toBe(100_000);
    expect(updatedRun.totalCost).toBe(200_000);

    // Replayed kardex: PRODUCTION_IN qty 1000 @ 200_000_000 -> wac 200_000_000; EXIT_OUT never
    // moves wac. Reallocation raises totalCost to 200_000 -> rateFromTotal(200_000, 1000) =
    // 200_000_000.
    expect(await itemWac(db, output.id)).toBe(200_000_000);

    const adjustments = await db.query.costingAdjustments.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, output.id),
    });
    expect(adjustments).toHaveLength(1);
    const adjustment = adjustments[0];
    expect(adjustment).toMatchObject({
      triggerEventType: "session",
      triggerEventId: session.id,
      // cost_delta (Centavos) is unaffected by — it's computed as
      // (frozenMc - replayedMc) * qty / 1_000_000, and the mc-scale ×1,000,000 cancels back out:
      // (100_000_000 - 200_000_000) * 500 / 1_000_000 = -50_000.
      costDelta: -50_000,
    });
    expect(JSON.parse(adjustment?.affectedStockExitIds ?? "[]")).toEqual([exit.id]);
    expect(JSON.parse(adjustment?.affectedSaleLineIds ?? "[]")).toEqual([]);
  });
});
