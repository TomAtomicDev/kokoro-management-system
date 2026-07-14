import { defineConfig } from "@playwright/test";

// Runs against a real deployed Worker (staging in CI, KOK-009), not a local dev server — the
// whole point of the smoke suite is proving the actual deploy works end-to-end. For local runs,
// point PLAYWRIGHT_BASE_URL at `wrangler dev` (defaults to its usual port).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:8787",
    trace: "on-first-retry",
  },
});
