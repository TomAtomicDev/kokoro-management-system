// core/settings — thin key/value accessor over `app_settings` (Doc 04 §3.5, KOK-020's first code
// consumer of this table). This is config/infrastructure state, NOT a business event table
// (contrast with every other core/ command in this codebase, which writes an audit_log row for
// every mutation, D-3/Doc 08): `setSetting` deliberately does NOT audit — same tier as a plain
// read, not a business write. Single-statement upsert, so no db.batch() either (D-3 only requires
// batching when a command produces more than one write).

import type { Db } from "../../db/index.js";
import { appSettings } from "../../db/schema.js";

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const row = await db.query.appSettings.findFirst({
    where: (t, { eq }) => eq(t.key, key),
  });
  return row?.value ?? null;
}

/** Upsert: inserts `key` if absent, otherwise overwrites its `value` (mirrors
 * core/inventory/movements.ts's `onConflictDoUpdate` precedent — the only other upsert in this
 * codebase; unlike that one, this is a plain overwrite with no relative/CASE arithmetic needed). */
export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value },
  });
}
