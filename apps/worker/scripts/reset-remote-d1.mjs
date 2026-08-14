#!/usr/bin/env node
// Wipes a REMOTE D1 database (staging only — prod is deliberately not wired up) and re-applies
// migrations, so the environment starts from an empty schema. Unlike db:reset:dev (which just
// deletes the local .wrangler/state directory), there is no local file to delete here — D1 has
// no "drop schema" primitive, so this discovers every user table and view via sqlite_master and
// drops them (including d1_migrations, so wrangler replays every migration from 0001), then
// re-runs `wrangler d1 migrations apply`.
//
// Table drop order matters and PRAGMA foreign_keys=OFF does not help (D1 runs each `d1 execute`
// call inside one implicit transaction, and SQLite only allows toggling foreign_keys outside a
// transaction — see the migration-side version of this problem fixed in 0012/0013/0014/0022).
// PRAGMA defer_foreign_keys=ON does work mid-transaction, but only defers the *check*; it can't
// save you from dropping a table whose schema a later DROP still needs to consult (SQLite errors
// with "no such table" trying to resolve a FK against an already-dropped parent). So instead this
// computes the real FK dependency graph via PRAGMA foreign_key_list and drops tables in reverse
// dependency order — children (referencing tables) before their parents — so no drop ever needs
// to consult a table that's already gone. The one genuine cycle in this schema (`sales` and
// `custom_orders` mutually reference each other via ON DELETE RESTRICT) can't be ordered that way;
// for any leftover cyclic tables, every row is deleted first (schemas still present, so the
// deferred FK check can resolve normally) and only then are the now-empty tables dropped.
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

// --remote (unlike --local) interleaves upload-progress lines ("├ Checking if file needs
// uploading" etc.) before the JSON payload even with --json set, so parse from the first `[`.
function wranglerJson(args) {
  const output = wrangler(args);
  return JSON.parse(output.slice(output.indexOf("[")));
}

function runSql(statements) {
  if (statements.length === 0) return;
  const tmpDir = mkdtempSync(join(tmpdir(), "kokoro-d1-reset-"));
  const tmpFile = join(tmpDir, "batch.sql");
  writeFileSync(tmpFile, statements.join("\n"));
  wrangler(["d1", "execute", dbName, "--remote", "--env", env, `--file=${tmpFile}`]);
  rmSync(tmpDir, { recursive: true, force: true });
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
const [{ results: objects }] = wranglerJson([
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
const views = objects.filter((o) => o.type === "view").map((o) => o.name);
const tables = objects.filter((o) => o.type === "table").map((o) => o.name);

if (objects.length === 0) {
  console.log("No tables or views found — database is already empty.");
} else {
  console.log(`Dropping ${views.length} view(s): ${views.join(", ") || "(none)"}`);
  runSql(views.map((name) => `DROP VIEW IF EXISTS "${name}";`));

  console.log("Computing FK dependency graph for the remaining tables...");
  // One PRAGMA call per table, not a --file batch: --file execution against --remote collapses
  // to a single aggregate summary row ("Total queries executed": N) instead of one result set
  // per statement (unlike --local, which does return them positionally) — so a batched fetch
  // here would silently see zero FK rows for every table and produce a meaningless empty graph.
  // --command does return real per-call results on both --local and --remote.
  const referencedBy = Object.fromEntries(tables.map((t) => [t, new Set()]));
  for (const child of tables) {
    const [{ results: rows }] = wranglerJson([
      "d1",
      "execute",
      dbName,
      "--remote",
      "--env",
      env,
      "--json",
      "--command",
      `PRAGMA foreign_key_list("${child}")`,
    ]);
    for (const row of rows) {
      const parent = row.table;
      if (parent !== child && referencedBy[parent]) {
        referencedBy[parent].add(child);
      }
    }
  }

  const remaining = new Set(tables);
  const dropOrder = [];
  let progressed = true;
  while (remaining.size > 0 && progressed) {
    progressed = false;
    for (const t of [...remaining]) {
      const stillReferenced = [...referencedBy[t]].some((child) => remaining.has(child));
      if (!stillReferenced) {
        dropOrder.push(t);
        remaining.delete(t);
        progressed = true;
      }
    }
  }

  console.log(`Dropping ${dropOrder.length} table(s) in dependency order: ${dropOrder.join(", ")}`);
  // No PRAGMA needed: by construction, every table here is dropped only once every table that
  // still references it is already gone, so the implicit delete never has a live child to check.
  runSql(dropOrder.map((name) => `DROP TABLE IF EXISTS "${name}";`));

  if (remaining.size > 0) {
    const cyclic = [...remaining];
    console.log(`Breaking FK cycle among: ${cyclic.join(", ")} (deleting rows, then dropping)`);
    // A genuine cycle (e.g. sales <-> custom_orders via mutual ON DELETE RESTRICT) has no valid
    // drop order. Empty every table in the cycle first — the schemas still exist at this point,
    // so the deferred check can resolve against them normally — then drop the now-empty tables.
    runSql([
      "PRAGMA defer_foreign_keys=ON;",
      ...cyclic.map((name) => `DELETE FROM "${name}";`),
      ...cyclic.map((name) => `DROP TABLE IF EXISTS "${name}";`),
    ]);
  }
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
