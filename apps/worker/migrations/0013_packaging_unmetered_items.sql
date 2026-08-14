-- BI-11/BI-15: promote PACKAGING to an item kind, replace obsolete categories,
-- and add the RAW_MATERIAL-only unmetered flag. SQLite CHECK changes require a
-- table rebuild; existing PACKAGING/LABEL rows are normalized during the copy.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP VIEW `v_stock`;--> statement-breakpoint
DROP VIEW `v_kardex`;--> statement-breakpoint
DROP VIEW `v_price_health`;--> statement-breakpoint
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
	`is_unmetered` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "items_kind_check" CHECK("__new_items"."kind" IN ('RAW_MATERIAL','SEMI_FINISHED','FINISHED','PACKAGING')),
	CONSTRAINT "items_category_check" CHECK("__new_items"."category" IN ('INGREDIENT','NOT_EATABLE','BAKERY','DAIRY','PASTRY','OTHER')),
	CONSTRAINT "items_unit_check" CHECK("__new_items"."unit" IN ('G','KG','ML','L','UNIT','M'))
);
--> statement-breakpoint
INSERT INTO `__new_items` ("id", "name", "kind", "category", "unit", "wac_mc", "replacement_cost_mc", "replacement_cost_updated_at", "sale_price_mc", "min_stock_qty", "is_unmetered", "is_active", "notes", "created_at", "updated_at")
SELECT "id", "name",
	CASE WHEN "category" IN ('PACKAGING','LABEL') THEN 'PACKAGING' ELSE "kind" END,
	CASE WHEN "category" IN ('PACKAGING','LABEL') THEN 'NOT_EATABLE' ELSE "category" END,
	"unit", "wac_mc", "replacement_cost_mc", "replacement_cost_updated_at", "sale_price_mc", "min_stock_qty", 0, "is_active", "notes", "created_at", "updated_at"
FROM `items`;
--> statement-breakpoint
DROP TABLE `items`;--> statement-breakpoint
ALTER TABLE `__new_items` RENAME TO `items`;--> statement-breakpoint
CREATE UNIQUE INDEX `items_name_unique` ON `items` (`name`);--> statement-breakpoint
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
