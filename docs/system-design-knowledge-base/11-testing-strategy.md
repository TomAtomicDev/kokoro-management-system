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
- **Order state machine (O-8 target):** every legal/illegal transition, including reversal and
  terminal CANCELLED; none creates/reverses cash. Delivery/undo still use R-2/R-5 for stock/cost
  and never refuse because cash was collected.
- **Order corrections (O-8 target):** pre-delivery field/status permission matrix; customer
  fixed once any receipt has ever been linked, merchandise agreement can fall below receipts;
  pinned line shares stay exactly allocatable. Stale writes fail and existing work/cash remains.
- **Margin & price suggestion (C-5).**
- **business_date derivation (INV-3)** across DST-free La Paz and UTC boundaries.

## 2. Property-based tests (mandatory for money math, Doc 08 §4)

- ∀ purchase sequences: `item_stock` = Σ movements (INV-5 in miniature).
- ∀ entry sequences: WAC stays within [min, max] of entry unit costs.
- ∀ allocations: Σ parts = whole (no lost centavos).
- ∀ order-linked receipt sequences: customer price minus qualifying active receipts equals
  expected minus excess; multiple deposits and balance receipts preserve exact centavos.
- ∀ pre-delivery agreement edits (KOK-205): draft agreed subtotal plus draft additional charge
  and the currently active qualifying receipts use the same pure expected/excess helper as
  KOK-207; a subtotal below receipts previews positive excess and is accepted. Deleted rows,
  refunds, OTHER_INCOME and purchase expenses never settle debt. A NULL subtotal has no
  numeric preview; independent finance edits refresh the order-scoped read after saving.
- ∀ order deliveries: `sale.total = merchandise subtotal + additional_charge`, independently
  of any number of provider expenses; product margin excludes charge and expense cash flows.
- ∀ receivable sets: positive outstanding delivered orders plus catalog-sale debt preserve the
  global sum across customer groups with no order sale counted twice or zero-debt order listed.
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
output WAC), sale (PAID vs ON_CREDIT, margin snapshots), catalog receivable collection, cash-free
order lifecycle with byte-for-byte finance-row/account conservation, exits, count commit (ADJUST
correctness), transfers (paired rows sum to zero), edit/delete regeneration (R-1), nightly
consistency job detects and repairs seeded drift (R-2).

**Legacy Phase 3.5 receivables/order coverage (superseded for order payments by ADR-022):** verify `GET /api/receivables` groups by customer, keeps
unassigned debts as separate sale rows, returns the same unfiltered global total as the dashboard
and finance summary under search/age filters and pagination, and reports the net custom-order
balance (including the full total when deposit is zero). Verify zero-deposit confirmation creates
only the order transition/audit, and that no-deposit and credit-delivery acknowledgments are each
mandatory, audited, and independent of R-5.

The orders UI must show every active order regardless of creation date, fetch bounded keyset pages
until continuation is exhausted, keep four vertical status lanes in the agreed order, and sort the
latest promised delivery date first within each lane (undated ties by creation time and ID descending).
The optional history creation-date range defaults to no restriction and is cleared when switching to
Activos; view, filter and date state survive URL reload. KOK-206 owns the payment-derived history
filters and broad read-surface reconciliation; KOK-207 owns delivered-only debt, global receivables,
views, snapshots and alerts.

**KOK-205 edit-form acceptance:** an order-scoped read sums only active, directly linked manual
ORDER_DEPOSIT/ORDER_BALANCE incomes. The agreement form shows that current receipt total and uses
`calculateOrderReceiptBalance` for its draft subtotal + charge preview. It excludes soft-deleted
rows, refunds, OTHER_INCOME, expenses and receipts for other orders; a NULL subtotal has no numeric
preview. Lowering the agreement below receipts is accepted and shows excess. Finance edits invalidate
the read, and a successful order save refreshes it. Update validation covers all four pre-delivery
statuses, FINISHED items, positive quantities, pinned/exact-centavo allocation, customer lock after
any historically linked receipt, explicit nullable clears, immutable PED code, retained work and
stale-write conflict without partial line/audit writes. DELIVERED/CANCELLED agreement edits refuse.

`/orders?open=<id>` survives refresh and browser navigation, including >500 active orders, stable ties
and undated orders. Lifecycle coverage runs confirm/start/ready/back/deliver/undo/cancel/redeliver
against active order cash rows and verifies every transition leaves every financial row and account
balance byte-for-byte unchanged. Delivery snapshots `sale.total = merchandise subtotal +
additional_charge`, posts stock/COGS with R-2/R-5 and creates no provider session/payment. Undo
soft-deletes the sale and reverses stock with R-5 even after independent receipts; redelivery posts no
money. CUSTOM_ORDER collection through `collectPayment` refuses, while CATALOG collection remains
unchanged. After delivery, product gross margin reconciles to merchandise subtotal and frozen sale-line
COGS; KOK-208 verifies the dedicated page's honest linked-cost evidence.

**ADR-022 replacement acceptance (KOK-204…208):** retain the existing catalog-sale and
inventory/costing tests. Add property-based tests on safe integer centavos for arbitrary
numbers of deposits, balance receipts, refunds, expenses, overpayments and edits/deletions:
account balances equal opening plus signed active transactions; `expected` and `excess` are
nonnegative and conserve the signed difference without duplicate receipts; order debt counts
only qualifying active receipts, not expenses/refunds/tips from an unrelated order. Confirm,
deliver, undo, cancel and re-deliver against any existing cash history must leave all finance
rows, account balances, original categories and codes unchanged. Delivery/undo must still
atomically reverse sale/stock with R-2/R-5 replay, even after partial collection; the new
sale remains a stock/COGS snapshot, never an income source. Cover active pre-delivery expected
balance, delivered-only positive receivable, cancellation with/without retained cash,
overpayment, provider expense without customer charge and customer charge without expense.
Product gross margin uses frozen sale-line COGS, whereas cash result sums linked incomes
minus linked expenses, including purchase cash outflow without deducting it again as COGS.
Editing the agreement below receipts shows excess; customer edit after receipt and all edits
of delivered/cancelled agreement fail. Corrections in Finance remain possible in every state.

Migration tests use service-created fixtures to validate FK/trigger/paired-transfer integrity,
order association and account conservation on SQLite/D1; they do not require backfilling
disposable pre-release order cash or provider-session test rows. Reset affected dev/staging
test data at the coordinated cutover and verify catalog/order receivables exactly once,
with matching unfiltered totals across SC-21, Finance, Panel, alerts and snapshots; label
the daily-snapshot/liability projection boundary explicitly. Test >500 orders and bounded
set-based lookup, partial collection and later zero-debt removal. Playwright covers the
KOK-204 migration-0026 fixture checks `PRAGMA foreign_key_check`, order/purchase indexes, manual
ING/GTO codes and transfer pairing; its order-scoped create route takes the association from the
path, and Finance edits preserve that association. Playwright covers the
dedicated `/orders/:id` page, original `?open=` bookmarks, income/expense/refund buttons
whose forms submit the page's PED ID without a picker, appearance of each row in Finance,
and responsive history/finance navigation. The earlier payment-coupled Phase 3.5 assertions
above remain regression history, not target acceptance for custom orders. KOK-202 is retired
unimplemented; its partial-evidence, frozen-COGS, link and error/loading assertions are
covered by KOK-208's dedicated page, not an intermediate drawer.

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
- **Undo delivery** (O-6/O-8) — the sale is soft-deleted, `custom_orders.sale_id` cleared, stock and
  costing are reversed in one batch, all finance rows/accounts remain unchanged, and the order returns
  to READY even after independent receipts.
- **Future-dated commands are rejected** (KOK-138) across every event service.

## 4. E2E (Playwright, staging)

Journeys (mirroring UC + SC docs): onboarding wizard → first purchase → first production →
first sale → dashboard reflects all; order quote/edit with a direct receipt, draft excess preview,
cash-free confirmation, delivery, undo and redelivery; catalog-sale collection; count with variance;
edit + undo delete; price update from price-health screen; login rate limit. The order journey verifies
the same direct receipt row and account balance before/after each lifecycle transition, and that the
order-owned sale snapshots merchandise plus additional charge without collection. KOK-206/207/208
cover global debt surfaces, delivered-only receivables and the dedicated order page. Telegram flows
are covered by integration tests against grammY handlers with faked Update payloads (webhook
contract), not by live Playwright.

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
| **P3.5** | KOK-191…208 complete; catalog/count reads pass staging-scale and >100-item coverage; ADR-022's independent cash, multiple receipts/refunds, cash-free transitions, documented non-production data reset, order-only delivered debts and separately labelled product margin/cash result satisfy the replacement acceptance above; KOK-197…201 surfaces reconciled, KOK-202 absorbed by KOK-208, dedicated order page and legacy deep links verified; `pnpm check`, invariant tests, browser and staging smoke tests green; owner approves go-live. The earlier KOK-204/205 provider-session and single-deposit gates are superseded. |
| P4 | Capture eval pass ≥ 90% at launch (target G7 95% after tuning); INV-2/4 enforced by tests; digest delivered to staging chat |
| P5 | Query evals pass; Bs/h numbers match golden spreadsheet; dashboard v2 numbers reconcile with reports |
| P6 | Full E2E suite green; restore drill executed and documented; a11y checklist complete |

## 7. Non-functional checks

- **Perf:** seeded 1-year dataset (~15k movements): every list API < 300 ms p95 locally; SPA
  initial bundle < 350 kB gzip (CI budget).
- **Security:** route-level authz test (every `/api/*` 401s without session); Telegram webhook
  rejects wrong secret/chat; rate-limit tests.
- **Backup:** weekly automated restore-to-scratch-DB verification job comparing row counts.
