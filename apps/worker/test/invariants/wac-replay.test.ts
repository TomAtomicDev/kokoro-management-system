// INVARIANT SUITE — KOK-024. R-2 / INV-11: a backdated event's committed WAC is the full-kardex
// answer, not the incrementally-threaded one.
//
// GUARDRAIL (CLAUDE.md "Guardrails for AI Agents"): once merged, this directory is "fix code, not
// tests". A failure here means a service regressed, not that an assertion needs relaxing.
//
// WHY THIS FILE EXISTS SEPARATELY FROM costing-replay.test.ts. That file asserts the PLAN that
// `planCostingReplay` returns. This one asserts what is actually IN THE DATABASE after the real
// command commits — the two are different claims, and only the second one is the invariant the
// ledger depends on. A correct plan that the service then overwrites with its own naive C-1 write
// would pass every test in costing-replay.test.ts and still corrupt the ledger.
//
// THE LOAD-BEARING ASSERTION is not "wac === <correct number>" on its own. A test that only
// asserts the correct value can still be satisfied by accident, and — more importantly — it does
// not demonstrate that the un-guarded code would have failed it. So every scenario below ALSO
// computes the naive pre-KOK-024 value explicitly (via `applyWacEntry`, seeded from the stored
// `items.wac` / `item_stock.qty_on_hand` exactly as the old `recordPurchase` read them) and asserts
// the committed value DIFFERS from it. Without that inequality the test would pass against the old
// un-guarded service and prove nothing.
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createItem } from "../../src/core/catalog/index.js";
import { applyWacEntry, recomputeWacFromMovements } from "../../src/core/costing/wac.js";
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
  stockExits,
  stockMovements,
} from "../../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;

type TestDb = ReturnType<typeof createDb>;

async function seedItem(db: TestDb, name: string) {
  return createItem(db, { name, kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "KG" }, ACTOR);
}

/** A purchase of `qty` milli-units whose C-2 unit cost is exactly `unitCost` centavos/milli-unit. */
async function purchase(
  db: TestDb,
  itemId: string,
  date: string,
  time: string,
  qty: number,
  unitCost: number,
  confirm?: true,
) {
  return recordPurchase(
    db,
    {
      accountId: "acc_bank",
      occurredAt: `${date}T${time}:00.000Z`,
      businessDate: date,
      lines: [{ itemId, qty, lineTotal: qty * unitCost }],
      ...(confirm === true ? { confirm: true } : {}),
    },
    ACTOR,
  );
}

/** The item's stored WAC cache and on-hand balance — the exact two values the pre-KOK-024
 * `recordPurchase` fed into C-1, and therefore the seed for the naive reconstruction below. */
async function readStoredState(
  db: TestDb,
  itemId: string,
): Promise<{ wac: number; onHand: number }> {
  const item = await db.query.items.findFirst({ where: (t, { eq: eqOp }) => eqOp(t.id, itemId) });
  const stock = await db.query.itemStock.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.itemId, itemId),
  });
  return { wac: item?.wac ?? 0, onHand: stock?.qtyOnHand ?? 0 };
}

/** The item's committed kardex in canonical order — the same `(occurred_at, created_at)` sort key
 * replay.ts's `comparePoints` and repair.ts both use, so `recomputeWacFromMovements` over this is
 * R-2's authoritative answer. */
async function readKardex(db: TestDb, itemId: string) {
  return db.query.stockMovements.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.itemId, itemId),
    orderBy: (t, { asc }) => [asc(t.occurredAt), asc(t.createdAt)],
  });
}

// Storage is isolated per test FILE, not per test (same note as purchasing.test.ts) — this restores
// the per-test guarantee. Items are created with a unique name per test (items.name is UNIQUE), so
// they never need resetting; `stock_movements` and `item_stock` are cleared wholesale because the
// INV-11 "latest movement" probe is a per-item query that must not see a prior test's tail.
beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(costingAdjustments);
  await db.delete(stockExits);
  await db.delete(stockMovements);
  await db.delete(itemStock);
  // Cascades to purchase_lines (onDelete: cascade FK).
  await db.delete(purchases);
  await db
    .delete(financialTransactions)
    .where(eq(financialTransactions.sourceEventType, "purchase"));
  await db.delete(auditLog);
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("INV-11/R-2 — same-item backdated insert lands the full-kardex WAC", () => {
  /**
   * The scenario, worked by hand.
   *
   * RECORDED order: A (day 10, 10 000 @ 2) -> B (exit 8 000, day 12) -> C (10 000 @ 10, day 5).
   *   after A: onHand 10 000, wac 2
   *   after B: onHand  2 000, wac 2   (C-6 — an exit never moves the WAC)
   *
   * C is then backdated to day 5, i.e. BEFORE everything. CHRONOLOGICAL order is C, A, B:
   *   C -> wac (0·0 + 10 000·10)/10 000 = 10, onHand 10 000
   *   A -> wac (10 000·10 + 10 000·2)/20 000 = 6, onHand 20 000
   *   B -> onHand 12 000, wac 6 (exit carries WAC forward)
   * So the correct committed WAC is 6.
   *
   * The naive pre-KOK-024 threading — C-1 applied to the CURRENT cached state, ignoring
   * `business_date` entirely — would instead have produced
   *   (max(2 000,0)·2 + 10 000·10) / (2 000 + 10 000) = 104 000/12 000 = 8.6667.
   * 6 ≠ 8.6667, which is exactly what makes the assertions below discriminate the guarded service
   * from the un-guarded one.
   *
   * B froze `unit_cost_snapshot` 2 but the replay says it consumed at 6, so
   * cost_delta = (2 − 6) × 8 000 = −32 000 centavos and R-5 demands `confirm: true`.
   */
  it("commits the chronologically-correct WAC, and NOT what naive C-1 threading would have written", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "INV — backdate mismo ítem");

    await purchase(db, item.id, "2026-07-10", "10:00", 10_000, 2);
    await recordExit(
      db,
      {
        itemId: item.id,
        qty: 8_000,
        reason: "WASTE",
        occurredAt: "2026-07-12T10:00:00.000Z",
        businessDate: "2026-07-12",
      },
      ACTOR,
    );

    // Captured BEFORE the backdated purchase: these are precisely the two values the un-guarded
    // `recordPurchase` read out of the cache to thread C-1 with.
    const stored = await readStoredState(db, item.id);
    expect(stored.wac).toBeCloseTo(2, 9);
    expect(stored.onHand).toBe(2_000);

    // The value the OLD code would have committed. Computed here, from the real pre-state, rather
    // than hard-coded — so it stays honest if the seed numbers above are ever changed.
    const naiveThreadedWac = applyWacEntry(stored.wac, stored.onHand, 10_000, 10);
    expect(naiveThreadedWac).toBeCloseTo(104_000 / 12_000, 9);

    await purchase(db, item.id, "2026-07-05", "10:00", 10_000, 10, true);

    const kardex = await readKardex(db, item.id);
    expect(kardex).toHaveLength(3);
    // Sanity: the backdated row really did land FIRST in kardex order, or the rest is vacuous.
    expect(kardex[0]?.businessDate).toBe("2026-07-05");

    const after = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });

    // (1) R-2: the stored cache equals a from-zero recompute over the committed kardex in
    //     chronological order. This is the invariant the nightly INV-5 job also audits.
    expect(after?.wac).toBeCloseTo(recomputeWacFromMovements(kardex), 9);
    expect(after?.wac).toBeCloseTo(6, 9);

    // (2) THE load-bearing assertion. Without this the test would pass against the pre-guard
    //     `recordPurchase`, which committed 8.6667 — a green test that cannot fail is worse than
    //     no test. `not.toBeCloseTo` fails when the values agree to 9 decimals.
    expect(after?.wac).not.toBeCloseTo(naiveThreadedWac, 9);
  });

  it("books the correction forward (R-4) instead of rewriting the exit's frozen snapshot", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "INV — backdate ajuste hacia adelante");

    await purchase(db, item.id, "2026-07-10", "10:00", 10_000, 2);
    const exit = await recordExit(
      db,
      {
        itemId: item.id,
        qty: 8_000,
        reason: "WASTE",
        occurredAt: "2026-07-12T10:00:00.000Z",
        businessDate: "2026-07-12",
      },
      ACTOR,
    );
    expect(exit.exit.unitCostSnapshot).toBeCloseTo(2, 9);

    const result = await purchase(db, item.id, "2026-07-05", "10:00", 10_000, 10, true);

    // Hand-computed: (frozen 2 − replayed 6) × 8 000 = −32 000. Negative per Doc 04 §3.4's sign
    // convention — the goods really cost more than was booked, so accumulated margin FELL.
    const adjustments = await db
      .select()
      .from(costingAdjustments)
      .where(eq(costingAdjustments.itemId, item.id));
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({
      itemId: item.id,
      triggerEventType: "purchase",
      triggerEventId: result.purchase.id,
      costDelta: -32_000,
    });

    // R-4: history is untouched. The exit still reports the cost it reported on the day.
    const exitRow = await db.query.stockExits.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, exit.exit.id),
    });
    expect(exitRow?.unitCostSnapshot).toBe(2);
  });
});

describe("INV-11 fast path — a same-day capture must NOT trigger a replay", () => {
  /**
   * The other half of the invariant, and the one a regression is most likely to break by
   * over-correcting: the ordinary same-day capture is the overwhelmingly common case, and it must
   * keep behaving EXACTLY as it did before KOK-024 — no replay, no adjustment row, no audit noise,
   * and the plain threaded C-1 value.
   *
   * A (day 10 10:00, 10 000 @ 2) then D (day 10 14:00, 10 000 @ 4):
   *   naive = correct = (10 000·2 + 10 000·4)/20 000 = 3.
   * Here naive and full-kardex AGREE — that agreement is the point, so this test asserts equality
   * with the naive value where the backdated test above asserts inequality.
   */
  it("threads C-1 as before, writing no costing_adjustments row and no replay audit entry", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "INV — captura del mismo día");

    await purchase(db, item.id, "2026-07-10", "10:00", 10_000, 2);

    const stored = await readStoredState(db, item.id);
    const naiveThreadedWac = applyWacEntry(stored.wac, stored.onHand, 10_000, 4);
    expect(naiveThreadedWac).toBeCloseTo(3, 9);

    // No `confirm` flag: a same-day purchase must never be refused by R-5 in the first place.
    await purchase(db, item.id, "2026-07-10", "14:00", 10_000, 4);

    const after = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    // Behaviour matches the pre-guard path exactly.
    expect(after?.wac).toBeCloseTo(naiveThreadedWac, 9);
    // ...and is still the full-kardex answer, because on this path the two coincide.
    expect(after?.wac).toBeCloseTo(recomputeWacFromMovements(await readKardex(db, item.id)), 9);

    // The observable proof that no replay ran. `costing_adjustments` alone is not enough (a replay
    // with a zero delta plans no adjustment row either), so the `costing_replay` audit row — which
    // replay.ts emits whenever it plans ANY statement — is asserted too.
    expect(
      await db.select().from(costingAdjustments).where(eq(costingAdjustments.itemId, item.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(auditLog).where(eq(auditLog.action, "costing_replay")),
    ).toHaveLength(0);
  });

  it("does not replay for an item with no kardex history at all", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "INV — sin historial previo");

    // Deeply backdated, but there is nothing behind it to disturb: INV-11's ordering test is about
    // movements that already exist, not about how old the date is.
    await purchase(db, item.id, "2026-01-02", "10:00", 5_000, 7);

    const after = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(after?.wac).toBeCloseTo(7, 9);
    expect(
      await db.select().from(auditLog).where(eq(auditLog.action, "costing_replay")),
    ).toHaveLength(0);
  });
});
