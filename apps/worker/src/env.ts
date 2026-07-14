// Typed Cloudflare Worker bindings + Hono context variables.
//
// Bindings mirror `wrangler.toml` (D1 `DB`, R2 `BUCKET`) and the secrets set via
// `wrangler secret put` per docs/system-design-knowledge-base/02-system-architecture.md §5.
// AI model ids are deliberately NOT here — they live in the `app_settings` table, not as
// Worker secrets/vars (Doc 02 §5).

/** Cloudflare bindings + secrets available on `c.env`. */
export interface Env {
  /** D1 database binding (binding name `DB` in wrangler.toml). */
  DB: D1Database;
  /** R2 bucket binding (binding name `BUCKET` in wrangler.toml) — photos, exports, backups. */
  BUCKET: R2Bucket;

  // --- Secrets (wrangler secret put), Doc 02 §5 ---
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  OPENAI_API_KEY: string;
  SESSION_SECRET: string;
  OWNER_PASSWORD_HASH: string;
  OWNER_TELEGRAM_CHAT_ID: string;
}

/**
 * Hono context variables (`c.get`/`c.set`), as opposed to bindings on `c.env`.
 * Kept minimal for now; grows as auth (KOK-007) and other middleware land.
 */
export interface Variables {
  requestId: string;
}
