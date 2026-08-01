// Integration tests for jobs/backup.ts's runBackup (KOK-022). Follows the Doc 11 §3 template:
// seed real state via core/ service factories, run the job against real D1 + the Miniflare R2
// simulator (test/setup.ts applies migrations/0001_init.sql first; wrangler.toml's BUCKET binding
// backs env.BUCKET the same way it backs api/purchasing.ts's photo route), then assert the
// job_runs row it writes and the R2 object it produces.
//
// Storage is isolated per test FILE, not per test (mirrors every other integration test file's
// identical note) for D1 AND for R2 — the beforeEach below wipes job_runs rows for job='backup',
// resets app_settings.backup_retention_days back to its seeded default ('30', Doc 04 §7), and
// deletes every backups/ object left over from a prior test in this file.
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createItem } from "../src/core/catalog/index.js";
import { setSetting } from "../src/core/settings/index.js";
import { createDb } from "../src/db/index.js";
import { jobRuns } from "../src/db/schema.js";
import { runBackup } from "../src/jobs/backup.js";
import { deleteObject, getObject, listObjects } from "../src/lib/r2.js";

const ACTOR = "OWNER_WEB" as const;

type TestDb = ReturnType<typeof createDb>;

async function seedItem(db: TestDb, name: string) {
  return createItem(db, { name, kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "KG" }, ACTOR);
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(jobRuns).where(eq(jobRuns.job, "backup"));
  await setSetting(db, "backup_retention_days", "30");
  const leftovers = await listObjects(env.BUCKET, "backups/");
  for (const object of leftovers) {
    await deleteObject(env.BUCKET, object.key);
  }
});

describe("runBackup (KOK-022)", () => {
  it("dumps tables to R2 and writes an ok=1 job_runs row with key/sizeBytes/deletedCount in detail", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Backup dump item");

    await runBackup(db, env.BUCKET);

    const runs = await db.query.jobRuns.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.job, "backup"),
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.ok).toBe(1);
    expect(runs[0]?.finishedAt).not.toBeNull();

    const detail = JSON.parse(runs[0]?.detail ?? "null");
    expect(typeof detail.key).toBe("string");
    expect((detail.key as string).startsWith("backups/")).toBe(true);
    expect(detail.sizeBytes).toBeGreaterThan(0);
    expect(detail.deletedCount).toBe(0); // nothing pre-existing to sweep in this test
    expect(typeof detail.tableCount).toBe("number");
    expect(typeof detail.totalRows).toBe("number");

    const object = await getObject(env.BUCKET, detail.key as string);
    expect(object).not.toBeNull();
    expect(object?.httpMetadata?.contentType).toBe("application/sql");
    const text = (await object?.text()) ?? "";
    expect(text).toContain("INSERT INTO items");
    expect(text).toContain(item.id);
  });

  it("the retention sweep deletes a pre-existing backups/ object older than backup_retention_days, without touching the object this run just created", async () => {
    const db = createDb(env.DB);
    await env.BUCKET.put("backups/old-fixture.sql", "-- old backup fixture", {
      httpMetadata: { contentType: "application/sql" },
    });
    await setSetting(db, "backup_retention_days", "0");

    await runBackup(db, env.BUCKET);

    const oldObject = await getObject(env.BUCKET, "backups/old-fixture.sql");
    expect(oldObject).toBeNull();

    const runs = await db.query.jobRuns.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.job, "backup"),
    });
    expect(runs).toHaveLength(1);
    const detail = JSON.parse(runs[0]?.detail ?? "null");
    expect(detail.deletedCount).toBeGreaterThanOrEqual(1);

    // This run's own backup was uploaded AFTER the sweep ran, so it must survive regardless of how
    // aggressive backup_retention_days is set (see runBackup's header note on why the sweep is
    // ordered before the upload).
    const newObject = await getObject(env.BUCKET, detail.key as string);
    expect(newObject).not.toBeNull();
  });
});
