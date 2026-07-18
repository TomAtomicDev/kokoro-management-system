// Integration tests for jobs/daily-snapshot.ts's runDailySnapshot (KOK-021). Follows the Doc 11
// §3 template: seed real state via core/ service factories (createItem, recordPurchase,
// recordTransaction — the same seams inventory-queries.test.ts/finance.test.ts use), run the job
// against real D1 (test/setup.ts applies migrations/0001_init.sql first), then assert the
// daily_snapshots + job_runs rows it writes, plus (mirroring costing-repair.test.ts's assertion
// style, but at the ORCHESTRATION level — this file doesn't re-derive buildWacRepairIfDrifted's
// own unit coverage) the R-2 WAC-repair audit trail for a deliberately-drifted item.
//
// Storage is isolated per test FILE, not per test (mirrors every other integration test file's
// identical note). The beforeEach below wipes every table this job reads/writes across a run
// (job_runs, daily_snapshots, audit_log, financial_transactions, stock_movements, item_stock,
// purchases) and resets both seeded accounts to balance 0 — a fuller wipe than most other test
// files use, because runDailySnapshot iterates over EVERY item in v_stock and EVERY active
// account each run: leftover derived rows from an earlier test in this file would otherwise leak
// into this test's job_runs.detail mismatch/repair counts. `items`/`financial_accounts` rows
// themselves are never deleted (items.name is UNIQUE, same precedent as every other test file), so
// each test uses a unique item name.
import { env } from "cloudflare:test";
import { generateUuidV7, toBusinessDate } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createItem } from "../src/core/catalog/index.js";
import { recordPurchase } from "../src/core/purchasing/index.js";
import { createDb } from "../src/db/index.js";
import {
  auditLog,
  dailySnapshots,
  financialAccounts,
  financialTransactions,
  itemStock,
  items,
  jobRuns,
  purchases,
  stockMovements,
} from "../src/db/schema.js";
import { runDailySnapshot } from "../src/jobs/daily-snapshot.js";

const ACTOR = "OWNER_WEB" as const;

type TestDb = ReturnType<typeof createDb>;

async function seedItem(db: TestDb, name: string) {
  return createItem(db, { name, kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "KG" }, ACTOR);
}

/** Mirrors costing-repair.test.ts's seedItem/seedMovement fixtures: an item whose stored `wac`
 * (deliberately set to 100) disagrees with what its kardex implies (a single purchase-shaped
 * movement of 1000 @ 200 -> true wac 200), so R-2's >1% drift threshold is tripped. */
async function seedDriftedItem(db: TestDb, name: string) {
  const item = await seedItem(db, name);
  await db.update(items).set({ wac: 100 }).where(eq(items.id, item.id));
  await db.insert(stockMovements).values({
    id: generateUuidV7(),
    occurredAt: "2026-07-01T10:00:00.000Z",
    businessDate: "2026-07-01",
    itemId: item.id,
    type: "PURCHASE_IN",
    qty: 1000,
    unitCost: 200,
    totalCost: 200000,
    sourceEventType: "test_fixture",
    sourceEventId: "fixture_drift",
    createdAt: "2026-07-01T10:00:00.000Z",
  });
  return item;
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(jobRuns);
  await db.delete(dailySnapshots);
  await db.delete(auditLog);
  // counterpart_tx_id is a self-referencing FK (ON DELETE restrict, not deferred) — mirrors
  // finance.test.ts's identical null-out-before-delete precaution.
  await db.update(financialTransactions).set({ counterpartTxId: null });
  await db.delete(financialTransactions);
  await db.delete(purchases); // cascades to purchase_lines
  await db.delete(stockMovements);
  await db.delete(itemStock);
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("runDailySnapshot (KOK-021)", () => {
  it("writes a daily_snapshots row for today's business date and an ok=1 job_runs row", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Daily snapshot happy item");
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: new Date().toISOString(),
        businessDate: toBusinessDate(new Date()),
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 2500 }],
      },
      ACTOR,
    );

    await runDailySnapshot(db);

    const businessDate = toBusinessDate(new Date());
    const snapshot = await db.query.dailySnapshots.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.businessDate, businessDate),
    });
    expect(snapshot).toBeDefined();
    // Every prior test's item_stock/stock_movements are wiped in beforeEach, so this item is the
    // sole contributor to v_stock's total: qty 1000 @ wac 2.5 (2500/1000) = stock_value 2500.
    expect(snapshot?.stockValue).toBe(2500);
    expect(snapshot?.bankBalance).toBe(-2500); // the purchase's SUPPLY_PURCHASE expense debited acc_bank
    expect(snapshot?.cashBalance).toBe(0);
    expect(snapshot?.accountsReceivable).toBe(0); // no sales fixtures seeded
    expect(snapshot?.customerDeposits).toBe(0);

    const jobRunRows = await db.query.jobRuns.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.job, "daily-snapshot"),
    });
    expect(jobRunRows).toHaveLength(1);
    expect(jobRunRows[0]?.ok).toBe(1);
    expect(jobRunRows[0]?.finishedAt).not.toBeNull();

    const detail = JSON.parse(jobRunRows[0]?.detail ?? "null");
    expect(Array.isArray(detail.stockMismatches)).toBe(true);
    expect(Array.isArray(detail.balanceMismatches)).toBe(true);
    expect(typeof detail.wacRepairCount).toBe("number");
  });

  it("is idempotent: a second run for the same business date upserts the snapshot row instead of duplicating it", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Daily snapshot idempotency item");
    await recordPurchase(
      db,
      {
        accountId: "acc_cash",
        occurredAt: new Date().toISOString(),
        businessDate: toBusinessDate(new Date()),
        lines: [{ itemId: item.id, qty: 500, lineTotal: 1000 }],
      },
      ACTOR,
    );

    await runDailySnapshot(db);
    await expect(runDailySnapshot(db)).resolves.not.toThrow();

    const businessDate = toBusinessDate(new Date());
    const snapshots = await db.query.dailySnapshots.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.businessDate, businessDate),
    });
    expect(snapshots).toHaveLength(1); // upserted, not duplicated (business_date is the PK)
    expect(snapshots[0]?.cashBalance).toBe(-1000);

    // Each run still gets its own job_runs row (job_runs.id is a fresh uuid every time, no PK
    // collision) — two runs -> two observability rows, even though only one snapshot row exists.
    const jobRunRows = await db.query.jobRuns.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.job, "daily-snapshot"),
    });
    expect(jobRunRows).toHaveLength(2);
    expect(jobRunRows.every((r) => r.ok === 1)).toBe(true);
  });

  it("repairs a drifted item's WAC (R-2) during the run and writes a costing_repair audit row", async () => {
    const db = createDb(env.DB);
    const item = await seedDriftedItem(db, "Daily snapshot drifted item");

    await runDailySnapshot(db);

    const updatedItem = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, item.id),
    });
    expect(updatedItem?.wac).toBe(200); // recomputed from the kardex, replacing the drifted 100

    const repairAuditRows = await db.query.auditLog.findMany({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, item.id), eqOp(t.action, "costing_repair")),
    });
    expect(repairAuditRows).toHaveLength(1);
    expect(repairAuditRows[0]).toMatchObject({ actor: "SYSTEM", entityType: "items" });
    expect(JSON.parse(repairAuditRows[0]?.beforeJson ?? "null")).toEqual({ wac: 100 });
    expect(JSON.parse(repairAuditRows[0]?.afterJson ?? "null")).toEqual({ wac: 200 });

    const jobRunRows = await db.query.jobRuns.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.job, "daily-snapshot"),
    });
    expect(jobRunRows).toHaveLength(1);
    expect(jobRunRows[0]?.ok).toBe(1);
    const detail = JSON.parse(jobRunRows[0]?.detail ?? "null");
    expect(detail.wacRepairCount).toBeGreaterThanOrEqual(1);
  });
});
