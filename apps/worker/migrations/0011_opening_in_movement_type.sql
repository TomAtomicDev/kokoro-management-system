-- KOK-084 / Doc 03 C-8: allow the first positive inventory count for an item to be recorded as
-- an externally-valued OPENING_IN entry. SQLite CHECK constraints require the standard table
-- recreation; the views that depend on stock_movements are dropped before the rename so SQLite
-- does not validate a dangling view halfway through the migration.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP VIEW `v_stock`;--> statement-breakpoint
DROP VIEW `v_kardex`;--> statement-breakpoint
DROP VIEW `v_price_health`;--> statement-breakpoint
DROP VIEW `v_waste`;--> statement-breakpoint
DROP VIEW `v_session_hours`;--> statement-breakpoint
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
	CONSTRAINT "stock_movements_type_check" CHECK("__new_stock_movements"."type" IN ('OPENING_IN','PURCHASE_IN','PRODUCTION_IN','PRODUCTION_OUT','SALE_OUT','EXIT_OUT','ADJUST'))
);
--> statement-breakpoint
INSERT INTO `__new_stock_movements` ("id", "occurred_at", "business_date", "item_id", "type", "qty", "unit_cost_mc", "total_cost", "source_event_type", "source_event_id", "created_at")
SELECT "id", "occurred_at", "business_date", "item_id", "type", "qty", "unit_cost_mc", "total_cost", "source_event_type", "source_event_id", "created_at" FROM `stock_movements`;
--> statement-breakpoint
DROP TABLE `stock_movements`;--> statement-breakpoint
ALTER TABLE `__new_stock_movements` RENAME TO `stock_movements`;--> statement-breakpoint
CREATE INDEX `ix_movements_item_date` ON `stock_movements` (`item_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `ix_movements_source` ON `stock_movements` (`source_event_type`,`source_event_id`);--> statement-breakpoint
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
