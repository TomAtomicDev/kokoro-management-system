# 12 — Architecture Decision Records

Format: Context → Decision → Consequences. Status of all ADRs below: **Accepted (2026-07-06)**.
New decisions append ADR-015+; superseding requires a new ADR referencing the old one.

---

## ADR-001 · Platform: single modular monolith on Cloudflare Workers + Hono

**Context.** Constraints demand low cost, zero-ops, easy deploys, evolvability, and
AI-assisted development. Load is tiny (one user, tens of events/day). Candidates: Cloudflare
Workers, Railway (Node/Express or Hono), Hostinger VPS, Supabase (as backend platform).

**Decision.** One Cloudflare Worker (Hono, TypeScript) serving API + Telegram webhook +
assistant + cron jobs + static SPA.

**Consequences.** ~US$5/mo, no servers to patch, cron and object storage built in, instant
rollbacks. Trade-offs accepted: workerd runtime restrictions (no native Node addons — argon2
must be WASM or PBKDF2 fallback), CPU-time limits (irrelevant: workload is I/O-bound), vendor
coupling mitigated by Hono's portability and standard SQL. Railway/VPS rejected: standing
compute (~US$5–20/mo) plus OS/process ops for zero benefit at this scale. Supabase rejected as
platform: heavier stack (Postgres + edge functions split), free-tier pausing risk, and its
strengths (auth, realtime, RLS multi-tenant) are unused by a single-user system.

## ADR-002 · Database: Cloudflare D1 (SQLite) with Drizzle ORM

**Context.** Relational integrity, transactions, tiny scale, co-location with the Worker.

**Decision.** D1 as the only database; Drizzle for typed schema + migrations; atomicity via
`db.batch()` (INV-1); derived aggregates maintained transactionally instead of DB triggers.

**Consequences.** Zero-config, free-tier-sized forever (< 100 MB/decade at this volume),
local-first dev with real SQLite. Accepted limitations: no stored procedures/true serializable
multi-statement interactivity — mitigated because every command is expressible as one batch and
there is exactly one writer (the owner); single-region write latency is irrelevant. PostgreSQL
(Supabase/Railway) rejected: operational surface and cost without a single feature this domain
needs. Fallback documented: Drizzle keeps SQL portable; migration to Postgres is mechanical if
multi-user ever arrives.

## ADR-003 · No microservices, no Queues, no Durable Objects in v1

**Context.** Tech menu included Cloudflare Queues and Durable Objects; constraints say avoid
over-engineering.

**Decision.** All side effects (alerts, cache refresh) run in-process or in cron jobs. No
queues, no DOs, no service decomposition.

**Consequences.** One deployable, one mental model, trivially debuggable. Concurrency control
that DOs would give is unnecessary: a single human writer; Telegram dedupe (INV-2) and
idempotency keys cover retries. If a future need appears (e.g., long-running imports), Queues
can be added behind the existing job abstraction.

## ADR-004 · Frontend: React 18 + Vite SPA with TanStack Router/Query, Tailwind v4 + shadcn/ui

**Context.** Desktop-first data app (tables, drawers, charts, chat). Alternatives: Astro
(content-oriented; islands add complexity for a fully interactive app), TanStack Start / SSR
frameworks (SSR buys nothing behind a login for one user), daisyUI (less composable than
shadcn/Radix for complex form/table/drawer patterns).

**Decision.** Pure SPA served as Worker static assets; TanStack Query as the only client cache;
shadcn/ui + Radix + lucide as the component base; Recharts for charts.

**Consequences.** Simplest possible deploy (static files), excellent AI-codegen ergonomics
(shadcn patterns are ubiquitous in training data), no server rendering pipeline to maintain.
Accepted: slightly slower first paint than SSR — irrelevant for a returning single user.

## ADR-005 · Mobile capture channel: Telegram Bot (not a PWA, not WhatsApp)

**Context.** The owner is out of home most of the day and wants phone capture + quick queries.
Options: custom mobile app (out of scope), offline PWA, WhatsApp Business API, Telegram Bot.

**Decision.** Telegram Bot API (grammY) as the exclusive v1 mobile capture surface.

**Consequences.** Zero mobile codebase; free; push notifications, voice notes, inline keyboards
and webhook retries out of the box; excellent low-connectivity behavior (Telegram queues client
messages). Requires the owner to adopt Telegram (acceptable: WhatsApp remains her *customer*
channel; Telegram is her *business console*). WhatsApp API rejected: cost, business verification
friction, template-message restrictions, and Meta policy risk for this use. PWA rejected for
v1: building capture UI + offline sync duplicates what Telegram gives for free; revisit only if
Telegram adoption fails (Doc 09 post-v1).

## ADR-006 · AI: OpenAI API, runtime-configurable models, curated tool registry; no model-generated SQL; MCP dev-only

**Context.** AI must parse Bolivian-Spanish event descriptions (text and voice notes) reliably
and answer analytical questions with real numbers. Risks: hallucinated writes, SQL
injection-by-model, cost creep, provider/model churn. The founder's stated preference is the
OpenAI API for the **product** assistant (development tooling may use any provider). Recent
OpenAI chat models accept audio (and images) as direct input, removing the need for a separate
transcription stage.

**Decision.** OpenAI API for CAPTURE and QUERY via one in-process tool registry (read tools +
draft tools), with tool/draft schemas emitted as strict structured outputs from the shared Zod
schemas (ADR-008). **Model ids are configuration, not code**: `ai_model_text`,
`ai_model_audio`, `ai_model_transcribe` in `app_settings` (defaults `gpt-5.5`,
`gpt-realtime-whisper`, `gpt-4o-transcribe`; ids verified against OpenAI's lineup at
implementation), editable from Settings without a deploy. Voice notes are processed by the
configured audio model in transcribe mode (current default) or as direct audio input when a
native-audio chat model is configured (Doc 05 §1.1); photos go to the text model's vision
input; the transcription model is only a fallback. **Owner media sent to the assistant is never persisted** (rule A-6) — only text
transcripts/results are logged. Writes always require human confirmation (INV-4). No free-form
SQL tool in v1. The provider client is isolated in a single adapter (`assistant/llm.ts`). MCP
server wraps the same registry for development use only.

**Consequences.** Bounded blast radius (worst case: a wrong *draft*), measurable accuracy
(interaction log + evals — fixtures are provider-agnostic, so model swaps are re-runs, not
rewrites), single point to extend (a new tool serves web chat, Telegram, and MCP
simultaneously). Configurable models mean cost/quality tuning (e.g., a cheaper model for
trivial captures) is a settings change validated by the eval suite, not an architecture change;
the single adapter keeps even a provider switch contained to one file plus eval re-recording.
Query expressiveness is capped by tool coverage — mitigated by `get_trends` + generous
parametrization, and revisitable (a read-only SQL tool over the views is the documented escape
hatch, gated on eval maturity). Trade-off accepted: no persisted audio means a mis-transcribed
voice note cannot be re-heard later — the confirmation card (A-1) is the safeguard, since the
owner verifies the draft before anything commits.

## ADR-007 · Auth: application-level password session; Telegram chat-id allowlist

**Context.** Exactly one user. Options: Cloudflare Access (Zero Trust), third-party auth
(Clerk/Auth0), password + session.

**Decision.** Owner password (argon2id via WASM; PBKDF2-HMAC-SHA256/600k fallback if bundle
size hurts) → HMAC-signed HttpOnly cookie, 30-day sliding. Telegram authenticated by
`OWNER_TELEGRAM_CHAT_ID` + webhook secret.

**Consequences.** No third-party dependency, works on custom domain and local dev identically,
~50 lines of well-tested code. Cloudflare Access rejected: ties login UX to email OTP and
Cloudflare dashboard config, complicates E2E automation, and adds an ops surface the owner can't
self-serve. Risk of DIY auth accepted because scope is minimal (one credential, no roles, no
signup) and covered by tests (Doc 11 §7).

## ADR-008 · Single contract: shared Zod schemas for API, forms, and AI tools

**Context.** Three input channels (web form, Telegram/AI draft, HTTP API) for identical
commands; drift between them is the biggest correctness risk for AI-assisted evolution.

**Decision.** Every command's DTO is one Zod schema in `packages/shared`, imported by the API
route, the React form (via zodResolver), and the AI draft tool definition.

**Consequences.** A schema change propagates compile-time errors to every channel — an AI agent
cannot update one and forget another (D-4). Cost: shared package discipline and careful
serialization of integers (centavos/milli-units) across the wire — handled once in shared
serializers.

## ADR-009 · Editable events with system-derived kardex; O(1) edits + nightly WAC repair

**Context.** The original proposal made `Movimientos_Inventario` an immutable user-facing
ledger. Solo operators mis-record constantly; strict append-only correction (reversal entries)
is accountant ergonomics, not hers. But naive in-place editing corrupts derived costs.

**Decision.** Users edit **events**; derived kardex/financial rows are system-owned and
regenerated atomically per event (INV-9/10). WAC is not retroactively replayed on edits (R-2);
a nightly job recomputes WAC from the full kardex and repairs drift > 1% with an audit entry.

**Consequences.** Corrections are one edit form, no accounting knowledge needed; auditability
preserved via `audit_log` before/after; costs are eventually exact with O(1) edit cost. Accepted
imprecision window: between an edit of an old event and the nightly repair, WAC can be slightly
stale — immaterial at this margin granularity, and the consistency sentinel (INV-5) monitors it.

## ADR-010 · Costing policy: WAC valuation; labor and trip costs not capitalized

**Context.** Choices: FIFO vs weighted average; whether owner labor and purchase-trip/delivery
costs enter product cost.

**Decision.** (a) Weighted average cost per item. (b) Owner labor is never in product cost;
hours are a separate profitability lens (S-4). (c) Purchase-trip freight/fuel and delivery costs
are period operating expenses; only production-session shared costs are allocated into batch
cost (S-3).

**Consequences.** (a) FIFO's per-layer tracking adds real complexity for negligible precision
gain at ~dozens of SKUs; WAC + replacement-cost display covers the inflation problem better than
FIFO's stale layers. (b) Avoids a fictitious wage circularly defining "profit"; Bs/h is the
honest metric for a solo owner. (c) Keeps unit costs comparable across purchases; the P&L still
captures every boliviano. All three are conventions the insights layer states explicitly on
screen (CalcTrace).

## ADR-011 · Numeric representation: integer centavos and milli-unit quantities

**Context.** SQLite has no DECIMAL; floats corrupt money.

**Decision.** INTEGER centavos for money, INTEGER milli-units for quantities, basis points for
rates (INV-6); REAL permitted only in explicitly-documented derived cache columns (`wac`,
`replacement_cost`, snapshots). All arithmetic through `shared/money.ts`/`qty.ts`.

**Consequences.** Exact ledgers, portable SQL, cheap comparisons. Cost: mental conversion in
debugging (mitigated by formatting helpers everywhere) and explicit rounding rules
(half-up at final step; largest-remainder for allocations — tested by property tests).

## ADR-012 · Customer deposits are liabilities (derived, not a stored balance)

**Context.** 50% advances currently distort perceived cash; the core anti-decapitalization
requirement (INV-7).

**Decision.** Deposits post as INCOME/ORDER_DEPOSIT into a real account (cash arrives) while a
**derived liability** `customer_deposits` (from order + transaction state) is reported
everywhere net position appears; released on delivery, reversed on refund, converted to income
on forfeit.

**Consequences.** Cash balances stay physically true (the money *is* in the account) while the
dashboard shows "de tu caja, Bs X no es tuyo todavía". Deriving (vs a stored liability ledger)
eliminates a class of double-entry bugs at this scale; the daily snapshot materializes it for
trends.

## ADR-013 · Negative stock allowed, flagged, never blocking

**Context.** Capture-first principle vs inventory purism. The owner may record a sale before
recording the production that created the goods.

**Decision.** Stock may go negative (INV-8): warn inline at capture, set `negative_since` flag,
surface in alerts until a count/production/purchase resolves it.

**Consequences.** No lost or blocked records in the field; reconciliation is guided rather than
forced. Cost: WAC on negative-stock entries uses the `max(on_hand, 0)` guard (C-1), a documented
approximation the nightly repair keeps honest.

## ADR-014 · Two-account finance model (bank + cash box), extensible table

**Context.** The business runs exactly one bank account and one physical cash box.

**Decision.** `financial_accounts` table seeded with the two accounts; UI hard-designed around
them (account cards, transfer flow); schema supports more accounts without migration.

**Consequences.** Matches the owner's mental model 1:1 today; adding e.g. a savings account or
QR wallet later is a data insert plus minor UI work, not a redesign.
