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
| INV-6 | One scale per concept (Doc 04 §2, ADR-017): money amounts are integer centavos (BOB); **every per-unit rate** — sale price, unit price, WAC, replacement cost, cost snapshots — is integer milli-centavos per WHOLE unit (`_mc` columns); quantities are integer milli-units of the item's canonical persisted unit (`KG`, `L`, `M`, or `UNIT`); percentages are basis points. No monetary value or per-unit rate uses `REAL`. Derived money is rounded half-up at the final step only, and guarded scale conversions live in `packages/shared/money.ts` and `packages/shared/qty.ts`. |
| INV-7 | Order-linked receipts are cash events independent of order status. `ORDER_DEPOSIT` and `ORDER_BALANCE` keep their categories across delivery, undo and cancellation; the order liability/receivable presentation is derived separately (O-8, ADR-022). Never create or reverse cash by transitioning an order. |
| INV-8 | Stock MAY go negative (capture-first); negative stock raises a persistent reconciliation flag, never a blocking error. |
| INV-9 | Derived rows always carry `source_event_type` + `source_event_id`; orphan derived rows are forbidden. |
| INV-10 | Deleting an event soft-deletes it and removes/reverses its derived rows in the same batch; history stays in `audit_log`. |
| INV-11 | A create/edit/delete of a movement-affecting event whose `(occurred_at, created_at)` point precedes the latest already-processed movement for an affected item triggers a synchronous, bounded WAC/cost replay before the command commits (R-2, ADR-016); the nightly sentinel (INV-5) is a backstop auditor, never the primary corrector. |
| INV-12 | Every session, production run, sale, assembly, purchase, custom order, inventory count, and stock exit carries a unique, stable, human-readable `code` (KOK-185, Doc 04 §3.6), assigned atomically at creation and never mutated thereafter; a manual (non-system-owned) `financial_transactions` row carries one too, with both legs of a transfer sharing one code, while a system-owned row carries none (it is identified by its source event's code instead). Never generated client-side (web or Telegram) — always server-assigned. |

## 3. Aggregates and key entities

| Aggregate root | Contains | Notes |
|----------------|----------|-------|
| **Item** | aliases, costing state, stock summary | `kind`: RAW_MATERIAL / SEMI_FINISHED / FINISHED / PACKAGING; `category`: INGREDIENT / NOT_EATABLE / BAKERY / DAIRY / PASTRY / OTHER (filtering only, no business rule keys off it). **PACKAGING (KOK-1xx KB amendment, closes BI-11)**: promoted from a `category` value to its own `kind`, superseding the old "high-value packaging = RAW_MATERIAL consumed by recipes" rule. The old
`LABEL` category (etiquetas) is absorbed into `PACKAGING` too — a label is applied when the
product is packed, exactly like a bag or box, never a recipe input — so both former categories map to the new kind;
`category` for these items becomes `NOT_EATABLE` (labels/tape/cleaning supplies), the same
non-food-raw-material bucket `LABEL` used to occupy. A PACKAGING item is purchased and stocked exactly like RAW_MATERIAL (WAC, replacement cost, `minStockQty`) but is **never a recipe input** — `recipes.ts`'s item-kind whitelist stays RAW_MATERIAL/SEMI_FINISHED-only, so a PACKAGING item cannot be added to a recipe even by mistake. **Amended by the Presentation/Combo model (Phase 3.2, KOK-121 — decided 2026-08-11, implementation pending; supersedes the "packaging is a second `sale_lines` row" rule shipped by KOK-100):** a PACKAGING item is consumed by an **Assembly** event (§3 *Assembly*, C-10) — the moment it is physically applied to a product — and **never by a sale**. The governing rule is now: *a packaging item leaves inventory when it is physically used, whether or not a sale exists.* A `ProductionRun` still never touches packaging stock (producing a loaf does not bag it); a sale never does either (the bag left stock when the loaf was packed, days earlier); a `StockExit` MAY, but only through its optional packaging lines and only for a product that was **not** already assembled (§3 *StockExit*). This is what decouples "was this unit produced" from "was this unit packaged", and it is what makes stock of "Kéfir 500 ml" a real, countable thing rather than a bulk litre figure plus a pile of bottles. Minor consumables still may be bought as OPERATING_EXPENSE with no item at all (hybrid, per original spec) when tracking them individually isn't worth it. **`salePriceMc`/`minStockQty` are kind-exclusive** (KOK-096, extended by KOK-1xx for PACKAGING): `salePriceMc` is required for FINISHED and forbidden (`null`) for RAW_MATERIAL/SEMI_FINISHED/PACKAGING. A PACKAGING item has **no list price and no sale line at all** under the Presentation/Combo model: its cost reaches the customer inside the WAC of the presentation or combo it was assembled into, which is where the price lives. (If an empty package is ever genuinely sold on its own — a loose gift box, a paid upgrade — it is catalogued as a FINISHED sellable item in its own right; that does not reopen packaging-as-product for the operational bags and labels. Phase 3.2, KOK-121/KOK-126.) `minStockQty` is required for RAW_MATERIAL/PACKAGING, optional for SEMI_FINISHED, and forbidden (`null`) for FINISHED. "Required" means non-null, not non-zero — `minStockQty: 0` is valid and means "track this item, never alert on it." For SEMI_FINISHED, `null` means no low-stock alert and a non-null value enables one for an internal intermediate that benefits from a threshold. Enforced by `superRefine` on the create/update item command schemas (D-4: one contract for the catalog form, the onboarding wizard, and any assistant draft tool), never by tightening `minStockQtySchema`'s `.nonnegative()` to `.positive()`. Accepted trade-off: this still rules out a low-stock alert on a finished good — a coherent thing to want, but it would require amending this rule rather than just filling in a field. **`isUnmetered` is RAW_MATERIAL-only** (C-9, KOK-1xx KB amendment, closes BI-15) — forbidden/false for every other kind. |
| **Recipe** | recipe lines (item + qty), expected yield, est. labor minutes | One output item per recipe; an item MAY have several recipes (variants); one is `is_default`. Deletion is a soft **deactivate** (`is_active = 0`), mirroring `items.is_active` — never a hard DELETE (a recipe already referenced by a production run is protected by `ON DELETE RESTRICT` on `production_runs.recipe_id` regardless). **`name` must be unique among ACTIVE recipes (KOK-025 KB amendment, closes a duplicate-recipe bug)**: enforced by a partial unique index (`ux_recipes_name`, mirroring `ux_recipes_default`'s `WHERE is_active = 1` scoping) plus an app-level pre-check in `recordRecipe`/`updateRecipe`/`setRecipeActive` (reactivation) so the error surfaces as a 409 `message_es`, not a raw SQLite constraint violation. Scoped to active rows only — a deactivated recipe's name is free to reuse — so recipe history stays intact without permanently reserving a name. **Recipes are NOT widened to accept PACKAGING or FINISHED inputs (Phase 3.2, KOK-121).** A recipe answers "how is this food made"; how a product is presented or bundled is an **AssemblyDefinition** (below). Reusing recipes for both would reintroduce the duplicate-recipe-per-size problem the Presentation/Combo model exists to remove, and would entangle two different costing graphs. |
| **Purchase** | purchase lines, payment info, **required** session link, optional order association, photo | Creates PURCHASE_IN movements + expense transaction; updates WAC + replacement cost. A line's `lineTotal` may be 0 (free/promotional stock); if the purchase's total across all lines is 0, no `financial_transactions` row is created (no cash moved) — `financial_transactions.amount` is always > 0. Session link becomes required in Phase 3.2 (S-1, KOK-130) — resolved automatically, never blocking. KOK-204 adds the optional direct order association to the purchase and its derived expense without changing purchase ownership/editability. |
| **ProductionRun** | consumed lines (actual), output (actual qty), indirect cost, **required** session link | Recipe is a template: consumption defaults from recipe × batches, editable before commit. Phase 3.2: `recipe_id` becomes **optional** (KOK-144) — real cost already comes from actual consumption, so a one-off run may pick its output item directly with no recipe; and the session link becomes required (S-1, KOK-130). `indirect_cost` never moves cash — it is an estimate that only raises the batch's cost (KOK-118 renames it and says so on screen). |
| **AssemblyDefinition** | component lines (item + qty), output item, notes | Phase 3.2 (KOK-121/KOK-123). The reusable template for a **presentation** (a quantity of product + its packaging: "Kéfir natural 500 ml") or a **combo** (several finished presentations + outer packaging: "Desayuno Kokoro"). Components MAY be SEMI_FINISHED, FINISHED or PACKAGING — the one place FINISHED is a legal input. Output item is FINISHED with unit `UNIT` and its own price, stock, WAC and margin. **At most one ACTIVE definition per output item is `is_default`; setting an active definition as default atomically demotes the previous default at write time.** The default is a UX affordance for preselection and suggestions, not the test for whether an item is assembled: that is decided by the existence of **any ACTIVE definition** for the output item. **A definition may not contain itself directly or transitively** (cycle prohibition, enforced by a graph walk at save time). Deactivated, never hard-deleted, exactly like Recipe. |
| **Assembly** | consumed lines (actual, with frozen costs), output (actual qty obtained), **required** session link | Phase 3.2 (KOK-124). The *Envasado/Armado* event: executes an AssemblyDefinition, moving value from components into the finished presentation/combo. Definition is a template exactly as a recipe is — consumption defaults from it × planned qty and stays editable before commit. Emits ASSEMBLY_OUT for every component and ASSEMBLY_IN for the output, updates the output's WAC (C-10), and **creates no financial transaction of any kind**: it is an inventory transformation, not a purchase, sale or expense. |
| **Sale** | sale lines, `additional_charge` snapshot for custom orders, channel (CATALOG / CUSTOM_ORDER), payment status for catalog sales, customer ref | Creates SALE_OUT movements; paid CATALOG sales also post cash. A generated CUSTOM_ORDER sale never posts cash (O-8 target). **Lines are FINISHED-only** — presentations and combos included, packaging never. Frozen line cost includes their packaging; the order charge is separate from product gross margin. |
| **CustomOrder** | merchandise subtotal and order items, additional customer charge, delivery date/place, linked work, sale and independent cash events | State machine in §5; O-8 supersedes the older payment-coupled O-1…O-7 passages. The additional charge belongs to the order, not to a provider session. |
| **StockExit** | item, qty, reason (WASTE / SELF_CONSUMPTION / GIFT_SAMPLE / SPOILAGE / OTHER), optional packaging lines | Valued at current WAC; no financial transaction (cost already incurred) — reported as "invisible cost". Phase 3.2 (KOK-128) adds **optional packaging lines** for the case where an unassembled product physically consumes packaging on its way out (gifting an unbagged loaf in a bag with a label). Default is no packaging; packaging is suggested only when the exited item is *not* itself an assembled presentation; an exit of an assembled presentation never adds packaging, because its WAC already contains it. |
| **InventoryCount** | count lines (expected vs counted) | `expected_qty` is frozen from stock at count start; `counted_qty` stays editable while DRAFT, and commit adjusts against that frozen expectation. Current item name and canonical unit are resolved from the catalog for count responses, not snapshotted. Commits ADJUST movements for variances. A line for an item with zero prior `stock_movements` and a positive counted qty commits OPENING_IN instead (C-8) — an opening balance, not a correction. A DRAFT count may be **cancelled, which means deleted** (soft, audit-reversible) — there is no "CANCELLED" count status (Phase 3.2, KOK-141). |
| **FinancialTransaction** | — | Either derived (from sale/purchase/order/withdrawal) or standalone (operating expense, other income). Transfers are paired rows. |
| **Session** | typed container: PRODUCTION / PURCHASE_TRIP / DELIVERY_RUN / ADMIN / OTHER; hours, shared costs, linked events | See §6. Phase 3.2: a start time is mandatory, at most one OPEN session per type, and purchases/production/assemblies must belong to one. |
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
  -deleted purchases (R-3) do not count. For SEMI_FINISHED/FINISHED items produced by a recipe,
  `replacement_cost = Σ(default-recipe line qty × ingredient's effective replacement cost, C-3c) /
  expected_yield`,
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
  `theoretical_cost_replacement = Σ(recipe line qty × ingredient's effective replacement cost,
  C-3c) / expected_yield`.
  Both are computed live and returned by the recipe read APIs; neither is cached nor written to
  `items.wac` / `items.replacement_cost` — only the *default* recipe's replacement-cost figure
  feeds that cache, and only via the nightly/on-demand job (KOK-029), never from KOK-025 itself.
- **C-3c Effective replacement cost (KOK-103 KB amendment, closes BI-24)**: a RAW_MATERIAL/
  PACKAGING item's stored `replacement_cost_mc` is `0` (schema default, Doc 04) until its first
  real purchase or, for `isUnmetered` items, the owner's manual entry (C-9) — both of which stamp
  `replacement_cost_updated_at`. An opening-balance count line (C-8) deliberately does **not**
  stamp it (`"last purchase unit cost"` means a real supplier transaction, not an administrative
  entry), so a freshly onboarded item can carry a non-zero `wac_mc` (from its `OPENING_IN`) while
  `replacement_cost_mc` sits at its untouched `0` default. Read raw, that `0` is not a business
  value — showing it would let `margin_replacement = price − 0` render as a false ~100% margin the
  moment onboarding finishes, before a single purchase exists.

  Every consumer of replacement cost — C-3's own SEMI_FINISHED/FINISHED rollup, C-3b's live
  theoretical-cost preview, C-5's `margin_replacement`/price-health alert, and the catalog's
  replacement-cost display — MUST therefore read the item's **effective replacement cost**, not
  the raw column, defined as:

  ```
  effective_replacement_cost =
    replacement_cost_updated_at IS NOT NULL ? replacement_cost_mc : wac_mc
  ```

  i.e. fall back to current WAC exactly when no real purchase (or owner estimate) has ever priced
  the item — the best available estimate of "what it costs to re-acquire today" absent purchase
  history or inflation is what was actually paid on average. If WAC is *also* `0` (no purchase, no
  opening balance, no owner estimate — the item has no cost basis of any kind yet), the effective
  replacement cost stays `0` and C-5's `margin_replacement`/price-health alert MUST be suppressed
  (not shown) for that item rather than rendering a false 100% margin.

  This is a **read-time projection only** — it never writes back into `items.replacement_cost_mc`
  or `replacement_cost_updated_at` for RAW_MATERIAL/PACKAGING, preserving C-3's "last real
  purchase" meaning and C-8's OPENING_IN carve-out exactly as decided. SEMI_FINISHED/FINISHED are
  the one exception: their stored `replacement_cost_mc` is already a computed rollup (not a "last
  purchase" fact), so C-3's nightly/on-demand job legitimately writes the sum of ingredients'
  *effective* replacement costs — the same inputs C-3b's live preview uses — so a recipe built on
  never-purchased ingredients gets a correct cached figure from its first recompute rather than
  waiting for a first purchase to happen anywhere in its BOM.
- **C-3d Composite replacement cost of a presentation/combo** (Phase 3.2, KOK-121/KOK-127): a
  FINISHED item whose cost basis comes from an **AssemblyDefinition** rather than a recipe rolls up
  the same way, from its definition instead:
  `replacement_cost = Σ(definition line qty × component's effective replacement cost, C-3c) /
  definition output qty`.
  Components may themselves be presentations, so this is a multi-level rollup exactly like C-3's
  BOM and follows the same rules: dependency order, half-up rounding **once per level**, the
  bounded per-level tolerance recorded in ADR-017, and the same nightly/on-demand refresh job
  (KOK-029). An item is costed from a recipe **or** from an assembly definition, never both: if an
  item somehow has each, the assembly definition wins (it is the later transformation and its
  components already carry the recipe's cost). The cycle prohibition on definitions is what keeps
  this rollup terminating.

  This rule is what makes the combo's price health honest. Worked example (the acceptance fixture,
  KOK-124): a Desayuno Kokoro assembled at WAC Bs 40,70 and sold at Bs 60 shows a **historical**
  margin of 32,17% — healthy-looking — while its components now cost Bs 44,50 to replace, a
  **replacement** margin of 25,83%, below the 30% threshold. C-5 must fire on the second figure.
  Without a composite replacement cost the combo would have no C-5 signal at all, which is the
  exact failure mode G2 exists to prevent.
- **C-4 Production run cost**:
  `direct = Σ(consumed qty × consumed item's WAC at commit time)`;
  `total = direct + indirect_cost + allocated session shared cost (§6)`;
  `output unit cost = total / actual_output_qty`. Actual output absorbs shrinkage/merma
  automatically. Output entry updates the output item's WAC per C-1. **KOK-144 amendment:**
  `recipe_id` may be NULL for a one-off run; in that mode the owner selects the output item and
  enters the actual consumption lines directly. The recipe remains a prefill only, so C-4, R-2/R-5
  replay, and order-linked profitability use the same stored consumption/output data regardless of
  whether a recipe was selected.
- **C-5 Margins** (per finished item):
  `margin_wac = price − wac`; `margin_replacement = price − effective replacement cost (C-3c)`;
  percentages over price. **Price-health alert** when
  `margin_replacement_pct < settings.min_margin_pct` (default 30%), **suppressed** when the item's
  effective replacement cost is `0` (no purchase, opening balance, or owner estimate exists yet —
  C-3c) rather than firing on a meaningless `100%` figure.
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
- **C-10 Assembly cost** (Phase 3.2, KOK-121/KOK-124 — decided 2026-08-11, implementation
  pending). An *Envasado/Armado* event transfers value; it does not create or spend any:

  ```
  direct = Σ(consumed qty × consumed component's WAC at commit time)
  output unit cost = direct / actual_output_qty
  ```

  Four normative consequences, each deliberate:

  - **Actual output absorbs everything.** If components for ten bottles are consumed and nine
    usable units come out, the nine carry the full cost — breakage and spillage stay visible in
    the unit cost instead of vanishing. Identical in spirit to C-4's merma absorption.
  - **No cash, ever.** An assembly writes no `financial_transactions` row of any kind. The value
    that was distributed across base product and packaging is now concentrated in the
    presentation; total stock value is unchanged by the event (a useful test assertion).
  - **Labor is not capitalized** (C-7). Packing time is captured through the session and feeds
    Bs/hour; it never enters the product's cost.
  - **Session shared costs are NOT allocated into assemblies.** S-3 allocates a PRODUCTION
    session's shared costs across its **production runs** only. An assembly in that session
    absorbs none of them, and a production session containing only assemblies leaves its shared
    costs as period operating expenses. Rationale: C-10 keeps "value in = value out" exactly
    true, which is what makes double-counting between the assembly and the later sale structurally
    impossible; letting period costs leak into an assembly would break that property for a figure
    S-4 already reports honestly as Bs/hour. Revisit only with a superseding rule, not inline.

  The output entry updates the output item's WAC per C-1 (`ASSEMBLY_IN` is an entry type). Sales of
  the resulting presentation freeze that full WAC, so the sale's margin already accounts for all
  packaging — deducting packaging again at sale time would double-count it, which is precisely the
  bug this model removes.

## 5. Custom order lifecycle (Modality 2)

```
QUOTING ──confirm(optional deposit)──► CONFIRMED ──start──► IN_PRODUCTION ──ready──► READY ──deliver──► DELIVERED
   │                              │  ◄──back──┘  ◄──────back──────┘  ◄─ undo delivery ─┘   (terminal
   │                              │                    │                        │           unless undone)
   └────────────cancel────────────┴────────cancel──────┴──────cancel────────────┘
                                    → CANCELLED (deposit refund or forfeit, owner decides)
                                      TERMINAL — never reopened (O-6)
```

Rules:

**Superseding payment/edition contract (Phase 3.5, KOK-204…208; ADR-022).** The
payment-coupled clauses in O-1…O-3 and O-6 below document already shipped behavior; O-7 and
the external-delivery clauses describe earlier unimplemented plans. None is the target payment
contract. O-8 below supersedes them wherever they require automatic cash posting,
deposit release/recategorization, full-balance collection, a payment-based undo veto, or
deposit-based restrictions on the agreed total. O-4's stock and costing rules and O-5's ordering
rules still apply. The migration in Doc 04 §3.4 specifies the cutover; the old code must not be
interpreted as implementing O-8 until those backlog tasks ship.

- **O-1** `CONFIRMED` requires the agreed merchandise subtotal. The deposit defaults to 50% of that
  subtotal (editable), but MAY be zero. An optional external-delivery pass-through is added only at
  delivery and is not part of the deposit base. A positive deposit is a financial INCOME with
  category ORDER_DEPOSIT into bank/cash and an increase of the `customer_deposits` liability (INV-7).
  A zero deposit creates no financial transaction, does not change an account balance, and creates no
  deposit liability. Confirming at zero requires an explicit high-risk acknowledgment in the command;
  the service validates it and the audit log records it. The confirmation UI must make clear that the
  business is accepting the order before receiving any money and require an affirmative decision.
- **O-2** On `deliver`: the system creates the linked **Sale** (channel CUSTOM_ORDER) for the
  merchandise subtotal plus any external-delivery pass-through; the deposit liability is released
  against it; the remaining balance is recorded as paid (ORDER_BALANCE) or as accounts receivable if
  the customer owes.
  - The sale's lines are derived from the order's lines, so **every order line must be linked to a
    catalog FINISHED item before an order can be delivered** (Doc 04 §5) — free-text lines are a
    quoting convenience and must be resolved first (`resolveOrderLine`, KOK-034 — the one narrow
    exception to "no generic update order", see Doc 04 §5); delivery refuses (409) otherwise.
    `agreed_total` is the merchandise subtotal and is split across those lines by largest remainder
    so `Σ(qty × unit_price_mc / 1e6)` reproduces it exactly. An optional `delivery_fee` is stored
    separately on the generated sale; `sales.total = merchandise subtotal + delivery_fee`. It is
    never allocated onto product lines, and ordinary catalog sales have a zero delivery fee.
  - Only the **balance** is new money: the deposit was already banked at confirm time, so
    `ORDER_BALANCE` is booked for `sales.total − deposit_paid` (nothing when that is zero), and an
    ON_CREDIT balance shows in `v_receivables` net of the deposit. With a zero deposit the full final
    sale total, including any delivery fee, is the balance and may become a receivable; the
    receivable is created at delivery, not while the order is still in production.
  - Choosing ON_CREDIT at delivery requires a separate explicit high-risk acknowledgment, validated
    by the service and recorded in the audit log. The warning states the amount that will remain
    owed and requires an affirmative decision to proceed. This acknowledgment is independent of
    R-5's `confirm` flag for backdated-cost replay; when both apply, both decisions are required.
  - The deposit liability is released by the status reaching `DELIVERED`; `v_liability` subtracts
    delivered orders' `deposit_paid`. Revenue is recognized here, at delivery, and never earlier
    (INV-7).
  - **External delivery pass-through (Phase 3.5/KOK-204):** only when the business pays an external
    delivery provider, `deliverOrder` creates one closed `DELIVERY_RUN` session by workflow
    convention, ending at the delivery's `occurred_at`. Duration defaults to 5 minutes and is
    editable; `started_at = occurred_at − duration`. The generated sale links to that session.
    The session carries one actual shared-cost line (“Servicio de delivery externo”) paid from a
    selected account; that exact amount is copied to `sales.delivery_fee` — no markup. The session's
    operating expense and sale's customer charge are both committed in the same atomic batch. The
    charge is included in the final paid balance/receivable, while both pass-through amounts are
    excluded from product gross margin. Product gross margin is
    `(sales.total − sales.delivery_fee) − frozen sale-line COGS`; show the fee and expense separately
    in the order detail, not in the history row or margin figure. The one-session-per-order behavior
    is a capture convention only: no DB uniqueness constraint is added, and the existing
    `sales.session_id` relationship remains many-to-one.
    A provider cost already recorded on an earlier delivery attempt is not paid twice when that
    delivery is undone. If re-delivery uses the same paid service without a new payment, reuse the
    retained session and its original time/cost, and apply its fee to the new sale; the session's
    end time then documents the **original provider event**, not the later re-delivery timestamp.
    If a new provider payment occurs, create a new session/expense, retain the earlier expense as
    history, and charge only the new provider amount on the current sale. A session/cost linked to
    an active delivered sale cannot be edited or deleted through generic session commands: changing
    it would silently break the fee/expense reconciliation. Correct it only via a future explicit
    reconciliation command; after undo, the retained expense can use normal guarded corrections.
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
  per-order work evidence. A linked run's full batch cost is not, by itself, the order's gross
  margin; realized product gross margin comes from the delivered sale lines' frozen COGS.
  - Consequence, decided 2026-08-11 and **not** to be re-litigated: there is **no hard gate**
    blocking `ready` when the order has no linked production run. Filling an order from stock
    already produced is legitimate, and a gate would force fake zero-quantity runs that corrupt
    C-4 and the WAC. The UI instead warns and asks for explicit confirmation (KOK-137).
  - Production and assembly forms offer orders in **every status except DELIVERED and CANCELLED**
    (KOK-137). Restricting the picker to CONFIRMED/IN_PRODUCTION hid legitimate work.
- **O-5** Unlimited concurrent orders; the active Orders board sorts each status lane by
  `delivery_date` **descending** (latest promised date first, topmost; undated orders last; Phase
  3.5/KOK-201). Tie-break by `created_at` descending and `id` descending. A bounded keyset read must
  expose continuation rather than silently omit active or historical orders beyond the per-request
  limit. `delivery_date` is a promised calendar date and MAY be in the future. The
  no-future-date rule applies only to transaction `business_date` values; it explicitly does not
  apply to `custom_orders.delivery_date`.
- **O-6 Backward transitions** (Phase 3.2, KOK-136 — decided 2026-08-11, shipped 2026-08-16).
  A mis-clicked status was previously unrecoverable. Two mechanisms, deliberately different:
  - **Free reversal** among `CONFIRMED` ↔ `IN_PRODUCTION` ↔ `READY`. No money moves in either
    direction, so a simple confirmation is enough. `QUOTING` → `CONFIRMED` is **not** reversible
    this way: it took a deposit, so undoing it is a cancellation with a refund/forfeit resolution
    (O-3), not a status step.
  - **Undo delivery** (`DELIVERED` → `READY`), with explicit confirmation and an R-5 impact
    preview. In one atomic batch it soft-deletes the sale that O-2 created (releasing its
    `SALE_OUT` movements and its income/receivable rows through the normal regenerate path),
    clears `custom_orders.sale_id`, and **restores the deposit to the `customer_deposits`
    liability** (INV-7) — revenue recognized at delivery is un-recognized here, and nowhere else.
    Because this deletes a sale, it inherits R-2's replay and R-5's confirmation exactly as any
    other sale deletion does.
    - Mechanically (verified against the code 2026-08-11): `core/sales`' refusal to touch a
      `channel='CUSTOM_ORDER'` sale **stands unchanged** — `undoDelivery` does not call
      `updateSale`/`deleteSale`; it emits its own reversal statements from `core/orders`, the module
      that owns the sale. Restoring the deposit liability needs no reversal row at all: the liability
      is derived (ADR-012) and simply resumes counting the order once its status leaves `DELIVERED`.
    - If delivery used an external provider, undo also removes the sale's pass-through fee and
      associated customer balance, but preserves the closed delivery session and its real
      operating-expense transaction: the provider was actually paid. A provider refund, if any, is
      recorded as a separate financial event.
    - **If the delivered sale has since been collected**, `undoDelivery` refuses with a 409.
      Collection is real money that really arrived, on a path that deliberately nets the deposit;
      silently reversing it would be worse than telling the owner to reverse the collection first.
  - **`CANCELLED` stays terminal.** Reopening it would mean reversing a `DEPOSIT_REFUND` expense
    or un-recognizing a FORFEIT already booked as `OTHER_INCOME` in a closed period — accounting
    surface with no matching operational need. Record a new order instead.
- **O-7 Stage-specific order correction (Phase 3.5/KOK-205):** there is no general-purpose
  `updateOrder`. Corrections use named commands with status and field guards, preserve the immutable
  `PED` code, audit before/after, and commit in one atomic batch:
  - While `QUOTING`, `updateOrderQuote` may correct the full quote, including customer, description,
    merchandise subtotal, lines, delivery date/place, notes and expected deposit.
  - In `CONFIRMED`, `IN_PRODUCTION` and `READY`, `updateOrderLogistics` may change only delivery
    date/place and notes; it moves no money or stock.
  - In those same pre-delivery statuses, `renegotiateOrder` may change the description, merchandise
    lines/quantities (including adding a line to an empty quote) and agreed merchandise subtotal. It
    never rewrites `deposit_paid`, the deposit transaction, or existing production/assembly/stock events.
    New subtotal must be at least
    `deposit_paid`; if it would be lower, reject the renegotiation and require cancellation with
    REFUND followed by a new order (partial deposit refunds on active orders are not supported).
    Once any positive deposit has been received, customer identity is immutable. A confirmed
    zero-deposit order may change customer only with a fresh explicit `acceptNoDepositRisk` and audit
    entry for the new counterparty. When the quote has a subtotal, explicitly pinned line shares
    must fit within it; if lines exist, delivery's largest-remainder allocation must be able to
    reproduce the subtotal exactly. An unset QUOTING subtotal defers this check until it is agreed.
    Keep empty lines legal before delivery but reject delivery with none. Every correction compares
    the order's `updated_at` from the form at commit inside its atomic command, aborts the batch if it has changed,
    and reports a stale edit with 409.
  - `DELIVERED` corrections use O-6's guarded undo-delivery path; `CANCELLED` remains terminal.
    Renegotiating order lines never rewrites already-recorded production or assembly events; if the
    physical work itself was wrong, correct that source event separately through its guarded service.

**O-8 Independent order cash events and editable pre-delivery agreement (target; KOK-204…208).**

- Confirmation, delivery, undo delivery, backward steps and cancellation never insert, edit, delete
  or recategorize `financial_transactions`, nor change account balances. Confirmation no longer
  requires collecting a deposit or a no-deposit risk acknowledgment. Delivery still creates the
  order-owned CUSTOM_ORDER sale and `SALE_OUT` movements, with frozen line COGS and R-2/R-5 replay;
  undo soft-deletes that sale, reverses its stock movements, and returns the order to READY even
  after any number of payments. It never reverses a real cash event. Cancellation is terminal and
  does not automatically refund or forfeit anything; refunds are separate explicit expenses.
- An order may have any number of independently created, corrected or soft-deleted receipts in
  category `ORDER_DEPOSIT` or `ORDER_BALANCE`, each with its own date, account, immutable manual
  code and `custom_order_id`. These are cash-flow labels, not an application to a sale: a balance
  receipt remains a balance receipt even after undo. `ORDER_REFUND` expenses reduce cash but do not
  reinstate a delivered order's debt. A tip/overpayment remains recorded as a receipt; its excess
  is displayed separately. Order status does not gate capture or correction of these cash events.
  The finance service owns their mutations and account deltas; the source-event association stays
  separate from the order relationship. Purchase/provider expenses can also be associated with
  the order without altering their source or changing the customer's debt. The relationship uses
  IDs, not the display code as a database key.
  An order-linked OTHER_INCOME is available for other cash associated with the order: it
  appears in cash result but, unlike ORDER_DEPOSIT/ORDER_BALANCE, does not settle order debt.
  A tip paid as part of a customer installment can be captured in ORDER_BALANCE and shown as
  excess receipts once the customer price has been covered.
  The order page launches the familiar income/expense/refund forms with its order ID fixed by
  context (KOK-208). The Finance table shows those same movements and their related PED link,
  but Finance does not offer a picker for creating or reassigning order-linked transactions.
  An incorrect manual association is corrected by soft-deleting the row and recording it from
  the correct order page. Source-owned purchase expenses remain editable through purchasing.
  Existing old-model rows are disposable test data and are not migrated or corrected through
  a special legacy finance path; reset those datasets at the coordinated cutover.
- `customer_amount = agreed_total + additional_charge`, both nonnegative integer centavos; the
  charge is independently quoted and need not equal a provider expense. `receipts` is the sum of
  active directly order-linked manual ORDER_DEPOSIT/ORDER_BALANCE transactions only.
  `outstanding = max(customer_amount - receipts, 0)`;
  `excess = max(receipts - customer_amount, 0)`. Null agreement means no computable outstanding.
  Only DELIVERED orders with positive outstanding appear as order receivables; before delivery the
  same difference is an expected balance, never an account receivable; CANCELLED orders have no
  receivable. Refunds/expenses are excluded from this debt equation. Unfulfilled order receipts
  are still real cash, but are not recognized product revenue; the liability projection must not
  treat a payment labeled ORDER_BALANCE as automatically earned merely because of its label.
- Delivered **product gross margin** equals the current active delivered sale's merchandise
  subtotal less its frozen sale-line COGS. Separately, **order cash result** equals all active
  linked receipts and other income minus all active linked expenses (including refunds and linked
  purchase/provider expenses); it is not gross margin and may double-count inventory acquisition
  if combined with COGS. Neither amount is silently substituted for the other.
- `updateOrder` replaces stage-specific quote/logistics/renegotiation endpoints: QUOTING,
  CONFIRMED, IN_PRODUCTION and READY allow editing agreement, lines, additional charge and
  logistics in one guarded, audited batch. FINISHED-item eligibility, exact-centavo allocation,
  stale-write protection and immutable PED code still apply. When any receipt has ever been linked
  (including a subsequently corrected/soft-deleted receipt), customer
  identity cannot change, but the agreed amount may change even below receipts: show the excess.
  DELIVERED and CANCELLED orders cannot edit their agreement or delivered items; to correct a
  delivered agreement, undo delivery first (with costing impact preview). A payment is corrected
  through finance, never by editing an order. Linked historical work is not rewritten.
- The generated sale remains the stock/COGS evidence; it snapshots the merchandise agreement and
  additional charge (`sale.total = merchandise + charge`) but creates no payment. Its PAID/ON_CREDIT
  fields are no longer the source of truth for custom-order debt; catalog sales retain their
  existing collection workflow. Redelivery creates a fresh sale snapshot without reposting cash.

## 6. Sessions, shared costs, and time profitability

- **S-1** *(amended — Phase 3.2, KOK-130, decided 2026-08-11, shipped 2026-08-13. Originally:
  "a session is optional context; every event type MAY link to one session".)*
  **Purchases, production runs and assemblies MUST belong to a session**; every other event type
  MAY. Without that link the Bs/hour metrics (S-4, G3) have no denominator for the work that
  produces value, which is the whole reason sessions exist.

  The requirement is a **domain** rule, never an interaction blocker — making the user create a
  session before recording a real purchase would violate product principle 1 (*capture first*)
  and produce unrecorded events, which is strictly worse than an imperfect session. The service
  therefore resolves it itself, in the command's own batch:

  1. If an OPEN session **of the matching type** exists, link to it.
  2. Otherwise create a minimal session of the matching type (same `occurred_at`, no costs, OPEN)
     and link to that. The owner can complete or correct it afterwards.

  **Type matching is strict**: a purchase resolves against `PURCHASE_TRIP`, a production run or an
  assembly against `PRODUCTION`. An event never attaches to an open session of a different type —
  hours must stay attributable to the kind of work that generated them.
- **S-1b One OPEN session per type** *(Phase 3.2, KOK-130; hardens the previous soft warning
  recorded in Doc 04 §5)*. At most one session may be `OPEN` per `type`, enforced by a partial
  unique index, not by a warning. Sessions of **different** types may be open simultaneously — a
  delivery of flour mid-bake opens a purchase session without interrupting the production one. A
  single globally-open session was considered and rejected for exactly that reason. Starting a
  second session of a type that already has one offers "close the previous one now and start the
  new one" as a single action.
- **S-2** Session records `started_at` (**required** — Phase 3.2, KOK-131), `ended_at` (or direct
  `duration_min`) and shared cost lines (e.g., fuel Bs 20, electricity/gas estimate Bs 8). Shared
  costs create OPERATING_EXPENSE transactions (paid from an account) — except ESTIMATED costs
  (e.g., home energy share) which are flagged `is_estimate` and excluded from cash but included in
  profitability analysis. A session supplied with an end time or a duration at creation is born
  `CLOSED` in one step. Only the end/duration is optional; there is no session without a start,
  which is why the week calendar (SC-09) has no "unscheduled" lane.
- **S-3** Allocation: a PRODUCTION session's shared costs are allocated across its production
  runs **proportionally to each run's direct cost** and included in C-4. Purchase-trip and
  delivery-run shared costs stay as period operating expenses (not capitalized). **Assemblies
  absorb no allocated session cost** (C-10) — a production session whose only events are
  assemblies leaves its shared costs as period operating expenses.
- **S-4** Time profitability:
  `session Bs/h = attributable contribution / hours`, where contribution for a production
  session = Σ over produced goods of `(current price − unit cost) × qty produced` (potential
  contribution), for a delivery run = product gross margin of delivered sales (excluding the equal
  external-delivery fee/expense pass-through), for purchase/admin = 0 (cost centers). Monthly
  `owner Bs/h = operating profit / total logged hours` (see S-5 for what
  "total logged hours" means once sessions can overlap). Both are reported; the monthly figure is
  the headline (G3).
- **S-5 Deduplicated hours** *(Phase 3.2, KOK-135 — decided 2026-08-11, shipped 2026-08-16)*.
  S-1b allows sessions of different types to be open at once, so naively summing `duration_min`
  across sessions can exceed the hours that actually elapsed and would silently deflate G3.
  Therefore:
  - **Per-session Bs/h (S-4) uses that session's own duration**, unchanged. A purchase trip
    nested inside a bake still cost the time it cost.
  - **The monthly business figure (G3) uses deduplicated wall-clock hours**: the total length of
    the **union** of all session intervals in the period, counting overlapped time once. A session
    with no recorded duration is excluded from the union, never imputed — and the excluded count is
    shown, following the KOK-079 precedent.
  - Where the two totals differ, the UI shows both and states why; a number the owner cannot
    reconcile against her own day is a number she stops trusting.

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
  `ProductionRun`'s cost (C-4) depends on its consumed items' WAC.
  **Amendment (Phase 3.2, KOK-121/KOK-125 — decided 2026-08-11, implementation pending): the
  dependency graph spans ACTIVE assembly definitions as well as recipes.** An assembly's output
  cost (C-10) depends on its components' WAC exactly as a production run's does, and a combo's
  components are themselves presentations, so the graph is now
  `raw material → semi-finished → finished → presentation → combo`. A backdated bottle purchase
  must reach the Kéfir 500 ml presentation *and* every combo containing it; a replay that stops at
  recipes would leave those costs silently stale. The cycle prohibition on assembly definitions
  (§3) is what keeps this walk terminating, the same role `validateRecipeItemKinds` plays for
  recipes. The nightly consistency job
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

`PurchaseRecorded`, `ProductionCompleted`, `AssemblyCompleted`, `SaleRecorded`, `SalePaid`,
`StockExited`, `InventoryCounted`, `StockAdjusted`, `OrderQuoted`, `OrderConfirmed`,
`OrderDelivered`, `OrderDeliveryUndone`, `OrderStatusReverted`, `OrderCancelled`,
`DepositReceived`, `DepositReleased`, `TransferMade`, `WithdrawalMade`, `ExpenseRecorded`,
`SessionOpened`, `SessionClosed`, `LowStockDetected`, `MarginBelowThreshold`,
`NegativeStockFlagged`. v1 handles them in-process (no queue): side effects are alerts and cache
refresh only.

## 9. Use case catalog

| ID | Use case | Channel(s) | Core service |
|----|----------|-----------|--------------|
| UC-01 | Record purchase (multi-line, account, photo, session — required but auto-resolved, S-1) | TG, Web | purchasing.recordPurchase |
| UC-02 | Record production run (recipe → adjust actuals → commit) | TG, Web | production.recordRun |
| UC-03 | Record catalog sale (items, qty, payment method/status) | TG, Web | sales.recordSale |
| UC-04 | Collect CATALOG sale receivable in full; custom-order partial receipts use UC-26 | TG, Web | sales.collectPayment (catalog only) |
| UC-05 | Quote custom order | TG, Web | orders.quote |
| UC-06 | Confirm order without posting cash (O-8 target) | TG, Web | orders.confirm |
| UC-07 | Deliver order (sale/stock snapshot only; O-8 target) | TG, Web | orders.deliver |
| UC-08 | Cancel order without posting cash (O-8 target) | Web | orders.cancel |
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
| UC-21 | Record packing/assembly (*Envasado/Armado*: definition → adjust actuals → commit) | TG, Web | assembly.recordAssembly |
| UC-22 | Manage presentation & combo definitions | Web | assembly.definitions.* |
| UC-23 | Revert an order's status / undo a delivery (O-6) | Web | orders.revertStatus / orders.undoDelivery |
| UC-24 | Cancel (delete) a draft inventory count | Web | inventory.cancelCount |
| UC-25 | Review receivables by customer and open the source sale/order | Web | finance.listReceivables |
| UC-26 | Capture/correct repeatable order receipts, refunds and related expenses | Web | finance.recordOrderTransaction / finance.updateTransaction |
| UC-27 | Edit pre-delivery agreement and additional customer charge | Web | orders.updateOrder |

UC-21…UC-24 are Phase 3.2 additions (decided 2026-08-11); UC-25 is a Phase 3.5 addition. Their
acceptance criteria land in Doc 11 with the tasks that build them.

Each use case's acceptance criteria live in [11 — Testing Strategy](11-testing-strategy.md)
(integration suites §3, phase gates §6).
