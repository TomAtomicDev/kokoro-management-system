# 03 — Domain Model

Single bounded context: **Business Operations** (one business, one owner). Modules within the
context: Catalog, Inventory, Costing, Purchasing, Production, Sales, Custom Orders, Finance,
Sessions & Labor, Insights. Ubiquitous language is defined in [13 — Glossary](13-project-glossary.md);
code uses the English terms exactly as written there.

## 1. Core modeling stance

The domain is **event-sourced-lite**: user-recorded **business events** (purchase, production
run, sale, exit, count, financial movement) are the primary records. From them the system
derives:

- **Stock movements** (the kardex) → current stock per item.
- **Financial transactions** → account balances, receivables, deposit liability.
- **Costing state** → weighted-average cost (WAC) and cached replacement cost per item.

Users create/edit/delete events; derived records are system-owned and regenerated atomically
when an event changes. This replaces the original proposal's "immutable kardex users write to"
with "kardex immutable **to users**, derived from editable events" — same auditability, far
better correction ergonomics for a solo operator (ADR-009).

## 2. System invariants

| ID | Invariant |
|----|-----------|
| INV-1 | Every command commits all its rows (event + derived + balances + audit) in one atomic batch. |
| INV-2 | All channel handlers are idempotent (Telegram `update_id`, API client `Idempotency-Key`). |
| INV-3 | Every event has `occurred_at` (UTC) and `business_date` (America/La_Paz); reports group by `business_date`. |
| INV-4 | AI may draft events; only explicit human confirmation commits a write. |
| INV-5 | `item_stock.qty_on_hand` = Σ `stock_movements.qty` per item; account `balance` = opening + Σ transactions. Checked nightly. |
| INV-6 | Money is stored as integer centavos (BOB); quantities as decimal-safe integers in milli-units (Doc 04 §2). Derived money is rounded half-up at the final step only. |
| INV-7 | A custom-order deposit is a liability (`customer_deposits`) from receipt until delivery or refund; it never appears as revenue before delivery. |
| INV-8 | Stock MAY go negative (capture-first); negative stock raises a persistent reconciliation flag, never a blocking error. |
| INV-9 | Derived rows always carry `source_event_type` + `source_event_id`; orphan derived rows are forbidden. |
| INV-10 | Deleting an event soft-deletes it and removes/reverses its derived rows in the same batch; history stays in `audit_log`. |
| INV-11 | A create/edit/delete of a movement-affecting event whose `business_date` precedes the latest already-processed movement for an affected item triggers a synchronous, bounded WAC/cost replay before the command commits (R-2, ADR-016); the nightly sentinel (INV-5) is a backstop auditor, never the primary corrector. |

## 3. Aggregates and key entities

| Aggregate root | Contains | Notes |
|----------------|----------|-------|
| **Item** | aliases, costing state, stock summary | `kind`: RAW_MATERIAL / SEMI_FINISHED / FINISHED; `category`: INGREDIENT / PACKAGING / LABEL / BAKERY / DAIRY / OTHER. Packaging rule: high-value packaging = RAW_MATERIAL consumed by recipes; minor consumables are bought as OPERATING_EXPENSE with no item (hybrid, per original spec). |
| **Recipe** | recipe lines (item + qty), expected yield, est. labor minutes | One output item per recipe; an item MAY have several recipes (variants); one is `is_default`. |
| **Purchase** | purchase lines, payment info, optional session link, photo | Creates PURCHASE_IN movements + expense transaction; updates WAC + replacement cost. A line's `lineTotal` may be 0 (free/promotional stock); if the purchase's total across all lines is 0, no `financial_transactions` row is created (no cash moved) — `financial_transactions.amount` is always > 0. |
| **ProductionRun** | consumed lines (actual), output (actual qty), indirect cost, optional session link | Recipe is a template: consumption defaults from recipe × batches, editable before commit. |
| **Sale** | sale lines, channel (CATALOG / CUSTOM_ORDER), payment status, customer ref | Creates SALE_OUT movements (+ income transaction if paid). |
| **CustomOrder** | order items (item or free-text + agreed price), deposit, delivery date/place, linked production runs & sale | State machine in §5. |
| **StockExit** | item, qty, reason (WASTE / SELF_CONSUMPTION / GIFT_SAMPLE / SPOILAGE / OTHER) | Valued at current WAC; no financial transaction (cost already incurred) — reported as "invisible cost". |
| **InventoryCount** | count lines (expected vs counted) | Commits ADJUST movements for variances. |
| **FinancialTransaction** | — | Either derived (from sale/purchase/order/withdrawal) or standalone (operating expense, other income). Transfers are paired rows. |
| **Session** | typed container: PRODUCTION / PURCHASE_TRIP / DELIVERY_RUN / ADMIN; hours, shared costs, linked events | See §6. |
| **DailySnapshot** | — | System-generated; powers trends without heavy recomputation. |

## 4. Costing rules (normative)

- **C-1 Valuation method: weighted average cost (WAC)** per item (ADR-010). On every stock
  **entry** with unit cost `c` and qty `q`: `wac' = (max(on_hand,0)·wac + q·c) / (max(on_hand,0) + q)`.
  Exits consume at current `wac` and never change it.
- **C-2 Purchase cost** per line: `unit_cost = line_total / qty` (freight/session shared costs are
  NOT capitalized into items; they go to OPERATING_EXPENSE — simplicity over precision, ADR-010).
- **C-3 Replacement cost**: for RAW_MATERIAL, `replacement_cost = last purchase unit cost`
  (updated on every purchase). For SEMI_FINISHED/FINISHED,
  `replacement_cost = Σ(default-recipe line qty × ingredient replacement_cost) / expected_yield`,
  recomputed by the nightly job and on demand; cached with timestamp.
- **C-4 Production run cost**:
  `direct = Σ(consumed qty × consumed item's WAC at commit time)`;
  `total = direct + indirect_cost + allocated session shared cost (§6)`;
  `output unit cost = total / actual_output_qty`. Actual output absorbs shrinkage/merma
  automatically. Output entry updates the output item's WAC per C-1.
- **C-5 Margins** (per finished item):
  `margin_wac = price − wac`; `margin_replacement = price − replacement_cost`;
  percentages over price. **Price-health alert** when
  `margin_replacement_pct < settings.min_margin_pct` (default 30%).
- **C-6 Exit valuation**: exits and count adjustments value at current WAC; the value feeds the
  waste report, not the financial ledger.
- **C-7 Labor is not capitalized** into product cost. Hours are tracked per session and reported
  as `Bs/hour = contribution / hours` (§6, ADR-010). Rationale: keeps costs objective and
  comparable, avoids circular wage assumptions; the owner's pay is what the business yields.

## 5. Custom order lifecycle (Modality 2)

```
QUOTING ──confirm(+deposit)──► CONFIRMED ──start──► IN_PRODUCTION ──ready──► READY ──deliver──► DELIVERED
   │                              │                    │                        │        (final state)
   └────────────cancel────────────┴────────cancel──────┴──────cancel────────────┘
                                    → CANCELLED (deposit refund or forfeit, owner decides)
```

Rules:

- **O-1** `CONFIRMED` requires a recorded deposit (default 50%, editable amount). The deposit is
  a financial INCOME with category ORDER_DEPOSIT into bank/cash **and** an increase of the
  `customer_deposits` liability (INV-7).
- **O-2** On `deliver`: the system creates the linked **Sale** (channel CUSTOM_ORDER) for the
  full agreed total; the deposit liability is released against it; the balance is recorded as
  paid (ORDER_BALANCE) or as accounts receivable if the customer owes.
- **O-3** On `cancel` after deposit: owner chooses REFUND (expense DEPOSIT_REFUND, liability
  released) or FORFEIT (liability converts to OTHER_INCOME).
- **O-4** Orders never reserve stock (single operator; reservation adds friction without value).
  Production for an order is a normal ProductionRun linked via `custom_order_id`, enabling
  per-order cost and profit reporting.
- **O-5** Unlimited concurrent orders; the Orders board sorts by `delivery_date`.

## 6. Sessions, shared costs, and time profitability

- **S-1** A session is optional context; every event type MAY link to one session.
- **S-2** Session records `started_at`, `ended_at` (or direct `duration_min`) and shared cost
  lines (e.g., fuel Bs 20, electricity/gas estimate Bs 8). Shared costs create OPERATING_EXPENSE
  transactions (paid from an account) — except ESTIMATED costs (e.g., home energy share) which
  are flagged `is_estimate` and excluded from cash but included in profitability analysis.
- **S-3** Allocation: a PRODUCTION session's shared costs are allocated across its production
  runs **proportionally to each run's direct cost** and included in C-4. Purchase-trip and
  delivery-run shared costs stay as period operating expenses (not capitalized).
- **S-4** Time profitability:
  `session Bs/h = attributable contribution / hours`, where contribution for a production
  session = Σ over produced goods of `(current price − unit cost) × qty produced` (potential
  contribution), for a delivery run = margin of delivered sales, for purchase/admin = 0 (cost
  centers). Monthly `owner Bs/h = operating profit / total logged hours`. Both are reported;
  the monthly figure is the headline (G3).

## 7. Correction & recalculation policy

- **R-1** Editing an event regenerates its derived rows (INV-9/10) in one batch.
- **R-2** WAC and dependent costs **are** replayed synchronously, inside the triggering
  command's own batch, whenever a create/edit/delete lands with a `business_date` earlier than
  the latest already-processed movement for an affected item (INV-11) — this covers plain
  out-of-order inserts too, not only edits of existing events (e.g. recording today's production
  before backdating last week's purchase). The replay resumes `recomputeWacFromMovements`
  (KOK-013) from the touched point forward rather than only from zero, and cascades across items
  linked by production recipes (raw material → semi-finished → finished, dependency order),
  since a `ProductionRun`'s cost (C-4) depends on its consumed items' WAC. The nightly
  consistency job (INV-5) remains a backstop auditor for drift the synchronous path might miss
  (e.g. a direct DB fix bypassing services) — not the primary correction mechanism. This
  supersedes ADR-009's "nightly-only, O(1) edits" framing; see ADR-016.
- **R-3** Deletions are soft (`deleted_at`), reversible for 90 days via audit data.
- **R-4** A replay (R-2) never rewrites an already-frozen cost snapshot
  (`sale_lines.unit_cost_snapshot`, `stock_exits.unit_cost_snapshot`) — historical per-day
  margins stay exactly as they were reported at the time. Instead it books a
  `costing_adjustment` row (Doc 04 §3.4) capturing the aggregate `cost_delta` in Bs, dated to the
  *correction's* `business_date` (today), so cumulative profitability absorbs the correction
  without silently altering history (ADR-016).
- **R-5** Before committing a create/edit/delete whose replay (R-2) would touch sales or
  production runs already recorded after the touched point, the service computes — and the UI
  surfaces — an impact preview (count of affected records + estimated `cost_delta`) and requires
  explicit user confirmation. Applies equally to a plain backdated insert and to an edit/delete
  of a past event (ADR-016).

## 8. Domain events (naming: past tense, for logs/hooks/UI toasts)

`PurchaseRecorded`, `ProductionCompleted`, `SaleRecorded`, `SalePaid`, `StockExited`,
`InventoryCounted`, `StockAdjusted`, `OrderQuoted`, `OrderConfirmed`, `OrderDelivered`,
`OrderCancelled`, `DepositReceived`, `DepositReleased`, `TransferMade`, `WithdrawalMade`,
`ExpenseRecorded`, `SessionClosed`, `LowStockDetected`, `MarginBelowThreshold`,
`NegativeStockFlagged`. v1 handles them in-process (no queue): side effects are alerts and cache
refresh only.

## 9. Use case catalog

| ID | Use case | Channel(s) | Core service |
|----|----------|-----------|--------------|
| UC-01 | Record purchase (multi-line, account, photo, optional session) | TG, Web | purchasing.recordPurchase |
| UC-02 | Record production run (recipe → adjust actuals → commit) | TG, Web | production.recordRun |
| UC-03 | Record catalog sale (items, qty, payment method/status) | TG, Web | sales.recordSale |
| UC-04 | Collect receivable (mark sale paid) | TG, Web | sales.collectPayment |
| UC-05 | Quote custom order | TG, Web | orders.quote |
| UC-06 | Confirm order with deposit | TG, Web | orders.confirm |
| UC-07 | Deliver order (auto-sale, balance settle) | TG, Web | orders.deliver |
| UC-08 | Cancel order (refund/forfeit) | Web | orders.cancel |
| UC-09 | Record non-commercial exit | TG, Web | inventory.recordExit |
| UC-10 | Inventory count & adjust | Web (TG single-item) | inventory.count |
| UC-11 | Record expense / other income | TG, Web | finance.recordTransaction |
| UC-12 | Transfer bank ↔ cash box | TG, Web | finance.transfer |
| UC-13 | Owner withdrawal | TG, Web | finance.withdraw |
| UC-14 | Open/close session (hours, shared costs, link events) | TG, Web | sessions.* |
| UC-15 | Manage catalog & recipes & prices | Web | catalog.* |
| UC-16 | Quick queries (stock? cash? today's sales? pending orders?) | TG, Web chat | assistant read tools |
| UC-17 | Analytical chat (trends, margins, hours) | Web chat | assistant read tools |
| UC-18 | Edit/delete any event | Web | per-module update/delete |
| UC-19 | Review alerts (low stock, price health, negative stock) | TG push, Web | insights.alerts |
| UC-20 | Configure settings (thresholds, prices, aliases, backup) | Web | settings.* |

Each use case's acceptance criteria live in [11 — Testing Strategy](11-testing-strategy.md)
(integration suites §3, phase gates §6).
