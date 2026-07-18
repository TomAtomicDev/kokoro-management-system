// Integration tests for core/inventory/counts.ts (KOK-019, Doc 03 §3 UC-10, Doc 04 §3.3
// `inventory_counts` / `inventory_count_lines`). Follows the Doc 11 §3 template: seed via
// createItem/recordPurchase (the same seams purchasing.test.ts/exits.test.ts use) -> execute
// startCount/updateCountLine/commitCount -> assert the count/line rows, ADJUST movements,
// item_stock, and audit_log, run against real D1 via @cloudflare/vitest-pool-workers.
//
// THE single most important test in this file (see core/inventory/counts.ts's header) is
// "frozen-snapshot semantics": expectedQty is captured ONCE at startCount time and MUST NOT be
// re-derived from live item_stock at commit time, even when other events (an unrelated purchase)
// change that item's live stock while the count is still DRAFT. Get this wrong and inventory data
// is silently corrupted — it is asserted first, and again via the property test at the bottom.
//
// Storage is isolated per test FILE, not per test (mirrors purchasing.test.ts/exits.test.ts's
// identical note) — the `beforeEach` below clears inventory_counts (cascades to
// inventory_count_lines), purchases (cascades to purchase_lines), their audit/movement/transaction
// rows, and resets both seeded accounts to balance 0. Items get unique names per test (items.name
// is UNIQUE) so seeded rows never collide across tests. Because items are never deleted between
// tests, an UNSCOPED startCount (no kind/category filter) may resolve items created by earlier
// tests too — this is harmless (their lines default to zero variance and are never touched, so
// they produce no movements) and every assertion below checks specific items by id rather than
// exact array lengths, precisely to stay correct under that accumulation.
import { env } from "cloudflare:test";
import { generateUuidV7 } from "@kokoro/shared";
import { eq, inArray } from "drizzle-orm";
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";

import { createItem, setItemActive } from "../src/core/catalog/index.js";
import {
  commitCount,
  getCount,
  listCounts,
  startCount,
  updateCountLine,
} from "../src/core/inventory/counts.js";
import { recordPurchase } from "../src/core/purchasing/index.js";
import { createDb } from "../src/db/index.js";
import {
  auditLog,
  financialAccounts,
  financialTransactions,
  inventoryCounts,
  purchases,
  stockMovements,
} from "../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;
const NOW = "2026-07-16T10:00:00.000Z";
const BUSINESS_DATE = "2026-07-16";

type TestDb = ReturnType<typeof createDb>;
type ItemKind = "RAW_MATERIAL" | "SEMI_FINISHED" | "FINISHED";
type ItemCategory = "INGREDIENT" | "PACKAGING" | "LABEL" | "BAKERY" | "DAIRY" | "OTHER";

async function seedItem(
  db: TestDb,
  name: string,
  kind: ItemKind = "RAW_MATERIAL",
  category: ItemCategory = "INGREDIENT",
) {
  return createItem(db, { name, kind, category, unit: "KG" }, ACTOR);
}

async function seedItemWithStock(
  db: TestDb,
  name: string,
  qty: number,
  kind: ItemKind = "RAW_MATERIAL",
  category: ItemCategory = "INGREDIENT",
) {
  const item = await seedItem(db, name, kind, category);
  await recordPurchase(
    db,
    {
      accountId: "acc_bank",
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId: item.id, qty, lineTotal: qty * 10 }],
    },
    ACTOR,
  );
  return item;
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(auditLog).where(inArray(auditLog.entityType, ["inventory_counts", "purchases"]));
  await db
    .delete(stockMovements)
    .where(inArray(stockMovements.sourceEventType, ["inventory_count", "purchase"]));
  await db
    .delete(financialTransactions)
    .where(eq(financialTransactions.sourceEventType, "purchase"));
  await db.delete(inventoryCounts); // cascades to inventory_count_lines (onDelete: cascade FK)
  await db.delete(purchases); // cascades to purchase_lines
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("startCount (UC-10 step 1) — frozen-snapshot semantics", () => {
  it("freezes expectedQty at count-start time; a LATER unrelated purchase does NOT change the frozen value, and commit adjusts against the FROZEN value, not live stock", async () => {
    const db = createDb(env.DB);
    const item = await seedItemWithStock(db, "Snapshot semantics item", 10);

    const started = await startCount(db, { occurredAt: NOW, businessDate: BUSINESS_DATE }, ACTOR);
    const line = started.count.lines.find((l) => l.itemId === item.id);
    expect(line?.expectedQty).toBe(10);
    expect(line?.countedQty).toBe(10); // defaults to expectedQty ("no variance yet")

    // An UNRELATED event lands mid-count: a second purchase brings live stock to 15, while the
    // count above is still DRAFT and its frozen expectedQty stays 10.
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 5, lineTotal: 50 }],
      },
      ACTOR,
    );
    const liveStockMidCount = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(liveStockMidCount?.qtyOnHand).toBe(15); // sanity check: live stock DID move

    await updateCountLine(
      db,
      { countId: started.count.id, itemId: item.id, countedQty: 12 },
      ACTOR,
    );

    const committed = await commitCount(db, { countId: started.count.id }, ACTOR);
    const adjustment = committed.adjustments.find((a) => a.itemId === item.id);
    // 12 - 10 (FROZEN expected), NOT 12 - 15 (live at commit time) — the whole point of this test.
    expect(adjustment?.delta).toBe(2);

    const movementRow = await db.query.stockMovements.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.sourceEventType, "inventory_count"), eqOp(t.itemId, item.id)),
    });
    expect(movementRow).toMatchObject({ type: "ADJUST", qty: 2, sourceEventId: started.count.id });

    const finalStock = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(finalStock?.qtyOnHand).toBe(17); // 15 (live at commit) + 2 (the adjustment) — a NET delta

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, started.count.id), eqOp(t.action, "commit")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "inventory_counts" });
  });

  it("scopes lines by kind/category (always isActive: true); unscoped includes all active items; inactive items never get lines", async () => {
    const db = createDb(env.DB);
    const itemIngredient = await seedItem(db, "Scope ingredient item", "RAW_MATERIAL", "PACKAGING");
    const itemFinished = await seedItem(db, "Scope finished item", "FINISHED", "BAKERY");
    const itemInactive = await seedItem(db, "Scope inactive item", "RAW_MATERIAL", "PACKAGING");
    await setItemActive(db, { id: itemInactive.id, isActive: false }, ACTOR);

    const categoryScoped = await startCount(
      db,
      { category: "PACKAGING", occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );
    const categoryItemIds = categoryScoped.count.lines.map((l) => l.itemId);
    expect(categoryItemIds).toContain(itemIngredient.id);
    expect(categoryItemIds).not.toContain(itemFinished.id);
    expect(categoryItemIds).not.toContain(itemInactive.id); // inactive, even though same category

    const kindScoped = await startCount(
      db,
      { kind: "FINISHED", occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );
    const kindItemIds = kindScoped.count.lines.map((l) => l.itemId);
    expect(kindItemIds).toContain(itemFinished.id);
    expect(kindItemIds).not.toContain(itemIngredient.id);

    const unscoped = await startCount(db, { occurredAt: NOW, businessDate: BUSINESS_DATE }, ACTOR);
    const unscopedItemIds = unscoped.count.lines.map((l) => l.itemId);
    expect(unscopedItemIds).toContain(itemIngredient.id);
    expect(unscopedItemIds).toContain(itemFinished.id);
    expect(unscopedItemIds).not.toContain(itemInactive.id); // inactive items never get lines
  });

  it("throws VALIDATION when the resolved (active) item set is empty", async () => {
    const db = createDb(env.DB);
    // A kind/category combo used ONLY in this test, deactivated immediately, so the resolved set
    // is guaranteed empty regardless of what other tests in this file have seeded.
    const item = await seedItem(db, "Empty scope item", "SEMI_FINISHED", "LABEL");
    await setItemActive(db, { id: item.id, isActive: false }, ACTOR);

    await expect(
      startCount(
        db,
        { kind: "SEMI_FINISHED", category: "LABEL", occurredAt: NOW, businessDate: BUSINESS_DATE },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("updateCountLine (UC-10 step 2)", () => {
  it("persists countedQty on a DRAFT count", async () => {
    const db = createDb(env.DB);
    const item = await seedItemWithStock(db, "Update line item", 10, "RAW_MATERIAL", "DAIRY");
    const started = await startCount(
      db,
      { category: "DAIRY", occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );

    const result = await updateCountLine(
      db,
      { countId: started.count.id, itemId: item.id, countedQty: 7 },
      ACTOR,
    );
    expect(result.line).toMatchObject({ itemId: item.id, expectedQty: 10, countedQty: 7 });

    const persisted = await getCount(db, started.count.id);
    expect(persisted.lines.find((l) => l.itemId === item.id)?.countedQty).toBe(7);
  });

  it("rejects editing a line on an already-COMMITTED count with CONFLICT", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Committed edit item", "RAW_MATERIAL", "LABEL");
    const started = await startCount(
      db,
      { category: "LABEL", occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );
    await commitCount(db, { countId: started.count.id }, ACTOR);

    await expect(
      updateCountLine(db, { countId: started.count.id, itemId: item.id, countedQty: 5 }, ACTOR),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects an unknown (countId, itemId) pair with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    const includedItem = await seedItem(db, "Unknown pair included item", "RAW_MATERIAL", "DAIRY");
    const excludedItem = await seedItem(db, "Unknown pair excluded item", "RAW_MATERIAL", "OTHER");
    const started = await startCount(
      db,
      { category: "DAIRY", occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );
    expect(started.count.lines.map((l) => l.itemId)).toContain(includedItem.id);

    await expect(
      updateCountLine(
        db,
        { countId: started.count.id, itemId: excludedItem.id, countedQty: 5 },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("commitCount (UC-10 step 3)", () => {
  it("zero-variance lines produce NO movement; mixed lines only adjust the nonzero ones", async () => {
    const db = createDb(env.DB);
    const itemZero = await seedItemWithStock(db, "Mixed zero item", 10, "RAW_MATERIAL", "DAIRY");
    const itemPlus = await seedItemWithStock(db, "Mixed plus item", 10, "RAW_MATERIAL", "DAIRY");
    const itemMinus = await seedItemWithStock(db, "Mixed minus item", 10, "RAW_MATERIAL", "DAIRY");

    const started = await startCount(
      db,
      { category: "DAIRY", occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );
    await updateCountLine(
      db,
      { countId: started.count.id, itemId: itemZero.id, countedQty: 10 },
      ACTOR,
    ); // delta 0
    await updateCountLine(
      db,
      { countId: started.count.id, itemId: itemPlus.id, countedQty: 15 },
      ACTOR,
    ); // delta +5
    await updateCountLine(
      db,
      { countId: started.count.id, itemId: itemMinus.id, countedQty: 4 },
      ACTOR,
    ); // delta -6

    const committed = await commitCount(db, { countId: started.count.id }, ACTOR);
    expect(committed.adjustments).toEqual(
      expect.arrayContaining([
        { itemId: itemPlus.id, delta: 5 },
        { itemId: itemMinus.id, delta: -6 },
      ]),
    );
    expect(committed.adjustments.find((a) => a.itemId === itemZero.id)).toBeUndefined();

    const zeroMovement = await db.query.stockMovements.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.sourceEventType, "inventory_count"), eqOp(t.itemId, itemZero.id)),
    });
    expect(zeroMovement).toBeUndefined();

    const plusMovement = await db.query.stockMovements.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.sourceEventType, "inventory_count"), eqOp(t.itemId, itemPlus.id)),
    });
    expect(plusMovement).toMatchObject({ type: "ADJUST", qty: 5 });

    const minusMovement = await db.query.stockMovements.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.sourceEventType, "inventory_count"), eqOp(t.itemId, itemMinus.id)),
    });
    expect(minusMovement).toMatchObject({ type: "ADJUST", qty: -6 });
  });

  it("a perfect count (all lines zero-variance) commits successfully with an empty adjustments array and NO movements at all", async () => {
    const db = createDb(env.DB);
    const item = await seedItemWithStock(db, "Perfect count item", 10, "RAW_MATERIAL", "OTHER");
    const started = await startCount(
      db,
      { category: "OTHER", occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );
    // Never touch countedQty — it defaults to expectedQty, i.e. zero variance for every line.

    const committed = await commitCount(db, { countId: started.count.id }, ACTOR);
    expect(committed.adjustments).toEqual([]);
    expect(committed.count.status).toBe("COMMITTED");

    const movements = await db.query.stockMovements.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, started.count.id),
    });
    expect(movements).toHaveLength(0);

    const stockRow = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
    });
    expect(stockRow?.qtyOnHand).toBe(10); // untouched
  });

  it("rejects committing an already-COMMITTED count with CONFLICT (double-commit)", async () => {
    const db = createDb(env.DB);
    await seedItem(db, "Double commit item", "RAW_MATERIAL", "LABEL");
    const started = await startCount(
      db,
      { category: "LABEL", occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );
    await commitCount(db, { countId: started.count.id }, ACTOR);

    await expect(commitCount(db, { countId: started.count.id }, ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("values the ADJUST movement at the item's WAC AT COMMIT TIME, not at count-start time", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "WAC at commit item", "RAW_MATERIAL", "INGREDIENT");
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 10, lineTotal: 20 }], // unit cost 2, wac=2, stock=10
      },
      ACTOR,
    );

    const started = await startCount(
      db,
      { occurredAt: NOW, businessDate: BUSINESS_DATE, category: "INGREDIENT" },
      ACTOR,
    );
    const lineAtStart = started.count.lines.find((l) => l.itemId === item.id);
    expect(lineAtStart?.expectedQty).toBe(10);

    // WAC changes BETWEEN startCount and commitCount: wac' = (10*2 + 10*6) / 20 = 4.
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 10, lineTotal: 60 }],
      },
      ACTOR,
    );
    const itemAfterSecondPurchase = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemAfterSecondPurchase?.wac).toBe(4);

    await updateCountLine(
      db,
      { countId: started.count.id, itemId: item.id, countedQty: 25 },
      ACTOR,
    );
    const committed = await commitCount(db, { countId: started.count.id }, ACTOR);
    expect(committed.adjustments.find((a) => a.itemId === item.id)?.delta).toBe(15); // 25 - 10 (frozen)

    const movementRow = await db.query.stockMovements.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.sourceEventType, "inventory_count"), eqOp(t.itemId, item.id)),
    });
    expect(movementRow?.unitCost).toBe(4); // WAC at COMMIT time, not the 2 it was at count-start

    // C-6-style invariant (mirrors exits.ts): valuing the ADJUST at current WAC must not itself
    // mutate that WAC.
    const itemAfterCommit = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(itemAfterCommit?.wac).toBe(4);
  });

  it("multi-item count: several deltas (mixed sign) update each item's stock independently", async () => {
    const db = createDb(env.DB);
    const item1 = await seedItemWithStock(db, "Multi item 1", 20, "RAW_MATERIAL", "BAKERY");
    const item2 = await seedItemWithStock(db, "Multi item 2", 30, "RAW_MATERIAL", "BAKERY");
    const item3 = await seedItemWithStock(db, "Multi item 3", 40, "RAW_MATERIAL", "BAKERY");

    const started = await startCount(
      db,
      { category: "BAKERY", occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );
    await updateCountLine(
      db,
      { countId: started.count.id, itemId: item1.id, countedQty: 25 },
      ACTOR,
    ); // +5
    await updateCountLine(
      db,
      { countId: started.count.id, itemId: item2.id, countedQty: 22 },
      ACTOR,
    ); // -8
    // item3 left untouched -> delta 0

    await commitCount(db, { countId: started.count.id }, ACTOR);

    const stock1 = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item1.id),
    });
    const stock2 = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item2.id),
    });
    const stock3 = await db.query.itemStock.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.itemId, item3.id),
    });
    expect(stock1?.qtyOnHand).toBe(25);
    expect(stock2?.qtyOnHand).toBe(22);
    expect(stock3?.qtyOnHand).toBe(40); // untouched
  });
});

describe("reads: getCount / listCounts", () => {
  it("getCount returns the count with its lines; NOT_FOUND for a missing id", async () => {
    const db = createDb(env.DB);
    await seedItem(db, "Read count item", "RAW_MATERIAL", "PACKAGING");
    const started = await startCount(
      db,
      { category: "PACKAGING", occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );

    const fetched = await getCount(db, started.count.id);
    expect(fetched.id).toBe(started.count.id);
    expect(fetched.lines.length).toBeGreaterThan(0);

    await expect(getCount(db, "does_not_exist")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("listCounts filters by status and date range", async () => {
    const db = createDb(env.DB);
    await seedItem(db, "List count item", "RAW_MATERIAL", "DAIRY");

    const draft = await startCount(
      db,
      { category: "DAIRY", occurredAt: "2026-07-14T10:00:00.000Z", businessDate: "2026-07-14" },
      ACTOR,
    );
    const toCommit = await startCount(
      db,
      { category: "DAIRY", occurredAt: "2026-07-16T10:00:00.000Z", businessDate: "2026-07-16" },
      ACTOR,
    );
    await commitCount(db, { countId: toCommit.count.id }, ACTOR);

    const { counts: draftCounts } = await listCounts(db, { status: "DRAFT" });
    expect(draftCounts.map((c) => c.id)).toContain(draft.count.id);
    expect(draftCounts.map((c) => c.id)).not.toContain(toCommit.count.id);

    const { counts: committedCounts } = await listCounts(db, { status: "COMMITTED" });
    expect(committedCounts.map((c) => c.id)).toContain(toCommit.count.id);
    expect(committedCounts.map((c) => c.id)).not.toContain(draft.count.id);

    const { counts: byDate } = await listCounts(db, {
      fromDate: "2026-07-15",
      toDate: "2026-07-16",
    });
    expect(byDate.map((c) => c.id)).toContain(toCommit.count.id);
    expect(byDate.map((c) => c.id)).not.toContain(draft.count.id);
  });
});

describe("batch atomicity (INV-1) for commitCount", () => {
  it("a failing statement in the same shape of batch as commitCount leaves the count DRAFT and no movements persisted", async () => {
    const db = createDb(env.DB);
    const item = await seedItemWithStock(
      db,
      "Atomicity count item",
      10,
      "RAW_MATERIAL",
      "PACKAGING",
    );
    const started = await startCount(
      db,
      { category: "PACKAGING", occurredAt: NOW, businessDate: BUSINESS_DATE },
      ACTOR,
    );
    await updateCountLine(
      db,
      { countId: started.count.id, itemId: item.id, countedQty: 15 },
      ACTOR,
    );

    // Mirrors the statement shape commitCount() builds (inventory_counts status update + ADJUST
    // movement insert), but the movement row uses an invalid `type` value that violates
    // stock_movements_type_check — run as a raw D1 batch (not through commitCount, whose own
    // buildStockMovementStatements call would reject an invalid type before ever reaching
    // db.batch) to prove the status update ahead of it never lands either.
    await expect(
      env.DB.batch([
        env.DB.prepare(
          "UPDATE inventory_counts SET status = 'COMMITTED', updated_at = ? WHERE id = ?",
        ).bind(NOW, started.count.id),
        env.DB.prepare(
          `INSERT INTO stock_movements (id, occurred_at, business_date, item_id, type, qty, unit_cost, total_cost, source_event_type, source_event_id, created_at)
           VALUES ('movement_atomicity_test', ?, ?, ?, 'NOT_A_REAL_TYPE', 5, 0, 0, 'inventory_count', ?, ?)`,
        ).bind(NOW, BUSINESS_DATE, item.id, started.count.id, NOW),
      ]),
    ).rejects.toThrow();

    const countRow = await env.DB.prepare("SELECT status FROM inventory_counts WHERE id = ?")
      .bind(started.count.id)
      .first<{ status: string }>();
    expect(countRow?.status).toBe("DRAFT");

    const movementRow = await env.DB.prepare(
      "SELECT id FROM stock_movements WHERE id = 'movement_atomicity_test'",
    ).first();
    expect(movementRow).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Property test (Doc 11 §2, mandatory for stock/money math per D-5/CLAUDE.md) — the strongest
// possible test of the frozen-snapshot rule: generates sequences that mix standalone purchases
// with FULL count cycles (start -> 0..3 interleaved purchases while still DRAFT -> set a random
// countedQty -> commit) against one fixed item, and asserts item_stock.qty_on_hand always matches
// a hand-tracked total computed via the SAME frozen-expectedQty rule the implementation is
// supposed to follow. `interleavedPurchases` is what makes this discriminating: it deliberately
// produces cases where an event lands strictly BETWEEN a count's start and its commit.
// ---------------------------------------------------------------------------

describe("property: count cycles interleaved with purchases keep item_stock consistent with frozen-snapshot semantics (INV-5 in miniature)", () => {
  it("∀ sequences of standalone purchases and full count cycles (with purchases interleaved mid-count) against a fixed item: qty_on_hand always equals a frozen-expectedQty hand-tracked total", async () => {
    const db = createDb(env.DB);

    // lineTotal starts at 1 (not 0): a zero-total purchase is valid (recordPurchase skips the
    // financial_transactions row in that case, see core/purchasing) but that's core/purchasing's
    // own concern, not this module's — the generator sidesteps it to keep this property test
    // focused on count semantics.
    const purchaseArb = fc.record({
      qty: fc.integer({ min: 1, max: 500 }),
      lineTotal: fc.integer({ min: 1, max: 5000 }),
    });
    const standalonePurchaseArb = fc.record({
      op: fc.constant("purchase" as const),
      purchase: purchaseArb,
    });
    const countCycleArb = fc.record({
      op: fc.constant("count" as const),
      interleavedPurchases: fc.array(purchaseArb, { minLength: 0, maxLength: 3 }),
      countedQty: fc.integer({ min: 0, max: 2000 }),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.oneof(standalonePurchaseArb, countCycleArb), { minLength: 1, maxLength: 8 }),
        async (rounds) => {
          // Fresh item every run (unique name, items.name is UNIQUE), scoped to a category used
          // only by this property test so each run's counts stay small.
          const runId = generateUuidV7();
          const item = await seedItem(
            db,
            `Property snapshot item ${runId}`,
            "RAW_MATERIAL",
            "OTHER",
          );

          let trackedOnHand = 0;

          for (const round of rounds) {
            if (round.op === "purchase") {
              await recordPurchase(
                db,
                {
                  accountId: "acc_bank",
                  occurredAt: NOW,
                  businessDate: BUSINESS_DATE,
                  lines: [
                    {
                      itemId: item.id,
                      qty: round.purchase.qty,
                      lineTotal: round.purchase.lineTotal,
                    },
                  ],
                },
                ACTOR,
              );
              trackedOnHand += round.purchase.qty;
            } else {
              // FROZEN at start — this is the value commitCount's ADJUST delta must be computed
              // against, regardless of what interleavedPurchases do to live stock below.
              const expectedQtyAtStart = trackedOnHand;
              const started = await startCount(
                db,
                { category: "OTHER", occurredAt: NOW, businessDate: BUSINESS_DATE },
                ACTOR,
              );
              const ourLine = started.count.lines.find((l) => l.itemId === item.id);
              expect(ourLine?.expectedQty).toBe(expectedQtyAtStart);

              for (const p of round.interleavedPurchases) {
                await recordPurchase(
                  db,
                  {
                    accountId: "acc_bank",
                    occurredAt: NOW,
                    businessDate: BUSINESS_DATE,
                    lines: [{ itemId: item.id, qty: p.qty, lineTotal: p.lineTotal }],
                  },
                  ACTOR,
                );
                trackedOnHand += p.qty;
              }

              await updateCountLine(
                db,
                { countId: started.count.id, itemId: item.id, countedQty: round.countedQty },
                ACTOR,
              );
              await commitCount(db, { countId: started.count.id }, ACTOR);

              // Frozen-snapshot semantics: delta is against expectedQtyAtStart, NEVER the live
              // stock at commit time (which interleavedPurchases above may have moved).
              trackedOnHand += round.countedQty - expectedQtyAtStart;
            }
          }

          const stockRow = await db.query.itemStock.findFirst({
            where: (t, { eq: eqOp }) => eqOp(t.itemId, item.id),
          });
          expect(stockRow?.qtyOnHand ?? 0).toBe(trackedOnHand);
        },
      ),
      { numRuns: 15 },
    );
  });
});
