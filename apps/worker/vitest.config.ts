// Vitest config for apps/worker: runs tests inside workerd via @cloudflare/vitest-pool-workers,
// so tests get real D1/R2 bindings as declared in wrangler.toml (Doc 11 "Tooling").
//
// NOTE: this is the standard config shape for @cloudflare/vitest-pool-workers ^0.5.x + vitest
// ^2.x (pool via `poolOptions.workers.wrangler.configPath`, pointing at this app's
// wrangler.toml). Double-check against the installed package's docs/changelog once dependencies
// are actually installed — the pool's config surface has moved between versions upstream.
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
