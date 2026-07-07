# 09 — Technical Roadmap

Six phases. Each phase ends **deployed to production and usable** — the owner gets value from
Phase 1 onward; Excel is retired incrementally, not big-bang. Durations assume AI-assisted solo
development; they are sequencing guides, not commitments.

```
P0 Foundations ─► P1 Money & Stock Ledger ─► P2 Production & Costing ─► P3 Sales & Orders
                                                        │                     │
                                                        └────────► P4 Telegram + AI Capture
                                                                        │
                                                                        ▼
                                                              P5 Insights & Analytical AI ─► P6 Hardening
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

## Phase 4 — Telegram + AI Capture (≈2 weeks) — *the mobile experience*

Telegram bot (webhook, dedupe, chat-id auth, `/start` linking), assistant runtime + tool
registry + CAPTURE pipeline + confirmation cards (Doc 05 §2–3, §6), voice transcription, command
mini-forms, morning digest + alert pushes, assistant_interactions logging, eval suite v1 in CI,
web QuickAdd bar reusing CAPTURE.
**Exit:** ≥ 80% of the owner's daily events captured from the phone (measure via `actor`).

## Phase 5 — Insights & Analytical AI (≈1.5 weeks)

QUERY pipeline + web chat with charts (SC-14), reports suite (SC-11, SC-13), time-profitability
metrics (S-4, G3), dashboard v2 (full SC-01), AI Ops panel (SC-17), weekly digest job.
**Exit:** G2/G3 delivered; owner reviews price health weekly from the dashboard.

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

## Post-v1 candidate directions (not committed)

Purchase suggestion lists from low stock + upcoming orders; WhatsApp Business bridge if
customers demand it; simple demand notes per product (seasonality journal); multi-device offline
PWA capture if Telegram proves insufficient.
