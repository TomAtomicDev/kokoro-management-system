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
- **Replacement cost (C-3):** recipe rollup, missing-ingredient handling.
- **Session allocation (S-3):** proportional split, rounding remainders (largest-remainder so
  Σ allocations = shared cost exactly).
- **Order state machine (O-1…O-3):** every legal/illegal transition.
- **Margin & price suggestion (C-5).**
- **business_date derivation (INV-3)** across DST-free La Paz and UTC boundaries.

## 2. Property-based tests (mandatory for money math, Doc 08 §4)

- ∀ purchase sequences: `item_stock` = Σ movements (INV-5 in miniature).
- ∀ entry sequences: WAC stays within [min, max] of entry unit costs.
- ∀ allocations: Σ parts = whole (no lost centavos).
- ∀ event edit/delete sequences: derived rows have no orphans (INV-9/10).

## 3. Integration tests (service level, real D1 via vitest-pool-workers)

Template per command service: seed fixture catalog → execute command → assert (a) event rows,
(b) derived kardex/financial rows with correct signs and snapshots, (c) `item_stock`/balances,
(d) audit_log entry, (e) **atomicity**: force a failing statement in the batch and assert
nothing persisted (INV-1).

Priority suites: purchase (WAC + replacement cost updates), production run (consumption edit,
output WAC), sale (PAID vs ON_CREDIT, margin snapshots), collect receivable, order lifecycle end
to end (deposit liability rises/falls correctly — INV-7), cancel with REFUND vs FORFEIT, exits,
count commit (ADJUST correctness), transfers (paired rows sum to zero), edit/delete regeneration
(R-1), nightly consistency job detects and repairs seeded drift (R-2).

## 4. E2E (Playwright, staging)

Journeys (mirroring UC + SC docs): onboarding wizard → first purchase → first production →
first sale → dashboard reflects all; order lifecycle from quote to delivery incl. deposit and
balance; mark-paid receivable; count with variance; edit + undo delete; price update from
price-health screen; login rate limit. Telegram flows are covered by integration tests against
the grammY handlers with faked Update payloads (webhook contract), not by live Playwright.

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
| P4 | Capture eval pass ≥ 90% at launch (target G7 95% after tuning); INV-2/4 enforced by tests; digest delivered to staging chat |
| P5 | Query evals pass; Bs/h numbers match golden spreadsheet; dashboard v2 numbers reconcile with reports |
| P6 | Full E2E suite green; restore drill executed and documented; a11y checklist complete |

## 7. Non-functional checks

- **Perf:** seeded 1-year dataset (~15k movements): every list API < 300 ms p95 locally; SPA
  initial bundle < 350 kB gzip (CI budget).
- **Security:** route-level authz test (every `/api/*` 401s without session); Telegram webhook
  rejects wrong secret/chat; rate-limit tests.
- **Backup:** weekly automated restore-to-scratch-DB verification job comparing row counts.
