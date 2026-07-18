// core/jobs.ts's builders only build queries (mirrors test/audit.test.ts's identical framing for
// buildAuditLogInsert); this proves buildDailySnapshotUpsert/buildJobRunInsert actually write the
// rows they promise when executed via a real db.batch() (Doc 08 D-3), and that the snapshot
// builder's upsert genuinely overwrites rather than conflicting on a second call for the same
// business_date. jobs/daily-snapshot.test.ts covers these at the orchestration level (a full
// runDailySnapshot run); this file is the builders' own unit coverage, one tier down.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { buildDailySnapshotUpsert, buildJobRunInsert, getLatestJobRun } from "../src/core/jobs.js";
import { createDb } from "../src/db/index.js";

describe("buildDailySnapshotUpsert", () => {
  it("inserts a new daily_snapshots row for a business date that doesn't exist yet", async () => {
    const db = createDb(env.DB);
    await db.batch([
      buildDailySnapshotUpsert(db, {
        businessDate: "2026-07-18",
        stockValue: 1000,
        bankBalance: 2000,
        cashBalance: 300,
        accountsReceivable: 0,
        customerDeposits: 0,
        createdAt: "2026-07-18T09:00:00.000Z",
      }),
    ]);

    const row = await db.query.dailySnapshots.findFirst({
      where: (t, { eq }) => eq(t.businessDate, "2026-07-18"),
    });
    expect(row).toMatchObject({ stockValue: 1000, bankBalance: 2000, cashBalance: 300 });
  });

  it("overwrites (does not conflict) on a second call for the same business_date", async () => {
    const db = createDb(env.DB);
    const businessDate = "2026-07-19";
    await db.batch([
      buildDailySnapshotUpsert(db, {
        businessDate,
        stockValue: 1000,
        bankBalance: 1000,
        cashBalance: 1000,
        accountsReceivable: 0,
        customerDeposits: 0,
        createdAt: "2026-07-19T09:00:00.000Z",
      }),
    ]);
    await db.batch([
      buildDailySnapshotUpsert(db, {
        businessDate,
        stockValue: 5000,
        bankBalance: 6000,
        cashBalance: 7000,
        accountsReceivable: 100,
        customerDeposits: 50,
        createdAt: "2026-07-19T09:05:00.000Z",
      }),
    ]);

    const rows = await db.query.dailySnapshots.findMany({
      where: (t, { eq }) => eq(t.businessDate, businessDate),
    });
    expect(rows).toHaveLength(1); // upserted, not duplicated
    expect(rows[0]).toMatchObject({
      stockValue: 5000,
      bankBalance: 6000,
      cashBalance: 7000,
      accountsReceivable: 100,
      customerDeposits: 50,
    });
  });
});

describe("buildJobRunInsert", () => {
  it("writes job/startedAt/finishedAt/ok/detail, with a fresh id each call", async () => {
    const db = createDb(env.DB);
    await db.batch([
      buildJobRunInsert(db, {
        job: "unit_test_job",
        startedAt: "2026-07-18T09:00:00.000Z",
        finishedAt: "2026-07-18T09:00:05.000Z",
        ok: 1,
        detail: JSON.stringify({ ok: true }),
      }),
    ]);
    await db.batch([
      buildJobRunInsert(db, {
        job: "unit_test_job",
        startedAt: "2026-07-18T09:10:00.000Z",
        finishedAt: "2026-07-18T09:10:05.000Z",
        ok: 0,
        detail: "boom",
      }),
    ]);

    const rows = await db.query.jobRuns.findMany({
      where: (t, { eq }) => eq(t.job, "unit_test_job"),
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2); // distinct ids, no PK collision
    expect(rows.find((r) => r.ok === 1)?.detail).toBe(JSON.stringify({ ok: true }));
    expect(rows.find((r) => r.ok === 0)?.detail).toBe("boom");
  });
});

describe("getLatestJobRun (KOK-022)", () => {
  it("returns null for a job that has never run", async () => {
    const db = createDb(env.DB);
    const row = await getLatestJobRun(db, "unit_test_job_never_ran");
    expect(row).toBeNull();
  });

  it("returns the most recent row (by startedAt) for that job, ignoring other jobs", async () => {
    const db = createDb(env.DB);
    await db.batch([
      buildJobRunInsert(db, {
        job: "unit_test_latest_job",
        startedAt: "2026-07-17T09:00:00.000Z",
        finishedAt: "2026-07-17T09:00:05.000Z",
        ok: 1,
        detail: "first",
      }),
    ]);
    await db.batch([
      buildJobRunInsert(db, {
        job: "unit_test_latest_job",
        startedAt: "2026-07-18T09:00:00.000Z",
        finishedAt: "2026-07-18T09:00:05.000Z",
        ok: 0,
        detail: "second, most recent",
      }),
    ]);
    await db.batch([
      buildJobRunInsert(db, {
        job: "some_other_job",
        startedAt: "2026-07-19T09:00:00.000Z",
        finishedAt: "2026-07-19T09:00:05.000Z",
        ok: 1,
        detail: "different job entirely",
      }),
    ]);

    const row = await getLatestJobRun(db, "unit_test_latest_job");
    expect(row?.detail).toBe("second, most recent");
    expect(row?.ok).toBe(0);
  });
});
