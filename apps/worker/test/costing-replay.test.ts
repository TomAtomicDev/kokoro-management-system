// Integration tests for core/costing/replay.ts + adjustments.ts (KOK-024 Phase C, Doc 03 §7
// R-2/R-4/R-5, INV-11, ADR-016). Follows the Doc 11 §3 template and purchasing.test.ts's shape:
// seed through the real service factories (createItem / recordPurchase / recordExit — D-2, never
// raw INSERTs into business tables) against real D1 via @cloudflare/vitest-pool-workers, then
// assert the PLAN rather than a committed result. `planCostingReplay` builds statements and never
// executes them, so these tests read the plan directly — which is also exactly what the dry-run
// impact endpoint (R-5) will do.
//
// The load-bearing assertion in this file is "no frozen snapshot is ever written" (R-4): the whole
// mechanism exists so that a day already reported keeps reporting the same margin. A future change
// that "helpfully" corrects `sale_lines.unit_cost_snapshot` in place would be silently destroying
// history, so the statements are inspected at the SQL level for it below.
//
// Storage is isolated per test FILE, not per test (same note as purchasing.test.ts / exits.test.ts)
// — the `beforeEach` restores the per-test guarantee. Items get a unique name per test
// (items.name is UNIQUE), so they never need resetting.
import { env } from "cloudflare:test";
import { generateUuidV7, toBusinessDate } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createItem } from "../src/core/catalog/index.js";
import type { PendingMovementChange } from "../src/core/costing/index.js";
import { planCostingReplay } from "../src/core/costing/index.js";
import { recordExit } from "../src/core/inventory/exits.js";
import { recordPurchase } from "../src/core/purchasing/index.js";
import { createDb } from "../src/db/index.js";
import {
  auditLog,
  costingAdjustments,
  financialAccounts,
  financialTransactions,
  purchases,
  stockExits,
} from "../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;

type TestDb = ReturnType<typeof createDb>;

async function seedItem(db: TestDb, name: string) {
  return createItem(db, { name, kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "KG" }, ACTOR);
}

/** A purchase of `qty` milli-units whose C-2 unit cost is exactly `unitCost` centavos/milli-unit. */
async function seedPurchase(
  db: TestDb,
  itemId: string,
  date: string,
  qty: number,
  unitCost: number,
) {
  return recordPurchase(
    db,
    {
      accountId: "acc_bank",
      occurredAt: `${date}T10:00:00.000Z`,
      businessDate: date,
      lines: [{ itemId, qty, lineTotal: qty * unitCost }],
    },
    ACTOR,
  );
}

/** The pending change under test: one brand-new backdated purchase line, expressed as the
 * post-commit movement set the caller is about to hand `buildReplaceMovementsForSourceStatements`. */
function backdatedPurchaseChange(
  itemId: string,
  purchaseId: string,
  occurredAt: string,
  businessDate: string,
  qty: number,
  unitCost: number,
): PendingMovementChange {
  return {
    sourceEventType: "purchase",
    sourceEventId: purchaseId,
    newMovements: [
      {
        itemId,
        occurredAt,
        businessDate,
        type: "PURCHASE_IN",
        qty,
        unitCost,
        sourceEventType: "purchase",
        sourceEventId: purchaseId,
      },
    ],
  };
}

/** Renders a built (never executed) statement to SQL so a test can assert on what it targets. */
function statementSql(statement: unknown): string {
  return (statement as { toSQL(): { sql: string } }).toSQL().sql;
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(costingAdjustments);
  await db.delete(auditLog).where(eq(auditLog.entityType, "purchases"));
  await db.delete(auditLog).where(eq(auditLog.entityType, "stock_exits"));
  await db
    .delete(financialTransactions)
    .where(eq(financialTransactions.sourceEventType, "purchase"));
  await db.delete(stockExits);
  // Cascades to purchase_lines and leaves no purchase-sourced kardex rows behind for the next
  // test's `latest movement` probe to trip over.
  await db.delete(purchases);
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("planCostingReplay — INV-11 fast path", () => {
  it("returns required:false with zero statements when the change lands at/after the item's latest movement", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Harina — fast path");
    await seedPurchase(db, item.id, "2026-07-10", 10_000, 2);

    const purchaseId = generateUuidV7();
    const plan = await planCostingReplay(db, {
      trigger: {
        eventType: "purchase",
        eventId: purchaseId,
        businessDate: "2026-07-15",
        occurredAt: "2026-07-15T10:00:00.000Z",
      },
      changes: [
        backdatedPurchaseChange(
          item.id,
          purchaseId,
          "2026-07-15T10:00:00.000Z",
          "2026-07-15",
          5_000,
          3,
        ),
      ],
      actor: ACTOR,
    });

    // The ordinary same-day capture: nothing sits after the touched point, so C-1's incremental
    // result is already correct and the planner must not do (or plan) any work at all.
    expect(plan.required).toBe(false);
    expect(plan.confirmationRequired).toBe(false);
    expect(plan.statements).toHaveLength(0);
    expect(plan.impact.costDelta).toBe(0);
    expect(plan.impact.affectedItemIds).toEqual([]);
    expect(plan.impact.affectedSaleLineIds).toEqual([]);
    expect(plan.impact.affectedStockExitIds).toEqual([]);
    expect(plan.impact.affectedProductionRunIds).toEqual([]);
    expect(plan.impact.requiresConfirmation).toBe(false);
  });

  it("returns required:false for an item with no kardex history at all", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Harina — sin historial");

    const purchaseId = generateUuidV7();
    const plan = await planCostingReplay(db, {
      trigger: {
        eventType: "purchase",
        eventId: purchaseId,
        businessDate: "2026-07-10",
        occurredAt: "2026-07-10T10:00:00.000Z",
      },
      changes: [
        backdatedPurchaseChange(
          item.id,
          purchaseId,
          "2026-07-10T10:00:00.000Z",
          "2026-07-10",
          5_000,
          3,
        ),
      ],
      actor: ACTOR,
    });

    expect(plan.required).toBe(false);
    expect(plan.statements).toHaveLength(0);
  });
});

describe("planCostingReplay — backdated change (R-2/R-4)", () => {
  /**
   * The canonical scenario, with numbers worked out by hand so a regression names itself.
   *
   * Recorded order: P1 10 000 @ 2 (07-10) -> exit 8 000 (07-11, freezes snapshot 2)
   *                 -> P2 10 000 @ 4 (07-12).
   *   after P1  : onHand 10 000, wac 2
   *   after exit: onHand  2 000, wac 2 (C-6 — an exit never moves the WAC)
   *   after P2  : onHand 12 000, wac (2 000·2 + 10 000·4) / 12 000 = 44 000/12 000 = 3.6667
   *
   * Now a purchase of 10 000 @ 10 is backdated to 07-10T12:00, i.e. BETWEEN P1 and the exit:
   *   prefix [P1]  -> seed onHand 10 000, wac 2
   *   P3           -> wac (10 000·2 + 10 000·10)/20 000 = 6, onHand 20 000
   *   exit         -> wacBefore 6 (frozen snapshot said 2), onHand 12 000
   *   P2           -> wac (12 000·6 + 10 000·4)/22 000 = 112 000/22 000 = 5.0909…
   *
   * cost_delta = Σ (frozen − replayed) × |qty| = (2 − 6) × 8 000 = −32 000 centavos.
   * Negative, per Doc 04 §3.4's sign convention: the goods really cost more than was booked, so
   * accumulated margin FELL.
   */
  it("replays a single item's kardex, corrects the WAC, and books the cost delta forward", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Harina — backdate con salida");

    await seedPurchase(db, item.id, "2026-07-10", 10_000, 2);
    const exit = await recordExit(
      db,
      {
        itemId: item.id,
        qty: 8_000,
        reason: "WASTE",
        occurredAt: "2026-07-11T10:00:00.000Z",
        businessDate: "2026-07-11",
      },
      ACTOR,
    );
    await seedPurchase(db, item.id, "2026-07-12", 10_000, 4);

    const before = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(before?.wac).toBeCloseTo(44_000 / 12_000, 9);

    const purchaseId = generateUuidV7();
    const plan = await planCostingReplay(db, {
      trigger: {
        eventType: "purchase",
        eventId: purchaseId,
        businessDate: "2026-07-10",
        occurredAt: "2026-07-10T12:00:00.000Z",
      },
      changes: [
        backdatedPurchaseChange(
          item.id,
          purchaseId,
          "2026-07-10T12:00:00.000Z",
          "2026-07-10",
          10_000,
          10,
        ),
      ],
      actor: ACTOR,
    });

    expect(plan.required).toBe(true);
    expect(plan.impact.affectedItemIds).toEqual([item.id]);
    expect(plan.impact.affectedStockExitIds).toEqual([exit.exit.id]);
    expect(plan.impact.costDelta).toBe(-32_000);

    // R-5: the correction changes cost already booked against a recorded exit, so the owner has
    // to see it before it lands.
    expect(plan.confirmationRequired).toBe(true);
    expect(plan.impact.requiresConfirmation).toBe(true);

    // The plan carries the corrected WAC, one adjustment row, and one audit row.
    const sqls = plan.statements.map(statementSql);
    expect(sqls.filter((sql) => /update\s+"items"/i.test(sql))).toHaveLength(1);
    expect(sqls.filter((sql) => /insert into "costing_adjustments"/i.test(sql))).toHaveLength(1);
    expect(sqls.filter((sql) => /insert into "audit_log"/i.test(sql))).toHaveLength(1);
  });

  it("dates the costing_adjustment to the correction (today), never to the backdated event (R-4)", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Harina — fecha del ajuste");

    await seedPurchase(db, item.id, "2026-07-10", 10_000, 2);
    await recordExit(
      db,
      {
        itemId: item.id,
        qty: 8_000,
        reason: "WASTE",
        occurredAt: "2026-07-11T10:00:00.000Z",
        businessDate: "2026-07-11",
      },
      ACTOR,
    );
    await seedPurchase(db, item.id, "2026-07-12", 10_000, 4);

    const purchaseId = generateUuidV7();
    const plan = await planCostingReplay(db, {
      trigger: {
        eventType: "purchase",
        eventId: purchaseId,
        businessDate: "2026-07-10",
        occurredAt: "2026-07-10T12:00:00.000Z",
      },
      changes: [
        backdatedPurchaseChange(
          item.id,
          purchaseId,
          "2026-07-10T12:00:00.000Z",
          "2026-07-10",
          10_000,
          10,
        ),
      ],
      actor: ACTOR,
    });

    // Execute just the adjustment insert to inspect the persisted row. (The production caller
    // includes the whole array in ITS OWN batch, D-3; a test may run one statement on its own.)
    const adjustmentStatement = plan.statements.find((statement) =>
      /insert into "costing_adjustments"/i.test(statementSql(statement)),
    );
    expect(adjustmentStatement).toBeDefined();
    if (adjustmentStatement === undefined) return;
    await adjustmentStatement;

    const rows = await db.select().from(costingAdjustments);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    // The trigger event is dated 2026-07-10; the correction must NOT inherit that date, or it
    // would retroactively change a day that has already been reported.
    expect(row.businessDate).not.toBe("2026-07-10");
    // INV-3: the shop's calendar day, NOT `toISOString().slice(0, 10)`. After 20:00 America/La_Paz
    // the UTC date has already rolled over, so the naive slice would file every evening correction
    // one day late — this assertion caught exactly that while it was being written.
    expect(row.businessDate).toBe(toBusinessDate(new Date()));
    expect(row.triggerEventType).toBe("purchase");
    expect(row.triggerEventId).toBe(purchaseId);
    expect(row.costDelta).toBe(-32_000);
    expect(JSON.parse(row.affectedStockExitIds)).toHaveLength(1);
    expect(JSON.parse(row.affectedSaleLineIds)).toEqual([]);
  });
});

describe("planCostingReplay — R-5 confirmation gate", () => {
  it("does NOT require confirmation when the replay moves no already-frozen cost", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Harina — sin consumidores");

    // Two purchases and nothing that consumed the item: a backdated purchase between them still
    // fires INV-11 (there IS a later movement), but there is no frozen snapshot to contradict, so
    // there is nothing for the owner to confirm.
    await seedPurchase(db, item.id, "2026-07-10", 10_000, 2);
    await seedPurchase(db, item.id, "2026-07-12", 10_000, 4);

    const purchaseId = generateUuidV7();
    const plan = await planCostingReplay(db, {
      trigger: {
        eventType: "purchase",
        eventId: purchaseId,
        businessDate: "2026-07-11",
        occurredAt: "2026-07-11T10:00:00.000Z",
      },
      changes: [
        backdatedPurchaseChange(
          item.id,
          purchaseId,
          "2026-07-11T10:00:00.000Z",
          "2026-07-11",
          10_000,
          10,
        ),
      ],
      actor: ACTOR,
    });

    expect(plan.required).toBe(true);
    expect(plan.confirmationRequired).toBe(false);
    expect(plan.impact.requiresConfirmation).toBe(false);
    expect(plan.impact.affectedSaleLineIds).toEqual([]);
    expect(plan.impact.affectedStockExitIds).toEqual([]);
    expect(plan.impact.affectedProductionRunIds).toEqual([]);
    expect(plan.impact.costDelta).toBe(0);
    // No costing_adjustments row is planned for a zero delta.
    const sqls = plan.statements.map(statementSql);
    expect(sqls.filter((sql) => /insert into "costing_adjustments"/i.test(sql))).toHaveLength(0);
  });
});

describe("planCostingReplay — R-4: frozen snapshots are read, never written", () => {
  it("plans ZERO writes targeting sale_lines or stock_exits", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Harina — snapshots congelados");

    await seedPurchase(db, item.id, "2026-07-10", 10_000, 2);
    await recordExit(
      db,
      {
        itemId: item.id,
        qty: 8_000,
        reason: "WASTE",
        occurredAt: "2026-07-11T10:00:00.000Z",
        businessDate: "2026-07-11",
      },
      ACTOR,
    );
    await seedPurchase(db, item.id, "2026-07-12", 10_000, 4);

    const purchaseId = generateUuidV7();
    const plan = await planCostingReplay(db, {
      trigger: {
        eventType: "purchase",
        eventId: purchaseId,
        businessDate: "2026-07-10",
        occurredAt: "2026-07-10T12:00:00.000Z",
      },
      changes: [
        backdatedPurchaseChange(
          item.id,
          purchaseId,
          "2026-07-10T12:00:00.000Z",
          "2026-07-10",
          10_000,
          10,
        ),
      ],
      actor: ACTOR,
    });

    // The replay demonstrably HAS an affected exit (so this assertion is not vacuous) ...
    expect(plan.impact.affectedStockExitIds.length).toBeGreaterThan(0);
    expect(plan.statements.length).toBeGreaterThan(0);

    // ... and yet not one planned statement mutates the tables holding the frozen snapshots.
    for (const statement of plan.statements) {
      const sql = statementSql(statement);
      expect(sql).not.toMatch(/(insert into|update|delete from)\s+"?sale_lines"?/i);
      expect(sql).not.toMatch(/(insert into|update|delete from)\s+"?stock_exits"?/i);
    }

    // The frozen snapshot itself is still exactly what the exit recorded at the time.
    const exitRows = await db.select().from(stockExits);
    expect(exitRows).toHaveLength(1);
    expect(exitRows[0]?.unitCostSnapshot).toBe(2);
  });
});
