import { defineConfig } from "vitest/config";

// No component tests exist yet for the shell scaffold (KOK-003) — real coverage arrives with
// the screen tasks (SC-xx) that fill content into it. `passWithNoTests` keeps `pnpm run test`
// green in the meantime instead of failing the whole workspace on an empty suite.
export default defineConfig({
  test: {
    passWithNoTests: true,
  },
});
