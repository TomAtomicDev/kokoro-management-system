-- KOK-071 vertical 3/4 (ADR-017): user-set sale rates move from INTEGER centavos per
-- WHOLE unit to INTEGER milli-centavos per WHOLE unit. Both columns therefore rescale by
-- exactly x1,000 (not the x1,000,000 used by the legacy per-milli-unit REAL columns).
PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP VIEW `v_stock`;--> statement-breakpoint
DROP VIEW `v_kardex`;--> statement-breakpoint
DROP VIEW `v_price_health`;--> statement-breakpoint
DROP VIEW `v_waste`;--> statement-breakpoint
DROP VIEW `v_session_hours`;--> statement-breakpoint
CREATE TABLE `__new_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`unit` text NOT NULL,
	`wac_mc` integer DEFAULT 0 NOT NULL,
	`replacement_cost_mc` integer DEFAULT 0 NOT NULL,
	`replacement_cost_updated_at` text,
	`sale_price_mc` integer,
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
INSERT INTO `__new_items` ("id", "name", "kind", "category", "unit", "wac_mc", "replacement_cost_mc", "replacement_cost_updated_at", "sale_price_mc", "min_stock_qty", "is_active", "notes", "created_at", "updated_at")
SELECT "id", "name", "kind", "category", "unit", "wac_mc", "replacement_cost_mc", "replacement_cost_updated_at", CAST(ROUND("sale_price" * 1000) AS INTEGER), "min_stock_qty", "is_active", "notes", "created_at", "updated_at" FROM `items`;
--> statement-breakpoint
DROP TABLE `items`;--> statement-breakpoint
ALTER TABLE `__new_items` RENAME TO `items`;--> statement-breakpoint
CREATE UNIQUE INDEX `items_name_unique` ON `items` (`name`);--> statement-breakpoint
CREATE TABLE `__new_sale_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`item_id` text NOT NULL,
	`qty` integer NOT NULL,
	`unit_price_mc` integer NOT NULL,
	`unit_cost_snapshot_mc` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sale_lines_qty_check" CHECK("__new_sale_lines"."qty" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_sale_lines` ("id", "sale_id", "item_id", "qty", "unit_price_mc", "unit_cost_snapshot_mc")
SELECT "id", "sale_id", "item_id", "qty", CAST(ROUND("unit_price" * 1000) AS INTEGER), "unit_cost_snapshot_mc" FROM `sale_lines`;
--> statement-breakpoint
DROP TABLE `sale_lines`;--> statement-breakpoint
ALTER TABLE `__new_sale_lines` RENAME TO `sale_lines`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE VIEW v_stock AS
SELECT
  i.id AS item_id,
  i.name, i.kind, i.category, i.unit,
  i.wac_mc, i.replacement_cost_mc, i.sale_price_mc, i.min_stock_qty, i.is_active,
  COALESCE(s.qty_on_hand, 0) AS qty_on_hand,
  s.negative_since,
  CAST(ROUND(COALESCE(s.qty_on_hand, 0) * i.wac_mc / 1000000.0) AS INTEGER) AS stock_value,
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
CREATE VIEW v_price_health AS
SELECT
  i.id AS item_id, i.name, i.sale_price_mc, i.wac_mc, i.replacement_cost_mc,
  i.replacement_cost_updated_at
FROM items i
WHERE i.kind = 'FINISHED' AND i.is_active = 1;
--> statement-breakpoint
CREATE VIEW v_waste AS
SELECT
  strftime('%Y-%m', business_date) AS month,
  reason,
  COUNT(*) AS exit_count,
  SUM(CAST(ROUND(qty * unit_cost_snapshot_mc / 1000000.0) AS INTEGER)) AS total_cost
FROM stock_exits
WHERE deleted_at IS NULL
GROUP BY strftime('%Y-%m', business_date), reason;
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
