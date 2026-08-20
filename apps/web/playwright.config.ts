import { defineConfig } from "@playwright/test";

// Runs against a real deployed Worker (staging in CI, KOK-009), not a local dev server — the
// whole point of the smoke suite is proving the actual deploy works end-to-end. For local runs,
// point PLAYWRIGHT_BASE_URL at `wrangler dev` (defaults to its usual port).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Every spec shares one real backend (a deployed staging Worker, or a local wrangler dev in
  // the PR-gate job) — cross-cutting global state like "which sessions are open" is genuinely
  // shared across concurrently-running spec files, not just isolated by fixture-name uniqueness
  // the way item/recipe/order records are. Serialize in CI so that isn't a source of flakiness;
  // local runs stay parallel (fast iteration, and a human can just re-run a flake).
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:8787",
    trace: "on-first-retry",
  },
});
