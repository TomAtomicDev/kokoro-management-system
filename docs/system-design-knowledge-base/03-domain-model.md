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
| INV-6 | One scale per concept (Doc 04 §2, ADR-017): money amounts are integer centavos (BOB); **every per-unit rate** — sale price, unit price, WAC, replacement cost, cost snapshots — is integer milli-centavos per WHOLE unit (`_mc` columns); quantities are integer milli-units of the item's own unit; percentages are basis points. No monetary value or per-unit rate uses `REAL`. Derived money is rounded half-up at the final step only, and the only scale conversions live in `packages/shared/money.ts`. |
| INV-7 | A custom-order deposit is a liability (`customer_deposits`) from receipt until delivery or refund; it never appears as revenue before delivery. |
| INV-8 | Stock MAY go negative (capture-first); negative stock raises a persistent reconciliation flag, never a blocking error. |
| INV-9 | Derived rows always carry `source_event_type` + `source_event_id`; orphan derived rows are forbidden. |
| INV-10 | Deleting an event soft-deletes it and removes/reverses its derived rows in the same batch; history stays in `audit_log`. |
| INV-11 | A create/edit/delete of a movement-affecting event whose `(occurred_at, created_at)` point precedes the latest already-processed movement for an affected item triggers a synchronous, bounded WAC/cost replay before the command commits (R-2, ADR-016); the nightly sentinel (INV-5) is a backstop auditor, never the primary corrector. |

## 3. Aggregates and key entities

| Aggregate root | Contains | Notes |
|----------------|----------|-------|
| **Item** | aliases, costing state, stock summary | `kind`: RAW_MATERIAL / SEMI_FINISHED / FINISHED / PACKAGING; `category`: INGREDIENT / NOT_EATABLE / BAKERY / DAIRY / PASTRY / OTHER (filtering only, no business rule keys off it). **PACKAGING (KOK-1xx KB amendment, closes BI-11)**: promoted from a `category` value to its own `kind`, superseding the old "high-value packaging = RAW_MATERIAL consumed by recipes" rule. The old
`LABEL` category (etiquetas) is absorbed into `PACKAGING` too — a label is applied at sale time
exactly like a bag or box, never a recipe input — so both former categories map to the new kind;
`category` for these items becomes `NOT_EATABLE` (labels/tape/cleaning supplies), the same
non-food-raw-material bucket `LABEL` used to occupy. A PACKAGING item is purchased and stocked exactly like RAW_MATERIAL (WAC, replacement cost, `minStockQty`) but is **never a recipe input** — `recipes.ts`'s item-kind whitelist stays RAW_MATERIAL/SEMI_FINISHED-only, so a PACKAGING item cannot be added to a recipe even by mistake. Instead it is consumed as a second kind of `sale_lines` row, alongside the FINISHED product line, at the moment of an actual sale (§SC-03). This decouples "was this unit produced" from "was this unit packaged for a customer": a `ProductionRun` of a FINISHED item never touches packaging stock, and neither does a `StockExit` (WASTE/SELF_CONSUMPTION/GIFT_SAMPLE/SPOILAGE) — self-consuming or discarding a baked good does not consume a bag, so packaging stock is only ever debited when a real sale happens. Minor consumables still may be bought as OPERATING_EXPENSE with no item at all (hybrid, per original spec) when tracking them individually isn't worth it. **`salePriceMc`/`minStockQty` are kind-exclusive** (KOK-096, extended by KOK-1xx for PACKAGING): `salePriceMc` is required for FINISHED and forbidden (`null`) for RAW_MATERIAL/SEMI_FINISHED/PACKAGING (a PACKAGING item has no list price — its `sale_lines.unit_price_mc` is ordinarily `0`, the owner is not charging separately for the bag, but that field stays editable per line for the rare case, e.g. a priced gift box); `minStockQty` is required for RAW_MATERIAL/PACKAGING and forbidden (`null`) for SEMI_FINISHED/FINISHED. "Required" means non-null, not non-zero — `minStockQty: 0` is valid and means "track this item, never alert on it." Enforced by `superRefine` on the create/update item command schemas (D-4: one contract for the catalog form, the onboarding wizard, and any assistant draft tool), never by tightening `minStockQtySchema`'s `.nonnegative()` to `.positive()`. Accepted trade-off: this rules out a low-stock alert on a finished good — a coherent thing to want, but it would require amending this rule rather than just filling in a field. **`isUnmetered` is RAW_MATERIAL-only** (C-9, KOK-1xx KB amendment, closes BI-15) — forbidden/false for every other kind. |
| **Recipe** | recipe lines (item + qty), expected yield, est. labor minutes | One output item per recipe; an item MAY have several recipes (variants); one is `is_default`. Deletion is a soft **deactivate** (`is_active = 0`), mirroring `items.is_active` — never a hard DELETE (a recipe already referenced by a production run is protected by `ON DELETE RESTRICT` on `production_runs.recipe_id` regardless). |
| **Purchase** | purchase lines, payment info, optional session link, photo | Creates PURCHASE_IN movements + expense transaction; updates WAC + replacement cost. A line's `lineTotal` may be 0 (free/promotional stock); if the purchase's total across all lines is 0, no `financial_transactions` row is created (no cash moved) — `financial_transactions.amount` is always > 0. |
| **ProductionRun** | consumed lines (actual), output (actual qty), indirect cost, optional session link | Recipe is a template: consumption defaults from recipe × batches, editable before commit. |
| **Sale** | sale lines, channel (CATALOG / CUSTOM_ORDER), payment status, customer ref | Creates SALE_OUT movements (+ income transaction if paid). |
| **CustomOrder** | order items (item or free-text + agreed price), deposit, delivery date/place, linked production runs & sale | State machine in §5. |
| **StockExit** | item, qty, reason (WASTE / SELF_CONSUMPTION / GIFT_SAMPLE / SPOILAGE / OTHER) | Valued at current WAC; no financial transaction (cost already incurred) — reported as "invisible cost". |
| **InventoryCount** | count lines (expected vs counted) | Commits ADJUST movements for variances. A line for an item with zero prior `stock_movements` and a positive counted qty commits OPENING_IN instead (C-8) — an opening balance, not a correction. |
| **FinancialTransaction** | — | Either derived (from sale/purchase/order/withdrawal) or standalone (operating expense, other income). Transfers are paired rows. |
| **Session** | typed container: PRODUCTION / PURCHASE_TRIP / DELIVERY_RUN / ADMIN; hours, shared costs, linked events | See §6. |
| **DailySnapshot** | — | System-generated; powers trends without heavy recomputation. |

## 4. Costing rules (normative)

- **C-1 Valuation method: weighted average cost (WAC)** per item (ADR-010). On every stock
  **entry** with unit cost `c` and qty `q`: `wac' = (max(on_hand,0)·wac + q·c) / (max(on_hand,0) + q)`.
  Exits consume at current `wac` and never change it.
- **C-2 Purchase cost** per line: `unit_cost = line_total / qty` (freight/session shared costs are
  NOT capitalized into items; they go to OPERATING_EXPENSE — simplicity over precision, ADR-010).
- **C-3 Replacement cost**: for RAW_MATERIAL and PACKAGING (KOK-1xx: both are *purchased*, not
  manufactured, items — PACKAGING follows the same rule as RAW_MATERIAL here), `replacement_cost =
  last purchase unit cost`, where
  **"last" means last by `business_date`, not last recorded** (ties on the same `business_date`
  break by capture order, so the most recently recorded of that day wins). A purchase therefore
  updates `replacement_cost` only when no purchase of that item carries a LATER `business_date`;
  a backdated purchase leaves it untouched. Rationale (KOK-024): replacement cost answers "what
  would it cost me to buy this again today", so backdating last week's invoice must not roll
  today's price back to last week's — a real hazard in a high-inflation context, and the reason
  C-5's `margin_replacement` and its price-health alert would otherwise drift optimistic. Soft
  -deleted purchases (R-3) do not count. For SEMI_FINISHED/FINISHED,
  `replacement_cost = Σ(default-recipe line qty × ingredient replacement_cost) / expected_yield`,
  recomputed by the nightly job and on demand; cached with timestamp. The cached column is an
  INTEGER `replacement_cost_mc` (milli-centavos per whole unit) like every other stored rate, and
  because an ingredient's `replacement_cost_mc` may itself be a SEMI_FINISHED item's cached value
  (a multi-level BOM), the formula rounds half-up **once per level**. That quantization is bounded
  and deliberate — ≤ 0.5 mc (Bs 0.000005/unit) per level, dominated by the leaf raw material's own
  quantization, which is unavoidable; see ADR-017's KOK-071 vertical-2 amendment for the
  measurements and for why no float exception is carved out for this column.
- **C-3b Recipe theoretical cost (KOK-025 KB amendment)**: the Recipes screen (SC-06) previews a
  recipe's cost per output unit at both valuations, generalizing C-3's replacement-cost formula
  (which is defined there only for the *default* recipe feeding the cached column) to ANY recipe
  — default or variant — so the owner can compare candidates before promoting one to default:
  `theoretical_cost_wac = Σ(recipe line qty × ingredient wac) / expected_yield`;
  `theoretical_cost_replacement = Σ(recipe line qty × ingredient replacement_cost) / expected_yield`.
  Both are computed live and returned by the recipe read APIs; neither is cached nor written to
  `items.wac` / `items.replacement_cost` — only the *default* recipe's replacement-cost figure
  feeds that cache, and only via the nightly/on-demand job (KOK-029), never from KOK-025 itself.
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
  waste report, not the financial ledger. Exception: an opening-balance count line (C-8) *sets*
  WAC rather than reading it.
- **C-7 Labor is not capitalized** into product cost. Hours are tracked per session and reported
  as `Bs/hour = contribution / hours` (§6, ADR-010). Rationale: keeps costs objective and
  comparable, avoids circular wage assumptions; the owner's pay is what the business yields.
- **C-8 Opening inventory valuation** (KOK-084 KB amendment, closes the BI-01/BI-02 gap in
  `docs/development/bugs-and-improvements.md`): a count line for an item with **zero prior
  `stock_movements`** and a **positive counted quantity** is an opening balance, not a correction.
  It commits an `OPENING_IN` movement — not `ADJUST` — with a caller-supplied `unit_cost_mc` that
  MUST be `> 0`, enforced at the command schema layer (D-4); the movement-builder's own validator
  only rejects negative cost, not zero, so this cannot be left to that guard alone. `OPENING_IN` is
  a WAC **entry** type, exactly like `PURCHASE_IN`/`PRODUCTION_IN`: it participates in C-1's fold
  and in R-2's replay the same way, so a later backdated purchase against the same item re-costs
  correctly instead of silently skipping the opening balance the way a same-cost `ADJUST` would.
  It does **not** feed C-3's replacement-cost signal — `"last purchase unit cost"` means a real
  supplier transaction, not an administrative opening entry — and it creates no
  `financial_transactions` row, the same non-event as a zero-total purchase (§3): no cash moved. A
  count line for an item that already has prior movement history is unaffected and stays a plain
  `ADJUST` per C-6, valued at current WAC as always; only an item's *first-ever* positive count
  line can be an opening balance.
- **C-9 Unmetered items** (KOK-1xx KB amendment, closes BI-15): a RAW_MATERIAL item MAY be flagged
  `isUnmetered` (e.g. `Agua`) when recipes consume it but it is never purchased as discrete stock
  — it is a metered utility (water, gas), not inventory. The flag changes five things:
  - **No PURCHASE_IN.** `recordPurchase` rejects a line against an unmetered item with a
    `VALIDATION` error, mirroring the existing `kind !== 'FINISHED'` gate on sales
    (`sales/index.ts`).
  - **No StockExit.** WASTE/SELF_CONSUMPTION/GIFT_SAMPLE/SPOILAGE against an unmetered item is
    rejected the same way — there is no discrete unit to waste, gift, or self-consume.
  - **No kardex participation.** Production consumption of an unmetered line still contributes
    `qty × replacement_cost_mc` to C-4's `direct` total (the output item's cost is real), but does
    **not** emit a `PRODUCTION_OUT` stock_movement. An unmetered item therefore carries no
    `qty_on_hand` worth reading, no `negative_since`, and is excluded (not merely
    always-passing) from INV-5's nightly consistency check and from `listStock`'s
    negative-stock/low-stock surfacing — a permanent, correctly-zero row would otherwise read as
    "in stock, untouched," which is misleading for something that is never stocked at all.
  - **Cost basis is `replacement_cost_mc`, owner-entered, not WAC.** C-1's WAC fold only runs on
    entries (PURCHASE_IN/PRODUCTION_IN/OPENING_IN); an unmetered item never receives one, so
    `wac_mc` stays `0` forever and cannot be its cost basis. C-3's "last purchase unit cost" does
    not apply either (there is no purchase). Instead `replacement_cost_mc` is set directly by the
    owner on the catalog form (an estimate — e.g. Bs/liter of tap water backed out from the
    monthly utility bill) and is what gets snapshotted onto its production consumption lines (C-4)
    and used by any recipe's theoretical-cost preview (C-3b) that includes it. The create/update
    item commands accept `replacementCostMc` for this one case only (rejected for every other
    kind/`isUnmetered` combination, same `superRefine` as `salePriceMc`/`minStockQty`); a manual
    edit stamps `replacement_cost_updated_at` exactly like a purchase would, so the catalog's
    "calculado" badge reflects when the owner's estimate was last touched, not a purchase that
    never happened.
  - **Not physically counted.** `InventoryCount` item lists (`listItems`/`startCount`) exclude
    unmetered items — there is nothing to count.
  `minStockQty` stays required per the general RAW_MATERIAL rule but is inert for an unmetered
  item (no kardex participation ⇒ no low-stock check ever fires); the natural value is `0`
  (precedent: `Agua`, BI-12). `isUnmetered` is forbidden (`false`) for SEMI_FINISHED, FINISHED,
  and PACKAGING.

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
  - The sale's lines are derived from the order's lines, so **every order line must be linked to
    a catalog FINISHED item before an order can be delivered** (Doc 04 §5) — free-text lines are a
    quoting convenience and must be resolved first (`resolveOrderLine`, KOK-034 — the one narrow
    exception to "no generic update order", see Doc 04 §5); delivery refuses (409) otherwise. `agreed_total`
    is split across those lines by largest remainder so `Σ(qty × unit_price_mc / 1e6)` reproduces it exactly.
  - Only the **balance** is new money: the deposit was already banked at confirm time, so
    `ORDER_BALANCE` is booked for `agreed_total − deposit_paid` (nothing when that is zero), and an
    ON_CREDIT balance shows in `v_receivables` net of the deposit — never the full agreed total.
  - The deposit liability is released by the status reaching `DELIVERED`; `v_liability` subtracts
    delivered orders' `deposit_paid`. Revenue is recognized here, at delivery, and never earlier
    (INV-7).
- **O-3** On `cancel` after deposit: owner chooses REFUND (expense DEPOSIT_REFUND, liability
  released) or FORFEIT (liability converts to OTHER_INCOME).
  - FORFEIT writes **no new transaction and moves no cash**: the money is already in the account
    (ADR-012), so the original INCOME/`ORDER_DEPOSIT` row is **recategorized in place** to
    `OTHER_INCOME`, keeping its account, amount and original `business_date`. That single category
    change both recognizes the income and drops the row out of `v_liability`'s
    `category IN ('ORDER_DEPOSIT','DEPOSIT_REFUND')` filter, clearing the liability. Booking a
    second income row instead would double-count the same cash. Consequence, accepted by design:
    the forfeited amount appears in the cash-flow category mix of the month the DEPOSIT was
    received, not the month of the cancellation.
  - Cancelling an order that never took a deposit needs no resolution and has no financial effect.
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
  command's own batch, whenever a create/edit/delete lands with an `(occurred_at, created_at)`
  point earlier than the latest already-processed movement for an affected item (INV-11) — this
  covers plain out-of-order inserts too, not only edits of existing events (e.g. recording
  today's production before backdating last week's purchase). `business_date` is not the ordering
  key: two movements can share a `business_date` but disagree on `occurred_at`, and the kardex
  orders by the latter (`created_at` as a stable tiebreak). The replay resumes
  `recomputeWacFromMovements` (KOK-013) from the touched point forward rather than only from
  zero, and cascades across items linked by ACTIVE production recipes (raw material →
  semi-finished → finished, dependency order; a deactivated recipe edge is not followed), since a
  `ProductionRun`'s cost (C-4) depends on its consumed items' WAC. The nightly consistency job
  (INV-5) remains a backstop auditor for drift the synchronous path might miss (e.g. a direct DB
  fix bypassing services) — not the primary correction mechanism. This supersedes ADR-009's
  "nightly-only, O(1) edits" framing; see ADR-016.
- **R-3** Deletions are soft (`deleted_at`), reversible for 90 days via audit data.
- **R-4** A replay (R-2) never rewrites an already-frozen cost snapshot
  (`sale_lines.unit_cost_snapshot`, `stock_exits.unit_cost_snapshot`) — historical per-day
  margins stay exactly as they were reported at the time. Instead it books, for EACH item the
  replay touched whose `cost_delta` is nonzero, one `costing_adjustment` row (Doc 04 §3.4)
  capturing that item's `cost_delta` in Bs, dated to the *correction's* `business_date` (today) —
  an item the replay recomputed but whose WAC didn't actually move gets no row, so cumulative
  profitability absorbs the correction without silently altering history (ADR-016).
- **R-5** Before committing a create/edit/delete whose replay (R-2) would touch sales, stock
  exits, or production runs already recorded after the touched point, the service computes — and
  the UI surfaces — an impact preview (count of affected records + estimated `cost_delta`) and
  requires explicit user confirmation. Applies equally to a plain backdated insert and to an
  edit/delete/restore of a past event (ADR-016).

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
