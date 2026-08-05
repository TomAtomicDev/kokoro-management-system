#!/usr/bin/env node
// Wipes a REMOTE D1 database (staging only — prod is deliberately not wired up) and re-applies
// migrations, so the environment starts from an empty schema. Unlike db:reset:dev (which just
// deletes the local .wrangler/state directory), there is no local file to delete here — D1 has
// no "drop schema" primitive, so this discovers every user table via sqlite_master, DROPs them
// (including d1_migrations, so wrangler replays every migration from 0001), then re-runs
// `wrangler d1 migrations apply`.
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

console.log(`This will PERMANENTLY DELETE all data in the remote D1 database "${dbName}" (env: ${env}).`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(`Type "${dbName}" to confirm: `);
rl.close();
if (answer.trim() !== dbName) {
  console.error("Confirmation did not match. Aborted, nothing was touched.");
  process.exit(1);
}

console.log("Discovering tables...");
const listOutput = wrangler([
  "d1",
  "execute",
  dbName,
  "--remote",
  "--env",
  env,
  "--json",
  "--command",
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
]);
const [{ results: tables }] = JSON.parse(listOutput);

if (tables.length === 0) {
  console.log("No tables found — database is already empty.");
} else {
  const dropSql = tables.map(({ name }) => `DROP TABLE IF EXISTS "${name}";`).join("\n");
  const tmpDir = mkdtempSync(join(tmpdir(), "kokoro-d1-reset-"));
  const tmpFile = join(tmpDir, "drop-all.sql");
  writeFileSync(tmpFile, dropSql);
  console.log(`Dropping ${tables.length} table(s): ${tables.map(({ name }) => name).join(", ")}`);
  wrangler(["d1", "execute", dbName, "--remote", "--env", env, `--file=${tmpFile}`]);
  rmSync(tmpDir, { recursive: true, force: true });
}

console.log("Re-applying migrations...");
execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", dbName, "--remote", "--env", env], {
  stdio: "inherit",
});

console.log(`Done. "${dbName}" is now empty with a fresh schema.`);
