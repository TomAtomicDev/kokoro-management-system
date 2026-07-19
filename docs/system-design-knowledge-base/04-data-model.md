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

## 2. Numeric representation (INV-6)

| Concept | Storage | Example |
|---------|---------|---------|
| Money (BOB) | `INTEGER` centavos | Bs 12.50 → `1250` |
| Quantity | `INTEGER` milli-units of the item's unit | 1.5 kg (unit=KG) → `1500` |
| Percent / rates | `INTEGER` basis points | 30% → `3000` |
| Unit costs (derived, needs precision) | `INTEGER` micro-centavos per milli-unit is overkill → store as `REAL` **only** in cached/derived columns (`wac`, `replacement_cost`), documented per column; all persisted transaction amounts remain INTEGER |

Rule: arithmetic happens on integers/exact decimals in `packages/shared/money.ts`; rounding
half-up only when producing a final money amount.

## 3. Schema (DDL)

### 3.1 Catalog

```sql
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,                     -- display name (Spanish)
  kind TEXT NOT NULL CHECK (kind IN ('RAW_MATERIAL','SEMI_FINISHED','FINISHED')),
  category TEXT NOT NULL CHECK (category IN
    ('INGREDIENT','PACKAGING','LABEL','BAKERY','DAIRY','OTHER')),
  unit TEXT NOT NULL CHECK (unit IN ('G','KG','ML','L','UNIT')),
  wac REAL NOT NULL DEFAULT 0,                   -- weighted avg cost, centavos per milli-unit (derived, C-1)
  replacement_cost REAL NOT NULL DEFAULT 0,      -- centavos per milli-unit (derived, C-3)
  replacement_cost_updated_at TEXT,
  sale_price INTEGER,                            -- centavos per unit; NULL unless sellable (FINISHED)
  min_stock_qty INTEGER,                         -- milli-units; NULL = no alert
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

CREATE TABLE recipe_lines (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),    -- ingredient or high-value packaging
  qty INTEGER NOT NULL CHECK (qty > 0)           -- milli-units per 1 batch
);

CREATE TABLE price_history (                     -- price stability analysis (G2)
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  price INTEGER NOT NULL,                        -- centavos
  effective_from TEXT NOT NULL,                  -- business_date
  note TEXT
);
```

### 3.2 Sessions

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('PRODUCTION','PURCHASE_TRIP','DELIVERY_RUN','ADMIN','OTHER')),
  business_date TEXT NOT NULL,
  started_at TEXT, ended_at TEXT,
  duration_min INTEGER,                          -- direct entry allowed; derived from start/end otherwise
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  notes TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

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
  session_id TEXT REFERENCES sessions(id),
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
  recipe_id TEXT NOT NULL REFERENCES recipes(id),
  session_id TEXT REFERENCES sessions(id),
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
  unit_cost_snapshot REAL NOT NULL               -- WAC at commit (audit of C-4)
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
  item_id TEXT NOT NULL REFERENCES items(id),    -- FINISHED only (service-enforced)
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price INTEGER NOT NULL,                   -- centavos (editable vs list price)
  unit_cost_snapshot REAL NOT NULL               -- WAC at sale → per-line margin forever
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
  unit_cost_snapshot REAL NOT NULL,              -- WAC at exit (C-6)
  session_id TEXT REFERENCES sessions(id),
  notes TEXT, deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
    ('PURCHASE_IN','PRODUCTION_IN','PRODUCTION_OUT','SALE_OUT','EXIT_OUT','ADJUST')),
  qty INTEGER NOT NULL,                          -- signed milli-units (+in / −out)
  unit_cost REAL NOT NULL,                       -- centavos per milli-unit at movement time
  total_cost INTEGER NOT NULL,                   -- centavos, signed (qty × unit_cost rounded)
  source_event_type TEXT NOT NULL,               -- 'purchase'|'production_run'|'sale'|'stock_exit'|'inventory_count'
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
    ('purchase','production_run','stock_exit')),   -- KOK-024: a backdated exit changes on-hand,
                                          -- which changes C-1's max(on_hand,0) weight for every
                                          -- later entry — so an exit CAN move downstream WAC and
                                          -- that correction must be bookable

  trigger_event_id TEXT NOT NULL,        -- the create/edit/delete that triggered the replay
  affected_sale_line_ids TEXT NOT NULL,  -- JSON array of sale_lines.id, for UI drill-down
  affected_stock_exit_ids TEXT NOT NULL, -- JSON array of stock_exits.id
  cost_delta INTEGER NOT NULL,           -- centavos, signed: negative = accumulated margin fell
  created_at TEXT NOT NULL
);
```

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
| `v_stock` | items ⨝ item_stock + `stock_value = qty_on_hand × wac`, low-stock flag |
| `v_kardex` | stock_movements ⨝ items, ordered, with running balance via window function |
| `v_price_health` | FINISHED items: price, wac, replacement_cost, margin_wac, margin_repl, margin_repl_pct, alert flag (C-5) |
| `v_receivables` | sales WHERE payment_status='ON_CREDIT' AND deleted_at IS NULL, aged |
| `v_liability` | current customer_deposits (see §3.4) |
| `v_cashflow_daily` | financial_transactions grouped by business_date × category |
| `v_session_hours` | sessions with derived hours + linked event counts |
| `v_waste` | stock_exits valued, grouped by reason × month |

## 5. Integrity beyond DDL (service-enforced, tested)

- Sale lines only reference `kind='FINISHED'` items; recipe output must not be RAW_MATERIAL;
  production consumption items must not be FINISHED **unless** flagged rework (v1: forbidden).
- `purchases.total = Σ purchase_lines.line_total`; `sales.total = Σ qty×unit_price` (recomputed
  server-side, client values ignored).
- `custom_orders` transitions only along the state machine (O-1…O-3).
- One OPEN session per type at a time (soft rule: warn, allow override).
- `financial_transactions` with `source_event_id` are system-owned: not editable directly (edit
  the source event instead).

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
