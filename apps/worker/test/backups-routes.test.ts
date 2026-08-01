// Route-level smoke tests for GET /api/backups/latest and GET /api/backups/:key{.+}/download
// (KOK-022). Mirrors test/dashboard.test.ts's shape: proves the Hono wiring (auth gate, body
// shape, the download route's key-prefix validation) end to end via SELF.fetch. The job itself
// (table dump, R2 upload, retention sweep) is covered at the job level in test/backup.test.ts —
// this file only exercises what sits on top of it: reading job_runs back out as a DTO, and
// Worker-proxying the R2 object it produced.
import { env, SELF } from "cloudflare:test";
import type { BackupStatusDto } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../src/db/index.js";
import { jobRuns } from "../src/db/schema.js";
import { runBackup } from "../src/jobs/backup.js";
import { deleteObject, listObjects } from "../src/lib/r2.js";

const DEV_PASSWORD = "test-password-123";

function getCookieValue(setCookieHeader: string | null, name: string): string | undefined {
  if (!setCookieHeader) return undefined;
  const match = new RegExp(`${name}=([^;,]+)`).exec(setCookieHeader);
  return match?.[1];
}

async function login(): Promise<{ cookie: string; csrf: string }> {
  const res = await SELF.fetch("https://example.com/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: DEV_PASSWORD }),
  });
  const setCookie = res.headers.get("set-cookie");
  const session = getCookieValue(setCookie, "kokoro_session");
  const csrf = getCookieValue(setCookie, "kokoro_csrf");
  if (!session || !csrf) throw new Error("login did not return session/csrf cookies");
  return { cookie: `kokoro_session=${session}; kokoro_csrf=${csrf}`, csrf };
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(jobRuns).where(eq(jobRuns.job, "backup"));
  const leftovers = await listObjects(env.BUCKET, "backups/");
  for (const object of leftovers) {
    await deleteObject(env.BUCKET, object.key);
  }
});

describe("GET /api/backups/latest", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/backups/latest");
    expect(res.status).toBe(401);
  });

  it("returns null when the backup job has never run", async () => {
    const { cookie } = await login();
    const res = await SELF.fetch("https://example.com/api/backups/latest", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("returns the last run's status, with key/sizeBytes parsed out of job_runs.detail", async () => {
    const db = createDb(env.DB);
    await runBackup(db, env.BUCKET);

    const { cookie } = await login();
    const res = await SELF.fetch("https://example.com/api/backups/latest", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const status = (await res.json()) as BackupStatusDto;
    expect(status.ok).toBe(true);
    expect(status.key?.startsWith("backups/")).toBe(true);
    expect(status.sizeBytes).toBeGreaterThan(0);
    expect(status.finishedAt).not.toBeNull();
  });
});

describe("GET /api/backups/:key{.+}/download", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/backups/backups/whatever.sql/download");
    expect(res.status).toBe(401);
  });

  it("streams back the produced backup file with content-type application/sql", async () => {
    const db = createDb(env.DB);
    await runBackup(db, env.BUCKET);
    const latest = await db.query.jobRuns.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.job, "backup"),
    });
    const detail = JSON.parse(latest?.detail ?? "null") as { key: string };

    const { cookie } = await login();
    const res = await SELF.fetch(
      `https://example.com/api/backups/${encodeURIComponent(detail.key)}/download`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/sql");
    expect(await res.text()).toContain("INSERT INTO");
  });

  it("rejects a key that does not start with backups/ with VALIDATION (not a generic bucket-read proxy)", async () => {
    const { cookie } = await login();
    const res = await SELF.fetch(
      "https://example.com/api/backups/receipts/some-photo.jpg/download",
      { headers: { cookie } },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("VALIDATION");
  });

  it("returns 404 for a well-formed but nonexistent backups/ key", async () => {
    const { cookie } = await login();
    const res = await SELF.fetch(
      "https://example.com/api/backups/backups/does-not-exist.sql/download",
      { headers: { cookie } },
    );
    expect(res.status).toBe(404);
  });
});
