# 04 — Data Model

Target: **Cloudflare D1 (SQLite)**, managed with Drizzle ORM migrations. This document is the
authoritative **target** schema; Drizzle definitions in `apps/worker/src/db/schema.ts` MUST mirror
the applied-migration version 1:1 at every deployed step. KOK-204's independent finance association
and ORDER_REFUND category are implemented by migration 0026; KOK-205…208 remain target work and are
not assertions about the current database.

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

-- KOK-073 (migration 0023): erosion series for G2.
CREATE TABLE replacement_cost_history (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  replacement_cost_mc INTEGER NOT NULL,          -- milli-centavos per whole unit
  observed_at TEXT NOT NULL,                     -- ISO-8601 UTC, = items.replacement_cost_updated_at
  business_date TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('PURCHASE','NIGHTLY','MANUAL'))
);
-- Append-only. KOK-029's refresh writes ONLY when the recomputed value differs from the live one
-- (no row per no-op run); purchase-driven writes and genuine owner-entered MANUAL costs write at
-- the same time as items.replacement_cost_updated_at. The deliberate C-3c unset sentinel
-- (replacement_cost_mc=0 with replacement_cost_updated_at IS NULL), including catalog creation
-- without an explicit cost and clearing a manual cost, is not an observation and is not logged.
-- Never edited, never soft-deleted: it is an observation log, not a business event, so INV-10 does
-- not apply. This table exists because the series cannot be backfilled — see KOK-073.
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
  custom_order_id TEXT REFERENCES custom_orders(id), -- KOK-204/migration 0026; optional cost/cash association
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
  session_id TEXT REFERENCES sessions(id),       -- optional work session; no automatic provider session
  total INTEGER NOT NULL,                        -- centavos; product lines + additional_charge
  additional_charge INTEGER NOT NULL DEFAULT 0 CHECK (additional_charge >= 0),
                                                   -- customer charge snapshot (KOK-205 migration)
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
  agreed_total INTEGER,                          -- centavos; agreed merchandise subtotal, required to confirm
  additional_charge INTEGER NOT NULL DEFAULT 0 CHECK (additional_charge >= 0), -- KOK-205 migration
  deposit_required INTEGER,                      -- centavos, suggested default = 50%; zero is allowed
  deposit_paid INTEGER NOT NULL DEFAULT 0,         -- zero means no deposit was received
  deposit_tx_id TEXT REFERENCES financial_transactions(id), -- NULL when confirmed with zero deposit
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
-- Count response DTOs join each line to the current `items.name` and canonical `items.unit`.
-- These are read-time identity fields, not additional snapshots; only `expected_qty` is frozen.
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
      'SUPPLY_PURCHASE','OPERATING_EXPENSE','EQUIPMENT','DEPOSIT_REFUND','ORDER_REFUND',
     'OWNER_WITHDRAWAL','TRANSFER','OTHER_EXPENSE')),
  amount INTEGER NOT NULL CHECK (amount > 0),    -- always positive; direction from `type`
  counterpart_tx_id TEXT REFERENCES financial_transactions(id),  -- transfer pairing (UC-12)
  source_event_type TEXT, source_event_id TEXT,  -- NULL for standalone tx (UC-11/12/13)
  custom_order_id TEXT REFERENCES custom_orders(id), -- KOK-204/migration 0026; independent of source
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

An order MAY be confirmed with `deposit_paid = 0`; that confirmation writes no ORDER_DEPOSIT row and
does not affect account balances or deposit liability. The explicit no-deposit risk acknowledgment
is validated by `orders.confirm` and recorded in its audit row; it is not a stored balance or a new
column. The existing nullable `deposit_tx_id` and zero-default `deposit_paid` support this case, so
no schema migration is required for zero-deposit confirmation.

Deposit liability is derived, not a table:
`customer_deposits = Σ deposits received − Σ released/refunded`, computed from ORDER_DEPOSIT /
DEPOSIT_REFUND transactions and delivered orders; exposed via view `v_liability` and snapshotted
daily.

### 3.4.1 Target order-independent cash model (KOK-204…208; supersedes the payment-coupled parts above)

The DDL in §3.3–3.4 is the **target logical schema**, not a claim that migrations through 0026
already implement every column: KOK-204's order associations and ORDER_REFUND category are applied
in migration 0026, while KOK-205's additional-charge columns are not yet implemented. The previously
proposed `sales.delivery_fee` was never migrated or added to Drizzle. The following is the target
derivation/migration contract. ADR-022 supersedes ADR-012's order-state-dependent liability
mechanism. Ship remaining schema changes in **new forward-only migrations**; never rewrite applied
migrations.

- KOK-205 adds `custom_orders.additional_charge INTEGER NOT NULL DEFAULT 0 CHECK (additional_charge >= 0)`
  and `sales.additional_charge INTEGER NOT NULL DEFAULT 0 CHECK (additional_charge >= 0)` in
  its own forward migration with matching shared command, order UI and Drizzle definitions;
  do not add DB-only unused charge fields in KOK-204. No `sales.delivery_fee` column exists in
  deployed migrations, so do not migrate from or depend on it.
  `agreed_total` remains the merchandise subtotal. A generated CUSTOM_ORDER sale snapshots both:
  `sales.total = agreed_total + additional_charge` and
  `sales.additional_charge = custom_orders.additional_charge` (a separately disclosed
  customer charge, NOT an amount constrained to equal provider expense). Catalog sales keep zero.
  No additional-charge transaction is generated by delivery; a customer payment is a separate
  receipt. Change the fee's descriptive naming in DTO/UI where necessary without duplicating the
  stored amount. Once delivered, the order agreement/charge are immutable until undo.
- KOK-204 adds `financial_transactions.custom_order_id TEXT REFERENCES custom_orders(id)` and the
  `ix_tx_custom_order_date` index on `(custom_order_id, business_date, id)` in migration 0026. This
  **association** is separate from
  `source_event_type/id`: manual receipts/refunds/other expenses have a NULL source and an order ID,
  and therefore keep their own code/editability; purchase-owned expenses keep their purchase source
  and may also carry an order ID, remaining editable only through the purchase service. Do not
  use a PED display code as a foreign key. Add nullable `purchases.custom_order_id` and maintain
  the same order ID on its derived SUPPLY_PURCHASE transaction within the owning purchase batch;
  edits/soft-deletes/restores keep the association and account/stock invariants consistent.
  The order relationship is set when a finance command is launched from `/orders/:id` (KOK-208),
  not by selecting or reassigning an order in a Finance form. Finance lists the relationship
  and may edit non-link fields of manual rows; to correct a wrongly associated row, soft-delete
  it and capture the corrected event from the right order page. Provider delivery costs are
  ordinary manual order-linked expenses (multiple allowed), not
  autogenerated DELIVERY_RUN costs; a user-created session can still be independently linked if
  recorded for actual work. Never turn a source-owned row into a manual row to enable editing.
- KOK-204 migration 0026 adds `ORDER_REFUND` to the transaction category CHECK/shared enum, allowed only for manual
  EXPENSE with an order ID. Permit manual INCOME/`ORDER_DEPOSIT` and INCOME/`ORDER_BALANCE` only
  with an order ID; existing `OTHER_INCOME`, `OPERATING_EXPENSE`, `OTHER_EXPENSE` and purchase
  categories preserve their meanings. The code-allocation trigger must assign `ING` to manual
  order receipts and `GTO` to manual ORDER_REFUND; source-owned rows retain NULL code and
  their source reference. Rebuild the CHECK-bearing SQLite table safely if ALTER cannot
  change the constraint; preserve IDs, timestamps, transfer pair FKs/codes, partial unique indexes,
  triggers and all existing account balances. Validate the rebuild on D1/SQLite with
  `foreign_key_check` across the circular order/deposit and transfer references; never silently
  drop an FK, index or trigger to make the rebuild pass. Code allocation is still atomic and never
  rewrites a historical code. No new package dependency.
- `deposit_paid` and `deposit_tx_id` are **old-model fields** after cutover; do not use them as the
  accounting read source. A forward migration may leave the columns nullable/untouched while all
  new order commands stop writing them; reset disposable test data before cutover. Do not drop
  either in a migration that would require a fragile circular-FK table rebuild.
  `cancel_resolution` is likewise no longer a prerequisite for cancellation. Keep the stored sale payment status for catalog
  sales; new order sales are operational sale/stock snapshots and must not drive receivables or
  cash. Until a safe sale-table rebuild removes the legacy NOT NULL payment-status constraint,
  write generated order sales with `payment_status='ON_CREDIT'` solely as a compatibility value,
  `paid_at/payment_method/account_id=NULL`, regardless of actual receipts. Never display this
  value as an order payment state or allow `collectPayment` on CUSTOM_ORDER sales.
- **No historical provider-session or order-cash backfill is required.** The app has only
  disposable test data, not production records; reset affected development/staging databases
  at the coordinated ADR-022 cutover. Do not change applied migration files or skip a schema
  migration merely because data is disposable. Keep fixture-based FK/trigger/account tests,
  but no special service for correcting source-owned test receipts and no session-to-order
  attribution logic. New cash commands link directly to the order ID; there is no session
  intermediary. During the KOK-204-only development interval, old order transitions may still
  create old-model test rows until KOK-205 replaces them; do not treat those rows as target data.
- Derive order receipts from **active** (`deleted_at IS NULL`) linked manual INCOME rows in
  `ORDER_DEPOSIT` and `ORDER_BALANCE` only; exclude other income,
  purchase/provider expenses, refunds and unrelated sales. `expected = max(agreed_total +
  additional_charge - receipts, 0)` and `excess = max(receipts - agreed_total -
  additional_charge, 0)` in integer centavos; with NULL agreed_total both are NULL. A separate
  signed difference can support audit without discarding overpayments. Show expected only for
  active pre-delivery orders; expose **order receivables** only when status = DELIVERED and
  expected > 0; cancelled orders have none. The relevant sale must exist and be active for a
  delivered order, but its PAID/ON_CREDIT value is not the debt oracle. Debts for CATALOG sales
  continue to use their existing view/payment flow. Aggregate in set-based reads (no per-order
  query and no truncation at the board's page boundary); snapshot totals/alerts/dashboard all use
  the same derivation. For aging, use the delivered sale's business date; collecting partial
  amounts never resets the age. An order's refund does not increase expected/debt.
  KOK-205 introduces the reusable integer-centavo expected/excess calculation and an
  order-scoped receipt read for its pre-delivery agreement edit preview, using the draft
  merchandise subtotal plus draft additional charge. KOK-207 reuses that calculation for
  delivered-only order debt and aggregate consumers; do not derive a second formula in the web
  form or a divergent SQL expression for the order portion. The edit preview is not a stored receivable or a
  restriction on changing the agreement below receipts. Refresh after saving because
  independent finance edits can change the qualifying receipts without changing order fields.
- Replace the legacy `v_liability` formula that subtracts `deposit_paid` at delivery: report
  pre-delivery, non-cancelled order cash exposure from active order receipts net of explicit
  order refunds (`ORDER_REFUND`), floored at zero, without recategorizing any receipt. On undo it becomes
  pre-delivery exposure again; on cancellation it leaves that operational exposure measure even
  if cash remains in the account. Do not label this operational projection as a legally settled
  liability or as recognized revenue. Keep `v_cashflow_daily` tied to actual transaction dates
  and categories, unaffected by transitions. Document the historic daily-snapshot boundary so
  reports do not silently mix old and new projection definitions.
- Keep `v_receivables` for catalog sales and migrate the order portion to the derived order
  outstanding above, either by a carefully rebuilt union view with distinct sale/order keys or
  by separate scoped reads combined in `core/finance`. No double counting a CUSTOM_ORDER sale as
  both sale debt and order debt. Update the grouped receivables contract, daily snapshots, alerts,
  order DTOs and totals together; never leave a partially switched consumer in production.

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

### 3.6 Human-readable event codes (KOK-185, INV-12)

**Reverses a recorded decision.** An earlier pass of this KB (the original KOK-147 row, Doc 10)
concluded "no internal IDs are exposed — events have no short human code and the internal ones
are unreadable UUIDs, and inventing a code system was rejected as unnecessary." The owner hit the
exact problem that decision predicted would not matter (Issue #44 §B-4: a production session
rendering as the bare word "Producción," indistinguishable from every other session of that type)
— **the reversal is the correct call**, formats as `{PREFIX}-{NNNN}-{YYYY}` (4-digit zero-padded
sequence, then 4-digit year), and is now the system of record.

```sql
CREATE TABLE code_sequences (
  event_type TEXT NOT NULL,
  year TEXT NOT NULL,                            -- substr(created_at, 1, 4), never business_date
  next_seq INTEGER NOT NULL,
  PRIMARY KEY (event_type, year)
);
```

Every codeable table carries a nullable `code TEXT` column plus a `CREATE UNIQUE INDEX` (a
partial one, `WHERE type != 'TRANSFER_IN'`, on `financial_transactions` only — see below).
**Nullable, not `NOT NULL`, by deliberate design**: SQLite/D1 cannot add a `NOT NULL` column
without a default in one step, and the full drop/recreate-table rebuild that would (§8, migration
0022's precedent) is not worth it for a display convenience feature, not a money/correctness
invariant — see migration `0024_add_event_codes.sql`'s header for the full trade-off.

| Table / row class | `event_type` | prefix |
|---|---|---|
| `sessions` | `session` | `SES` |
| `production_runs` | `production_run` | `PRD` |
| `assemblies` | `assembly` | `ENV` |
| `sales` | `sale` | `VTA` |
| `purchases` | `purchase` | `CMP` |
| `custom_orders` | `custom_order` | `PED` |
| `inventory_counts` | `inventory_count` | `CNT` |
| `stock_exits` | `stock_exit` | `SAL` |
| `financial_transactions`, category IN (`OPERATING_EXPENSE`,`EQUIPMENT`,`OTHER_EXPENSE`) | `expense` | `GTO` |
| `financial_transactions`, category = `OTHER_INCOME` | `income` | `ING` |
| `financial_transactions`, manual `ORDER_DEPOSIT`/`ORDER_BALANCE` (KOK-204/migration 0026) | `income` | `ING` |
| `financial_transactions`, manual `ORDER_REFUND` (KOK-204/migration 0026) | `expense` | `GTO` |
| `financial_transactions`, category = `OWNER_WITHDRAWAL` | `withdrawal` | `RET` |
| `financial_transactions`, category = `TRANSFER` (both legs) | `transfer` | `TRF` |

**Manual vs. system-owned `financial_transactions`.** Only rows with `source_event_id IS NULL`
get a code, including newly captured manual order receipts/refunds. Existing source-owned
test rows (`SALE`, `SUPPLY_PURCHASE`, `DEBT_COLLECTION`, `ORDER_DEPOSIT`, `ORDER_BALANCE`,
`DEPOSIT_REFUND`) retain their NULL code until disposable data is reset at cutover; no second
display code is minted retroactively.

**Transfer pairs share one code.** `core/finance/transfer.ts` inserts both legs
(`TRANSFER_OUT`/`TRANSFER_IN`) with `counterpart_tx_id` still NULL, then links them via two
separate `UPDATE`s later in the same batch (that FK is not deferrable — see that file's header).
An `AFTER UPDATE OF counterpart_tx_id` trigger, scoped to `WHEN NEW.type = 'TRANSFER_OUT'`,
allocates one sequence number and writes it onto both rows once both exist — independent of which
of the two linking `UPDATE`s the caller runs first. The `ux_financial_transactions_code` unique
index is partial (`WHERE type != 'TRANSFER_IN'`) specifically to allow this: the IN leg's code is
a deliberate mirror of its OUT counterpart's, not a second independent identity competing for
uniqueness.

**Allocation mechanism (D-3 compliance).** A code is assigned by an `AFTER INSERT` (or, for
transfers, `AFTER UPDATE OF counterpart_tx_id`) SQLite trigger — not by `core/` itself — so it is
always written inside the same implicit transaction the triggering command's `db.batch()` already
wraps every statement in, and a rolled-back batch never burns a sequence number. `core/` never
computes a code and never reads `code_sequences` directly; every create path re-reads the
just-assigned `code` from its row after `db.batch()` completes (mirrors the existing
"re-read after the batch is the one answer that cannot disagree with what was written" pattern) and
folds it into the DTO it returns. See migration `0024_add_event_codes.sql`'s header for the full
reasoning, including why this needed a trigger where D1's batch API alone could not chain a
counter read into a same-batch `INSERT`'s bound value.

**Backfill.** Existing rows are assigned codes deterministically, ordered by `(created_at, id)` —
a total order — via `ROW_NUMBER()` (the same technique `0015_recipe_name_unique.sql` already
proved works against this project's D1). Re-running `db:reset:dev` against the same seed data
reproduces byte-identical codes.

**Immutability.** A code is assigned once and never reassigned — every trigger guards on `WHEN
NEW.code IS NULL`, which an already-coded row never satisfies again, and no `core/` `UPDATE`
statement ever includes `code` in its `SET` list.

## 4. Views (created as SQL views in migrations)

| View | Definition (essence) |
|------|----------------------|
| `v_stock` | items ⨝ item_stock + `stock_value = round(qty_on_hand × wac_mc / 1e6)`, low-stock flag. Also selects `replacement_cost_updated_at` (migration 0016) so `core/inventory/queries.ts`'s `listStock` can apply the same C-3c effective-replacement-cost fallback `toItemDto`/`price-health.ts` already do — the view exposes the raw column plus timestamp only, the fallback projection itself happens in `queries.ts`, not in SQL (same precedent as `v_price_health` below). |
| `v_kardex` | stock_movements ⨝ items, ordered, with running balance via window function |
| `v_price_health` | FINISHED items: id, name, sale_price_mc, wac_mc, replacement_cost_mc, replacement_cost_updated_at. Raw columns only — margins, the C-3c effective-replacement-cost fallback, and the alert-suppression rule are all computed in `core/costing/price-health.ts` (KOK-035, KOK-103), not in this view; the former SQL margin columns were removed in migration 0006 because they mixed per-whole-unit prices with per-milli-unit costs. |
| `v_receivables` | **Existing implementation:** sales WHERE payment_status='ON_CREDIT' with custom-order `sales.total − deposit_paid`; catalog sales use `sales.total` (migration 0024). **Target KOK-207:** remove order sales from this calculation; combine catalog debts with positive delivered-order outstanding from §3.4.1 exactly once. |
| `v_liability` | **Existing implementation:** order-status/deposit-paid-based customer deposits. **Target KOK-207:** pre-delivery order cash exposure described in §3.4.1, with a documented snapshot-definition cutover. |
| `v_cashflow_daily` | financial_transactions grouped by business_date × category |
| `v_session_hours` | sessions with derived hours + linked event counts. Per-session hours only — S-5's **deduplicated** wall-clock total (the union of overlapping session intervals, for G3) is computed by a pure function in `core/`, not here, following the same rule as the business-health aggregates below: interval-union arithmetic belongs where property tests can reach it. Also selects `s.code` (migration 0024, KOK-185/§3.6). |
| `v_waste` | stock_exits valued, grouped by reason × month |

`GET /api/receivables` (KOK-197) is a derived read over `v_receivables`, not a new ledger or stored
customer balance. It returns global, unfiltered summary totals and a searchable/age-filterable,
paginated list grouped by customer; each debt retains its source sale code/date, channel, sale total,
deposit applied, outstanding remainder, age and linked custom-order reference. Rows without a
customer are listed individually in a distinct “Sin cliente” group. All amounts are centavos.

**Business-health aggregates are NOT views.** Every metric in Phase 5.5 (money at risk, input
cost index, contribution Pareto, Bs/h per product, real-vs-nominal position) is computed by a
pure function in `core/` over a scoped query, following the KOK-035 precedent: the margin math
that a view got wrong for six migrations is the same math these metrics need, and it belongs
where it can be property-tested (Doc 11 §2) and unit-typed (ADR-017), not in SQL where a scale
error is invisible. Views stay for row-shaping and joins; they do no margin arithmetic.

## 5. Integrity beyond DDL (service-enforced, tested)

- **Recipe-less production (KOK-144):** `production_runs.recipe_id` is nullable because a recipe is
  only a prefill. When it is NULL, the command must supply a valid SEMI_FINISHED or FINISHED
  `output_item_id` and the actual `production_consumptions` lines; the same C-4 costing, kardex,
  replay (R-2/R-5), and `custom_order_id` profitability aggregation apply without a recipe.
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
- `purchases.total = Σ purchase_lines.line_total`; `sales.total = Σ sale-line merchandise amounts +
  sales.additional_charge` (server-recomputed). In the target order model `sales.additional_charge` snapshots
  `custom_orders.additional_charge`; it is not an assertion that provider cost equals customer
  charge. Ordinary catalog sales retain zero. Provider payments are independently recorded
  order-linked expenses, possibly multiple; neither delivering nor undoing the order alters them.
  Product gross margin is the sale-line merchandise revenue minus frozen COGS; show the separate
  cash result as linked income minus linked expenses, never as gross margin (O-8).
- `custom_orders` retains the O-1…O-6 state graph, but target O-8 separates cash from every
  transition. `updateOrder` (KOK-205) accepts corrections in QUOTING, CONFIRMED, IN_PRODUCTION and
  READY; DELIVERED requires undo first, CANCELLED stays terminal. Correcting agreement or charge
  never rewrites cash or linked production. Once a receipt is linked, customer identity is fixed.
  Preserve explicit `updated_at` compare-and-fail inside the atomic batch and reject stale writes
  (409). The previously specified O-7 split commands and deposit-based minimum are superseded.
  When a merchandise subtotal is set, pinned `line_total` values cannot exceed it and the resulting
  nonempty lines must be allocatable by the same exact-centavo algorithm as delivery; without a subtotal in
  QUOTING, this check is deferred to confirmation/renegotiation. Historical production/assembly
  links remain independent of replaced order-agreement lines.
- **Every `custom_order_lines` row must carry an `item_id` before the order may be DELIVERED**
  (KOK-033). Item-less free-text lines are legal while QUOTING, but `sale_lines.item_id` is NOT
  NULL and FINISHED-only and the merchandise subtotal is recomputed from those lines, so a delivery
  with an unlinked line could not produce lines equal to `agreed_total` without either inventing
  revenue with no sale line to support it or skipping the `SALE_OUT` for goods that really shipped
  (drifting `item_stock` upward forever, INV-5, since O-4's ProductionRun already booked the
  matching PRODUCTION_IN).
  `deliverOrder` therefore refuses with a 409 until every line is linked. **Amendment (KOK-034):**
  the named `resolveOrderLine` command attaches a catalog item to one line's `item_id` (leaving
  `description`/`qty`/`line_total` untouched) — legal on any non-terminal order (same set
  `cancelOrder` accepts), so the Orders board can resolve a free-text line without a general-purpose
  line editor. The target `updateOrder` command can also resolve a line as part of a pre-delivery edit.
- `agreed_total` is split across the delivered sale's lines by the largest-remainder method
  (`allocateAgreedTotalToOrderLines`): lines carrying an explicit `line_total` are pinned, the rest
  share what is left weighted by `qty`, and `Σ(qty × unit_price_mc / 1e6)` must reproduce `agreed_total` to
  the centavo (D-5) — otherwise the delivery is refused rather than rounded. The resulting
  merchandise subtotal equals `custom_orders.agreed_total`; any external-delivery fee is added to
  `sales.total` separately and does not change those product prices.
- The sale created by a delivery is owned by its order: `core/sales`' update/delete refuse
  (409 CONFLICT) for any `channel='CUSTOM_ORDER'` sale, since editing it would desynchronize
  `custom_orders.sale_id`/`agreed_total` and its stock/cost snapshot.
  This refusal is **not** relaxed by O-6: `orders.undoDelivery` does not call `updateSale` /
  `deleteSale` at all — it emits its own reversal statements from `core/orders`, the module that
  owns the sale, in the same batch that clears `sale_id` and flips the status. Restoring the
  deposit liability needs no row: `v_liability` is derived and resumes counting the order the
  moment its status leaves `DELIVERED` in the **legacy implementation**. Target O-8 replaces this
  behavior: undo has no cash effect and cannot be vetoed by an order-linked receipt; order sales
  cannot use `collectPayment`. Catalog sales retain that endpoint and its protections.
- A DRAFT `inventory_counts` row may be **deleted** (soft, audit-reversible) — that is what
  "cancel a count" means (Phase 3.2, KOK-141). No `CANCELLED` value is added to the status CHECK: a
  count that never committed produced no movements and has nothing to report as a state.
- **One OPEN session per `type` at a time, hard-enforced** by `ux_sessions_open_per_type` (§3.2,
  Phase 3.2/KOK-130). This supersedes the previous soft "warn, allow override" rule. Sessions of
  different types may overlap; the resulting double-counted hours are handled by S-5's
  deduplicated wall-clock union, not by forbidding the overlap.
- `financial_transactions` with `source_event_id` are system-owned: source event services own
  edits. No special direct edit path or backfill is required for disposable old-model order
  test rows; new independent receipts/refunds use NULL source plus `custom_order_id` and are
  editable as manual rows. Purchase/session-owned rows retain source-only correction rules.

## 6. Indexes

```sql
CREATE INDEX ix_movements_item_date ON stock_movements(item_id, business_date);
CREATE INDEX ix_movements_source ON stock_movements(source_event_type, source_event_id);
CREATE INDEX ix_tx_account_date ON financial_transactions(account_id, business_date);
CREATE INDEX ix_tx_source ON financial_transactions(source_event_type, source_event_id);
CREATE INDEX ix_tx_category_date ON financial_transactions(category, business_date);
CREATE INDEX ix_tx_custom_order_date ON financial_transactions(custom_order_id, business_date, id); -- KOK-204
CREATE INDEX ix_sales_date ON sales(business_date);
CREATE INDEX ix_sales_status ON sales(payment_status) WHERE payment_status='ON_CREDIT';
CREATE INDEX ix_purchases_date ON purchases(business_date);
CREATE INDEX ix_purchases_order ON purchases(custom_order_id);               -- KOK-204
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

**`drizzle-kit`'s own journal has drifted stale (found during KOK-185, migration 0024).**
`migrations/meta/_journal.json` — drizzle-kit's internal bookkeeping for what it has already
generated, entirely separate from `wrangler d1 migrations apply`'s own tracking — stops at
`0016_v_stock_effective_replacement_cost`; migrations `0017`–`0023` were added without a
matching `drizzle-kit generate` run (and their snapshots), so the journal doesn't know about
them. Running `drizzle-kit generate` in this state produces a migration that redundantly
`CREATE TABLE`s several already-existing tables and spuriously rebuilds others — **do not run
it and apply the output as-is**. `wrangler d1 migrations apply` is unaffected (it applies
`migrations/*.sql` by filename order, tracking progress in D1 itself, never reading the
journal), so hand-writing the next migration directly — mirroring `0024`'s own approach — remains
safe and is the current de facto practice. Resyncing the journal itself is unresolved tech debt,
out of scope for whichever task next touches this file; note it in that PR's description if it
still blocks you.
