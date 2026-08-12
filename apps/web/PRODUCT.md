# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One primary user: **the owner** of a one-person artisanal food business in Bolivia. She is
non-technical, Spanish-speaking, comfortable with WhatsApp/Telegram and spreadsheets. There are no
employees, no accountants, no second role in scope — the system is single-tenant, single-user. She
captures events (a purchase, a bake, a sale, a delivery) from her phone via Telegram/AI assistant
in seconds; this web app is where she analyzes trends, edits records, and asks an AI assistant
questions about her own business, from desktop.

## Product Purpose

Kokoro Management turns the everyday events of the business into reliable, always-current business
intelligence with near-zero administrative effort. It replaces an Excel workflow where data entry
only happened hours later at the home PC. The system computes everything derived — stock, real cost
per unit, margin at replacement cost, cash position, order deposits, and the profitability of every
hour she invests — so she never hand-enters a derived number. Success (12 months post-launch): she
records 10–20 events/day in under 30s each, reviews a weekly dashboard showing which products lost
margin to inflation, knows her effective Bs/hour by activity, and has stopped opening Excel.

## Positioning

A neighboring generic bookkeeping or inventory tool could not truthfully make the same claim: this
system is built specifically for a solo operator in a **high-inflation economy**, where **replacement
cost** (not historical cost) is treated as the truth for margin — every finished product's margin is
recomputed automatically after each purchase, with alerts before she unknowingly sells below what it
now costs to replace the stock ("silent decapitalization"). It also treats her own time as a real,
visible cost (Bs/hour by session/product) rather than folding it invisibly into product cost, and
treats customer deposits as a liability, not revenue, until delivery.

## Operating Context

- **Phone is for capture, desktop is for analysis** (a core product principle): Telegram
  interactions are ≤ 3 steps; this web app hosts the deep tables, charts, and editing.
- Events are grouped into **sessions** — purchase trips, production sessions, delivery runs — as
  containers for shared costs (fuel, energy) and person-hours; the system attaches sessions
  automatically rather than asking.
- Operates in **Bolivia, BOB currency only**, in a high-inflation environment — this is why
  replacement cost (not FX or multi-currency) is the inflation mechanism.
- The web app is installable as a **PWA shell** (icon on the phone, instant open) but stays
  **online-only** — no offline queue or background sync (reaffirmed via ADR-020: a replayed
  offline event would be a backdated event whose cost replay needs the owner's live confirmation,
  which can't be obtained offline).

## Capabilities and Constraints

In scope (v1), per Doc 01 §5 and reflected in the app's route/feature structure (catalog,
inventory, purchases, production, recipes, packing/bundling, sales, orders (custom orders with
deposit → production → delivery → balance), finance (bank + cash box), sessions, price-health,
reports/insights, AI assistant chat, settings, onboarding, backups, audit):

1. Unified catalog & kardex-based inventory with minimum-stock alerts and counts/adjustments.
2. Purchases: weighted-average cost and replacement cost, paid from bank or cash box.
3. Recipe-driven production (raw → semi-finished → finished), actual-yield costing.
4. Packing/bundling: presentations and combos as stockable finished goods with their own
   price/cost/margin.
5. Catalog sales (fixed price) and custom orders (quote → 50% deposit → production → delivery →
   balance collection).
6. Non-commercial exits (waste, self-consumption, gifts, spoilage) valued at cost.
7. Finance: two accounts, categorized income/expense, transfers, owner withdrawals, receivables,
   deposit liability, cash-flow reporting.
8. Insights: dashboard, price-health report (margin at WAC and replacement cost), Bs/hour metrics,
   trends, waste report.
9. AI assistant: Telegram bot (capture + quick queries) and web chat (analytical Q&A).

**Out of scope (non-goals):** multi-user/roles/permissions, native mobile apps, tax/fiscal
accounting or SIN integration, e-commerce storefront or online payments, barcode/IoT scanning,
multi-currency, demand forecasting/automatic production planning, offline-first sync.

**Product principles** (Doc 01 §6) that constrain UI behavior specifically: never block an event
capture for incomplete data or negative stock — record reality, flag inconsistencies, make
correction easy; every derived number is computed, never hand-entered; both historical and
replacement cost are always visible.

## Brand Commitments

The app is the owner's **operating instrument**, not a brand vehicle — the Kokoro brand (used to
reach her customers, e.g. product labels) is deliberately kept out of the app's daily-use surfaces.
Owner-confirmed north star (2026-07-16): "The main thing is found instantly, nothing confuses or
weighs. The brand only peeks through as a warm nod — the storefront is for her customers, this app
is to support **her**." The realized visual language (typography, color, tokens) is already
established and owner-validated — see `.design/foundations/DESIGN_BRIEF.md` and
`DESIGN_TOKENS.md`, implemented in `apps/web/src/styles/globals.css`. Do not treat the visual
system as undecided; extend it, don't replace it, absent an explicit rebrand request.

## Evidence on Hand

- **Doc 01 — Product Vision** (`docs/system-design-knowledge-base/01-product-vision.md`) and the
  rest of the System Design Knowledge Base are the authoritative source for business rules,
  domain model, and data model (Docs 02–04); this file summarizes, and never overrides, the KB.
- The product is already substantially built: extensive `apps/web/src/features/*` (audit, auth,
  backups, catalog, customers, dashboard, finance, inventory, onboarding, orders, pricing,
  production-runs, purchases, recipes, sales, sessions) and matching `src/routes/*`.
- No customer-facing testimonials, case studies, or press exist or are needed — this is an
  internal single-user operating tool, not a marketed product.

## Product Principles

1. Capture first, correct later — never block an event for incomplete data.
2. Events in, insight out — every derived number is computed, never hand-entered.
3. The phone is for capture, the desktop is for analysis.
4. Replacement cost is the truth in inflation; both historical and replacement cost stay visible.
5. Her time is a real, visible cost — reported as Bs/hour, not buried inside product cost.

## Accessibility & Inclusion

No user-specific accessibility need has been raised (single sighted, non-technical Spanish-speaking
user). The existing design system already targets WCAG AA contrast for all text pairs
(`.design/foundations/DESIGN_TOKENS.md`, verified computationally 2026-07-16) — treat that as the
floor for any new UI, not an open question.
