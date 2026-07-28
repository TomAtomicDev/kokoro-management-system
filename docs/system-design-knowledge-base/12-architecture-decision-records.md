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

## ADR-004 · Frontend: React 19 + Vite SPA with TanStack Router/Query, Tailwind v4 + shadcn/ui

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

**Decision.** Owner password (argon2id via WASM; PBKDF2-HMAC-SHA256 fallback if bundle size
hurts) → HMAC-signed HttpOnly cookie, 30-day sliding. Telegram authenticated by
`OWNER_TELEGRAM_CHAT_ID` + webhook secret.

**Consequences.** No third-party dependency, works on custom domain and local dev identically,
~50 lines of well-tested code. Cloudflare Access rejected: ties login UX to email OTP and
Cloudflare dashboard config, complicates E2E automation, and adds an ops surface the owner can't
self-serve. Risk of DIY auth accepted because scope is minimal (one credential, no roles, no
signup) and covered by tests (Doc 11 §7).

**Amendment (KOK-007 implementation).** Went with the PBKDF2-HMAC-SHA256 fallback outright
(skipped argon2id — see `apps/worker/src/auth/password.ts` header for the D-10 dependency/bundle
rationale), at **100,000 iterations, not the 600k this ADR originally suggested**: a live staging
deploy revealed the real Cloudflare Workers runtime hard-caps `crypto.subtle.deriveBits` PBKDF2
at 100,000 iterations (`NotSupportedError` above that) — Miniflare's local/test simulation does
not enforce this, so it only surfaces once code actually runs on workerd. 100k is the platform
ceiling for this primitive; going stronger means argon2id WASM after all (a future superseding
ADR), not a higher PBKDF2 count.

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

**Status update (2026-07-18): partially superseded by [ADR-016](#adr-016-synchronous-bounded-wac-replay--cost-adjustment-ledger-for-backdated-inventory-changes-supersedes-adr-009s-nightly-only-repair).**
The "editable events, system-owned derived rows" decision below still holds. What's superseded
is the *repair timing* claim (nightly-only, O(1) edit cost) — it didn't account for plain
out-of-order inserts (not just edits), and left historical sale/exit margins permanently wrong
when a WAC-affecting event was corrected after the fact. See ADR-016 for the revised mechanism.

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
*(Superseded by ADR-016: this window turned out to be unbounded for historical sale margins,
not just "until tomorrow" — see there.)*

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

**Status update (2026-07-27): partially superseded by [ADR-017](#adr-017--one-scale-per-concept-unit-rates-in-milli-centavos-per-whole-unit-enforced-by-branded-types-supersedes-adr-011s-real-allowance-and-its-no-brand-choice).**
The integer-centavos / milli-unit / basis-point core stands. Two sub-decisions did not: the
`REAL` allowance for derived cost columns, and the choice to leave money a bare `number` rather
than a branded type. Both are replaced by ADR-017 after they produced two shipped 1000× unit
bugs (KOK-069 and `v_price_health`).

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

## ADR-015 · Receipt photos via Worker-proxied R2 endpoints, not presigned URLs

**Context.** Doc 02 §6 originally said receipt photo upload/view (KOK-016, UC-01) uses "signed
URLs," which conventionally means S3-style SigV4-presigned URLs allowing the browser to talk to
R2 directly. Implementing that would require the `aws4fetch` package (or equivalent) plus new R2
API-key secrets — a new dependency (D-10) and a new credential to provision and rotate, for an
app with exactly one authenticated user.

**Decision.** Receipt photos go through session-gated Worker routes instead:
`PUT /api/purchases/photos/:key` and `GET /api/purchases/photos/:key` stream directly to/from
`env.BUCKET` (`putObject`/`getObject` in `apps/worker/src/lib/r2.ts`). No presigning, no new R2
credentials, no new package — the existing `/api/*` session + CSRF middleware (ADR-007) is the
only access control, exactly as it already is for every other business write.

**Consequences.** Functionally equivalent privacy for a single-owner app already gated end-to-end
by session auth: nothing reachable via a presigned URL would be reachable any other way here. The
Worker does slightly more request-proxying work (every photo byte flows through it rather than
browser↔R2 directly), which is irrelevant at this app's traffic volume. If the app ever grows
multiple authenticated actors with different photo-access scopes, presigned URLs (or a
capability-scoped variant) become worth revisiting — not needed today. Doc 02 §6 and any future
receipt-photo-adjacent task (sales/production attachments) should follow this same
Worker-proxied pattern unless a concrete new requirement forces a change.

## ADR-016 · Synchronous bounded WAC replay + cost-adjustment ledger for backdated inventory changes (supersedes ADR-009's nightly-only repair)

**Context.** ADR-009 assumed WAC drift from edits could wait for the nightly job because edits
were expected to be rare, deliberate corrections. Designing KOK-024 (event edit/delete) surfaced
a broader case: **any** new event recorded with a `business_date` earlier than the latest
already-processed movement for that item — not only edits of existing events — breaks C-1's
incremental WAC formula, which assumes chronological application order. This is the *routine*
case for a Telegram-first capture flow (e.g. recording today's production run before backdating
last week's flour purchase), and it is already reachable today, confirmed in the shipped
`recordPurchase` (KOK-016): it reads `items.wac` / `item_stock.qty_on_hand` at their CURRENT
value and applies C-1 against them regardless of the new movement's `business_date`
(`apps/worker/src/core/purchasing/index.ts:108-154`); no ordering guard exists anywhere in the
command schema, route, or service. Separately, waiting for the nightly job to fix an item's
current `wac` never touches already-frozen `sale_lines.unit_cost_snapshot` /
`stock_exits.unit_cost_snapshot` values — those margins stay wrong forever, not just "until
tomorrow" as ADR-009 implied.

**Decision.**
1. Any command that creates, edits, or deletes a movement-affecting event with a `business_date`
   earlier than the latest already-processed movement for an affected item triggers a
   **synchronous, bounded replay** — within the same batch as the command, not the nightly job —
   that resumes `recomputeWacFromMovements` (KOK-013) from the touched point forward instead of
   only from zero (R-2 revised). The nightly consistency job (KOK-021/INV-5) becomes a backstop
   auditor for drift the synchronous path might miss (e.g. a direct DB fix bypassing services),
   not the primary corrector.
2. The replay cascades across items connected by production recipes (raw material →
   semi-finished → finished), in recipe-dependency order, because a `ProductionRun`'s output
   unit cost (C-4) depends on its consumed items' WAC. Until KOK-026 ships, the dependency graph
   has a single node (no production yet), so this only becomes observable once production runs
   exist — but the mechanism is designed generically now so KOK-026 doesn't need a second
   implementation.
3. Snapshots already frozen at write time (`sale_lines.unit_cost_snapshot`,
   `stock_exits.unit_cost_snapshot`) are never rewritten by a replay — per-day historical margins
   stay exactly as originally reported. Instead the replay books a `costing_adjustment` row (new
   table, Doc 04 §3.4, R-4) capturing the aggregate `cost_delta` in Bs, dated to the
   *correction's* `business_date` (today), so cumulative profitability reporting absorbs the
   correction without silently altering history.
4. Before committing a change whose replay (per point 1) would touch sales or production runs
   already recorded after the touched point, the service computes and the API returns an
   **impact preview** (count of affected records + estimated `cost_delta`); the UI requires
   explicit confirmation before commit (R-5).

**Consequences.** Edit/insert/delete cost is no longer strictly O(1) — it's O(n), n = an affected
item's TOTAL movement count, not just the movements after the touched point. There is no
per-movement WAC cache to resume the seed state from (a cache would be a third place for the WAC
to be wrong), so the replay recomputes the untouched prefix from zero on every run, in addition to
the touched suffix. Bounded in practice by tens to low hundreds of movements for a solo-operator
business, which is cheap enough to do synchronously.
This removes the "stale until tomorrow" WAC window entirely and — more importantly — stops
historical sale margins from silently absorbing an old costing mistake with no visibility.
Historical per-day reports stay trustworthy (never rewritten); cumulative rentabilidad stays
accurate via the adjustment ledger. New complexity: replay must walk a small dependency graph
across items once production recipes are involved, and the impact-preview UX needs real design
work (not just a toast). New schema: `costing_adjustments` (Doc 04). This is a prerequisite
shared by KOK-024 (edit/delete) and KOK-026/KOK-028 (production, WAC cascade on shared-cost
allocation) — built once in `core/costing`/`core/inventory` rather than twice.

## ADR-017 · One scale per concept: unit rates in milli-centavos per whole unit, enforced by branded types (supersedes ADR-011's REAL allowance and its no-brand choice)

**Context.** ADR-011 chose integer centavos + milli-unit quantities and permitted `REAL` in
"explicitly-documented derived cache columns". In practice that produced **two different
denominators for the same-sounding concept**: `sale_price` / `sale_lines.unit_price` are centavos
per WHOLE unit, while `items.wac`, `items.replacement_cost`, `sale_lines.unit_cost_snapshot` and
`stock_exits.unit_cost_snapshot` are centavos per MILLI-unit, stored as floats. Nothing
distinguishes them — not the column type, not the name, not the TypeScript type (both are bare
`number`). So `sale_price − wac` compiles, runs, and is wrong by ~1000× while looking plausible.

This is not hypothetical. It shipped: `v_price_health`'s three margin columns were wrong by
1000× from migration 0001 until KOK-069 removed them; `SaleForm.tsx` carries a hand-written
`unitPrice / 1000` with an explanatory comment; ~25 further ad-hoc `× 1000` / `÷ 1000` sites are
scattered across `core/costing`, `core/production`, `core/recipes` and eight web components,
each one an independent chance to get the direction wrong. `money.ts`'s header records the
original decision *not* to brand the types "to keep every call site ergonomic"; the two bugs
above are the evidence that cost more than the ergonomics saved.

The system has **not been delivered to the owner and holds no production data**, so the migration
cost of fixing the representation is close to zero and will only ever rise.

**Decision.** Four scales, one per concept, each with a distinct nominal brand in
`packages/shared`; no concept has two scales.

| Concept | Scale | Brand | Column suffix |
|---|---|---|---|
| Money amount (total, balance, line total) | integer **centavos** | `Centavos` | none |
| **Any per-unit rate** (sale price, unit price, WAC, replacement cost, cost snapshot, theoretical unit cost) | integer **milli-centavos per WHOLE unit** (Bs 8.00/u → `800_000`) | `MilliCentavosPerUnit` | `_mc` |
| Quantity | integer **milli-units** of the item's own unit | `MilliUnits` | none |
| Percent / rate | integer **basis points** | `BasisPoints` | none |

1. **Every per-unit rate shares one denominator (the whole unit) and one scale.** `sale_price_mc
   − replacement_cost_mc` is dimensionally valid; the class of bug above cannot be expressed.
2. **`REAL` is removed from the schema.** Milli-centavos give ~3 decimal digits below the
   centavo, strictly more precision than the domain needs and, unlike float, deterministic —
   WAC replay (ADR-016) becomes reproducible bit-for-bit.
3. **Exactly two conversion helpers exist**, both in `shared/money.ts`, and they are the only
   place a scale factor appears anywhere in the repo:
   `totalCentavos(rate: MilliCentavosPerUnit, qty: MilliUnits): Centavos` (÷10⁶, half-up) and
   `rateFromTotal(total: Centavos, qty: MilliUnits): MilliCentavosPerUnit` (×10⁶).
   A bare `1000` or `1e6` outside `money.ts`/`qty.ts` is a review failure (D-5).
4. **Brands are nominal, zero-runtime** (`number & { readonly __brand: … }`) with explicit
   constructors. Mixing scales becomes a compile error rather than a plausible wrong number.
   Runtime `assertSafeInteger` guards stay — brands catch developer error, assertions catch
   bad input.
5. **Column names carry `_mc`** so raw SQL, D1 console sessions and CSV exports are
   self-describing. `800000` is unreadable; `sale_price_mc = 800000` is not.

**Correction (found during KOK-070).** Every worked example above (and the two duplicates in
Doc 04 §2 and Doc 13) originally read `8_000_000` for Bs 8.00/u and `12_345_000` for Bs 12.345/kg
— 10× too large. `milli-` is literally ×1000 (matching `MilliUnits`, which is unambiguously
×1000 in shipped code — see `qty.ts`'s `formatQty`, `÷ 1000`), so Bs 8.00 = 800 centavos ×
1000 = `800_000` milli-centavos, not `8_000_000`. The stated formulas were never wrong —
`totalCentavos(800_000, 1000)` (rate × qty ÷ 1e6, qty=1000 for one whole unit) already produces
the correct `800` centavos — only the illustrative numbers were, evidently copy-pasted between
the three docs without being checked against the formula. Fixed here and in Doc 04 §2 / Doc 13
in the same PR (D-1); `packages/shared/src/money.test.ts` now property-tests
`totalCentavos`/`rateFromTotal` against the corrected scale.

Delivered by a new forward migration (KOK-071), not by editing applied migrations — the
never-modify-applied-migrations guardrail holds even pre-production, and a fresh dev DB from
`0001…0007` must be identical to a migrated one.

**Consequences.** One-off churn across ~82 files touching cost/price fields, the shared Zod DTOs
(D-4 means each schema change lands in API + form + AI tool together), and the money property
tests (Doc 11 §2), which gain an overflow bound: `rate ≤ 10⁷ mc × qty ≤ 10⁶ mu = 10¹³`, two
orders of magnitude inside `Number.MAX_SAFE_INTEGER`. Raw integers in the DB get larger and less
readable, mitigated by the `_mc` suffix and by formatters at every display boundary. Migration
0007 rewrites values in place (**`× 1_000_000`** for the old centavos-per-MILLI-unit costs, `× 1000`
for the old centavos-per-WHOLE-unit prices) and is a one-way door once real data exists — which is
exactly why it happens now.

> _Correction (KOK-071 vertical 2, 2026-07-28): this paragraph originally read `× 1000` for **both**
> groups. Wrong for the first: Bs 8.00/u is `0.8` centavos per milli-unit and `800_000` mc, a factor
> of 10⁶ — two conversions (milli-unit → whole unit, and centavo → milli-centavo), not one. The
> shipped migration was always correct (`0007_wac_family_mc_scale.sql` uses
> `CAST(ROUND("wac" * 1000000) AS INTEGER)`); only this prose was, and it would have led migration
> 0008 to under-scale `replacement_cost` by 1000×. Same copy-paste failure mode as the KOK-070
> correction above — check illustrative factors against the formula._

**Alternatives considered.**
- *Brands only, keep both denominators.* Cheapest, and the compiler would catch the mismatch.
  Rejected: it leaves ~25 conversion sites and the `REAL` columns in place, so every future
  price-vs-cost feature still pays a correctness tax to save one migration we can do for free
  today.
- *Normalize costs to per-whole-unit but leave `sale_price` in plain centavos.* Removes most
  sites but preserves exactly one scale boundary — the boundary KOK-069's bug lived on. Rejected
  for leaving the door ajar.
- *Store money as `TEXT` decimal strings or a decimal library.* Rejected under D-10 (no new
  dependency) and for making SQL comparison/aggregation in views awkward.

**Amendment (KOK-071 vertical 2, 2026-07-28) — quantization of derived and recursive rates.**

`core/costing/replacement-cost.ts`'s `computeItemReplacementCost` returns a deliberately UNROUNDED
float, and its header records why: `items.replacement_cost` is read back **recursively** as an
ingredient's cost by another item's C-3 calculation (a multi-level BOM — RAW_MATERIAL →
SEMI_FINISHED → FINISHED), so rounding the stored value compounds a rounding error at every level
instead of only once, at display time — the discipline `core/recipes/theoretical-cost.ts`'s C-3b
preview follows. Point 2 above removes `REAL` from the schema and requires every stored money value
to be an integer. For this one column the two read as a straightforward conflict, and vertical 2
cannot proceed without settling it.

**Decision: the integer wins, with no exception carved out for this column.** Three findings, in
order of weight:

1. **The conflict is an artifact of the OLD scale.** The float rationale was written when the only
   integer alternative was the pre-KOK-071 *centavos-per-milli-unit* grid, on which Bs 8.00/u is
   `0.8` — quantizing there costs ~25% per level and the header comment is entirely right to refuse
   it. On the `_mc` grid the same rate is `800_000`. One milli-centavo is Bs 0.00001 per unit:
   three decimal digits below the centavo the value is ever *displayed* in. "Round only at display
   time, never in the cached column" is therefore **preserved, not violated** — milli-centavos is
   not a display scale, and C-3b's preview (which rounds to a whole centavo per whole unit, a grid
   1000× coarser) remains the only place a display rounding happens.
2. **The recursion is not unique to this column, and vertical 1 already decided it.** A production
   run's output cost is `rateFromTotal(total_cost, actual_output_qty)` → an integer
   `MilliCentavosPerUnit`, written as the PRODUCTION_IN movement's `unit_cost_mc` and rounded a
   second time by `applyWacEntry`'s C-1 average into `items.wac_mc`; when that output is
   SEMI_FINISHED and is consumed by a deeper run, its rounded WAC is snapshot as that run's
   `direct` cost (C-4). That is the identical multi-level compounding structure on the identical
   grid, and migration 0007 shipped it. The premise that "WAC never had replacement_cost's
   recursion problem" does not survive inspection; a carve-out here would leave the two halves of
   one BOM cost model on two different rules — which is the ambiguity ADR-017 exists to remove.
3. **Measured, the disputed rounding is not what causes BOM drift.** Simulated against an exact
   rational reference, decomposing drift into the *leaf* quantization (a RAW_MATERIAL's own
   `replacement_cost_mc = rateFromTotal(line_total, qty)`, an integer under this ADR no matter what
   is decided here) versus the *incremental* cost of also rounding each derived level. Flour bought
   3 kg for Bs 25.00, item unit = gram, 1000 g → 1 output unit (true cost `833_333.33` mc):

   | BOM depth | drift from leaf quantization alone | added by rounding the cached column |
   | --------- | ---------------------------------- | ----------------------------------- |
   | 1         | 333.3 mc (0.333 centavos)          | 0.000 mc                            |
   | 2         | 1 003.0 mc (1.003 centavos)        | 0.441 mc (0.0004 centavos)          |
   | 5         | 27 326 mc (27.3 centavos)          | 15.8 mc (0.016 centavos)            |

   The float cache does not protect against the drift that actually exists: at every depth the leaf
   term is 100–1700× larger, and it is unavoidable under this ADR. A displayed centavo only moves
   past 500 mc of drift.

**Normative consequences.**

- `items.replacement_cost_mc` is `INTEGER NOT NULL DEFAULT 0`, milli-centavos per whole unit,
  rounded half-up once per BOM level by the same `roundHalfUpToInt` every other derived rate uses.
- **Recorded tolerance:** each derived level adds ≤ 0.5 mc (Bs 0.000005/unit) of absolute
  quantization. Relative drift down a chain is dominated by, and approximately equal to, the leaf's
  own `0.5 mc / leaf_cost_mc` — the tolerance this ADR already accepts for every stored rate. This
  is an accepted, bounded tolerance, not a defect to be fixed later.
- **A property test pins the bound** (Doc 11 §2, and CLAUDE.md's money-math rule): the integer
  result of a randomly-generated multi-level BOM must stay within 0.5 mc per level of an exact
  rational reference.
- **Unit-of-measure guidance (a real finding, wider than C-3).** Drift scales with how many
  ingredient units enter one output unit, so cataloguing a bulk ingredient per GRAM rather than per
  KG multiplies its quantization ~1000× — measured above: 0.33 centavos vs 0.0003 centavos on the
  identical Bs 25.00 / 3 kg purchase. This is a property of this ADR's scale, not of C-3, and it
  argues for preferring the coarser unit when defining an item. Not a blocker for vertical 2.

**Alternatives rejected here.**

- *A `REAL` carve-out for this one column, via a KB exception.* Preserves exactly the "one concept,
  two representations" ambiguity this ADR removes, and per finding 3 buys 0.0004–0.016 centavos of
  precision against a leaf term 100–1700× larger. It also re-opens the non-determinism point 2
  closed: a float `replacement_cost` makes the nightly refresh's result depend on summation order.
- *Recompute each SEMI_FINISHED/FINISHED item from raw materials in one unrounded pass* instead of
  reading its children's cached values. Genuinely removes the per-level term, but contradicts C-3's
  "cached with timestamp" and the dependency-ordered refresh
  (`core/costing/replacement-cost-refresh.ts`), and costs a full BOM tree walk per item — to
  recover ~10⁻⁵ relative precision that no display can show. Rejected.
