# 02 — System Architecture

## 1. Architecture summary

**A single modular monolith on Cloudflare Workers.** One TypeScript Worker (Hono) serves the
JSON API, the Telegram webhook, the AI assistant runtime, scheduled jobs, and the static React
SPA. Persistence is Cloudflare D1 (SQLite); object storage is R2 (receipt photos, exports,
backups). There are no microservices, no queues, and no Durable Objects in v1 (see ADR-002,
ADR-003).

```
                 ┌─────────────────────────── Cloudflare edge ───────────────────────────┐
                 │                                                                        │
  Owner (phone)  │   ┌──────────────────────── Worker: kokoro ─────────────────────────┐ │
  Telegram app ──┼──►│ /telegram/webhook ─► Telegram Adapter ─┐                        │ │
                 │   │                                        ▼                        │ │
  Owner (desktop)│   │ /api/* ────────────► HTTP API (Hono) ─► Application Services ──►│ │──► D1 (SQLite)
  React SPA  ────┼──►│ /*  ───────────────► Static assets     │        │               │ │
                 │   │                                        │        ├──────────────►│ │──► R2 (photos,
                 │   │ /api/assistant/* ──► Assistant Runtime ─┘        │               │ │     backups, exports)
                 │   │                      (Claude API, tool registry)◄┘               │ │
                 │   │ Cron triggers ─────► Jobs (alerts, snapshots, backup, cache)     │ │──► Claude API
                 │   └──────────────────────────────────────────────────────────────────┘ │     (api.anthropic.com)
                 │                                                                        │──► Telegram Bot API
                 └────────────────────────────────────────────────────────────────────────┘
```

## 2. Technology stack (decided)

| Layer | Choice | Rationale (ADR) |
|-------|--------|-----------------|
| Runtime | Cloudflare Workers (single Worker) | ~$0–5/mo, zero-ops, global edge, cron built in — ADR-001 |
| HTTP framework | Hono 4 | Native to Workers, tiny, typed routes, middleware — ADR-001 |
| Language | TypeScript (strict) everywhere | One language for API, SPA, bot, jobs; ideal for AI-assisted dev |
| Database | Cloudflare D1 (SQLite) | Single-user scale, relational, free tier, `batch()` atomicity — ADR-002 |
| ORM / migrations | Drizzle ORM + drizzle-kit migrations | Typed schema shared with app code, D1 driver, SQL-first |
| Object storage | Cloudflare R2 | Receipt/product photos, nightly DB export, CSV exports |
| Frontend | React 18 + Vite SPA, served as Worker static assets | ADR-004 |
| Frontend data | TanStack Router + TanStack Query | Typed routes, cache/invalidatation model fits event editing |
| UI kit | Tailwind CSS v4 + shadcn/ui (Radix primitives) + lucide-react icons | ADR-004 |
| Charts | Recharts | Simple declarative charts for the dashboard/reports |
| Mobile capture | Telegram Bot API via **grammY** on the Worker webhook | ADR-005 |
| AI | Claude API — `claude-sonnet-5` (capture parsing + analytical chat) | ADR-006; model id per current Anthropic lineup |
| AI dev tooling | MCP server (dev-only) exposing the same tool registry | ADR-006 §MCP |
| Validation | Zod schemas (single source, shared client/server/AI tools) | ADR-008 |
| Auth | Owner password → signed session cookie (Web Crypto HMAC), Telegram `chat_id` allowlist | ADR-007 |
| Testing | Vitest (+ `@cloudflare/vitest-pool-workers`), Playwright, AI eval fixtures | Doc 11 |
| CI/CD | GitHub Actions → `wrangler deploy`; preview via `wrangler versions upload` | §9 |

Rejected alternatives and reasoning live in [12 — ADRs](12-architecture-decision-records.md)
(Supabase, Railway/VPS, PostgreSQL, Astro/TanStack Start, Queues, Durable Objects, WhatsApp).

## 3. Monorepo & module structure

Single repository, pnpm workspaces:

```
kokoro/
├── docs/                      # this KB
├── packages/
│   └── shared/                # Zod schemas, domain types, enums, money/qty utils, i18n strings
├── apps/
│   ├── worker/                # the deployable unit
│   │   ├── src/
│   │   │   ├── index.ts       # Hono app assembly + cron dispatcher
│   │   │   ├── db/            # drizzle schema, migrations, query helpers
│   │   │   ├── core/          # DOMAIN SERVICES (pure where possible)
│   │   │   │   ├── catalog/   # items, aliases, recipes
│   │   │   │   ├── inventory/ # kardex engine, stock, counts, exits
│   │   │   │   ├── costing/   # WAC engine, replacement cost, allocation
│   │   │   │   ├── purchasing/
│   │   │   │   ├── production/
│   │   │   │   ├── sales/
│   │   │   │   ├── orders/    # custom orders + deposit liability
│   │   │   │   ├── finance/   # accounts, transactions, transfers, withdrawals
│   │   │   │   ├── sessions/  # sessions, labor hours, shared-cost allocation
│   │   │   │   └── insights/  # report queries, price health, Bs/hour
│   │   │   ├── api/           # Hono routes (thin: parse → service → serialize)
│   │   │   ├── assistant/     # runtime, tool registry, prompts, interaction log
│   │   │   ├── telegram/      # grammY bot: conversations, confirmation cards
│   │   │   └── jobs/          # cron handlers
│   │   └── wrangler.toml
│   └── web/                   # React SPA (built into worker assets)
│       └── src/ (routes/, features/, components/, lib/)
└── tools/
    └── mcp-server/            # dev-only MCP wrapper around the tool registry
```

**Dependency rule (enforced by convention + lint):** `api/`, `telegram/`, `assistant/`, `jobs/`
call `core/` services; `core/` never imports from them. All writes to business tables go through
`core/` services — never raw SQL from routes, bot, or AI tools. This is what makes the AI
assistant, the API, and Telegram behaviorally identical.

## 4. Key runtime flows

### 4.1 Command flow (any write, from any channel)

```
channel (SPA form | Telegram confirm | assistant tool) 
  → Zod-validated Command DTO
  → core service: business rules + derived records
  → ONE atomic D1 batch: event rows + stock_movements + item_stock deltas
        + financial_transactions + account balance deltas + audit_log
  → Result DTO → channel-specific rendering
```

D1 `batch()` executes statements atomically (implicit transaction); every command MUST be a
single batch so partial writes are impossible (**INV-1**).

### 4.2 Event editing flow

Users edit **events** (purchase, production run, sale…), never kardex rows or financial rows.
The service recomputes all derived rows for that event (delete-and-recreate by
`source_event`), rebalances `item_stock` / account balances, and appends to `audit_log` — all in
one batch. Costing side-effects are recomputed forward (see [03 §7](03-domain-model.md)).

### 4.3 Telegram capture flow

```
voice/text message → grammY handler → assistant "capture" pipeline (Claude + catalog context)
  → draft event (Zod-validated) → confirmation card (inline keyboard: ✅ Confirmar / ✏️ Editar / ❌)
  → on ✅ → same core service as the web → short receipt message (stock/cash after)
```

Telegram retries webhooks on failure; handlers are idempotent via `update_id` dedupe (**INV-2**).

### 4.4 Scheduled jobs (Cron Triggers)

| Cron (UTC) | Job | Action |
|------------|-----|--------|
| `0 9 * * *` (05:00 La Paz) | `daily-snapshot` | Insert `daily_snapshots` row (stock value, balances, AR, deposit liability) |
| `5 9 * * *` | `replacement-cost-refresh` | Recompute `replacement_cost` cache for semi/finished items from current raw-material replacement costs |
| `10 9 * * *` | `alerts` | Low-stock + price-health (margin below threshold) + stale-order alerts → Telegram message |
| `0 7 * * *` | `backup` | `wrangler d1 export`-equivalent dump (SQL text) → R2, 30-day retention |
| `15 9 * * 1` | `weekly-digest` | Monday summary (sales, profit, hours, Bs/h) → Telegram |

Jobs are plain functions in `jobs/`, dispatched from the Worker `scheduled()` handler; each run
is recorded in `job_runs` for observability.

## 5. Environments & configuration

| Env | Worker | D1 | Purpose |
|-----|--------|----|---------|
| `dev` | `wrangler dev` (local, Miniflare) | local SQLite | development; seeded fixture data |
| `staging` | `kokoro-staging` | `kokoro-staging` | pre-release verification, separate Telegram bot token |
| `prod` | `kokoro` | `kokoro-prod` | live |

Secrets via `wrangler secret`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
`ANTHROPIC_API_KEY`, `SESSION_SECRET`, `OWNER_PASSWORD_HASH`, `OWNER_TELEGRAM_CHAT_ID`.
Non-secret config in `app_settings` table (thresholds, timezone, default prices behavior) so the
owner can change it from the UI.

Time policy: store UTC ISO-8601; every event also stores `business_date` (local date in
`America/La_Paz`) computed at write time; all reports group by `business_date` (**INV-3**).

## 6. Security

- **Web:** single owner account; password (argon2id hash via WASM or PBKDF2-HMAC-SHA-256 with
  Web Crypto if bundle size demands — ADR-007) → HttpOnly, Secure, SameSite=Lax session cookie
  (HMAC-signed, 30-day sliding). All `/api/*` require the session. CSRF: SameSite +
  double-submit token on mutations.
- **Telegram:** webhook validated with `X-Telegram-Bot-Api-Secret-Token`; messages accepted only
  from `OWNER_TELEGRAM_CHAT_ID`; anything else answered with a polite refusal and logged.
- **AI boundary:** the model can only call whitelisted tools with Zod-validated inputs; no
  free-form SQL in v1 (ADR-006). Write tools always require human confirmation (**INV-4**).
- **Data:** single-tenant; R2 bucket private (signed URLs for photos); backups encrypted at rest
  by Cloudflare. No PII beyond customer first names/phones the owner types.

## 7. Observability

- **Structured logs** (JSON) via Workers Logs; every command logs `{command, source_channel, event_id, duration_ms, ok}`.
- **`assistant_interactions` table**: prompt, model, tool calls, tokens, latency, draft, user
  verdict (accepted / edited / rejected) — the dataset for G7 accuracy tracking and prompt
  iteration (see Doc 05 §8).
- **`audit_log` table**: who/when/what for every create/update/delete of business events, with
  before/after JSON.
- **`job_runs` table** + Telegram alert to the owner-developer channel on job failure.
- **Consistency sentinel** (part of `daily-snapshot`): recompute `SUM(stock_movements)` per item
  vs `item_stock`, and account balances vs transaction sums; mismatch → alert (**INV-5** monitor).

## 8. Performance & capacity assumptions

~10–40 events/day, < 50k kardex rows/year, DB well under D1's 10 GB limit for decades.
Every list endpoint is paginated and indexed (Doc 04 §6). SPA bundle target < 350 kB gzip initial.
No caching layer needed; D1 read latency at this scale is negligible. Worker CPU limits are
irrelevant except in the AI loop, which is network-bound (streamed).

## 9. Deployment

- `main` branch → GitHub Actions: typecheck, lint, unit + integration tests → build SPA →
  `wrangler deploy` to **staging** → Playwright smoke on staging → manual approval → deploy prod.
- D1 migrations applied by `wrangler d1 migrations apply` in the same pipeline **before** the
  Worker version switch; migrations MUST be backward-compatible with the previous Worker version
  (expand → migrate → contract pattern).
- Rollback: `wrangler rollback` (Worker versions); DB rollbacks are forward-fix only.

## 10. Cost estimate (monthly)

| Item | Cost |
|------|------|
| Workers Paid plan (includes D1/R2/cron beyond free tier headroom) | US$5 |
| R2 storage (photos + backups, < 5 GB) | ~US$0 |
| Claude API (≈600 capture calls + 150 analytical chats/mo, Sonnet) | ~US$5–10 |
| Telegram | free |
| **Total** | **≈ US$10–15/mo** |
