-- KOK-185 (Doc 03 INV-12, Doc 04 KOK-185 subsection): human-readable event codes
-- ({PREFIX}-{NNNN}-{YYYY}, e.g. VTA-0912-2026), reversing KOK-147's original "inventing a code
-- system was rejected as unnecessary" call — the owner hit the exact problem that decision
-- predicted would not matter (Issue #44 §B-4, review-blocks-a-b-c.md §4.6.5).
--
-- WHY A TRIGGER, NOT core/-SIDE ALLOCATION: every mutation in core/ builds one db.batch() and
-- nothing outside it — there is no precedent anywhere in core/ for a standalone write. A
-- per-(event_type, year) counter incremented by an AFTER INSERT/AFTER UPDATE trigger keeps that
-- true: the trigger fires INSIDE the same implicit transaction db.batch() already wraps every
-- statement in (D1 batches are "executed and committed sequentially... the entire sequence acts
-- as a transaction" — if any statement fails, the whole batch rolls back, so a failed create can
-- never burn a sequence number). core/ never computes a code; it always re-reads the row after
-- db.batch() to get the trigger-assigned value back (mirrors core/sales's readAccountDtoOrThrow
-- pattern already in use for "the one answer that cannot disagree with what was actually
-- written").
--
-- WHY `code` IS NULLABLE, NOT NOT NULL: SQLite/D1 cannot add a NOT NULL column without a default
-- in one step, and the only way to add a real NOT NULL constraint here would be the full
-- drop/recreate-table rebuild 0011/0022 use for genuine constraint changes — expensive and risky
-- across 9 tables, several with incoming FKs from other tables. A CREATE UNIQUE INDEX gives the
-- uniqueness guarantee, and the AFTER INSERT trigger (WHEN NEW.code IS NULL) makes "every row
-- gets one" a structural guarantee no core/ write path can bypass, without the rebuild. This is a
-- deliberate trade-off, not an oversight: a human-readable code is a convenience feature, not a
-- money/correctness invariant, so a hypothetical trigger bug degrading to a missing code is a far
-- better failure mode than one blocking real business writes.
--
-- YEAR SOURCE: every code's year segment comes from created_at (server "now" at insert time), not
-- business_date/occurred_at. custom_orders has no business_date column at all (only
-- delivery_date, a future promise, and created_at), so created_at is the only field present on
-- every codeable table; it is also never backdated, so a code's year can never retroactively
-- change; and it is the same field the backfill below orders by, so one rule produces both the
-- year bucket and the ordinal.
--
-- BACKFILL: deterministic, ordered by (created_at, id) — a total order — via ROW_NUMBER(), same
-- technique already proven in this environment by 0015_recipe_name_unique.sql. Re-running
-- db:reset:dev against the same seed data reproduces byte-identical codes.
--
-- MANUAL VS. SYSTEM-OWNED FINANCIAL TRANSACTIONS: only `financial_transactions` rows with
-- source_event_id IS NULL (gasto operativo, otro ingreso, retiro, transferencia) get their own
-- code — a system-owned row (SALE, SUPPLY_PURCHASE, DEBT_COLLECTION, ORDER_DEPOSIT,
-- ORDER_BALANCE, DEPOSIT_REFUND) inherits its source event's code for display instead (Doc 07),
-- so giving it a second code of its own would be redundant, not missing.
--
-- TRANSFER PAIRS SHARE ONE CODE: core/finance/transfer.ts inserts both legs (TRANSFER_OUT,
-- TRANSFER_IN) with counterpart_tx_id still NULL, then links them via two separate UPDATEs later
-- in the SAME batch (counterpart_tx_id's self-FK is not deferrable — see that file's header). So
-- at each leg's own AFTER INSERT, its sibling doesn't exist yet — an AFTER INSERT trigger cannot
-- give both legs the same code. Instead, an AFTER UPDATE OF counterpart_tx_id trigger scoped to
-- WHEN NEW.type = 'TRANSFER_OUT' fires on the OUT leg's linking UPDATE specifically (independent
-- of which of the two linking UPDATEs the caller happens to run first) — by then BOTH rows exist,
-- so it allocates one sequence number and writes it onto both rows in a single statement.
--
-- WRANGLER/D1 NOTE: every trigger body below uses uppercase END. A wrangler bug (fixed August
-- 2026) mis-split migration files on a lowercase `end` closing a CREATE TRIGGER's BEGIN block,
-- folding every later statement into the trigger body — uppercase END avoids that history
-- entirely regardless of which wrangler version applies this file.

-- ============================================================================================
-- 1. Counter table
-- ============================================================================================

CREATE TABLE `code_sequences` (
	`event_type` text NOT NULL,
	`year` text NOT NULL,
	`next_seq` integer NOT NULL,
	PRIMARY KEY (`event_type`, `year`)
);
--> statement-breakpoint

-- ============================================================================================
-- 2. `code` column (nullable — see header) on every codeable table
-- ============================================================================================

ALTER TABLE `sessions` ADD `code` text;--> statement-breakpoint
ALTER TABLE `production_runs` ADD `code` text;--> statement-breakpoint
ALTER TABLE `assemblies` ADD `code` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `code` text;--> statement-breakpoint
ALTER TABLE `purchases` ADD `code` text;--> statement-breakpoint
ALTER TABLE `custom_orders` ADD `code` text;--> statement-breakpoint
ALTER TABLE `inventory_counts` ADD `code` text;--> statement-breakpoint
ALTER TABLE `stock_exits` ADD `code` text;--> statement-breakpoint
ALTER TABLE `financial_transactions` ADD `code` text;--> statement-breakpoint

-- ============================================================================================
-- 3. Deterministic backfill (ROW_NUMBER over (created_at, id) — 0015's proven technique). A
-- no-op against a fresh, empty database (db:reset:dev).
-- ============================================================================================

UPDATE sessions
SET code = 'SES-' || printf('%04d', (
    SELECT rn FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY substr(created_at,1,4) ORDER BY created_at, id) AS rn
      FROM sessions
    ) ranked WHERE ranked.id = sessions.id
  )) || '-' || substr(sessions.created_at, 1, 4);
--> statement-breakpoint

UPDATE production_runs
SET code = 'PRD-' || printf('%04d', (
    SELECT rn FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY substr(created_at,1,4) ORDER BY created_at, id) AS rn
      FROM production_runs
    ) ranked WHERE ranked.id = production_runs.id
  )) || '-' || substr(production_runs.created_at, 1, 4);
--> statement-breakpoint

UPDATE assemblies
SET code = 'ENV-' || printf('%04d', (
    SELECT rn FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY substr(created_at,1,4) ORDER BY created_at, id) AS rn
      FROM assemblies
    ) ranked WHERE ranked.id = assemblies.id
  )) || '-' || substr(assemblies.created_at, 1, 4);
--> statement-breakpoint

UPDATE sales
SET code = 'VTA-' || printf('%04d', (
    SELECT rn FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY substr(created_at,1,4) ORDER BY created_at, id) AS rn
      FROM sales
    ) ranked WHERE ranked.id = sales.id
  )) || '-' || substr(sales.created_at, 1, 4);
--> statement-breakpoint

UPDATE purchases
SET code = 'CMP-' || printf('%04d', (
    SELECT rn FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY substr(created_at,1,4) ORDER BY created_at, id) AS rn
      FROM purchases
    ) ranked WHERE ranked.id = purchases.id
  )) || '-' || substr(purchases.created_at, 1, 4);
--> statement-breakpoint

UPDATE custom_orders
SET code = 'PED-' || printf('%04d', (
    SELECT rn FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY substr(created_at,1,4) ORDER BY created_at, id) AS rn
      FROM custom_orders
    ) ranked WHERE ranked.id = custom_orders.id
  )) || '-' || substr(custom_orders.created_at, 1, 4);
--> statement-breakpoint

UPDATE inventory_counts
SET code = 'CNT-' || printf('%04d', (
    SELECT rn FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY substr(created_at,1,4) ORDER BY created_at, id) AS rn
      FROM inventory_counts
    ) ranked WHERE ranked.id = inventory_counts.id
  )) || '-' || substr(inventory_counts.created_at, 1, 4);
--> statement-breakpoint

UPDATE stock_exits
SET code = 'SAL-' || printf('%04d', (
    SELECT rn FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY substr(created_at,1,4) ORDER BY created_at, id) AS rn
      FROM stock_exits
    ) ranked WHERE ranked.id = stock_exits.id
  )) || '-' || substr(stock_exits.created_at, 1, 4);
--> statement-breakpoint

-- Manual (non-system-owned, non-TRANSFER) financial_transactions rows: GTO-/ING-/RET-, ranked
-- per (category-bucket, year).
UPDATE financial_transactions
SET code = (
    CASE category
      WHEN 'OTHER_INCOME' THEN 'ING-'
      WHEN 'OWNER_WITHDRAWAL' THEN 'RET-'
      ELSE 'GTO-'
    END
  ) || printf('%04d', (
    SELECT rn FROM (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY
          (CASE category WHEN 'OTHER_INCOME' THEN 'income' WHEN 'OWNER_WITHDRAWAL' THEN 'withdrawal' ELSE 'expense' END),
          substr(created_at,1,4)
        ORDER BY created_at, id
      ) AS rn
      FROM financial_transactions
      WHERE source_event_id IS NULL AND category != 'TRANSFER'
    ) ranked WHERE ranked.id = financial_transactions.id
  )) || '-' || substr(financial_transactions.created_at, 1, 4)
WHERE source_event_id IS NULL AND category != 'TRANSFER';
--> statement-breakpoint

-- TRANSFER pairs: rank the OUT legs only, then copy each OUT leg's code onto its IN counterpart —
-- see header ("TRANSFER PAIRS SHARE ONE CODE").
UPDATE financial_transactions
SET code = 'TRF-' || printf('%04d', (
    SELECT rn FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY substr(created_at,1,4) ORDER BY created_at, id) AS rn
      FROM financial_transactions
      WHERE type = 'TRANSFER_OUT' AND category = 'TRANSFER'
    ) ranked WHERE ranked.id = financial_transactions.id
  )) || '-' || substr(financial_transactions.created_at, 1, 4)
WHERE type = 'TRANSFER_OUT' AND category = 'TRANSFER';
--> statement-breakpoint

UPDATE financial_transactions
SET code = (
  SELECT o.code FROM financial_transactions o WHERE o.id = financial_transactions.counterpart_tx_id
)
WHERE type = 'TRANSFER_IN' AND category = 'TRANSFER';
--> statement-breakpoint

-- ============================================================================================
-- 4. Seed `code_sequences` from the backfill so the first post-migration trigger fire continues
-- cleanly instead of colliding with a backfilled number. No-op against a fresh database (the
-- GROUP BY produces zero rows), which is exactly what is wanted there.
-- ============================================================================================

INSERT INTO code_sequences (event_type, year, next_seq)
SELECT 'session', substr(created_at,1,4), COUNT(*) FROM sessions GROUP BY substr(created_at,1,4);
--> statement-breakpoint

INSERT INTO code_sequences (event_type, year, next_seq)
SELECT 'production_run', substr(created_at,1,4), COUNT(*) FROM production_runs GROUP BY substr(created_at,1,4);
--> statement-breakpoint

INSERT INTO code_sequences (event_type, year, next_seq)
SELECT 'assembly', substr(created_at,1,4), COUNT(*) FROM assemblies GROUP BY substr(created_at,1,4);
--> statement-breakpoint

INSERT INTO code_sequences (event_type, year, next_seq)
SELECT 'sale', substr(created_at,1,4), COUNT(*) FROM sales GROUP BY substr(created_at,1,4);
--> statement-breakpoint

INSERT INTO code_sequences (event_type, year, next_seq)
SELECT 'purchase', substr(created_at,1,4), COUNT(*) FROM purchases GROUP BY substr(created_at,1,4);
--> statement-breakpoint

INSERT INTO code_sequences (event_type, year, next_seq)
SELECT 'custom_order', substr(created_at,1,4), COUNT(*) FROM custom_orders GROUP BY substr(created_at,1,4);
--> statement-breakpoint

INSERT INTO code_sequences (event_type, year, next_seq)
SELECT 'inventory_count', substr(created_at,1,4), COUNT(*) FROM inventory_counts GROUP BY substr(created_at,1,4);
--> statement-breakpoint

INSERT INTO code_sequences (event_type, year, next_seq)
SELECT 'stock_exit', substr(created_at,1,4), COUNT(*) FROM stock_exits GROUP BY substr(created_at,1,4);
--> statement-breakpoint

INSERT INTO code_sequences (event_type, year, next_seq)
SELECT
  CASE category
    WHEN 'OTHER_INCOME' THEN 'income'
    WHEN 'OWNER_WITHDRAWAL' THEN 'withdrawal'
    ELSE 'expense'
  END,
  substr(created_at,1,4),
  COUNT(*)
FROM financial_transactions
WHERE source_event_id IS NULL AND category != 'TRANSFER'
GROUP BY 1, 2;
--> statement-breakpoint

INSERT INTO code_sequences (event_type, year, next_seq)
SELECT 'transfer', substr(created_at,1,4), COUNT(*)
FROM financial_transactions
WHERE type = 'TRANSFER_OUT' AND category = 'TRANSFER'
GROUP BY substr(created_at,1,4);
--> statement-breakpoint

-- ============================================================================================
-- 5. Uniqueness (created after backfill, matching 0015's precedent of dedup-then-index)
-- ============================================================================================

CREATE UNIQUE INDEX `ux_sessions_code` ON `sessions` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_production_runs_code` ON `production_runs` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_assemblies_code` ON `assemblies` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_sales_code` ON `sales` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_purchases_code` ON `purchases` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_custom_orders_code` ON `custom_orders` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_inventory_counts_code` ON `inventory_counts` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_stock_exits_code` ON `stock_exits` (`code`);--> statement-breakpoint
-- Partial: excludes TRANSFER_IN specifically, because that leg's code is a deliberate MIRROR of
-- its TRANSFER_OUT counterpart's code (see trg_financial_transactions_transfer_code_assign below)
-- — a plain UNIQUE INDEX here would reject the second leg for duplicating a value that is
-- supposed to be duplicated. TRANSFER_OUT rows (one per pair), manual GTO/ING/RET rows, and NULL
-- (system-owned) rows are all still fully covered by this index.
CREATE UNIQUE INDEX `ux_financial_transactions_code` ON `financial_transactions` (`code`) WHERE `type` != 'TRANSFER_IN';--> statement-breakpoint

-- ============================================================================================
-- 6. Triggers — one per simple table, plus financial_transactions's two (manual, transfer-pair).
-- Every body: upsert code_sequences, then write the formatted code back onto the just-inserted
-- row(s), reading `next_seq` back via a scalar subquery on code_sequences (same table, same
-- transaction, sees the increment this trigger's own first statement just wrote).
-- ============================================================================================

CREATE TRIGGER `trg_sessions_code_assign`
AFTER INSERT ON `sessions`
WHEN NEW.code IS NULL
BEGIN
  INSERT INTO code_sequences (event_type, year, next_seq)
  VALUES ('session', substr(NEW.created_at, 1, 4), 1)
  ON CONFLICT(event_type, year) DO UPDATE SET next_seq = next_seq + 1;

  UPDATE sessions
  SET code = 'SES-' || printf('%04d', (
    SELECT next_seq FROM code_sequences WHERE event_type = 'session' AND year = substr(NEW.created_at, 1, 4)
  )) || '-' || substr(NEW.created_at, 1, 4)
  WHERE id = NEW.id;
END;
--> statement-breakpoint

CREATE TRIGGER `trg_production_runs_code_assign`
AFTER INSERT ON `production_runs`
WHEN NEW.code IS NULL
BEGIN
  INSERT INTO code_sequences (event_type, year, next_seq)
  VALUES ('production_run', substr(NEW.created_at, 1, 4), 1)
  ON CONFLICT(event_type, year) DO UPDATE SET next_seq = next_seq + 1;

  UPDATE production_runs
  SET code = 'PRD-' || printf('%04d', (
    SELECT next_seq FROM code_sequences WHERE event_type = 'production_run' AND year = substr(NEW.created_at, 1, 4)
  )) || '-' || substr(NEW.created_at, 1, 4)
  WHERE id = NEW.id;
END;
--> statement-breakpoint

CREATE TRIGGER `trg_assemblies_code_assign`
AFTER INSERT ON `assemblies`
WHEN NEW.code IS NULL
BEGIN
  INSERT INTO code_sequences (event_type, year, next_seq)
  VALUES ('assembly', substr(NEW.created_at, 1, 4), 1)
  ON CONFLICT(event_type, year) DO UPDATE SET next_seq = next_seq + 1;

  UPDATE assemblies
  SET code = 'ENV-' || printf('%04d', (
    SELECT next_seq FROM code_sequences WHERE event_type = 'assembly' AND year = substr(NEW.created_at, 1, 4)
  )) || '-' || substr(NEW.created_at, 1, 4)
  WHERE id = NEW.id;
END;
--> statement-breakpoint

CREATE TRIGGER `trg_sales_code_assign`
AFTER INSERT ON `sales`
WHEN NEW.code IS NULL
BEGIN
  INSERT INTO code_sequences (event_type, year, next_seq)
  VALUES ('sale', substr(NEW.created_at, 1, 4), 1)
  ON CONFLICT(event_type, year) DO UPDATE SET next_seq = next_seq + 1;

  UPDATE sales
  SET code = 'VTA-' || printf('%04d', (
    SELECT next_seq FROM code_sequences WHERE event_type = 'sale' AND year = substr(NEW.created_at, 1, 4)
  )) || '-' || substr(NEW.created_at, 1, 4)
  WHERE id = NEW.id;
END;
--> statement-breakpoint

CREATE TRIGGER `trg_purchases_code_assign`
AFTER INSERT ON `purchases`
WHEN NEW.code IS NULL
BEGIN
  INSERT INTO code_sequences (event_type, year, next_seq)
  VALUES ('purchase', substr(NEW.created_at, 1, 4), 1)
  ON CONFLICT(event_type, year) DO UPDATE SET next_seq = next_seq + 1;

  UPDATE purchases
  SET code = 'CMP-' || printf('%04d', (
    SELECT next_seq FROM code_sequences WHERE event_type = 'purchase' AND year = substr(NEW.created_at, 1, 4)
  )) || '-' || substr(NEW.created_at, 1, 4)
  WHERE id = NEW.id;
END;
--> statement-breakpoint

CREATE TRIGGER `trg_custom_orders_code_assign`
AFTER INSERT ON `custom_orders`
WHEN NEW.code IS NULL
BEGIN
  INSERT INTO code_sequences (event_type, year, next_seq)
  VALUES ('custom_order', substr(NEW.created_at, 1, 4), 1)
  ON CONFLICT(event_type, year) DO UPDATE SET next_seq = next_seq + 1;

  UPDATE custom_orders
  SET code = 'PED-' || printf('%04d', (
    SELECT next_seq FROM code_sequences WHERE event_type = 'custom_order' AND year = substr(NEW.created_at, 1, 4)
  )) || '-' || substr(NEW.created_at, 1, 4)
  WHERE id = NEW.id;
END;
--> statement-breakpoint

CREATE TRIGGER `trg_inventory_counts_code_assign`
AFTER INSERT ON `inventory_counts`
WHEN NEW.code IS NULL
BEGIN
  INSERT INTO code_sequences (event_type, year, next_seq)
  VALUES ('inventory_count', substr(NEW.created_at, 1, 4), 1)
  ON CONFLICT(event_type, year) DO UPDATE SET next_seq = next_seq + 1;

  UPDATE inventory_counts
  SET code = 'CNT-' || printf('%04d', (
    SELECT next_seq FROM code_sequences WHERE event_type = 'inventory_count' AND year = substr(NEW.created_at, 1, 4)
  )) || '-' || substr(NEW.created_at, 1, 4)
  WHERE id = NEW.id;
END;
--> statement-breakpoint

CREATE TRIGGER `trg_stock_exits_code_assign`
AFTER INSERT ON `stock_exits`
WHEN NEW.code IS NULL
BEGIN
  INSERT INTO code_sequences (event_type, year, next_seq)
  VALUES ('stock_exit', substr(NEW.created_at, 1, 4), 1)
  ON CONFLICT(event_type, year) DO UPDATE SET next_seq = next_seq + 1;

  UPDATE stock_exits
  SET code = 'SAL-' || printf('%04d', (
    SELECT next_seq FROM code_sequences WHERE event_type = 'stock_exit' AND year = substr(NEW.created_at, 1, 4)
  )) || '-' || substr(NEW.created_at, 1, 4)
  WHERE id = NEW.id;
END;
--> statement-breakpoint

CREATE TRIGGER `trg_financial_transactions_manual_code_assign`
AFTER INSERT ON `financial_transactions`
WHEN NEW.code IS NULL AND NEW.source_event_id IS NULL AND NEW.category != 'TRANSFER'
BEGIN
  INSERT INTO code_sequences (event_type, year, next_seq)
  VALUES (
    CASE NEW.category WHEN 'OTHER_INCOME' THEN 'income' WHEN 'OWNER_WITHDRAWAL' THEN 'withdrawal' ELSE 'expense' END,
    substr(NEW.created_at, 1, 4),
    1
  )
  ON CONFLICT(event_type, year) DO UPDATE SET next_seq = next_seq + 1;

  UPDATE financial_transactions
  SET code = (
      CASE NEW.category WHEN 'OTHER_INCOME' THEN 'ING-' WHEN 'OWNER_WITHDRAWAL' THEN 'RET-' ELSE 'GTO-' END
    ) || printf('%04d', (
      SELECT next_seq FROM code_sequences
      WHERE event_type = (CASE NEW.category WHEN 'OTHER_INCOME' THEN 'income' WHEN 'OWNER_WITHDRAWAL' THEN 'withdrawal' ELSE 'expense' END)
        AND year = substr(NEW.created_at, 1, 4)
    )) || '-' || substr(NEW.created_at, 1, 4)
  WHERE id = NEW.id;
END;
--> statement-breakpoint

-- Fires on the OUT leg's own counterpart-linking UPDATE (core/finance/transfer.ts:98-105) —
-- scoped to `type = 'TRANSFER_OUT'` specifically so it never depends on which of the two linking
-- UPDATEs the caller happens to run first. Both rows already exist by this point (both INSERTs
-- ran earlier in the same batch), so this writes ONE code onto both in a single statement.
CREATE TRIGGER `trg_financial_transactions_transfer_code_assign`
AFTER UPDATE OF `counterpart_tx_id` ON `financial_transactions`
WHEN NEW.type = 'TRANSFER_OUT' AND NEW.code IS NULL AND NEW.counterpart_tx_id IS NOT NULL
BEGIN
  INSERT INTO code_sequences (event_type, year, next_seq)
  VALUES ('transfer', substr(NEW.created_at, 1, 4), 1)
  ON CONFLICT(event_type, year) DO UPDATE SET next_seq = next_seq + 1;

  UPDATE financial_transactions
  SET code = 'TRF-' || printf('%04d', (
    SELECT next_seq FROM code_sequences WHERE event_type = 'transfer' AND year = substr(NEW.created_at, 1, 4)
  )) || '-' || substr(NEW.created_at, 1, 4)
  WHERE id IN (NEW.id, NEW.counterpart_tx_id);
END;
--> statement-breakpoint

-- ============================================================================================
-- 7. Views recreated to expose `code` (SQLite has no CREATE OR REPLACE VIEW) — DROP+CREATE,
-- same precedent as 0005_receivables_net_of_deposit.sql. Every other view (v_stock, v_kardex,
-- v_price_health, v_liability, v_cashflow_daily, v_waste) is item-level or aggregate, not
-- event-level, so none of them need a `code` column.
-- ============================================================================================

DROP VIEW `v_session_hours`;--> statement-breakpoint
CREATE VIEW v_session_hours AS
SELECT
  s.id AS session_id, s.type, s.business_date, s.status,
  s.started_at, s.ended_at,
  COALESCE(
    s.duration_min,
    CASE WHEN s.started_at IS NOT NULL AND s.ended_at IS NOT NULL
      THEN CAST(ROUND((julianday(s.ended_at) - julianday(s.started_at)) * 24 * 60) AS INTEGER)
      ELSE NULL
    END
  ) AS duration_min,
  (SELECT COUNT(*) FROM purchases p WHERE p.session_id = s.id AND p.deleted_at IS NULL) +
  (SELECT COUNT(*) FROM production_runs r WHERE r.session_id = s.id AND r.deleted_at IS NULL) +
  (SELECT COUNT(*) FROM sales sl WHERE sl.session_id = s.id AND sl.deleted_at IS NULL) +
  (SELECT COUNT(*) FROM stock_exits e WHERE e.session_id = s.id AND e.deleted_at IS NULL) +
  (SELECT COUNT(*) FROM assemblies a WHERE a.session_id = s.id AND a.deleted_at IS NULL)
    AS linked_event_count,
  s.code AS code
FROM sessions s
WHERE s.deleted_at IS NULL;
--> statement-breakpoint

DROP VIEW `v_receivables`;--> statement-breakpoint
CREATE VIEW v_receivables AS
SELECT
  s.id AS sale_id, s.occurred_at, s.business_date,
  s.customer_id, c.name AS customer_name,
  s.total - COALESCE(o.deposit_paid, 0) AS total,
  s.channel, s.custom_order_id,
  CAST(julianday('now') - julianday(s.occurred_at) AS INTEGER) AS days_outstanding,
  s.code AS code
FROM sales s
LEFT JOIN customers c ON c.id = s.customer_id
LEFT JOIN custom_orders o ON o.id = s.custom_order_id AND o.deleted_at IS NULL
WHERE s.payment_status = 'ON_CREDIT' AND s.deleted_at IS NULL;
