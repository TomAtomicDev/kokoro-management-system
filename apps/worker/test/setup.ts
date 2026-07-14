import { applyD1Migrations, env } from "cloudflare:test";

// Runs once per test file (Vitest `setupFiles`) so every test sees the full schema of
// migrations/0001_init.sql applied to a fresh in-memory D1 instance.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
