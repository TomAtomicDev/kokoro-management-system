// INVARIANT SUITE — KOK-024. R-4 immutability and the R-5 confirmation contract.
//
// GUARDRAIL (CLAUDE.md "Guardrails for AI Agents"): once merged, this directory is "fix code, not
// tests". A failure here means a service regressed, not that an assertion needs relaxing.
//
// R-4 is the rule that makes the whole replay mechanism safe to run at all: a day already reported
// keeps reporting the same margin. The correction is booked FORWARD as a `costing_adjustments` row
// dated today, never backward by rewriting `sale_lines.unit_cost_snapshot` /
// `stock_exits.unit_cost_snapshot`. A future change that "helpfully" corrects those frozen columns
// in place would be silently rewriting history — which is precisely the failure the backlog's 🧠5
// rating is about, and it would leave no trace anywhere else.
//
// costing-replay.test.ts already asserts the PLAN contains no SQL targeting those tables. This file
// asserts the stronger, end-to-end claim: after a REAL command commits a replay that demonstrably
// changed the underlying WAC, every frozen snapshot is byte-identical to what it was before.
// (Stronger because it would also catch a rewrite that arrived from outside the plan — e.g. a
// service adding its own "fix up the snapshots" statement to the same batch.)
//
// ============================================================================================
// DOCUMENTED EXCEPTION TO D-2 (same as cross-item-cascade.test.ts — see its header for the full
// rationale). The sales service does not exist yet (KOK-030 is unshipped), so the `sales` /
// `sale_lines` / SALE_OUT fixtures below are written with direct `db.insert` calls. The exception
// covers ONLY those fixtures: exits and purchases go through the real `recordExit` /
// `recordPurchase`, and the code under test is always the real service. Migrate `seedSale` to the
// sales service factory when KOK-030 ships and delete this notice.
// ============================================================================================
import { env } from "cloudflare:test";
import { generateUuidV7, toBusinessDate } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createItem } from "../../src/core/catalog/index.js";
import { recordExit } from "../../src/core/inventory/exits.js";
import { recordPurchase } from "../../src/core/purchasing/index.js";
import { createDb } from "../../src/db/index.js";
import {
  auditLog,
  costingAdjustments,
  financialAccounts,
  financialTransactions,
  itemStock,
  purchases,
  saleLines,
  sales,
  stockExits,
  stockMovements,
} from "../../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;

type TestDb = ReturnType<typeof createDb>;

async function seedItem(db: TestDb, name: string) {
  return createItem(db, { name, kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "KG" }, ACTOR);
}

/**
 * DIRECT-INSERT FIXTURE (see the D-2 exception notice in this file's header).
 *
 * One PAID catalog sale of `qty` milli-units that froze `unitCostSnapshot`, plus its SALE_OUT
 * kardex row and the matching `item_stock` decrement — the last of which matters: without it the
 * stored on-hand cache would disagree with the kardex before the replay even starts, and the
 * expected numbers below (which are derived from the kardex) would not be the ones the service
 * threads C-1 against.
 */
async function seedSale(
  db: TestDb,
  params: {
    itemId: string;
    occurredAt: string;
    businessDate: string;
    qty: number;
    unitPrice: number;
    unitCostSnapshot: number;
  },
): Promise<{ saleId: string; saleLineId: string }> {
  const saleId = generateUuidV7();
  const saleLineId = generateUuidV7();
  const now = new Date().toISOString();

  await db.insert(sales).values({
    id: saleId,
    occurredAt: params.occurredAt,
    businessDate: params.businessDate,
    channel: "CATALOG",
    total: params.qty * params.unitPrice,
    paymentStatus: "PAID",
    paidAt: params.occurredAt,
    paymentMethod: "CASH",
    accountId: "acc_cash",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(saleLines).values({
    id: saleLineId,
    saleId,
    itemId: params.itemId,
    qty: params.qty,
    unitPrice: params.unitPrice,
    unitCostSnapshot: params.unitCostSnapshot,
  });

  await db.insert(stockMovements).values({
    id: generateUuidV7(),
    occurredAt: params.occurredAt,
    businessDate: params.businessDate,
    itemId: params.itemId,
    type: "SALE_OUT",
    qty: -params.qty,
    unitCost: params.unitCostSnapshot,
    totalCost: -Math.round(params.qty * params.unitCostSnapshot),
    sourceEventType: "sale",
    sourceEventId: saleId,
    createdAt: now,
  });

  const stock = await db.query.itemStock.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.itemId, params.itemId),
  });
  await db
    .update(itemStock)
    .set({ qtyOnHand: (stock?.qtyOnHand ?? 0) - params.qty, updatedAt: now })
    .where(eq(itemStock.itemId, params.itemId));

  return { saleId, saleLineId };
}

/** Every frozen cost snapshot in the database, keyed by row id — the thing R-4 forbids changing. */
async function readFrozenSnapshots(
  db: TestDb,
): Promise<{ exits: Record<string, number>; saleLines: Record<string, number> }> {
  const exitRows = await db.select().from(stockExits);
  const lineRows = await db.select().from(saleLines);
  return {
    exits: Object.fromEntries(exitRows.map((row) => [row.id, row.unitCostSnapshot])),
    saleLines: Object.fromEntries(lineRows.map((row) => [row.id, row.unitCostSnapshot])),
  };
}

/**
 * A total snapshot of every table the refused command could conceivably have touched.
 *
 * R-5's contract is that the refusal happens BEFORE `db.batch`, so nothing is written. That is an
 * atomicity CLAIM in a comment; this proves it, rather than spot-checking the two or three tables a
 * reviewer happened to think of.
 */
async function snapshotWorld(db: TestDb): Promise<unknown> {
  return {
    purchases: await db.select().from(purchases),
    stockMovements: await db.select().from(stockMovements),
    stockExits: await db.select().from(stockExits),
    saleLines: await db.select().from(saleLines),
    sales: await db.select().from(sales),
    costingAdjustments: await db.select().from(costingAdjustments),
    auditLog: await db.select().from(auditLog),
    financialTransactions: await db.select().from(financialTransactions),
    financialAccounts: await db.select().from(financialAccounts),
    itemStock: await db.select().from(itemStock),
    items: await db.query.items.findMany(),
  };
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(costingAdjustments);
  await db.delete(saleLines);
  await db.delete(sales);
  await db.delete(stockExits);
  await db.delete(stockMovements);
  await db.delete(itemStock);
  await db.delete(purchases);
  await db.delete(financialTransactions);
  await db.delete(auditLog);
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

/**
 * THE SCENARIO, worked by hand.
 *
 * Recorded:
 *   day 10 10:00  P1 purchase 10 000 @ 2   -> wac 2, onHand 10 000
 *   day 11 10:00  exit 3 000               -> freezes snapshot 2, onHand 7 000
 *   day 11 12:00  sale 2 000               -> freezes snapshot 2, onHand 5 000
 *   day 12 10:00  P2 purchase 10 000 @ 4   -> wac (5 000·2 + 10 000·4)/15 000 = 3.3333
 *
 * Then C, 10 000 @ 10, is BACKDATED to day 10 12:00 — between P1 and the two consumers.
 *   prefix [P1] -> seed onHand 10 000, wac 2
 *   C    -> wac (10 000·2 + 10 000·10)/20 000 = 6,  onHand 20 000
 *   exit -> consumed at a replayed 6, froze 2  => (2 − 6) × 3 000 = −12 000
 *   sale -> consumed at a replayed 6, froze 2  => (2 − 6) × 2 000 =  −8 000
 *   P2   -> wac (15 000·6 + 10 000·4)/25 000 = 130 000/25 000 = 5.2
 *
 * cost_delta = −12 000 + −8 000 = −20 000 centavos, hand-computed here and NOT read back from the
 * implementation. Negative per Doc 04 §3.4: the goods really cost more than was booked, so
 * accumulated margin fell.
 */
const EXPECTED_COST_DELTA = -20_000;
const EXPECTED_REPLAYED_WAC = 5.2;
const FROZEN_SNAPSHOT = 2;

const BACKDATED_PURCHASE = {
  occurredAt: "2026-07-10T12:00:00.000Z",
  businessDate: "2026-07-10",
  qty: 10_000,
  lineTotal: 100_000, // unit cost 10
};

async function seedScenario(db: TestDb, suffix: string) {
  const item = await seedItem(db, `INV — congelados ${suffix}`);

  await recordPurchase(
    db,
    {
      accountId: "acc_bank",
      occurredAt: "2026-07-10T10:00:00.000Z",
      businessDate: "2026-07-10",
      lines: [{ itemId: item.id, qty: 10_000, lineTotal: 20_000 }],
    },
    ACTOR,
  );

  const exit = await recordExit(
    db,
    {
      itemId: item.id,
      qty: 3_000,
      reason: "WASTE",
      occurredAt: "2026-07-11T10:00:00.000Z",
      businessDate: "2026-07-11",
    },
    ACTOR,
  );
  expect(exit.exit.unitCostSnapshot).toBe(FROZEN_SNAPSHOT);

  const sale = await seedSale(db, {
    itemId: item.id,
    occurredAt: "2026-07-11T12:00:00.000Z",
    businessDate: "2026-07-11",
    qty: 2_000,
    unitPrice: 15,
    unitCostSnapshot: FROZEN_SNAPSHOT,
  });

  await recordPurchase(
    db,
    {
      accountId: "acc_bank",
      occurredAt: "2026-07-12T10:00:00.000Z",
      businessDate: "2026-07-12",
      lines: [{ itemId: item.id, qty: 10_000, lineTotal: 40_000 }],
    },
    ACTOR,
  );

  return { item, exit, sale };
}

function backdatedPurchaseCommand(itemId: string, confirm?: true) {
  return {
    accountId: "acc_bank" as const,
    occurredAt: BACKDATED_PURCHASE.occurredAt,
    businessDate: BACKDATED_PURCHASE.businessDate,
    lines: [{ itemId, qty: BACKDATED_PURCHASE.qty, lineTotal: BACKDATED_PURCHASE.lineTotal }],
    ...(confirm === true ? { confirm: true } : {}),
  };
}

describe("R-4 — frozen cost snapshots survive a replay byte-identically", () => {
  it("leaves every stock_exits and sale_lines unit_cost_snapshot exactly as it was", async () => {
    const db = createDb(env.DB);
    const { item, exit, sale } = await seedScenario(db, "inmutables");

    const before = await readFrozenSnapshots(db);
    // Non-vacuity: there ARE snapshots to protect, and they hold the pre-replay value.
    expect(Object.keys(before.exits)).toHaveLength(1);
    expect(Object.keys(before.saleLines)).toHaveLength(1);
    expect(before.exits[exit.exit.id]).toBe(FROZEN_SNAPSHOT);
    expect(before.saleLines[sale.saleLineId]).toBe(FROZEN_SNAPSHOT);

    await recordPurchase(db, backdatedPurchaseCommand(item.id, true), ACTOR);

    // Non-vacuity, the important half: the underlying WAC really did change, so an implementation
    // that rewrote snapshots to "stay consistent" would have had something to rewrite them to.
    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemRow?.wac).toBeCloseTo(EXPECTED_REPLAYED_WAC, 9);
    expect(itemRow?.wac).not.toBeCloseTo(FROZEN_SNAPSHOT, 9);

    const after = await readFrozenSnapshots(db);
    // Byte-identical: same row ids, same values, nothing added or removed.
    expect(after).toEqual(before);
  });

  it("books exactly one costing_adjustments row per affected item, with the hand-computed delta and TODAY's business date", async () => {
    const db = createDb(env.DB);
    const { item, exit, sale } = await seedScenario(db, "ajuste");

    const result = await recordPurchase(db, backdatedPurchaseCommand(item.id, true), ACTOR);

    const adjustments = await db
      .select()
      .from(costingAdjustments)
      .where(eq(costingAdjustments.itemId, item.id));
    // Exactly one — not one per affected consumer, and not one per statement.
    expect(adjustments).toHaveLength(1);
    const adjustment = adjustments[0];
    expect(adjustment).toBeDefined();
    if (adjustment === undefined) return;

    expect(adjustment.costDelta).toBe(EXPECTED_COST_DELTA);
    expect(adjustment.triggerEventType).toBe("purchase");
    expect(adjustment.triggerEventId).toBe(result.purchase.id);

    // R-4: dated to the CORRECTION (today), never to the backdated event — inheriting 2026-07-10
    // would retroactively change a day that has already been reported.
    //
    // INV-3: the shop's calendar day in America/La_Paz via the repo's own util, NOT
    // `new Date().toISOString().slice(0, 10)`. After 20:00 local the UTC date has already rolled
    // over, so the naive slice files every evening correction one day late — a real off-by-one that
    // has already been hit once on this task.
    expect(adjustment.businessDate).toBe(toBusinessDate(new Date()));
    expect(adjustment.businessDate).not.toBe(BACKDATED_PURCHASE.businessDate);

    // Both frozen consumers are named for the UI drill-down.
    expect(JSON.parse(adjustment.affectedStockExitIds)).toEqual([exit.exit.id]);
    expect(JSON.parse(adjustment.affectedSaleLineIds)).toEqual([sale.saleLineId]);
  });
});

describe("R-5 — the confirmation gate refuses BEFORE writing anything", () => {
  it("throws CONFLICT with a populated impact, and leaves the database bit-for-bit unchanged", async () => {
    const db = createDb(env.DB);
    const { item, exit, sale } = await seedScenario(db, "confirmacion");

    const worldBefore = await snapshotWorld(db);

    await expect(
      recordPurchase(db, backdatedPurchaseCommand(item.id), ACTOR),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: {
        reason: "REPLAY_CONFIRMATION_REQUIRED",
        impact: {
          requiresConfirmation: true,
          costDelta: EXPECTED_COST_DELTA,
          affectedItemIds: [item.id],
          affectedStockExitIds: [exit.exit.id],
          affectedSaleLineIds: [sale.saleLineId],
        },
      },
    });

    // The atomicity claim, proven rather than assumed. `recordPurchase` throws before `db.batch`,
    // so not one row of the refused purchase exists: no purchase, no purchase line, no kardex row,
    // no financial transaction, no account balance movement, no audit entry, no adjustment, and
    // `items.wac` / `item_stock` untouched.
    expect(await snapshotWorld(db)).toEqual(worldBefore);
  });

  it("commits the identical command once `confirm: true` is supplied", async () => {
    const db = createDb(env.DB);
    const { item } = await seedScenario(db, "confirmada");

    const result = await recordPurchase(db, backdatedPurchaseCommand(item.id, true), ACTOR);

    // Same command, same numbers — the flag is a confirmation, not a different operation.
    expect(result.purchase.total).toBe(BACKDATED_PURCHASE.lineTotal);
    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemRow?.wac).toBeCloseTo(EXPECTED_REPLAYED_WAC, 9);
    expect(
      await db.select().from(costingAdjustments).where(eq(costingAdjustments.itemId, item.id)),
    ).toHaveLength(1);
  });
});
