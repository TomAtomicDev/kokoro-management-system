// Backups routes (KOK-022, Doc 02 §4.4). Mounted under /api in index.ts. Thin by design (D-2):
// GET /backups/latest reads the most recent `job_runs` row for job='backup' via core/jobs.ts's
// getLatestJobRun and maps it to a BackupStatusDto; GET /backups/:key{.+}/download mirrors
// purchasing.ts's photo-download route (same Worker-proxied R2 read, ADR-015: no presigned URLs).
//
// The download route is deliberately NOT a generic bucket-read proxy: it validates `key` starts
// with `backups/` before ever calling getObject, so a session that can read purchase receipts
// (`/purchases/photos/:key`) can't be repointed at that same endpoint shape to read a backup file,
// nor can this endpoint be repointed at `receipts/...` keys.

import type { BackupStatusDto } from "@kokoro/shared";
import { Hono } from "hono";

import { notFound, validationError } from "../core/errors.js";
import { getLatestJobRun } from "../core/jobs.js";
import { createDb } from "../db/index.js";
import type { Env, Variables } from "../env.js";
import { getObject } from "../lib/r2.js";

const BACKUP_KEY_PREFIX = "backups/";

/** Shape jobs/backup.ts writes into job_runs.detail on a successful run — see its own JSON.stringify call. */
interface BackupRunDetail {
  key?: string;
  sizeBytes?: number;
}

function parseDetail(detail: string | null): BackupRunDetail {
  if (!detail) return {};
  try {
    const parsed: unknown = JSON.parse(detail);
    return parsed && typeof parsed === "object" ? (parsed as BackupRunDetail) : {};
  } catch {
    return {};
  }
}

export const backupsRoute = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/backups/latest", async (c) => {
    const db = createDb(c.env.DB);
    const run = await getLatestJobRun(db, "backup");
    if (!run) {
      return c.json(null);
    }

    const ok = run.ok === 1;
    const detail = ok ? parseDetail(run.detail) : {};
    const status: BackupStatusDto = {
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      ok,
      key: detail.key ?? null,
      sizeBytes: detail.sizeBytes ?? null,
    };
    return c.json(status);
  })
  .get("/backups/:key{.+}/download", async (c) => {
    const key = c.req.param("key");
    if (!key.startsWith(BACKUP_KEY_PREFIX)) {
      throw validationError("Clave de respaldo inválida.", { key });
    }
    const object = await getObject(c.env.BUCKET, key);
    if (!object) {
      throw notFound("No se encontró el respaldo solicitado.", { key });
    }
    return c.body(object.body, 200, {
      "Content-Type": object.httpMetadata?.contentType ?? "application/sql",
    });
  });
