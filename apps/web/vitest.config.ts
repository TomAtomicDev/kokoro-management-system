import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// No component tests exist yet for the shell scaffold (KOK-003) — real coverage arrives with
// the screen tasks (SC-xx) that fill content into it. `passWithNoTests` keeps `pnpm run test`
// green in the meantime instead of failing the whole workspace on an empty suite.
//
// `exclude` adds `e2e/**` on top of Vitest's own defaults (node_modules, dist, etc. — omitting
// them here would replace, not extend, that default list): e2e/ holds Playwright specs (KOK-009
// smoke suite), which use `@playwright/test`'s own `test()`/`expect()` and must never be
// collected by Vitest's runner.
//
// `resolve.alias` mirrors vite.config.ts's own `@` -> `./src` alias (Vitest does not read that
// file automatically — this is a separate config). Every prior test file used only relative
// imports so this gap went unnoticed; KOK-024 Phase G's hook tests are the first to import a
// module (`@/lib/api`) through the alias, which fails to resolve at all without this.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    passWithNoTests: true,
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
});
