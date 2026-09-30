# 09 — Technical Roadmap

Seven delivery phases plus five inserted remediation/depth phases (P3.1, P3.1.5, P3.2, P3.5,
P5.5 — half-numbers mark work added after the original plan, sequenced by execution order, not by
when it was written). The project has not been deployed to production; staging is the only
environment used so far. Go-live is gated on the staging fixes and readiness checks in Phase 3.5.
Durations assume AI-assisted solo development; they are sequencing guides, not commitments.

```
P0 Foundations ─► P1 Money & Stock Ledger ─► P2 Production & Costing ─► P3 Sales & Orders
                                                                               │
                    P3.1 Onboarding Hardening
                              │
                    P3.1.5 Numeric Foundation
                              │
                    P3.2 User-Test 1 Review
                              │
                    P3.5 Staging Bugs & Improvements
                              │
                    ★ GO-LIVE (first production data)
                              │
                    P4 Telegram + AI Capture
                              │
                              ▼
      P5 Insights & Analytical AI ─► P5.5 Business Health Data ─► P6 Hardening
```

## Phase 0 — Foundations (≈1 week)

Monorepo (pnpm, Biome, tsconfig), Worker skeleton (Hono) + SPA shell served as assets, D1
databases (dev/staging/prod) + Drizzle + migration `0001` (full schema Doc 04 — created once,
complete, to avoid churn), seed accounts/settings, auth (login, session cookie), CI/CD pipeline
(GitHub Actions → staging → approval → prod), `shared` package with money/qty/i18n utilities,
audit_log plumbing, error model.
**Exit:** owner can log into an empty deployed app; CI deploys on merge.

## Phase 1 — Money & Stock Ledger (≈2 weeks) — *replaces the most painful Excel sheets*

Catalog CRUD + aliases (SC-15), Finance module: accounts, transactions, transfers, withdrawals
(SC-10), Purchases with WAC + replacement-cost update (SC-07, C-1…C-3), Inventory: stock view,
kardex, exits, counts (SC-08), onboarding wizard (opening balances + initial count), dashboard
v1 (cash + stock cards), nightly consistency job (INV-5) + snapshots + R2 backup.
**Exit:** stock and cash are trustworthy in production; Excel retired for purchases/cash.

## Phase 2 — Production & Costing (≈1.5 weeks)

Recipes (SC-06), production runs with actual-yield costing (SC-05, C-4), sessions + shared-cost
allocation + hours (SC-09, S-1…S-3), replacement-cost refresh job for semi/finished items.
**Exit:** every finished product has a real unit cost and replacement cost.

## Phase 3 — Sales & Custom Orders (≈1.5 weeks)

Catalog sales + receivables (SC-02/03), price_history, customers, custom-order lifecycle with
deposit liability (SC-04, O-1…O-5), price-health report v1 (SC-12).
**Exit:** full Modality 1 + 2 operation in production; Excel fully retired.

## Phase 3.1 — Onboarding Hardening (≈0.5 week)

Closure of the triage register from the owner's first walk through the setup wizard (GH #4): kind-
conditional required fields, canonical units with magnitude-scaled input, `PACKAGING` as its own
item kind, unmetered items (C-9), opening-inventory valuation (C-8), and the wizard-navigation
rework. Inserted before P3.1.5 in execution order.
**Exit:** a first-run owner reaches a trustworthy opening state — correct catalog, correct opening
stock, correct opening balances — without help.

## Phase 3.1.5 — Numeric Foundation (≈0.5 week)

Branded numeric scales in `packages/shared`, migration 0007 normalizing every per-unit rate to
milli-centavos per whole unit, and the call-site cleanup that removes ~25 ad-hoc ×1000
conversions (ADR-017). Inserted 2026-07-27 after two 1000× unit bugs shipped.
**Exit:** no `REAL` in the schema, no ad-hoc money/quantity scale conversion outside
`shared/money.ts`, WAC replay reproducible bit-for-bit.
**Why here and not later:** P4 freezes field names into shared Zod schemas, prompt few-shots and
golden eval fixtures, so a rename afterwards costs a re-blessing of the eval suite that D-7
deliberately makes expensive; running the migration first lets the whole AI layer be authored
once against final names. P5/P5.5 are then pure price-vs-cost arithmetic on top. And the
migration rescales stored values, so it must land before the owner has real data — it is a
one-way door the moment she does.

## Phase 3.2 — User-Test 1 Review (≈4 weeks) — *a go-live prerequisite*

The owner's first hands-on session on staging produced ~70 observations (GH #23). The review
meeting on 2026-08-11 closed all of them; the decisions are recorded in
`docs/development/acuerdos-prueba-usuario-1.md` and the tasks in Doc 10's Phase 3.2. Four blocks,
in execution order:

1. **Quick wins** — copy, tooltips, sticky headers, dark-theme native controls, favicon + PWA
   shell, reusable date-range filter, client-side column sorting.
2. **Presentation/Combo model** — the structural change (Doc 03 C-3d/C-10, Doc 04's assembly
   tables): packaging stops being a sale line and becomes a component of a new *Envasado/Armado*
   event producing stockable presentations and combos with their own price, stock, WAC and
   composite replacement cost.
3. **Sessions & orders** — session link mandatory in the domain and resolved automatically, one
   OPEN session per type, deduplicated hours for G3, order status reversal and undo-delivery.
4. **Forms, validation & tools** — full-page event forms, live validation with own primitives,
   recipe-less production, opening stock on item creation, calculator, persistent recipe timer.

**Exit / handoff:** blocks 2 and 3 must land before go-live because they change the catalog, the
kardex and the session model — after real data exists, each becomes a migration of live cost history
instead of a schema edit. Completion of Phase 3.2 hands off to Phase 3.5 for staging bug fixes and
release-readiness validation. The business starts recording production data only after Phase 3.5
exits and the owner explicitly approves the release. Block 4 is UI surface and may land after
go-live unless needed to resolve a release-blocking issue.
**Why the model change cannot wait:** presentations give per-size stock and put packaging cost
inside the product's margin. Recording months of sales under the old rule and converting later
would mean rewriting historical `unit_cost_snapshot` values — precisely what R-4 forbids.

## Phase 3.5 — Staging Bugs and Improvements (milestone-based; re-estimate after sizing)

Resolve staging defects and complete release-readiness improvements before the first production
deployment. The catalog/count work addresses the `GET /api/items` D1 100-bound-parameter limit and
the count detail screen's silent item-name/unit fallbacks: preserve the relational catalog, make
reads set-based, return current item identity with count lines, and audit count queries for
unbounded ID lists. Also deliver a dedicated all-dates receivables manager linked from the Panel and
Finanzas, and allow orders to be confirmed with zero deposit or delivered on credit only with
explicit, separately audited risk acknowledgment. Existing `custom_orders.deposit_paid` and nullable
`deposit_tx_id` support a zero deposit; no database schema migration is planned for that rule. The
backlog also closes two observed form defects: hidden save failures and missing opening-stock fields
when creating an item inline from Envasar component lines. Orders get a vertical active-status board
across all dates, an explicit filtered history for delivered/cancelled orders, linked-sale payment
state, honest cost evidence and URL-backed detail navigation. The active board remains sorted by
promised delivery date. The delivery form also records an external provider's real session expense
and the equal customer pass-through in the linked sale, atomically, without adding inventory cost.
O-7's quote, logistics and renegotiation corrections are also implemented with field/status guards,
unchanged paid deposits, and audited atomic commands.

The original two-week estimate predates KOK-200…205 and the external-delivery accounting change.
Do not treat it as a delivery commitment: sequence KOK-196 → KOK-199, KOK-197 → KOK-198,
KOK-191 → KOK-192 → KOK-193, and KOK-200 → KOK-201/KOK-202 (KOK-204 supplies the fee-aware
extension to both). KOK-203 and KOK-205 can proceed after their stated dependencies; KOK-194/195
are independent. Re-estimate the phase with the implementing team, and keep the release gate below
based on verified behavior rather than calendar time.

**Exit / go-live gate:** catalog and inventory counts work with staging-scale and larger datasets;
count item names and units display correctly through draft editing and confirmation; query failures
are visible rather than rendered as plausible fallback data; receivables totals reconcile across
the Panel, Finanzas and SC-21 while the debt list shows every date and exact sale balance;
zero-deposit confirmation/on-credit delivery warnings require the correct explicit acknowledgments
without bypassing R-5; Pedidos shows all active orders, separates delivered/cancelled history,
  reflects the linked sale's current debt state (including after collection), loads active orders
  past the first 500 without truncation, never presents partial linked costs as profit, and
shows delivered product gross margin from sale-line COGS while excluding the external pass-through.
The external delivery expense reconciles with the equal charge in sale total without changing that
  margin, including after undo and re-delivery without duplicate provider expense. O-7 corrections
  preserve paid deposits, reject impossible line allocations and stale edits, and cannot silently
  rewrite recorded production/assembly work.
`pnpm check`, invariant tests, browser verification and staging smoke tests pass. The owner reviews
and approves production release only after this phase exits.

## Phase 4 — Telegram + AI Capture (≈2 weeks) — *the mobile experience*

Telegram bot (webhook, dedupe, chat-id auth, `/start` linking), assistant runtime + tool
registry + CAPTURE pipeline + confirmation cards (Doc 05 §2–3, §6), voice-note input, command
mini-forms, morning digest + alert pushes, assistant_interactions logging, eval suite v1 in CI,
web QuickAdd bar reusing CAPTURE.
**Exit:** ≥ 80% of the owner's daily events captured from the phone (measure via `actor`).

## Phase 5 — Insights & Analytical AI (≈1.5 weeks)

QUERY pipeline + web chat with charts (SC-14), reports suite (SC-11, SC-13), time-profitability
metrics (S-4, G3), dashboard v2 (full SC-01), AI Ops panel (SC-17), weekly digest job.
**Exit:** G2/G3 delivered; owner reviews price health weekly from the dashboard.

## Phase 5.5 — Business Health Data (≈1 week)

Turns recorded events into decisions: money-at-risk ranking and price staleness on SC-12,
contribution Pareto, Bs/hora per product, input cost index, real-vs-nominal position and weekly
profit/Bs-h trends in SC-13's new "Salud del negocio" tab, plus the two health lines in the
Monday digest. `replacement_cost_history` (KOK-073) starts recording immediately, ahead of any
consumer, because that series cannot be backfilled.
**Exit:** every G2/G3 number the owner sees is expressed in Bs or Bs/hour and links to the data
behind it; no chart on screen approximates a series the system does not actually store.

## Phase 6 — Hardening & polish (ongoing, first pass ≈1 week)

Playwright E2E full pass, restore-from-backup drill (documented runbook), rate limiting, perf
pass (indexes verified with real data volume), accessibility audit, prompt tuning from ≥1 month
of interaction logs, evaluate deferred items: Claude Desktop MCP for the owner, receipt-photo
OCR to prefill purchases, collaborator role.

## Dependency notes

- P2 depends on P1's kardex/WAC engine; P3's order delivery depends on P3 sales, not on P2
  (orders can sell items produced without recipes in a pinch — but recipes ship first anyway).
- P4 depends only on P1–P3 services existing (tools wrap them); the eval suite (P4) must exist
  **before** P5 prompt iteration.
- R2 backup (P1) intentionally precedes any real data accumulation.
- P3.1.5 blocks P4 (which freezes field names into eval fixtures), P5 and P5.5 (price-vs-cost
  math), and KOK-036. It must land before the owner has any data, since migration 0007 rescales
  stored values.
- P5.5 depends on P5's report shell (SC-13 tabs) and on KOK-051 for the S-4 definitions, except
  KOK-073, which depends on Numeric Foundation (migration 0007) and must ship before go-live — it
  accumulates a series that no later task can reconstruct, and the clock starts when real purchases
  do. **KOK-073 is pulled forward to close before the Phase 3.5 go-live gate**, not left in P5.5.
- P3.2 and P3.5 gate go-live, and therefore block nothing technically but gate everything
  practically.
  Its Presentation/Combo work also feeds P4: `draft_assembly` and the "a sale never carries
  packaging" rule must exist before the capture prompt and its golden fixtures are authored, for
  the same reason P3.1.5 precedes P4 — D-7 makes re-blessing the eval suite deliberately expensive,
  so the AI layer is authored once against final names and final rules.
- P3.2 also invalidates the staging dataset: the pre-assembly catalog shape is not migrated
  forward, so staging is wiped and re-seeded when block 2 lands. No production data exists yet, so
  this costs nothing — and it is the last moment at which that is true.

## Post-v1 candidate directions (not committed)

Purchase suggestion lists from low stock + upcoming orders; WhatsApp Business bridge if
customers demand it; simple demand notes per product (seasonality journal); multi-device offline
PWA capture if Telegram proves insufficient.
