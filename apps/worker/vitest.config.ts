// Vitest config for apps/worker: runs tests inside workerd via @cloudflare/vitest-pool-workers,
// so tests get real D1/R2 bindings as declared in wrangler.toml (Doc 11 "Tooling").
//
// TEST_MIGRATIONS exposes migrations/0001_init.sql to tests as a Miniflare binding; test setup
// applies it to the in-memory D1 instance before each test file runs (see test/setup.ts), so
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
  },
});
