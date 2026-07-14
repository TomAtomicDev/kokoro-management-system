# 01 — Product Vision

## 1. Vision statement

**Kokoro Management turns the everyday events of a one-person artisanal food business into
reliable, always-current business intelligence — with near-zero administrative effort.**

The owner captures what happens (a purchase, a bake, a sale, a delivery) in seconds from her
phone, in natural language. The system does the accounting: stock, real cost per unit, margin at
replacement cost, cash position, order deposits, and the profitability of every hour she invests.
On desktop, she analyzes trends, edits records, and asks an AI assistant questions about her own
business.

## 2. The problem

| Pain | Today (Excel) | Consequence |
|------|---------------|-------------|
| Capture friction | Data entry only possible at the home PC, hours after the fact | Missing/incorrect records, low trust in the data |
| Silent decapitalization | Prices held stable while ingredient costs inflate; margins recomputed rarely and by hand | Products can be sold **below replacement cost** without the owner noticing |
| No time visibility | Hours spent shopping, producing, delivering are not recorded | Cannot tell whether the business pays for her time |
| Deposit confusion | 50% advances mixed with revenue | Cash looks healthier than it is; advances get spent before producing the order |
| Stock blindness | Stock counted mentally or ad hoc | Stock-outs of key inputs (milk), waste is invisible |
| Two cash locations | Bank account + physical cash box tracked informally | Reconciliation errors, unclear cash position |

## 3. Product goals (measurable)

| # | Goal | Target metric |
|---|------|---------------|
| G1 | Effortless event capture | Median time to record an event from phone ≤ 30 s; ≥ 90% of events captured same day |
| G2 | Anti-decapitalization | Every finished product shows margin at **replacement cost**, refreshed automatically after each purchase; alert when margin < configurable threshold |
| G3 | Time profitability | Owner sees Bs/hour by session type and by product, monthly |
| G4 | Trustworthy stock | Kardex-derived stock; monthly count variance < 5% for tracked raw materials |
| G5 | Clean cash | Bank + cash box balances always current; deposits shown as liability until delivery |
| G6 | Low cost & maintenance | Infrastructure cost ≤ ~US$6/month excluding AI tokens; AI tokens ≤ ~US$10/month at expected volume; zero-ops deployment |
| G7 | AI reliability | ≥ 95% of AI-drafted events accepted without field corrections (measured from interaction logs) |

## 4. Users

One primary user: **the owner** (referred to as "the owner" throughout the KB). She is
non-technical, Spanish-speaking, comfortable with WhatsApp/Telegram and spreadsheets. There are
no employees, no accountants, and no second role in scope. The system is single-tenant and
single-user; a future collaborator (e.g., a family helper recording deliveries) is a stretch
consideration, not a requirement (see Non-goals).

## 5. Scope

### In scope (v1)

1. **Catalog & inventory** — unified item catalog (raw material, semi-finished, finished),
   kardex-based stock, minimum-stock alerts, inventory counts and adjustments.
2. **Purchases** — purchase events with lines, updates stock, weighted-average cost, and
   replacement cost; paid from bank or cash box.
3. **Production** — recipe-driven batch transformations (raw → semi-finished → finished),
   actual-yield costing, indirect/shared cost allocation, multi-run production sessions.
4. **Sales** — catalog sales (Modality 1) with fixed prices, cash/QR, paid or on-credit.
5. **Custom orders** (Modality 2) — quote → 50% deposit (liability) → production → delivery →
   balance collection; multiple concurrent orders.
6. **Non-commercial exits** — waste, self-consumption, gifts/samples, spoilage, valued at cost.
7. **Finance** — two accounts (bank, cash box), all income/expense categorized, transfers,
   owner withdrawals, accounts receivable, deposit liability, cash-flow reporting.
8. **Sessions & time** — purchase trips, production sessions, delivery runs as containers for
   events, shared costs (fuel, energy), and person-hours.
9. **Insights** — dashboard, price-health report (margin at WAC and at replacement cost),
   Bs/hour metrics, sales/production/cash trends, waste report.
10. **AI assistant** — (a) Telegram bot: natural-language event capture with confirmation, quick
    queries; (b) web chat: analytical Q&A over curated tools.
11. **Web app (desktop-first)** — tables, charts, full CRUD/editing of events, settings.

### Out of scope (v1) — non-goals

- Multi-user, roles, permissions beyond the single owner.
- Native mobile apps (Telegram + responsive web cover mobile).
- Tax/fiscal accounting, invoicing (facturación), or SIN integration (Bolivia).
- E-commerce storefront, customer self-service, online payments processing.
- Barcode scanning, scale/IoT integrations.
- Multi-currency (BOB only; inflation handled via replacement cost, not FX).
- Demand forecasting / automatic production planning (production remains owner's judgment; the
  system informs, it does not plan).
- Offline-first sync (Telegram queueing is the resilience mechanism for connectivity gaps).

## 6. Product principles

1. **Capture first, correct later.** Never block an event because data is incomplete or stock
   would go negative. Record reality, flag inconsistencies, make correction easy (see INV rules
   in [03 — Domain Model](03-domain-model.md)).
2. **Events in, insight out.** The owner records events; every derived number (stock, cost,
   margin, balances) is computed by the system and is never hand-entered.
3. **The phone is for capture, the desktop is for analysis.** Telegram interactions are ≤ 3
   steps. Deep tables, charts, and editing live on the web app.
4. **Replacement cost is the truth in inflation.** Historical cost states what was spent;
   replacement cost states what it takes to stay in business. Both are always visible; alerts
   use replacement cost.
5. **Deposits are debt, not income.** Customer advances are liabilities until delivery — in the
   data model, the UI, and every report.
6. **Her time is a cost of honesty.** Person-hours are tracked and reported as Bs/hour earned,
   but not buried inside product costs (see ADR-010).
7. **Boring, evolvable technology.** One deployable unit, one database, typed end-to-end,
   designed so an AI coding agent can extend it safely for years.
8. **AI is observable.** Every assistant interaction is logged with its tool calls and outcome;
   accuracy is measured, not assumed.

## 7. Success narrative (12 months after launch)

The owner records ~10–20 events/day from Telegram in under half a minute each. Every Monday she
opens the dashboard: it shows which products lost margin to inflation last month and by how much,
suggesting which prices to review on her own schedule. She knows her effective hourly earnings by
activity and has dropped one product that paid Bs 4/hour. Deposits no longer distort her sense of
cash. Her monthly inventory count matches the system within a few percent. She has not opened
Excel in months.
