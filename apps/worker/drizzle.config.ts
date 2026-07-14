import { defineConfig } from "drizzle-kit";

// D1 migrations are applied via `wrangler d1 migrations apply` (Doc 04 §8), not drizzle-kit's
// own migrator — this config is only used for `drizzle-kit generate` (schema.ts -> SQL) and
// `drizzle-kit check` (drift detection), so no `dbCredentials` connection is configured.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
});
