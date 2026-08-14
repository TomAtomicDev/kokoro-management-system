#!/usr/bin/env node
// Wipes a REMOTE D1 database (staging only — prod is deliberately not wired up) and re-applies
// migrations, so the environment starts from an empty schema. Unlike db:reset:dev (which just
// deletes the local .wrangler/state directory), there is no local file to delete here — D1 has
// no "drop schema" primitive, so this discovers every user table and view via sqlite_master,
// DROPs them (including d1_migrations, so wrangler replays every migration from 0001), then
// re-runs `wrangler d1 migrations apply`. Views must go too — migration 0001 recreates
// v_stock/v_kardex/v_price_health etc., and CREATE VIEW fails if a stale one is still there.
//
// This is a shared, remote environment — other people's smoke tests or in-progress manual
// testing can be sitting on it. Requires typing the database name to confirm; there is no --yes
// flag, on purpose, so this can never be scripted into an unattended pipeline.
//
// Usage:
//   node scripts/reset-remote-d1.mjs staging

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const ALLOWED_ENVS = { staging: "kokoro-staging" };

const env = process.argv[2];
const dbName = ALLOWED_ENVS[env];
if (!dbName) {
  console.error(`Usage: node scripts/reset-remote-d1.mjs <${Object.keys(ALLOWED_ENVS).join("|")}>`);
  console.error("(prod is intentionally not supported by this script)");
  process.exit(1);
}

function wrangler(args) {
  return execFileSync("pnpm", ["exec", "wrangler", ...args], { encoding: "utf8" });
}

console.log(
  `This will PERMANENTLY DELETE all data in the remote D1 database "${dbName}" (env: ${env}).`,
);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(`Type "${dbName}" to confirm: `);
rl.close();
if (answer.trim() !== dbName) {
  console.error("Confirmation did not match. Aborted, nothing was touched.");
  process.exit(1);
}

console.log("Discovering tables and views...");
const listOutput = wrangler([
  "d1",
  "execute",
  dbName,
  "--remote",
  "--env",
  env,
  "--json",
  "--command",
  "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
]);
const [{ results: objects }] = JSON.parse(listOutput);

if (objects.length === 0) {
  console.log("No tables or views found — database is already empty.");
} else {
  // Discovery order doesn't respect FK dependency order, so a plain DROP TABLE sequence hits
  // RESTRICT/cascade children immediately (SQLite enforces those regardless of drop order).
  // defer_foreign_keys=ON defers checks to commit, by which point every table is gone and no
  // rows remain to violate anything. Views are dropped with DROP VIEW, not DROP TABLE.
  const dropSql = [
    "PRAGMA defer_foreign_keys=ON;",
    ...objects.map(({ name, type }) =>
      type === "view" ? `DROP VIEW IF EXISTS "${name}";` : `DROP TABLE IF EXISTS "${name}";`,
    ),
  ].join("\n");
  const tmpDir = mkdtempSync(join(tmpdir(), "kokoro-d1-reset-"));
  const tmpFile = join(tmpDir, "drop-all.sql");
  writeFileSync(tmpFile, dropSql);
  console.log(
    `Dropping ${objects.length} object(s): ${objects.map(({ name }) => name).join(", ")}`,
  );
  wrangler(["d1", "execute", dbName, "--remote", "--env", env, `--file=${tmpFile}`]);
  rmSync(tmpDir, { recursive: true, force: true });
}

console.log("Re-applying migrations...");
execFileSync(
  "pnpm",
  ["exec", "wrangler", "d1", "migrations", "apply", dbName, "--remote", "--env", env],
  {
    stdio: "inherit",
  },
);

console.log(`Done. "${dbName}" is now empty with a fresh schema.`);
