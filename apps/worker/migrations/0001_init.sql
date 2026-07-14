CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assistant_interactions` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`channel` text NOT NULL,
	`pipeline` text NOT NULL,
	`user_input` text NOT NULL,
	`model` text NOT NULL,
	`tool_calls_json` text,
	`draft_json` text,
	`outcome` text,
	`edited_fields_json` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`latency_ms` integer,
	`error` text,
	CONSTRAINT "assistant_interactions_channel_check" CHECK("assistant_interactions"."channel" IN ('TELEGRAM','WEB')),
	CONSTRAINT "assistant_interactions_pipeline_check" CHECK("assistant_interactions"."pipeline" IN ('CAPTURE','QUERY')),
	CONSTRAINT "assistant_interactions_outcome_check" CHECK("assistant_interactions"."outcome" IN ('ACCEPTED','EDITED','REJECTED','ANSWERED','FAILED'))
);
--> statement-breakpoint
CREATE INDEX `ix_ai_at` ON `assistant_interactions` (`at`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before_json` text,
	`after_json` text,
	CONSTRAINT "audit_log_actor_check" CHECK("audit_log"."actor" IN ('OWNER_WEB','OWNER_TELEGRAM','ASSISTANT','SYSTEM'))
);
--> statement-breakpoint
CREATE INDEX `ix_audit_entity` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `custom_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`custom_order_id` text NOT NULL,
	`item_id` text,
	`description` text,
	`qty` integer DEFAULT 1000 NOT NULL,
	`line_total` integer,
	FOREIGN KEY (`custom_order_id`) REFERENCES `custom_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `custom_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`customer_id` text NOT NULL,
	`description` text NOT NULL,
	`agreed_total` integer,
	`deposit_required` integer,
	`deposit_paid` integer DEFAULT 0 NOT NULL,
	`deposit_tx_id` text,
	`delivery_date` text,
	`delivery_place` text,
	`sale_id` text,
	`cancel_resolution` text,
	`notes` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`deposit_tx_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "custom_orders_status_check" CHECK("custom_orders"."status" IN ('QUOTING','CONFIRMED','IN_PRODUCTION','READY','DELIVERED','CANCELLED')),
	CONSTRAINT "custom_orders_cancel_resolution_check" CHECK("custom_orders"."cancel_resolution" IN ('REFUND','FORFEIT'))
);
--> statement-breakpoint
CREATE INDEX `ix_orders_status_date` ON `custom_orders` (`status`,`delivery_date`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_snapshots` (
	`business_date` text PRIMARY KEY NOT NULL,
	`stock_value` integer NOT NULL,
	`bank_balance` integer NOT NULL,
	`cash_balance` integer NOT NULL,
	`accounts_receivable` integer NOT NULL,
	`customer_deposits` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `financial_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`opening_balance` integer DEFAULT 0 NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "financial_accounts_type_check" CHECK("financial_accounts"."type" IN ('BANK','CASH'))
);
--> statement-breakpoint
CREATE TABLE `financial_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`business_date` text NOT NULL,
	`account_id` text NOT NULL,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`amount` integer NOT NULL,
	`counterpart_tx_id` text,
	`source_event_type` text,
	`source_event_id` text,
	`description` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`counterpart_tx_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "financial_transactions_type_check" CHECK("financial_transactions"."type" IN ('INCOME','EXPENSE','TRANSFER_IN','TRANSFER_OUT')),
	CONSTRAINT "financial_transactions_category_check" CHECK("financial_transactions"."category" IN ('SALE','ORDER_DEPOSIT','ORDER_BALANCE','DEBT_COLLECTION','OTHER_INCOME','SUPPLY_PURCHASE','OPERATING_EXPENSE','EQUIPMENT','DEPOSIT_REFUND','OWNER_WITHDRAWAL','TRANSFER','OTHER_EXPENSE')),
	CONSTRAINT "financial_transactions_amount_check" CHECK("financial_transactions"."amount" > 0)
);
--> statement-breakpoint
CREATE INDEX `ix_tx_account_date` ON `financial_transactions` (`account_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `ix_tx_source` ON `financial_transactions` (`source_event_type`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `ix_tx_category_date` ON `financial_transactions` (`category`,`business_date`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`response_json` text
);
--> statement-breakpoint
CREATE TABLE `inventory_count_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`count_id` text NOT NULL,
	`item_id` text NOT NULL,
	`expected_qty` integer NOT NULL,
	`counted_qty` integer NOT NULL,
	FOREIGN KEY (`count_id`) REFERENCES `inventory_counts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_inventory_count_lines_count_item` ON `inventory_count_lines` (`count_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `inventory_counts` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`business_date` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`notes` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "inventory_counts_status_check" CHECK("inventory_counts"."status" IN ('DRAFT','COMMITTED'))
);
--> statement-breakpoint
CREATE TABLE `item_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`alias` text NOT NULL COLLATE NOCASE,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_aliases_alias_unique` ON `item_aliases` (`alias`);--> statement-breakpoint
CREATE TABLE `item_stock` (
	`item_id` text PRIMARY KEY NOT NULL,
	`qty_on_hand` integer DEFAULT 0 NOT NULL,
	`negative_since` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`unit` text NOT NULL,
	`wac` real DEFAULT 0 NOT NULL,
	`replacement_cost` real DEFAULT 0 NOT NULL,
	`replacement_cost_updated_at` text,
	`sale_price` integer,
	`min_stock_qty` integer,
	`is_active` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "items_kind_check" CHECK("items"."kind" IN ('RAW_MATERIAL','SEMI_FINISHED','FINISHED')),
	CONSTRAINT "items_category_check" CHECK("items"."category" IN ('INGREDIENT','PACKAGING','LABEL','BAKERY','DAIRY','OTHER')),
	CONSTRAINT "items_unit_check" CHECK("items"."unit" IN ('G','KG','ML','L','UNIT'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_name_unique` ON `items` (`name`);--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`ok` integer,
	`detail` text
);
--> statement-breakpoint
CREATE TABLE `pending_drafts` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`draft_json` text NOT NULL,
	`interaction_id` text,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`interaction_id`) REFERENCES `assistant_interactions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `price_history` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`price` integer NOT NULL,
	`effective_from` text NOT NULL,
	`note` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `production_consumptions` (
	`id` text PRIMARY KEY NOT NULL,
	`production_run_id` text NOT NULL,
	`item_id` text NOT NULL,
	`qty` integer NOT NULL,
	`unit_cost_snapshot` real NOT NULL,
	FOREIGN KEY (`production_run_id`) REFERENCES `production_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "production_consumptions_qty_check" CHECK("production_consumptions"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE `production_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`business_date` text NOT NULL,
	`recipe_id` text NOT NULL,
	`session_id` text,
	`custom_order_id` text,
	`batches` real NOT NULL,
	`output_item_id` text NOT NULL,
	`actual_output_qty` integer NOT NULL,
	`indirect_cost` integer DEFAULT 0 NOT NULL,
	`allocated_session_cost` integer DEFAULT 0 NOT NULL,
	`direct_cost` integer DEFAULT 0 NOT NULL,
	`total_cost` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`custom_order_id`) REFERENCES `custom_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`output_item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "production_runs_batches_check" CHECK("production_runs"."batches" > 0),
	CONSTRAINT "production_runs_actual_output_qty_check" CHECK("production_runs"."actual_output_qty" > 0)
);
--> statement-breakpoint
CREATE TABLE `purchase_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text NOT NULL,
	`item_id` text NOT NULL,
	`qty` integer NOT NULL,
	`line_total` integer NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "purchase_lines_qty_check" CHECK("purchase_lines"."qty" > 0),
	CONSTRAINT "purchase_lines_line_total_check" CHECK("purchase_lines"."line_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`business_date` text NOT NULL,
	`supplier_name` text,
	`session_id` text,
	`account_id` text NOT NULL,
	`total` integer NOT NULL,
	`receipt_photo_key` text,
	`notes` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `recipe_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`item_id` text NOT NULL,
	`qty` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "recipe_lines_qty_check" CHECK("recipe_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`output_item_id` text NOT NULL,
	`expected_yield_qty` integer NOT NULL,
	`est_labor_min` integer,
	`is_default` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`output_item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_recipes_default` ON `recipes` (`output_item_id`) WHERE "recipes"."is_default" = 1 AND "recipes"."is_active" = 1;--> statement-breakpoint
CREATE TABLE `sale_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`item_id` text NOT NULL,
	`qty` integer NOT NULL,
	`unit_price` integer NOT NULL,
	`unit_cost_snapshot` real NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sale_lines_qty_check" CHECK("sale_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`business_date` text NOT NULL,
	`channel` text NOT NULL,
	`custom_order_id` text,
	`customer_id` text,
	`session_id` text,
	`total` integer NOT NULL,
	`payment_status` text NOT NULL,
	`paid_at` text,
	`payment_method` text,
	`account_id` text,
	`notes` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`custom_order_id`) REFERENCES `custom_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sales_channel_check" CHECK("sales"."channel" IN ('CATALOG','CUSTOM_ORDER')),
	CONSTRAINT "sales_payment_status_check" CHECK("sales"."payment_status" IN ('PAID','ON_CREDIT')),
	CONSTRAINT "sales_payment_method_check" CHECK("sales"."payment_method" IN ('CASH','BANK_QR'))
);
--> statement-breakpoint
CREATE INDEX `ix_sales_date` ON `sales` (`business_date`);--> statement-breakpoint
CREATE INDEX `ix_sales_status` ON `sales` (`payment_status`) WHERE "sales"."payment_status" = 'ON_CREDIT';--> statement-breakpoint
CREATE TABLE `session_costs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`label` text NOT NULL,
	`amount` integer NOT NULL,
	`is_estimate` integer DEFAULT 0 NOT NULL,
	`account_id` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "session_costs_amount_check" CHECK("session_costs"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`business_date` text NOT NULL,
	`started_at` text,
	`ended_at` text,
	`duration_min` integer,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`notes` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "sessions_type_check" CHECK("sessions"."type" IN ('PRODUCTION','PURCHASE_TRIP','DELIVERY_RUN','ADMIN','OTHER')),
	CONSTRAINT "sessions_status_check" CHECK("sessions"."status" IN ('OPEN','CLOSED'))
);
--> statement-breakpoint
CREATE TABLE `stock_exits` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`business_date` text NOT NULL,
	`item_id` text NOT NULL,
	`qty` integer NOT NULL,
	`reason` text NOT NULL,
	`unit_cost_snapshot` real NOT NULL,
	`session_id` text,
	`notes` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stock_exits_qty_check" CHECK("stock_exits"."qty" > 0),
	CONSTRAINT "stock_exits_reason_check" CHECK("stock_exits"."reason" IN ('WASTE','SELF_CONSUMPTION','GIFT_SAMPLE','SPOILAGE','OTHER'))
);
--> statement-breakpoint
CREATE INDEX `ix_exits_date` ON `stock_exits` (`business_date`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`business_date` text NOT NULL,
	`item_id` text NOT NULL,
	`type` text NOT NULL,
	`qty` integer NOT NULL,
	`unit_cost` real NOT NULL,
	`total_cost` integer NOT NULL,
	`source_event_type` text NOT NULL,
	`source_event_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stock_movements_type_check" CHECK("stock_movements"."type" IN ('PURCHASE_IN','PRODUCTION_IN','PRODUCTION_OUT','SALE_OUT','EXIT_OUT','ADJUST'))
);
--> statement-breakpoint
CREATE INDEX `ix_movements_item_date` ON `stock_movements` (`item_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `ix_movements_source` ON `stock_movements` (`source_event_type`,`source_event_id`);--> statement-breakpoint
CREATE TABLE `telegram_updates` (
	`update_id` integer PRIMARY KEY NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
-- ============================================================================
-- Views (Doc 04 §4) — hand-authored below the drizzle-kit-generated tables/indexes above.
-- Drizzle's SQLite dialect does not model window-function/partial-aggregate views, so these are
-- not represented in src/db/schema.ts; core/ services query them via raw `sql` templates.
-- ============================================================================
--> statement-breakpoint
CREATE VIEW v_stock AS
SELECT
  i.id AS item_id,
  i.name, i.kind, i.category, i.unit,
  i.wac, i.replacement_cost, i.sale_price, i.min_stock_qty, i.is_active,
  COALESCE(s.qty_on_hand, 0) AS qty_on_hand,
  s.negative_since,
  CAST(ROUND(COALESCE(s.qty_on_hand, 0) * i.wac) AS INTEGER) AS stock_value,
  CASE
    WHEN i.min_stock_qty IS NOT NULL AND COALESCE(s.qty_on_hand, 0) < i.min_stock_qty THEN 1
    ELSE 0
  END AS is_low_stock
FROM items i
LEFT JOIN item_stock s ON s.item_id = i.id
WHERE i.is_active = 1;
--> statement-breakpoint
CREATE VIEW v_kardex AS
SELECT
  m.id, m.occurred_at, m.business_date,
  m.item_id, i.name AS item_name, i.unit,
  m.type, m.qty, m.unit_cost, m.total_cost,
  m.source_event_type, m.source_event_id, m.created_at,
  SUM(m.qty) OVER (
    PARTITION BY m.item_id
    ORDER BY m.occurred_at, m.created_at, m.id
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_balance
FROM stock_movements m
JOIN items i ON i.id = m.item_id;
--> statement-breakpoint
CREATE VIEW v_price_health AS
SELECT
  i.id AS item_id, i.name, i.sale_price, i.wac, i.replacement_cost,
  CASE WHEN i.sale_price IS NOT NULL AND i.sale_price > 0
    THEN CAST(ROUND((i.sale_price - i.wac) * 10000.0 / i.sale_price) AS INTEGER)
    ELSE NULL
  END AS margin_wac_bp,
  CASE WHEN i.sale_price IS NOT NULL AND i.sale_price > 0
    THEN CAST(ROUND((i.sale_price - i.replacement_cost) * 10000.0 / i.sale_price) AS INTEGER)
    ELSE NULL
  END AS margin_repl_bp,
  CASE WHEN i.sale_price IS NOT NULL AND i.sale_price > 0
    THEN (i.sale_price - i.replacement_cost) * 10000.0 / i.sale_price
    ELSE NULL
  END AS margin_repl_pct,
  i.replacement_cost_updated_at
FROM items i
WHERE i.kind = 'FINISHED' AND i.is_active = 1;
--> statement-breakpoint
CREATE VIEW v_receivables AS
SELECT
  s.id AS sale_id, s.occurred_at, s.business_date,
  s.customer_id, c.name AS customer_name,
  s.total, s.channel, s.custom_order_id,
  CAST(julianday('now') - julianday(s.occurred_at) AS INTEGER) AS days_outstanding
FROM sales s
LEFT JOIN customers c ON c.id = s.customer_id
WHERE s.payment_status = 'ON_CREDIT' AND s.deleted_at IS NULL;
--> statement-breakpoint
CREATE VIEW v_liability AS
SELECT
  COALESCE(SUM(CASE WHEN t.category = 'ORDER_DEPOSIT' THEN t.amount ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN t.category = 'DEPOSIT_REFUND' THEN t.amount ELSE 0 END), 0)
  - COALESCE((
      SELECT SUM(o.deposit_paid)
      FROM custom_orders o
      WHERE o.status = 'DELIVERED' AND o.deleted_at IS NULL
    ), 0) AS customer_deposits
FROM financial_transactions t
WHERE t.deleted_at IS NULL AND t.category IN ('ORDER_DEPOSIT', 'DEPOSIT_REFUND');
--> statement-breakpoint
CREATE VIEW v_cashflow_daily AS
SELECT
  business_date, category, type,
  SUM(amount) AS total_amount,
  COUNT(*) AS tx_count
FROM financial_transactions
WHERE deleted_at IS NULL
GROUP BY business_date, category, type;
--> statement-breakpoint
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
  (SELECT COUNT(*) FROM stock_exits e WHERE e.session_id = s.id AND e.deleted_at IS NULL)
    AS linked_event_count
FROM sessions s
WHERE s.deleted_at IS NULL;
--> statement-breakpoint
CREATE VIEW v_waste AS
SELECT
  strftime('%Y-%m', business_date) AS month,
  reason,
  COUNT(*) AS exit_count,
  SUM(CAST(ROUND(qty * unit_cost_snapshot) AS INTEGER)) AS total_cost
FROM stock_exits
WHERE deleted_at IS NULL
GROUP BY strftime('%Y-%m', business_date), reason;
--> statement-breakpoint
-- ============================================================================
-- Seed data (Doc 04 §7) — environment-agnostic; applied to dev, staging, AND prod by this
-- migration. Dev/staging-only fixture catalog + recipes live separately in
-- migrations/seed-fixtures.sql, applied by `pnpm run db:seed:dev` / `db:seed:staging`, never prod.
-- ============================================================================
--> statement-breakpoint
INSERT INTO financial_accounts (id, name, type, opening_balance, balance, is_active) VALUES
  ('acc_bank', 'Cuenta Banco', 'BANK', 0, 0, 1),
  ('acc_cash', 'Caja chica', 'CASH', 0, 0, 1);
--> statement-breakpoint
INSERT INTO app_settings (key, value) VALUES
  ('min_margin_pct', '3000'),
  ('default_deposit_pct', '5000'),
  ('timezone', '"America/La_Paz"'),
  ('alert_hour', '7'),
  ('negative_stock_alert', 'true'),
  ('backup_retention_days', '30'),
  ('ai_model_text', '"gpt-5.5"'),
  ('ai_model_audio', '"gpt-realtime-whisper"'),
  ('ai_model_transcribe', '"gpt-4o-transcribe"');
