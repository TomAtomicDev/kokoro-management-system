-- KOK-071 vertical 1/4 (Doc 10 Phase 3.5, ADR-017): the WAC family onto the integer
-- milli-centavos-per-WHOLE-unit scale. `items.wac`, `stock_movements.unit_cost`,
-- `sale_lines.unit_cost_snapshot`, `stock_exits.unit_cost_snapshot` and
-- `production_consumptions.unit_cost_snapshot` are all THE SAME NUMBER — produced once by
-- `core/costing/wac.ts` and written in the same `db.batch()` per event (D-3) — so they migrate
-- together in one migration; splitting them would leave one atomic batch writing two different
-- scales to two of its own rows (see Doc 10's KOK-071 restructuring note). `stock_movements.total_
-- cost` is a money TOTAL, not a per-unit rate, and is untouched.
--
-- REAL -> INTEGER, rescaled x1,000,000 (old: centavos per MILLI-unit, float; new: milli-centavos
-- per WHOLE unit, integer — ADR-017 / Doc 04 §2: a per-whole-unit rate is 1000x a per-milli-unit
-- one, and "milli-" is another x1000, so the combined factor is 1,000,000). Column suffix `_mc`
-- per ADR-017. `items.replacement_cost`, `items.sale_price`, `sale_lines.unit_price` and
-- `price_history.price` are each migrated in their own later slice (KOK-071 verticals 2-4) —
-- untouched here.
--
-- Standard SQLite table-recreate (the same shape migration 0004 already used for a CHECK-
-- constraint change): PRAGMA foreign_keys=OFF, build `__new_<table>`, copy+transform via
-- INSERT...SELECT, drop the old table, rename the new one in, recreate indexes. `items` is
-- rebuilt first; every other table below references `items(id)`, whose values are unchanged, so
-- foreign_keys stays OFF for the whole migration rather than toggling per table.
--
-- Values are rounded half-up-ish via SQLite's own ROUND() — the same primitive `v_stock`/`v_waste`
-- already used for the pre-migration REAL columns (0001_init.sql). A handful of last-digit
-- differences vs. a from-scratch integer replay are expected and reviewed, not treated as bugs
-- (this file's own PR description).
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`unit` text NOT NULL,
	`wac_mc` integer DEFAULT 0 NOT NULL,
	`replacement_cost` real DEFAULT 0 NOT NULL,
	`replacement_cost_updated_at` text,
	`sale_price` integer,
	`min_stock_qty` integer,
	`is_active` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "items_kind_check" CHECK("__new_items"."kind" IN ('RAW_MATERIAL','SEMI_FINISHED','FINISHED')),
	CONSTRAINT "items_category_check" CHECK("__new_items"."category" IN ('INGREDIENT','PACKAGING','LABEL','BAKERY','DAIRY','OTHER')),
	CONSTRAINT "items_unit_check" CHECK("__new_items"."unit" IN ('G','KG','ML','L','UNIT'))
);
--> statement-breakpoint
INSERT INTO `__new_items` ("id", "name", "kind", "category", "unit", "wac_mc", "replacement_cost", "replacement_cost_updated_at", "sale_price", "min_stock_qty", "is_active", "notes", "created_at", "updated_at")
SELECT "id", "name", "kind", "category", "unit", CAST(ROUND("wac" * 1000000) AS INTEGER), "replacement_cost", "replacement_cost_updated_at", "sale_price", "min_stock_qty", "is_active", "notes", "created_at", "updated_at" FROM `items`;
--> statement-breakpoint
DROP TABLE `items`;--> statement-breakpoint
ALTER TABLE `__new_items` RENAME TO `items`;--> statement-breakpoint
CREATE UNIQUE INDEX `items_name_unique` ON `items` (`name`);--> statement-breakpoint
CREATE TABLE `__new_production_consumptions` (
	`id` text PRIMARY KEY NOT NULL,
	`production_run_id` text NOT NULL,
	`item_id` text NOT NULL,
	`qty` integer NOT NULL,
	`unit_cost_snapshot_mc` integer NOT NULL,
	FOREIGN KEY (`production_run_id`) REFERENCES `production_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "production_consumptions_qty_check" CHECK("__new_production_consumptions"."qty" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_production_consumptions` ("id", "production_run_id", "item_id", "qty", "unit_cost_snapshot_mc")
SELECT "id", "production_run_id", "item_id", "qty", CAST(ROUND("unit_cost_snapshot" * 1000000) AS INTEGER) FROM `production_consumptions`;
--> statement-breakpoint
DROP TABLE `production_consumptions`;--> statement-breakpoint
ALTER TABLE `__new_production_consumptions` RENAME TO `production_consumptions`;--> statement-breakpoint
CREATE TABLE `__new_sale_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`item_id` text NOT NULL,
	`qty` integer NOT NULL,
	`unit_price` integer NOT NULL,
	`unit_cost_snapshot_mc` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sale_lines_qty_check" CHECK("__new_sale_lines"."qty" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_sale_lines` ("id", "sale_id", "item_id", "qty", "unit_price", "unit_cost_snapshot_mc")
SELECT "id", "sale_id", "item_id", "qty", "unit_price", CAST(ROUND("unit_cost_snapshot" * 1000000) AS INTEGER) FROM `sale_lines`;
--> statement-breakpoint
DROP TABLE `sale_lines`;--> statement-breakpoint
ALTER TABLE `__new_sale_lines` RENAME TO `sale_lines`;--> statement-breakpoint
CREATE TABLE `__new_stock_exits` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`business_date` text NOT NULL,
	`item_id` text NOT NULL,
	`qty` integer NOT NULL,
	`reason` text NOT NULL,
	`unit_cost_snapshot_mc` integer NOT NULL,
	`session_id` text,
	`notes` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stock_exits_qty_check" CHECK("__new_stock_exits"."qty" > 0),
	CONSTRAINT "stock_exits_reason_check" CHECK("__new_stock_exits"."reason" IN ('WASTE','SELF_CONSUMPTION','GIFT_SAMPLE','SPOILAGE','OTHER'))
);
--> statement-breakpoint
INSERT INTO `__new_stock_exits` ("id", "occurred_at", "business_date", "item_id", "qty", "reason", "unit_cost_snapshot_mc", "session_id", "notes", "deleted_at", "created_at", "updated_at")
SELECT "id", "occurred_at", "business_date", "item_id", "qty", "reason", CAST(ROUND("unit_cost_snapshot" * 1000000) AS INTEGER), "session_id", "notes", "deleted_at", "created_at", "updated_at" FROM `stock_exits`;
--> statement-breakpoint
DROP TABLE `stock_exits`;--> statement-breakpoint
ALTER TABLE `__new_stock_exits` RENAME TO `stock_exits`;--> statement-breakpoint
CREATE INDEX `ix_exits_date` ON `stock_exits` (`business_date`);--> statement-breakpoint
CREATE TABLE `__new_stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`business_date` text NOT NULL,
	`item_id` text NOT NULL,
	`type` text NOT NULL,
	`qty` integer NOT NULL,
	`unit_cost_mc` integer NOT NULL,
	`total_cost` integer NOT NULL,
	`source_event_type` text NOT NULL,
	`source_event_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stock_movements_type_check" CHECK("__new_stock_movements"."type" IN ('PURCHASE_IN','PRODUCTION_IN','PRODUCTION_OUT','SALE_OUT','EXIT_OUT','ADJUST'))
);
--> statement-breakpoint
INSERT INTO `__new_stock_movements` ("id", "occurred_at", "business_date", "item_id", "type", "qty", "unit_cost_mc", "total_cost", "source_event_type", "source_event_id", "created_at")
SELECT "id", "occurred_at", "business_date", "item_id", "type", "qty", CAST(ROUND("unit_cost" * 1000000) AS INTEGER), "total_cost", "source_event_type", "source_event_id", "created_at" FROM `stock_movements`;
--> statement-breakpoint
DROP TABLE `stock_movements`;--> statement-breakpoint
ALTER TABLE `__new_stock_movements` RENAME TO `stock_movements`;--> statement-breakpoint
CREATE INDEX `ix_movements_item_date` ON `stock_movements` (`item_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `ix_movements_source` ON `stock_movements` (`source_event_type`,`source_event_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- Views touching the renamed columns (Doc 04 §4) must be recreated — SQLite has no `CREATE OR
-- REPLACE VIEW` / `ALTER VIEW`.
DROP VIEW `v_stock`;--> statement-breakpoint
CREATE VIEW v_stock AS
SELECT
  i.id AS item_id,
  i.name, i.kind, i.category, i.unit,
  i.wac_mc, i.replacement_cost, i.sale_price, i.min_stock_qty, i.is_active,
  COALESCE(s.qty_on_hand, 0) AS qty_on_hand,
  s.negative_since,
  -- stock_value (Centavos) = totalCentavos(wac_mc, qty_on_hand): qty_on_hand (milli-units) x
  -- wac_mc (milli-centavos per whole unit) / 1e6, same formula as packages/shared/money.ts's
  -- totalCentavos, inlined here because this is SQL, not TypeScript.
  CAST(ROUND(COALESCE(s.qty_on_hand, 0) * i.wac_mc / 1000000.0) AS INTEGER) AS stock_value,
  CASE
    WHEN i.min_stock_qty IS NOT NULL AND COALESCE(s.qty_on_hand, 0) < i.min_stock_qty THEN 1
    ELSE 0
  END AS is_low_stock
FROM items i
LEFT JOIN item_stock s ON s.item_id = i.id
WHERE i.is_active = 1;
--> statement-breakpoint
DROP VIEW `v_kardex`;--> statement-breakpoint
CREATE VIEW v_kardex AS
SELECT
  m.id, m.occurred_at, m.business_date,
  m.item_id, i.name AS item_name, i.unit,
  m.type, m.qty, m.unit_cost_mc, m.total_cost,
  m.source_event_type, m.source_event_id, m.created_at,
  SUM(m.qty) OVER (
    PARTITION BY m.item_id
    ORDER BY m.occurred_at, m.created_at, m.id
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_balance
FROM stock_movements m
JOIN items i ON i.id = m.item_id;
--> statement-breakpoint
DROP VIEW `v_price_health`;--> statement-breakpoint
CREATE VIEW v_price_health AS
SELECT
  i.id AS item_id, i.name, i.sale_price, i.wac_mc, i.replacement_cost,
  i.replacement_cost_updated_at
FROM items i
WHERE i.kind = 'FINISHED' AND i.is_active = 1;
--> statement-breakpoint
DROP VIEW `v_waste`;--> statement-breakpoint
CREATE VIEW v_waste AS
SELECT
  strftime('%Y-%m', business_date) AS month,
  reason,
  COUNT(*) AS exit_count,
  -- total_cost (Centavos) = totalCentavos(unit_cost_snapshot_mc, qty), same formula as v_stock's
  -- stock_value above.
  SUM(CAST(ROUND(qty * unit_cost_snapshot_mc / 1000000.0) AS INTEGER)) AS total_cost
FROM stock_exits
WHERE deleted_at IS NULL
GROUP BY strftime('%Y-%m', business_date), reason;
