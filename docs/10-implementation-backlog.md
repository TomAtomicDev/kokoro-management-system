# 10 — Implementation Backlog

Tasks are grouped by phase (Doc 09) and ordered by execution priority within each phase.
ID format `KOK-xxx`. Every task follows the Definition of Done (Doc 08 §5). Sizes:
S ≤ half day · M ≤ 1.5 days · L ≤ 3 days (AI-assisted).

## Phase 0 — Foundations

| ID | Task | Area | Size |
|----|------|------|------|
| KOK-001 | Monorepo scaffold: pnpm workspaces, Biome, strict tsconfig, `packages/shared` skeleton | infra | S |
| KOK-002 | Worker skeleton: Hono app, env bindings (D1, R2, secrets), health route, structured logging middleware | backend | S |
| KOK-003 | SPA shell: Vite + React + Tailwind v4 + shadcn/ui init, TanStack Router/Query, layout (sidebar/topbar), dark mode | ui | M |
| KOK-004 | Serve SPA from Worker static assets; SPA fallback routing | infra | S |
| KOK-005 | D1 databases (dev/staging/prod) + Drizzle setup + migration 0001: full schema, views, indexes, seeds (Doc 04) | backend | L |
| KOK-006 | `shared`: money.ts, qty.ts (integer math + formatting es-BO), business-date util (America/La_Paz), UUIDv7, enums | backend | M |
| KOK-007 | Auth: password login (SC-18), signed session cookie, middleware, rate limit, CSRF token | backend | M |
| KOK-008 | Audit log helper + DomainError model + route error mapping | backend | S |
| KOK-009 | CI/CD: GitHub Actions (check → build → migrate+deploy staging → approval → prod), wrangler config per env | infra | M |
| KOK-010 | `CLAUDE.md` from Doc 08; PR template with KB-compliance checklist | infra | S |

## Phase 1 — Money & Stock Ledger

| ID | Task | Area | Size |
|----|------|------|------|
| KOK-011 | Catalog service + API + UI (SC-15): items CRUD, aliases, active toggle, merge utility | full | L |
| KOK-012 | Kardex engine (`core/inventory`): movement writer, item_stock maintenance, negative-stock flag (INV-8) | backend | M |
| KOK-013 | WAC engine (`core/costing`): C-1/C-2 entry updates, unit-cost snapshots; property-based tests | backend | M |
| KOK-014 | Finance service: transactions, transfers (paired rows), withdrawals, balance maintenance | backend | M |
| KOK-015 | Finance UI (SC-10): account cards, tx table, gasto/ingreso/transfer/retiro forms | ui | L |
| KOK-016 | Purchases: service (stock + WAC + replacement cost + expense tx in one batch), API, form with LineEditor + photo→R2 (SC-07) | full | L |
| KOK-017 | Inventory UI (SC-08): stock tab + KardexView drawer | ui | M |
| KOK-018 | Stock exits: service + UI (reason, valuation C-6) | full | M |
| KOK-019 | Inventory counts: service (DRAFT→COMMITTED, ADJUST movements) + checklist UI | full | L |
| KOK-020 | Onboarding wizard steps 1–5 (SC — onboarding) | ui | L |
| KOK-021 | Jobs runtime + `daily-snapshot` + INV-5 consistency sentinel + `job_runs` | backend | M |
| KOK-022 | R2 backup job + retention + settings surface (SC-16 backup card) | backend | M |
| KOK-023 | Dashboard v1 (SC-01: cash, stock value, low stock strip) | ui | M |
| KOK-024 | Event edit/delete framework: regenerate-derived pattern (R-1), UndoToast, audit trail in drawer | full | L |

## Phase 2 — Production & Costing

| ID | Task | Area | Size |
|----|------|------|------|
| KOK-025 | Recipes service + UI (SC-06) incl. theoretical cost panel (C-3 preview) | full | L |
| KOK-026 | Production runs: service (C-4 costing, consumption editing, output WAC update) + form + list (SC-05) | full | L |
| KOK-027 | Sessions: service + UI (SC-09), open-session chip, one-open-per-type warning | full | L |
| KOK-028 | Shared-cost allocation on session close (S-3) + estimate-cost handling (S-2) | backend | M |
| KOK-029 | `replacement-cost-refresh` job (C-3 for semi/finished) + `CalcTrace` component | full | M |

## Phase 3 — Sales & Orders

| ID | Task | Area | Size |
|----|------|------|------|
| KOK-030 | Sales: service (stock out, margin snapshot, income tx / receivable), API, form + list (SC-02/03) | full | L |
| KOK-031 | Receivables: collect-payment flow (UC-04), aging view, filter preset | full | M |
| KOK-032 | Customers: minimal CRUD + pickers | full | S |
| KOK-033 | Custom orders: state machine service (O-1…O-5), deposit liability accounting (INV-7) | backend | L |
| KOK-034 | Orders board UI (SC-04) with lifecycle actions + order profitability panel | ui | L |
| KOK-035 | price_history + price update flow + margen/price suggestion logic (C-5) | backend | M |
| KOK-036 | Price-health screen (SC-12) + MarginBadge everywhere sales prices render | ui | M |
| KOK-037 | Liability + receivables strips on Finance/Dashboard; v_liability view wiring | full | S |

## Phase 4 — Telegram + AI Capture

| ID | Task | Area | Size |
|----|------|------|------|
| KOK-038 | Telegram webhook: grammY on Hono, secret validation, update dedupe (INV-2), `/start` chat-id linking | backend | M |
| KOK-039 | Assistant runtime: OpenAI client adapter (`llm.ts`), tool-calling loop, streaming, model config from app_settings, interaction logging (A-3) | ai | L |
| KOK-040 | Tool registry framework + all read tools (Doc 05 §2) | ai | L |
| KOK-041 | Draft tools for all commands (shared schemas, D-4) | ai | M |
| KOK-042 | CAPTURE pipeline: prompts (system.capture.md), entity resolution, clarification policy (A-4), sanity bounds (A-5) | ai | L |
| KOK-043 | Confirmation cards + field-edit flow + receipts (Doc 06 §5); pending_drafts store | full | L |
| KOK-044 | Voice/photo input: audio-mode switch in `llm.ts` (transcribe vs native-audio per configured model, Doc 05 §1.1); photos → text-model vision; verify default model ids vs OpenAI lineup; no media persistence (A-6) | ai | M |
| KOK-045 | Command mini-forms (`/venta`, `/compra`, …) + `/resumen`, `/stock`, `/caja` quick queries | ai | M |
| KOK-046 | Morning digest + push alerts job (low stock, price health, deliveries, receivables) with deep links | backend | M |
| KOK-047 | Eval suite v1: 60 capture + 20 query fixtures, CI harness, weekly live run (D-7) | ai | L |
| KOK-048 | Web QuickAdd bar reusing CAPTURE + ConfirmDraftCard | ui | M |

## Phase 5 — Insights & Analytical AI

| ID | Task | Area | Size |
|----|------|------|------|
| KOK-049 | QUERY pipeline + web ChatPanel with streaming + chart blocks (SC-14) | ai | L |
| KOK-050 | Reports suite (SC-11, SC-13): cashflow, ventas, producción, mermas, retiros + CSV export | full | L |
| KOK-051 | Time profitability (S-4): session Bs/h, monthly owner Bs/h, report + dashboard card (G3) | full | M |
| KOK-052 | Dashboard v2 (full SC-01) + alert deep links | ui | M |
| KOK-053 | AI Ops panel (SC-17): acceptance rate, corrected fields, cost | ui | M |
| KOK-054 | Weekly Telegram digest job | backend | S |

## Phase 6 — Hardening

| ID | Task | Area | Size |
|----|------|------|------|
| KOK-055 | Playwright E2E suite: onboarding, each UC happy path, edit/delete/undo, order lifecycle | qa | L |
| KOK-056 | Backup-restore drill + runbook doc; export-all (CSV zip) for owner data sovereignty | infra | M |
| KOK-057 | Perf/index verification with 1-year synthetic data; SPA bundle budget check | infra | M |
| KOK-058 | Accessibility pass (Doc 06 §6) + mobile-web bottom-tab polish | ui | M |
| KOK-059 | Prompt tuning round from ≥1 month of assistant_interactions; eval fixture expansion | ai | M |
| KOK-060 | Security review: authz on every route, R2 signed URL scope, rate limits, secret rotation runbook | infra | M |

## Cross-cutting rules

- Bugs found in invariants (INV-x) jump the queue as P0.
- Each phase closes with a "phase acceptance" pass against the criteria in Doc 11 §5 before the
  next phase starts.
