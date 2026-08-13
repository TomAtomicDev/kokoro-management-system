# 04 — Data Model

Target: **Cloudflare D1 (SQLite)**, managed with Drizzle ORM migrations. This document is the
authoritative schema; Drizzle definitions in `apps/worker/src/db/schema.ts` MUST mirror it 1:1.

## 1. Conventions

- Table/column names: English `snake_case`, singular module prefixes avoided (tables are plural).
- Primary keys: `id TEXT` **UUIDv7** (time-sortable).
- Timestamps: `*_at TEXT` ISO-8601 UTC. Every business event also has `business_date TEXT`
  (`YYYY-MM-DD`, America/La_Paz) — INV-3.
- Soft delete: business-event tables carry `deleted_at TEXT NULL`; queries filter it by default.
- All FKs declared with `ON DELETE RESTRICT` unless noted (D1 enforces FKs; keep `PRAGMA foreign_keys=ON` semantics via wrangler default).

## 2. Numeric representation (INV-6, ADR-017)

Four scales, one per concept. **No concept has two scales** — that rule is the whole point, and
it exists because the previous model had two different denominators for "a per-unit price" and
shipped two 1000× bugs (KOK-069; see ADR-017 for the full history).

| Concept | Storage | Brand (`packages/shared`) | Column suffix | Example |
|---------|---------|---------------------------|---------------|---------|
| Money amount — totals, balances, line totals, transaction amounts | `INTEGER` centavos | `Centavos` | none | Bs 12.50 → `1250` |
| **Any per-unit rate** — sale price, line unit price, `wac`, `replacement_cost`, cost snapshots, theoretical unit cost | `INTEGER` milli-centavos per **WHOLE** unit | `MilliCentavosPerUnit` | `_mc` | Bs 8.00 per unit → `800000`; Bs 12.345/kg → `1234500` |
| Quantity | `INTEGER` milli-units of the item's own unit | `MilliUnits` | none | 1.5 kg (unit=KG) → `1500` |
| Percent / rate | `INTEGER` basis points | `BasisPoints` | none | 30% → `3000` |

Rules:

- **`REAL` does not appear in money or per-unit-rate columns.** Milli-centavos carry three decimal digits below the
  centavo — more precision than the domain needs, and deterministic, so WAC replay (ADR-016) is
  reproducible.
- **The denominator of every rate is the whole unit**, never the milli-unit, so
  `sale_price_mc − replacement_cost_mc` is always dimensionally valid.
- **Two conversion helpers only**, both in `packages/shared/money.ts`, and they are the only
  place a scale factor is written anywhere in the repo:
  `totalCentavos(rate, qty)` = `roundHalfUp(rate × qty / 1e6)` and
  `rateFromTotal(total, qty)` = `roundHalfUp(total × 1e6 / qty)`.
  The root lint gate rejects a literal `1000` / `1e6` used in arithmetic outside `money.ts`.
  A legitimate non-money conversion requires an adjacent
  `// scale-factor-ok: <specific reason>` comment. Immutable invariant tests remain independent
  formula oracles and are excluded from this mechanical guard (D-5).
- **Brands are nominal and zero-runtime**; mixing scales is a compile error. Runtime
  `assertSafeInteger` guards remain at every boundary — brands catch developer error,
  assertions catch bad input.
- Arithmetic happens on integers in `packages/shared/money.ts` / `qty.ts`; rounding half-up only
  when producing a final amount; proportional splits use largest-remainder allocation.

> **Correction (found during KOK-070, 2026-07-28).** This section's `MilliCentavosPerUnit`
> example originally showed `8000000`/`12345000` — 10× too large; `milli-` is ×1000, same as
> `MilliUnits`, so Bs 8.00/unit is `800000` milli-centavos, not `8000000`. See ADR-017's
> correction note for the full derivation. The `totalCentavos`/`rateFromTotal` formulas below
> were never wrong, only the worked examples were.

## 3. Schema (DDL)

### 3.1 Catalog

```sql
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,                     -- display name (Spanish)
  kind TEXT NOT NULL CHECK (kind IN ('RAW_MATERIAL','SEMI_FINISHED','FINISHED','PACKAGING')),
  category TEXT NOT NULL CHECK (category IN
    ('INGREDIENT','NOT_EATABLE','BAKERY','DAIRY','PASTRY','OTHER')),
  unit TEXT NOT NULL CHECK (unit IN ('KG','L','M','UNIT')),
  wac_mc INTEGER NOT NULL DEFAULT 0,             -- weighted avg cost, milli-centavos per whole unit (derived, C-1)
  replacement_cost_mc INTEGER NOT NULL DEFAULT 0,-- milli-centavos per whole unit (derived, C-3; owner-entered when is_unmetered, C-9); raw column only — readers use the WAC-fallback effective value (C-3c) until a real purchase lands
  replacement_cost_updated_at TEXT,
  sale_price_mc INTEGER,                         -- milli-centavos per whole unit; NULL unless sellable (FINISHED)
  min_stock_qty INTEGER,                         -- milli-units; NULL = no alert; required for RAW_MATERIAL/PACKAGING
  is_unmetered INTEGER NOT NULL DEFAULT 0,       -- RAW_MATERIAL only (C-9): no PURCHASE_IN/StockExit/kardex; cost = replacement_cost_mc
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE item_aliases (                      -- NL matching for the assistant ("harina", "flour")
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  alias TEXT NOT NULL COLLATE NOCASE,
  UNIQUE (alias)
);

CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  output_item_id TEXT NOT NULL REFERENCES items(id),
  expected_yield_qty INTEGER NOT NULL,           -- milli-units of output per 1 batch
  est_labor_min INTEGER,                         -- informative only (C-7)
  is_default INTEGER NOT NULL DEFAULT 0,         -- one default per output item (partial unique index)
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_recipes_default
  ON recipes(output_item_id) WHERE is_default = 1 AND is_active = 1;
CREATE UNIQUE INDEX ux_recipes_name             -- KOK-025 KB amendment: active recipe names must be unique
  ON recipes(name) WHERE is_active = 1;

CREATE TABLE recipe_lines (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),    -- RAW_MATERIAL or SEMI_FINISHED only (recipes.ts); PACKAGING is never a recipe input (KOK-1xx, see Doc 03 §3)
  qty INTEGER NOT NULL CHECK (qty > 0)           -- milli-units per 1 batch
);

-- PENDING (Phase 3.2, KOK-122 — decided 2026-08-11, not yet applied).
-- The Presentation/Combo template: how a quantity of product plus its packaging becomes one
-- stockable commercial unit. Deliberately NOT an extension of `recipes` (Doc 03 §3): a recipe
-- answers "how is this food made", a definition answers "how is it presented or bundled", and
-- the two carry different input rules and different costing graphs.
CREATE TABLE assembly_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  output_item_id TEXT NOT NULL REFERENCES items(id),  -- FINISHED, unit UNIT (service-enforced)
  output_qty INTEGER NOT NULL CHECK (output_qty > 0), -- milli-units produced by 1 execution
  is_default INTEGER NOT NULL DEFAULT 0,         -- one default per output item (partial unique index)
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_assembly_defs_default
  ON assembly_definitions(output_item_id) WHERE is_default = 1 AND is_active = 1;
CREATE UNIQUE INDEX ux_assembly_defs_name      -- mirrors ux_recipes_name's active-only scoping
  ON assembly_definitions(name) WHERE is_active = 1;

CREATE TABLE assembly_definition_lines (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES assembly_definitions(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),    -- SEMI_FINISHED, FINISHED or PACKAGING — the one
                                                 -- place FINISHED is a legal input (a combo
                                                 -- consumes finished presentations). Never
                                                 -- RAW_MATERIAL: raw inputs belong in a recipe.
  qty INTEGER NOT NULL CHECK (qty > 0)           -- milli-units per 1 execution
);
-- Cycle prohibition (Doc 03 §3, §5 below): a definition may not reach its own output item through
-- any chain of definition lines. Enforced by a graph walk in the service at save time — unlike the
-- recipe case (§5), this one is NOT allowed to surface later as a refresh-time 409, because C-3d's
-- rollup and R-2's replay both walk this graph and a cycle would not terminate.

CREATE TABLE price_history (                     -- price stability analysis (G2)
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  price_mc INTEGER NOT NULL,                     -- milli-centavos per whole unit
  effective_from TEXT NOT NULL,                  -- business_date
  note TEXT
);

-- PENDING (KOK-073, not yet applied): erosion series for G2.
CREATE TABLE replacement_cost_history (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  replacement_cost_mc INTEGER NOT NULL,          -- milli-centavos per whole unit
  observed_at TEXT NOT NULL,                     -- ISO-8601 UTC, = items.replacement_cost_updated_at
  business_date TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('PURCHASE','NIGHTLY','MANUAL'))
);
-- Append-only, written by the KOK-029 refresh ONLY when the recomputed value differs from the
-- live one (no row per no-op run). Never edited, never soft-deleted: it is an observation log,
-- not a business event, so INV-10 does not apply. This table exists because the series cannot be
-- backfilled — see KOK-073.
```

Item units are canonical per measurement family: mass persists as `KG` (small input/display `g`,
1 g = 1 milli-KG), volume as `L` (`ml`, 1 ml = 1 milli-L), length as `M` (`cm`, 1 cm = 10
milli-M), and count as `UNIT` with no smaller member. These input/display conversions are
implemented centrally in `packages/shared/src/qty.ts`; per-unit rates always retain the canonical
denominator.

### 3.2 Sessions

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('PRODUCTION','PURCHASE_TRIP','DELIVERY_RUN','ADMIN','OTHER')),
  business_date TEXT NOT NULL,
  started_at TEXT NOT NULL,                      -- Phase 3.2 (KOK-131): mandatory. Only the END is
                                                 -- optional, which is why SC-09's week calendar
                                                 -- has no "unscheduled" lane (Doc 03 S-2)
  ended_at TEXT,
  duration_min INTEGER,                          -- direct entry allowed; derived from start/end otherwise
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  notes TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- Phase 3.2 (KOK-130, migration 0022): one OPEN session per TYPE, hard-enforced (Doc 03 S-1b) — this
-- replaces the soft "warn, allow override" rule recorded in §5. Different types MAY be open at
-- the same time; a delivery of flour mid-bake must not force closing the production session.
CREATE UNIQUE INDEX ux_sessions_open_per_type
  ON sessions(type) WHERE status = 'OPEN' AND deleted_at IS NULL;

CREATE TABLE session_costs (                     -- shared costs (S-2)
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  label TEXT NOT NULL,                           -- "Gasolina", "Gas/energía"
  amount INTEGER NOT NULL CHECK (amount >= 0),   -- centavos
  is_estimate INTEGER NOT NULL DEFAULT 0,        -- 1 → no cash transaction, analysis-only
  account_id TEXT REFERENCES financial_accounts(id)  -- required when is_estimate=0
);
```

### 3.3 Business events

```sql
CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL, business_date TEXT NOT NULL,
  supplier_name TEXT,
  session_id TEXT NOT NULL REFERENCES sessions(id),   -- Phase 3.2 (KOK-130): required (Doc 03 S-1).
                                                 -- Resolved by the service — link to the open
                                                 -- PURCHASE_TRIP session or create a minimal one
                                                 -- in the same batch. Never a form blocker.
  account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  total INTEGER NOT NULL,                        -- centavos; = Σ lines (checked in service)
  receipt_photo_key TEXT,                        -- R2 object key
  notes TEXT, deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE purchase_lines (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),
  qty INTEGER NOT NULL CHECK (qty > 0),          -- milli-units
  line_total INTEGER NOT NULL CHECK (line_total >= 0)  -- centavos (unit cost derived, C-2)
);
-- A line_total of 0 is valid (free/promotional stock). Since financial_transactions.amount is
-- always > 0 (no zero-value cash movements), a purchase whose total across all lines is 0 skips
-- the SUPPLY_PURCHASE financial_transactions row entirely — PURCHASE_IN movements, WAC, and
-- replacement_cost are still updated as normal.

CREATE TABLE production_runs (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL, business_date TEXT NOT NULL,
  recipe_id TEXT REFERENCES recipes(id),         -- Phase 3.2 (KOK-144): NULLable. Real cost comes
                                                 -- from actual consumption (C-4); the recipe only
                                                 -- prefills, so a one-off run may have none and
                                                 -- pick its output item directly
  session_id TEXT NOT NULL REFERENCES sessions(id),   -- Phase 3.2 (KOK-130): required, resolved by
                                                 -- the service against the open PRODUCTION session
  custom_order_id TEXT REFERENCES custom_orders(id),   -- O-4
  batches REAL NOT NULL CHECK (batches > 0),
  output_item_id TEXT NOT NULL REFERENCES items(id),   -- denormalized from recipe at commit
  actual_output_qty INTEGER NOT NULL CHECK (actual_output_qty > 0),
  indirect_cost INTEGER NOT NULL DEFAULT 0,      -- centavos, run-specific extras
  allocated_session_cost INTEGER NOT NULL DEFAULT 0,   -- centavos (S-3, recomputed on session close)
  direct_cost INTEGER NOT NULL DEFAULT 0,        -- centavos, derived C-4
  total_cost INTEGER NOT NULL DEFAULT 0,         -- centavos, derived C-4
  notes TEXT, deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE production_consumptions (           -- ACTUAL consumption (recipe is only the default)
  id TEXT PRIMARY KEY,
  production_run_id TEXT NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),
  qty INTEGER NOT NULL CHECK (qty > 0),          -- milli-units
  unit_cost_snapshot_mc INTEGER NOT NULL         -- WAC at commit, milli-centavos per whole unit
);

-- PENDING (Phase 3.2, KOK-122/KOK-124). The Envasado/Armado event (UC-21, C-10). Structurally a
-- twin of production_runs, deliberately: same template-vs-actuals split, same frozen snapshots,
-- same replay/edit/delete framework. The differences are that it consumes FINISHED and PACKAGING,
-- and that it moves NO cash — there is no account_id, no indirect cost and no allocated session
-- cost anywhere in this table, and that absence is normative (C-10), not an omission.
CREATE TABLE assemblies (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL, business_date TEXT NOT NULL,
  definition_id TEXT REFERENCES assembly_definitions(id),  -- NULLable, same rationale as
                                                 -- production_runs.recipe_id: a one-off bundle
                                                 -- needs no reusable definition
  session_id TEXT NOT NULL REFERENCES sessions(id),   -- required (Doc 03 S-1), PRODUCTION type
  custom_order_id TEXT REFERENCES custom_orders(id),  -- same per-order costing role as O-4
  output_item_id TEXT NOT NULL REFERENCES items(id),  -- FINISHED; denormalized from the definition
  planned_output_qty INTEGER CHECK (planned_output_qty > 0),  -- milli-units, informative
  actual_output_qty INTEGER NOT NULL CHECK (actual_output_qty > 0),  -- absorbs breakage (C-10)
  direct_cost INTEGER NOT NULL DEFAULT 0,        -- centavos, derived C-10
  notes TEXT, deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE assembly_consumptions (             -- ACTUAL components (definition is only the default)
  id TEXT PRIMARY KEY,
  assembly_id TEXT NOT NULL REFERENCES assemblies(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),
  qty INTEGER NOT NULL CHECK (qty > 0),          -- milli-units
  unit_cost_snapshot_mc INTEGER NOT NULL         -- WAC at commit, milli-centavos per whole unit
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT, notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL, business_date TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('CATALOG','CUSTOM_ORDER')),
  custom_order_id TEXT REFERENCES custom_orders(id),
  customer_id TEXT REFERENCES customers(id),
  session_id TEXT REFERENCES sessions(id),       -- delivery run
  total INTEGER NOT NULL,
  payment_status TEXT NOT NULL CHECK (payment_status IN ('PAID','ON_CREDIT')),
  paid_at TEXT,                                  -- set when receivable collected (UC-04)
  payment_method TEXT CHECK (payment_method IN ('CASH','BANK_QR')),
  account_id TEXT REFERENCES financial_accounts(id),   -- required when PAID
  notes TEXT, deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE sale_lines (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),    -- FINISHED ONLY (service-enforced). Phase 3.2
                                                 -- (KOK-126) removes the PACKAGING allowance
                                                 -- KOK-100 introduced, resolving this file's
                                                 -- long-standing contradiction with §5 in favour
                                                 -- of §5. Packaging is consumed by an Assembly
                                                 -- (C-10), never by a sale; presentations and
                                                 -- combos ARE FINISHED items and are the thing sold
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price_mc INTEGER NOT NULL,                -- milli-centavos per whole unit (editable vs list price)
  unit_cost_snapshot_mc INTEGER NOT NULL         -- WAC at sale → per-line margin forever
);

CREATE TABLE custom_orders (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN
    ('QUOTING','CONFIRMED','IN_PRODUCTION','READY','DELIVERED','CANCELLED')),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  description TEXT NOT NULL,                     -- free text of the request
  agreed_total INTEGER,                          -- centavos; required to confirm
  deposit_required INTEGER,                      -- centavos, default = 50% of agreed_total
  deposit_paid INTEGER NOT NULL DEFAULT 0,
  deposit_tx_id TEXT REFERENCES financial_transactions(id),
  delivery_date TEXT, delivery_place TEXT,
  sale_id TEXT REFERENCES sales(id),             -- set on delivery (O-2)
  cancel_resolution TEXT CHECK (cancel_resolution IN ('REFUND','FORFEIT')),
  notes TEXT, deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE custom_order_lines (                -- what will be delivered (item-linked or free text)
  id TEXT PRIMARY KEY,
  custom_order_id TEXT NOT NULL REFERENCES custom_orders(id) ON DELETE CASCADE,
  item_id TEXT REFERENCES items(id),             -- NULL for one-off creations
  description TEXT,                              -- required when item_id IS NULL
  qty INTEGER NOT NULL DEFAULT 1000,             -- milli-units
  line_total INTEGER                             -- centavos share of agreed_total (optional)
);

CREATE TABLE stock_exits (                       -- non-commercial exits (UC-09)
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL, business_date TEXT NOT NULL,
  item_id TEXT NOT NULL REFERENCES items(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  reason TEXT NOT NULL CHECK (reason IN
    ('WASTE','SELF_CONSUMPTION','GIFT_SAMPLE','SPOILAGE','OTHER')),
  unit_cost_snapshot_mc INTEGER NOT NULL,        -- WAC at exit, milli-centavos per whole unit (C-6)
  session_id TEXT REFERENCES sessions(id),       -- stays optional (Doc 03 S-1 requires a session
                                                 -- only for purchases, production and assemblies)
  notes TEXT, deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- PENDING (Phase 3.2, KOK-128). Optional packaging physically consumed by an exit of an
-- UNASSEMBLED product (gifting an unbagged loaf inside a bag with a label). Modelled as a child
-- table rather than converting stock_exits into a header+lines event: the exit is conceptually of
-- one product, and rewriting a live event vertical — its replay, edit/delete and UI — for an
-- infrequent case is not worth it. Never populated for an exit of an assembled presentation: its
-- WAC already contains its packaging, and adding lines would deduct the same bottle twice.
CREATE TABLE stock_exit_packaging_lines (
  id TEXT PRIMARY KEY,
  stock_exit_id TEXT NOT NULL REFERENCES stock_exits(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),    -- PACKAGING only (service-enforced)
  qty INTEGER NOT NULL CHECK (qty > 0),          -- milli-units
  unit_cost_snapshot_mc INTEGER NOT NULL         -- WAC at exit (C-6), same treatment as the main line
);

CREATE TABLE inventory_counts (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL, business_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','COMMITTED')),
  notes TEXT, deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE inventory_count_lines (
  id TEXT PRIMARY KEY,
  count_id TEXT NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),
  expected_qty INTEGER NOT NULL,                 -- snapshot at count time
  counted_qty INTEGER NOT NULL,
  UNIQUE (count_id, item_id)
);
```

### 3.4 Derived ledgers

```sql
CREATE TABLE stock_movements (                   -- THE KARDEX (system-owned, INV-9)
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL, business_date TEXT NOT NULL,
  item_id TEXT NOT NULL REFERENCES items(id),
  type TEXT NOT NULL CHECK (type IN
    ('PURCHASE_IN','PRODUCTION_IN','PRODUCTION_OUT','SALE_OUT','EXIT_OUT','ADJUST','OPENING_IN',
     'ASSEMBLY_IN','ASSEMBLY_OUT')),
    -- OPENING_IN: opening-balance entry from an item's first positive count line (C-8, KOK-084);
    -- a WAC entry type like PURCHASE_IN/PRODUCTION_IN, not a correction like ADJUST
    -- ASSEMBLY_OUT / ASSEMBLY_IN (Phase 3.2, KOK-122, C-10): components out, finished
    -- presentation/combo in. ASSEMBLY_IN is a WAC ENTRY type — it takes part in C-1's fold and in
    -- R-2's replay exactly like PURCHASE_IN/PRODUCTION_IN/OPENING_IN. The two always appear
    -- together in one batch and their total_cost sums to zero: an assembly moves value, never
    -- creates or destroys it, which is a cheap and load-bearing test assertion
  qty INTEGER NOT NULL,                          -- signed milli-units (+in / −out)
  unit_cost_mc INTEGER NOT NULL,                 -- milli-centavos per whole unit at movement time
  total_cost INTEGER NOT NULL,                   -- centavos, signed via totalCentavos(unit_cost_mc, qty)
  source_event_type TEXT NOT NULL,               -- 'purchase'|'production_run'|'assembly'|'sale'|'stock_exit'|'inventory_count'
  source_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE item_stock (                        -- denormalized current stock (INV-5)
  item_id TEXT PRIMARY KEY REFERENCES items(id),
  qty_on_hand INTEGER NOT NULL DEFAULT 0,        -- signed milli-units (INV-8: may be negative)
  negative_since TEXT,                           -- reconciliation flag
  updated_at TEXT NOT NULL
);

CREATE TABLE financial_accounts (
  id TEXT PRIMARY KEY,                           -- seed: 'acc_bank', 'acc_cash'
  name TEXT NOT NULL,                            -- "Cuenta Banco", "Caja chica"
  type TEXT NOT NULL CHECK (type IN ('BANK','CASH')),
  opening_balance INTEGER NOT NULL DEFAULT 0,
  balance INTEGER NOT NULL DEFAULT 0,            -- derived (INV-5)
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE financial_transactions (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL, business_date TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  type TEXT NOT NULL CHECK (type IN ('INCOME','EXPENSE','TRANSFER_IN','TRANSFER_OUT')),
  category TEXT NOT NULL CHECK (category IN
    ('SALE','ORDER_DEPOSIT','ORDER_BALANCE','DEBT_COLLECTION','OTHER_INCOME',
     'SUPPLY_PURCHASE','OPERATING_EXPENSE','EQUIPMENT','DEPOSIT_REFUND',
     'OWNER_WITHDRAWAL','TRANSFER','OTHER_EXPENSE')),
  amount INTEGER NOT NULL CHECK (amount > 0),    -- always positive; direction from `type`
  counterpart_tx_id TEXT REFERENCES financial_transactions(id),  -- transfer pairing (UC-12)
  source_event_type TEXT, source_event_id TEXT,  -- NULL for standalone tx (UC-11/12/13)
  description TEXT, deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE costing_adjustments (       -- R-4: cumulative P&L correction from a backdated
                                          -- WAC replay (ADR-016); never rewrites frozen snapshots
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL, business_date TEXT NOT NULL,  -- date of the CORRECTION, not of the
                                                            -- backdated event that triggered it
  item_id TEXT NOT NULL REFERENCES items(id),
  trigger_event_type TEXT NOT NULL CHECK (trigger_event_type IN
    ('purchase','production_run','assembly','stock_exit','session','sale')), -- KOK-024: a backdated exit
                                          -- changes on-hand, which changes C-1's max(on_hand,0)
                                          -- weight for every later entry — so an exit CAN move
                                          -- downstream WAC and that correction must be bookable.
                                          -- KOK-028: closing a PRODUCTION session (S-3) can
                                          -- recompute several production runs'
                                          -- allocated_session_cost/output cost at once, so the
                                          -- trigger is the session, not one run. KOK-064: a sale
                                          -- is stock-wise identical to a stock exit (SALE_OUT), so
                                          -- a backdated sale can move downstream WAC exactly as a
                                          -- backdated exit does. Phase 3.2 (KOK-122): an assembly
                                          -- is simultaneously an exit (its components) and an
                                          -- entry (the presentation), so it can move WAC in both
                                          -- directions and propagate downstream through the
                                          -- assembly-definition graph (R-2 amendment)

  trigger_event_id TEXT NOT NULL,        -- the create/edit/delete that triggered the replay
  affected_sale_line_ids TEXT NOT NULL,  -- JSON array of sale_lines.id, for UI drill-down
  affected_stock_exit_ids TEXT NOT NULL, -- JSON array of stock_exits.id
  cost_delta INTEGER NOT NULL,           -- centavos, signed: negative = accumulated margin fell
  created_at TEXT NOT NULL
);
```

No `affected_production_run_ids` column: the row is keyed to one `item_id`, and until production
runs exist (KOK-026) no replay ever touches one — the impact-preview DTO (`packages/shared/src/
costing.ts`'s `ReplayImpactDto`) already carries `affectedProductionRunIds` for the day it does,
but persisting them here is deferred to KOK-026 rather than added speculatively now.

Deposit liability is derived, not a table:
`customer_deposits = Σ deposits received − Σ released/refunded`, computed from ORDER_DEPOSIT /
DEPOSIT_REFUND transactions and delivered orders; exposed via view `v_liability` and snapshotted
daily.

### 3.5 System & observability

```sql
CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- JSON values
-- keys: min_margin_pct(bp), default_deposit_pct(bp), timezone, alert_hour,
--       negative_stock_alert(bool), backup_retention_days,
--       ai_model_text, ai_model_audio, ai_model_transcribe (Doc 05 §1.1)

CREATE TABLE daily_snapshots (
  business_date TEXT PRIMARY KEY,
  stock_value INTEGER NOT NULL,                  -- Σ qty_on_hand×wac (centavos)
  bank_balance INTEGER NOT NULL, cash_balance INTEGER NOT NULL,
  accounts_receivable INTEGER NOT NULL,
  customer_deposits INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('OWNER_WEB','OWNER_TELEGRAM','ASSISTANT','SYSTEM')),
  action TEXT NOT NULL,                          -- 'create'|'update'|'delete'|'costing_repair'|...
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  before_json TEXT, after_json TEXT
);

CREATE TABLE assistant_interactions (            -- Doc 05 §8
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('TELEGRAM','WEB')),
  pipeline TEXT NOT NULL CHECK (pipeline IN ('CAPTURE','QUERY')),
  user_input TEXT NOT NULL,                      -- text or voice transcript; raw audio/images never persisted (A-6)
  model TEXT NOT NULL,                           -- model id actually used (configurable, Doc 05 §1.1)
  tool_calls_json TEXT,                          -- [{name, input, ms, ok}]
  draft_json TEXT,                               -- proposed event (CAPTURE)
  outcome TEXT CHECK (outcome IN ('ACCEPTED','EDITED','REJECTED','ANSWERED','FAILED')),
  edited_fields_json TEXT,                       -- which fields the owner corrected
  input_tokens INTEGER, output_tokens INTEGER, latency_ms INTEGER,
  error TEXT
);

CREATE TABLE job_runs (
  id TEXT PRIMARY KEY, job TEXT NOT NULL, started_at TEXT NOT NULL,
  finished_at TEXT, ok INTEGER, detail TEXT
);

CREATE TABLE telegram_updates (update_id INTEGER PRIMARY KEY, at TEXT NOT NULL);  -- INV-2 dedupe
CREATE TABLE idempotency_keys (key TEXT PRIMARY KEY, at TEXT NOT NULL, response_json TEXT);

CREATE TABLE pending_drafts (                    -- one active AI draft per Telegram chat (Doc 05 §6)
  chat_id TEXT PRIMARY KEY,
  draft_json TEXT NOT NULL,                      -- validated Command DTO + event type
  interaction_id TEXT REFERENCES assistant_interactions(id),
  expires_at TEXT NOT NULL                       -- TTL 30 min, swept by daily job
);
```

## 4. Views (created as SQL views in migrations)

| View | Definition (essence) |
|------|----------------------|
| `v_stock` | items ⨝ item_stock + `stock_value = round(qty_on_hand × wac_mc / 1e6)`, low-stock flag. Also selects `replacement_cost_updated_at` (migration 0016) so `core/inventory/queries.ts`'s `listStock` can apply the same C-3c effective-replacement-cost fallback `toItemDto`/`price-health.ts` already do — the view exposes the raw column plus timestamp only, the fallback projection itself happens in `queries.ts`, not in SQL (same precedent as `v_price_health` below). |
| `v_kardex` | stock_movements ⨝ items, ordered, with running balance via window function |
| `v_price_health` | FINISHED items: id, name, sale_price_mc, wac_mc, replacement_cost_mc, replacement_cost_updated_at. Raw columns only — margins, the C-3c effective-replacement-cost fallback, and the alert-suppression rule are all computed in `core/costing/price-health.ts` (KOK-035, KOK-103), not in this view; the former SQL margin columns were removed in migration 0006 because they mixed per-whole-unit prices with per-milli-unit costs. |
| `v_receivables` | sales WHERE payment_status='ON_CREDIT' AND deleted_at IS NULL, aged; `total` = **uncollected remainder**, i.e. `sales.total − custom_orders.deposit_paid` for a CUSTOM_ORDER sale (KOK-033, migration 0005) and plain `sales.total` otherwise |
| `v_liability` | current customer_deposits (see §3.4) |
| `v_cashflow_daily` | financial_transactions grouped by business_date × category |
| `v_session_hours` | sessions with derived hours + linked event counts. Per-session hours only — S-5's **deduplicated** wall-clock total (the union of overlapping session intervals, for G3) is computed by a pure function in `core/`, not here, following the same rule as the business-health aggregates below: interval-union arithmetic belongs where property tests can reach it. |
| `v_waste` | stock_exits valued, grouped by reason × month |

**Business-health aggregates are NOT views.** Every metric in Phase 5.5 (money at risk, input
cost index, contribution Pareto, Bs/h per product, real-vs-nominal position) is computed by a
pure function in `core/` over a scoped query, following the KOK-035 precedent: the margin math
that a view got wrong for six migrations is the same math these metrics need, and it belongs
where it can be property-tested (Doc 11 §2) and unit-typed (ADR-017), not in SQL where a scale
error is invisible. Views stay for row-shaping and joins; they do no margin arithmetic.

## 5. Integrity beyond DDL (service-enforced, tested)

- Sale lines only reference `kind='FINISHED'` items — presentations and combos included, PACKAGING
  never (Phase 3.2, KOK-126; §3.3's column comment now agrees with this rule instead of
  contradicting it). Recipe output must not be RAW_MATERIAL; production consumption items must not
  be FINISHED **unless** flagged rework (v1: forbidden).
- **Assembly definitions** (Phase 3.2, KOK-123): `output_item_id` must be `FINISHED` with unit
  `UNIT`; line items must be `SEMI_FINISHED`, `FINISHED` or `PACKAGING` (never `RAW_MATERIAL` —
  raw inputs belong to a recipe, and never `isUnmetered`); and a definition **must not reach its
  own output item** through any chain of definition lines. Unlike the recipe self-reference rule
  below, this is blocked at save time including transitive cycles, because C-3d's rollup and R-2's
  replay both walk this graph and would not terminate on a cycle.
- **Assembly consumption** must consume what the event actually used, not what the definition said:
  the definition prefills and the lines stay editable before commit, exactly like a recipe and a
  production run. `actual_output_qty` may differ from `planned_output_qty` and absorbs the whole
  cost (C-10).
- An **assembly writes no `financial_transactions` row** under any circumstance, and the sum of its
  `stock_movements.total_cost` (ASSEMBLY_OUT negative + ASSEMBLY_IN positive) is exactly zero.
  Both are asserted by the integration suite (Doc 11 §3).
- **Future business dates are rejected** across every event command (Phase 3.2, KOK-138): a
  transaction posts immediately and moves today's balance, so accepting a future date would
  promise a scheduling behaviour the system does not have. Backdating stays fully supported
  (that is what R-2/R-5 exist for).
- **A recipe line must not reference its own recipe's `output_item_id`** (`recordRecipe`/
  `updateRecipe`'s `validateRecipeItemKinds`, KOK-029 amendment): a direct self-reference always
  makes the C-3 recipe graph cyclical, so `planReplacementCostRefresh`'s `topoOrderAffectedItems`
  refuses the ENTIRE nightly/on-demand refresh with a 409 — not just for the offending item, for
  every SEMI_FINISHED/FINISHED item downstream of it — leaving `replacement_cost_mc` stuck at 0 for
  the whole catalog until a human notices and fixes the recipe. Recurring-input scenarios (e.g. a
  sourdough starter "fed" with a portion of itself) are not modeled recursively in v1: cost such a
  recipe using only its non-self ingredients, or track the reused portion as a separate line item.
  Deeper multi-item cycles (A's recipe uses B, B's recipe uses A) are not blocked at save time —
  they still surface later as the same refresh-time 409.
- `purchases.total = Σ purchase_lines.line_total`; `sales.total = Σ qty×unit_price_mc / 1e6` (recomputed
  server-side, client values ignored).
- `custom_orders` transitions only along the state machine (O-1…O-3, **and O-6's backward
  transitions** — Phase 3.2, KOK-136). There is no generic "update order" command and no
  soft-delete/restore pair: `CANCELLED` is the terminal "this didn't happen" state and is never
  reopened. `DELIVERED` is terminal in the forward direction but reachable backwards exactly once,
  through `undoDelivery` (O-6), which is a distinct guarded command — not a status write.
- **Every `custom_order_lines` row must carry an `item_id` before the order may be DELIVERED**
  (KOK-033). Item-less free-text lines are legal while QUOTING, but `sale_lines.item_id` is NOT
  NULL and FINISHED-only and `sales.total` is recomputed from those lines, so a delivery with an
  unlinked line could not produce a sale equal to `agreed_total` without either inventing revenue
  no line backs or skipping the `SALE_OUT` for goods that really shipped (drifting `item_stock`
  upward forever, INV-5, since O-4's ProductionRun already booked the matching PRODUCTION_IN).
  `deliverOrder` therefore refuses with a 409 until every line is linked. **Amendment (KOK-034):**
  the ONE narrow exception to "no generic update order" is `resolveOrderLine`, which attaches a
  catalog item to a single line's `item_id` (leaving `description`/`qty`/`line_total` untouched) —
  legal on any non-terminal order (same set `cancelOrder` accepts), so the Orders board can resolve
  a free-text line before delivery without a general-purpose line editor.
- `agreed_total` is split across the delivered sale's lines by the largest-remainder method
  (`allocateAgreedTotalToOrderLines`): lines carrying an explicit `line_total` are pinned, the rest
  share what is left weighted by `qty`, and `Σ(qty × unit_price_mc / 1e6)` must reproduce `agreed_total` to
  the centavo (D-5) — otherwise the delivery is refused rather than rounded.
- The sale created by a delivery is owned by its order: `core/sales`' update/delete refuse
  (409 CONFLICT) for any `channel='CUSTOM_ORDER'` sale, since editing it would desynchronize
  `custom_orders.sale_id`/`agreed_total` and rewrite the order's `ORDER_BALANCE` transaction.
  This refusal is **not** relaxed by O-6: `orders.undoDelivery` does not call `updateSale` /
  `deleteSale` at all — it emits its own reversal statements from `core/orders`, the module that
  owns the sale, in the same batch that clears `sale_id` and flips the status. Restoring the
  deposit liability needs no row: `v_liability` is derived and resumes counting the order the
  moment its status leaves `DELIVERED`. `undoDelivery` refuses (409) if the sale has since been
  collected — `collectPayment` does not go through this guard and can add cash rows the delivery
  never wrote.
- A DRAFT `inventory_counts` row may be **deleted** (soft, audit-reversible) — that is what
  "cancel a count" means (Phase 3.2, KOK-141). No `CANCELLED` value is added to the status CHECK: a
  count that never committed produced no movements and has nothing to report as a state.
- **One OPEN session per `type` at a time, hard-enforced** by `ux_sessions_open_per_type` (§3.2,
  Phase 3.2/KOK-130). This supersedes the previous soft "warn, allow override" rule. Sessions of
  different types may overlap; the resulting double-counted hours are handled by S-5's
  deduplicated wall-clock union, not by forbidding the overlap.
- `financial_transactions` with `source_event_id` are system-owned: not editable directly (edit
  the source event instead) — the owning SERVICE may still rewrite them as part of its own
  transitions, which is how O-3's FORFEIT recategorizes a deposit row in place.

## 6. Indexes

```sql
CREATE INDEX ix_movements_item_date ON stock_movements(item_id, business_date);
CREATE INDEX ix_movements_source ON stock_movements(source_event_type, source_event_id);
CREATE INDEX ix_tx_account_date ON financial_transactions(account_id, business_date);
CREATE INDEX ix_tx_source ON financial_transactions(source_event_type, source_event_id);
CREATE INDEX ix_tx_category_date ON financial_transactions(category, business_date);
CREATE INDEX ix_sales_date ON sales(business_date);
CREATE INDEX ix_sales_status ON sales(payment_status) WHERE payment_status='ON_CREDIT';
CREATE INDEX ix_purchases_date ON purchases(business_date);
CREATE INDEX ix_runs_date ON production_runs(business_date);
CREATE INDEX ix_runs_order ON production_runs(custom_order_id);
CREATE INDEX ix_assemblies_date ON assemblies(business_date);              -- Phase 3.2
CREATE INDEX ix_assemblies_order ON assemblies(custom_order_id);           -- Phase 3.2
CREATE INDEX ix_assembly_def_lines_item ON assembly_definition_lines(item_id);
  -- ^ the reverse edge R-2's replay walks: "which definitions consume this item?"
CREATE INDEX ix_orders_status_date ON custom_orders(status, delivery_date);
CREATE INDEX ix_exits_date ON stock_exits(business_date);
CREATE INDEX ix_costing_adj_item_date ON costing_adjustments(item_id, business_date);
CREATE INDEX ix_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX ix_ai_at ON assistant_interactions(at);
```

## 7. Seed data (first migration)

- `financial_accounts`: `acc_bank` ("Cuenta Banco", BANK), `acc_cash` ("Caja chica", CASH).
- `app_settings` defaults: `min_margin_pct=3000`, `default_deposit_pct=5000`,
  `timezone="America/La_Paz"`, `alert_hour=7`, `backup_retention_days=30`,
  `ai_model_text="gpt-5.5"`, `ai_model_audio="gpt-realtime-whisper"`,
  `ai_model_transcribe="gpt-4o-transcribe"`.
- Dev/staging only: fixture catalog (masa madre starter, harina, leche, kéfir, pan de masa
  madre, rollos de canela, cuñapés, queso crema de kéfir, ghee, cajas, etiquetas) with recipes —
  used by tests and demos.
  - **Phase 3.2 amendments (KOK-110, KOK-111, KOK-129).** `Agua` is priced at 0.00231 Bs/L
    (representable at the 5-decimal input ceiling). The catalog is ordered by kind
    (RAW_MATERIAL → SEMI_FINISHED → FINISHED → PACKAGING). Kéfir is reclassified for the
    Presentation/Combo model: **Kéfir natural a granel** as the bulk base plus **Kéfir natural
    500 ml** and **Kéfir natural 1 L** as presentations (FINISHED, unit `UNIT`, own price and
    stock) with their assembly definitions, and a **Desayuno Kokoro** combo so the flagship case is
    exercisable end to end. The onboarding *template* ships every FINISHED item with
    `sale_price_mc` **empty** — the wizard requires the owner to type each price before the catalog
    can be saved, so the price is her decision and not a number the system suggested (this does not
    relax KOK-096's rule that FINISHED items require a price; it moves where the requirement is
    met). Both fixture sources — the onboarding template and the dev/staging SQL seed — stay in
    sync. Staging is wiped and re-seeded when this lands: the pre-assembly catalog shape is not
    migrated forward.

## 8. Migration policy

Sequential numbered SQL migrations (`0001_init.sql`, …) applied by `wrangler d1 migrations apply`
in CI before deploy. Expand → migrate → contract; never edit an applied migration. Every
migration ships with a corresponding update to this document in the same PR (Doc 08 rule D-6).

**Generation workflow (amended during KOK-005):** `apps/worker/src/db/schema.ts` is the base for
`drizzle-kit generate`, which produces the table/index/CHECK-constraint DDL. Two things
`drizzle-kit` cannot express are appended by hand to the generated file afterward, in this fixed
order: (1) the `CREATE VIEW` statements of §4 — Drizzle's SQLite dialect does not model window
functions or partial-aggregate views; (2) the seed `INSERT`s of §7. One additional column
attribute is hand-patched post-generation: `item_aliases.alias` needs `COLLATE NOCASE` (§3.1),
which this drizzle-orm version's `text()` builder cannot emit. `schema.ts` carries a comment at
that column pointing back to the patch. Anyone regenerating a future migration from a changed
`schema.ts` must reapply these three additions to the new file — `drizzle-kit generate` alone is
not sufficient for a from-scratch migration in this schema.
