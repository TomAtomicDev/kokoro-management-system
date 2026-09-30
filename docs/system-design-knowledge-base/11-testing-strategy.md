# 11 — Testing Strategy

Test pyramid: many fast unit tests on the domain core, a solid integration layer against real
SQLite/D1, a thin E2E layer for the critical journeys, plus an **AI evaluation suite** treated
as first-class tests (D-7).

Tooling: **Vitest** with `@cloudflare/vitest-pool-workers` (runs inside workerd with real D1
bindings), **Playwright** for E2E, **fast-check** for property-based tests.
Command: `pnpm check` = biome + tsc + unit + integration. CI runs everything; E2E runs against
staging post-deploy.

## 1. Unit tests (`core/`, `shared/`)

Pure logic tested exhaustively, no DB:

- **money/qty utils:** formatting es-BO, rounding half-up, integer safety.
- **WAC engine (C-1):** entry math, negative-on-hand guard, exit neutrality.
- **Production costing (C-4):** direct + indirect + allocation → unit cost; merma absorption.
- **Assembly costing (C-10, Phase 3.2):** component cost transfer → output unit cost; breakage
  absorption (inputs for 10, 9 usable out → the 9 carry the whole cost); and the assertion that an
  assembly produces **no** financial transaction and **no** allocated session cost.
- **Replacement cost (C-3):** recipe rollup, missing-ingredient handling.
- **Composite replacement cost (C-3d, Phase 3.2):** definition rollup, multi-level (combo →
  presentation → base), the recipe-vs-definition precedence rule, and cycle refusal.
- **Session allocation (S-3):** proportional split, rounding remainders (largest-remainder so
  Σ allocations = shared cost exactly); assemblies in the session receive nothing.
- **Deduplicated hours (S-5, Phase 3.2):** interval union across overlapping sessions of different
  types; sessions with no duration excluded, not imputed.
- **Order state machine (O-1…O-3, O-6):** every legal/illegal transition, including the backward
  ones and the refusal to reopen `CANCELLED`; zero-deposit confirmation requires the explicit risk
  acknowledgment and creates no finance rows, balance change or deposit liability; on-credit
  delivery requires its independent acknowledgment, including when an R-5 replay confirmation is
  also required.
- **Order corrections (O-7, Phase 3.5):** field/status permission matrix for quote edits, logistics
  updates and renegotiation; a positive deposit/customer identity cannot be rewritten; a zero-deposit
  customer change requires renewed acknowledgment; merchandise subtotal cannot fall below the paid
  deposit; pinned line shares must remain allocatable to the centavo when the subtotal is set;
  corrections create no money/stock rows, reject stale writes and preserve already-recorded work.
- **Margin & price suggestion (C-5).**
- **business_date derivation (INV-3)** across DST-free La Paz and UTC boundaries.

## 2. Property-based tests (mandatory for money math, Doc 08 §4)

- ∀ purchase sequences: `item_stock` = Σ movements (INV-5 in miniature).
- ∀ entry sequences: WAC stays within [min, max] of entry unit costs.
- ∀ allocations: Σ parts = whole (no lost centavos).
- ∀ custom-order deposits: `deposit_paid + delivery balance = agreed_total` exactly, including a zero
  deposit; the zero-deposit confirmation itself creates no financial transaction or account delta.
- ∀ custom-order deliveries with an external provider: `sale.total = merchandise subtotal + delivery fee`,
  the fee equals the actual delivery-session expense, and product gross margin
  (`merchandise subtotal − frozen line COGS`) is invariant to the pass-through pair.
- ∀ receivable sets: each custom-order outstanding amount is `max(sale total − deposit paid, 0)`;
  grouping by customer (plus individually retained no-customer sales) preserves the global sum
  exactly, with no debt omitted or counted twice.
- ∀ event edit/delete sequences: derived rows have no orphans (INV-9/10).
- ∀ assemblies (Phase 3.2, C-10): **total inventory value is unchanged by the event** — Σ
  `ASSEMBLY_OUT.total_cost` + Σ `ASSEMBLY_IN.total_cost` = 0 to the centavo. This is the property
  that makes double-counting between an assembly and the later sale structurally impossible, so it
  is the one to pin first.
- ∀ session interval sets (Phase 3.2, S-5): the deduplicated union is ≤ the naive sum, ≥ the
  longest single interval, and equal to the sum exactly when no two intervals overlap.

## 3. Integration tests (service level, real D1 via vitest-pool-workers)

Template per command service: seed fixture catalog → execute command → assert (a) event rows,
(b) derived kardex/financial rows with correct signs and snapshots, (c) `item_stock`/balances,
(d) audit_log entry, (e) **atomicity**: force a failing statement in the batch and assert
nothing persisted (INV-1).

**Storage isolation is per test FILE, not per test** (`@cloudflare/vitest-pool-workers` v0.13+ —
the earlier `isolatedStorage: true` per-`it()` default was removed upstream; each test file gets
one fresh copy of the post-migration seeded D1, shared by every `it()`/`describe()` inside it).
Most suites are unaffected because they create fresh rows per test (`generateUuidV7`-keyed), but
any suite asserting against a **fixed seeded row** (e.g. `financial_accounts.acc_bank`/`acc_cash`,
Doc 04 §7) that a prior test in the same file may have mutated MUST add a `beforeEach` that resets
that state before every test — see `apps/worker/test/finance.test.ts` and `test/auth.test.ts`
(the latter resets rate-limit `audit_log` rows so login-attempt counting doesn't leak across
tests) for the pattern. Forgetting this reset doesn't fail fast: tests pass or fail depending on
declaration order, which is worse than an obvious crash — watch for it in review whenever a new
integration test touches seed-only rows instead of creating its own.

Priority suites: purchase (WAC + replacement cost updates), production run (consumption edit,
output WAC), sale (PAID vs ON_CREDIT, margin snapshots), collect receivable, order lifecycle end
to end (deposit liability rises/falls correctly — INV-7), cancel with REFUND vs FORFEIT, exits,
count commit (ADJUST correctness), transfers (paired rows sum to zero), edit/delete regeneration
(R-1), nightly consistency job detects and repairs seeded drift (R-2).

**Phase 3.5 receivables/order coverage:** verify `GET /api/receivables` groups by customer, keeps
unassigned debts as separate sale rows, returns the same unfiltered global total as the dashboard
and finance summary under search/age filters and pagination, and reports the net custom-order
balance (including the full total when deposit is zero). Verify zero-deposit confirmation creates
only the order transition/audit, and that no-deposit and credit-delivery acknowledgments are each
mandatory, audited, and independent of R-5.

The orders UI must show every active order regardless of creation date, keep four status lanes in the
agreed order, and sort latest promised delivery date leftmost within each lane. History quick filters
must separate delivered-with-balance, paid and cancelled orders; delivered payment state must follow
the linked sale through later collection. `OrderDto.balanceDue` is only the expected merchandise
remainder on a nonterminal order; delivered reads expose the linked sale's current payment state and
actual remainder, while cancelled reads have no balance. A delivered order missing its active linked
sale is an internal data error, never a zero receivable. Verify list and detail reads, zero-deposit
delivery, paid/on-credit delivery, later collection, cancellation and undo. Verify that source-event
links live only in order detail, its linked-cost panel distinguishes loading, error, verified-empty
and partial evidence without claiming profit before delivery; after delivery, product gross margin
must reconcile to the linked sale's merchandise subtotal and frozen line COGS.
`/orders?open=<id>` survives refresh and browser
  navigation, including >500 active orders, stable ties and undated orders. An external
delivery charge must be included in the final sale/receivable and equal the real operating expense
in the linked closed DELIVERY_RUN session; the order's product gross margin excludes both sides of
the pass-through. The session ends at delivery time and defaults to five minutes. Undo-delivery
  removes the sale fee and customer balance but preserves the actual provider expense/session.
  Undo followed by re-delivery without another provider payment creates no duplicate expense;
  a new provider payment creates a distinct session/expense. Generic edits/deletion of a session
  linked to an active delivered sale must refuse changes to its provider cost/account/type/time.

**Phase 3.2 additions:**

- **Assembly end to end** — components out + presentation in, output WAC, zero financial rows, and
  the "Desayuno Kokoro" golden fixture from `docs/development/acuerdos-prueba-usuario-1.md` §A-1
  checked number for number (Bs 13,00/u bagged loaf; Bs 18,00/u ghee; Bs 5,70/u kéfir 500 ml;
  Bs 40,70/u combo; historical margin 32,17% vs replacement margin 25,83% **firing** the C-5 alert).
- **Replay across the assembly graph** — a backdated bottle purchase must move the presentation's
  WAC *and* the combo's, and must surface an R-5 impact preview when later sales exist.
- **Sale rejects a PACKAGING line** (KOK-126), and an exit of an assembled presentation refuses to
  add packaging lines (KOK-128) — both are the double-deduction guard.
- **Session auto-resolution** (S-1): a purchase with no open PURCHASE_TRIP session creates one in
  the same batch; with one open, it links instead; it never attaches to an open session of another
  type; and a second OPEN session of the same type is rejected by the unique index.
- **Undo delivery** (O-6) — the sale is soft-deleted, `custom_orders.sale_id` cleared, the deposit
  back in `v_liability`, balances restored, all in one batch, with the order back at READY.
- **Future-dated commands are rejected** (KOK-138) across every event service.

## 4. E2E (Playwright, staging)

Journeys (mirroring UC + SC docs): onboarding wizard → first purchase → first production →
first sale → dashboard reflects all; order lifecycle from quote to delivery incl. deposit and
balance; mark-paid receivable; count with variance; edit + undo delete; price update from
price-health screen; login rate limit. Telegram flows are covered by integration tests against
the grammY handlers with faked Update payloads (webhook contract), not by live Playwright.
Phase 3.5 adds the no-deposit order confirmation and explicit acknowledgment, on-credit delivery
warning and acknowledgment, and the Deudas por cobrar journey: reconcile Panel/Finanzas totals, find
debts from prior months, expand a customer to the exact sale/order, collect its full balance, and
verify the debt and all three totals refresh. It also verifies the active Pedidos board across
creation dates, its delivery-date ordering, Historial payment filters, correct linked-sale state,
event links confined to the detail, honest cost/loading states, and delivered product gross margin
against the SaleDto's merchandise subtotal and frozen line COGS. The owner can edit a quote, correct
logistics and renegotiate an active order; O-7 correction flows must preserve deposits/event history
and obey their status/field guards.
The same journey covers an external provider delivery: the client owes the product subtotal plus the
pass-through fee; the provider expense posts once to the chosen account; the detail shows the linked
session and both amounts; and product gross margin does not change because of the pass-through.

## 5. AI evaluation suite (Doc 05 §8)

- **Capture goldens (≥60):** utterance (es-BO, incl. voice-transcript style noise) → expected
  draft: correct tool, exact amounts/qty/items, correct account/session inference; ambiguity
  fixtures must produce a clarification, not a guess (A-4).
- **Query goldens (≥20):** question → expected tool call set + grounding assertions (every
  number in the answer exists in fixture data; "no data" cases answered honestly).
- CI mode: recorded model responses (deterministic); weekly scheduled live-model run flags
  drift. Regression policy: PRs may not reduce golden pass rate; new capabilities add fixtures.

## 6. Acceptance criteria (phase gates, per Doc 09)

| Phase | Gate (all must hold on staging) |
|-------|--------------------------------|
| P0 | CI deploys on merge; login works; empty app renders; migration 0001 applied cleanly to fresh DB |
| P1 | UC-01/09/10/11/12/13 pass integration + E2E; INV-1/5/6/8 test suites green; backup object appears in R2; onboarding produces correct opening state |
| P2 | UC-02/14 pass; C-3/C-4 verified against a hand-calculated spreadsheet fixture (golden numbers checked into repo) |
| P3 | UC-03…UC-08 pass; deposit liability trace correct across full order lifecycle; price-health screen matches hand-calculated margins |
| **P3.2** | UC-21…UC-24 pass; the "Desayuno Kokoro" golden fixture reproduces every figure in `acuerdos-prueba-usuario-1.md` §A-1 including the C-5 alert on the combo; assembly value-conservation and S-5 union property tests green; no sale can carry a PACKAGING line and no packaging is deducted twice on any path; session auto-resolution and the one-OPEN-per-type index enforced; undo-delivery restores liability, balances and stock exactly; **KOK-073 deployed before the first real purchase**; full-page forms show total and affected account without scrolling on a 375px viewport |
| **P3.5** | KOK-191…205 complete; catalog/count reads pass staging-scale and >100-item coverage; receivables API/UI reconcile the all-dates total across Panel, Finanzas and SC-21 and collect the exact full sale balance; zero-deposit orders create no cash/deposit-liability rows; no-deposit and on-credit order acknowledgments are enforced/audited and do not bypass R-5; active Pedidos are unbounded by creation date and ordered by promised date as specified; Historial reflects current sale debt and event links stay in order detail; delivered product gross margin reconciles to merchandise subtotal less frozen sale-line COGS and excludes delivery pass-through; the delivery fee equals the actual session expense and undo preserves that real expense; O-7 corrections enforce field/status permissions, preserve deposits/event history and are audited; partial linked cost is never represented as profit; `pnpm check`, invariant tests, browser and staging smoke tests green; owner approves go-live |
| P4 | Capture eval pass ≥ 90% at launch (target G7 95% after tuning); INV-2/4 enforced by tests; digest delivered to staging chat |
| P5 | Query evals pass; Bs/h numbers match golden spreadsheet; dashboard v2 numbers reconcile with reports |
| P6 | Full E2E suite green; restore drill executed and documented; a11y checklist complete |

## 7. Non-functional checks

- **Perf:** seeded 1-year dataset (~15k movements): every list API < 300 ms p95 locally; SPA
  initial bundle < 350 kB gzip (CI budget).
- **Security:** route-level authz test (every `/api/*` 401s without session); Telegram webhook
  rejects wrong secret/chat; rate-limit tests.
- **Backup:** weekly automated restore-to-scratch-DB verification job comparing row counts.
