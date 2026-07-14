import { defineConfig } from "vitest/config";

// No component tests exist yet for the shell scaffold (KOK-003) — real coverage arrives with
// the screen tasks (SC-xx) that fill content into it. `passWithNoTests` keeps `pnpm run test`
// green in the meantime instead of failing the whole workspace on an empty suite.
//
// `exclude` adds `e2e/**` on top of Vitest's own defaults (node_modules, dist, etc. — omitting
// them here would replace, not extend, that default list): e2e/ holds Playwright specs (KOK-009
// smoke suite), which use `@playwright/test`'s own `test()`/`expect()` and must never be
// collected by Vitest's runner.
export default defineConfig({
  test: {
    passWithNoTests: true,
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
});
