// Vitest config for apps/worker: runs tests inside workerd via @cloudflare/vitest-pool-workers,
// so tests get real D1/R2 bindings as declared in wrangler.toml (Doc 11 "Tooling").
//
// TEST_MIGRATIONS exposes every file in migrations/ to tests as a Miniflare binding; test setup
// applies them to the in-memory D1 instance before each test file runs (see test/setup.ts), so
// integration tests query against the real schema, not an empty database.
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
    // Each integration test file re-applies the migrations to a fresh in-memory D1, and KOK-024's
    // replay path adds per-item kardex queries on top. Under parallel load that pushed several
    // files past the 5 s default and made the suite flaky — they pass in isolation, so the
    // timeouts were load-induced, not assertion failures.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
