-- KOK-130 / Doc 03 S-1/S-1b: purchases and production runs must belong to a session,
-- and at most one non-deleted session may remain OPEN for each session type.
-- SQLite cannot alter column nullability in place, so both event tables use the standard
-- drop-view/rebuild/swap/recreate-view pattern from migration 0011.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP VIEW `v_session_hours`;--> statement-breakpoint

-- Defensive forward-only backfill. Readable prefixes keep the generated relationship auditable;
-- the event primary key suffix makes each generated session id stable and collision-resistant.
INSERT INTO `sessions` (`id`, `type`, `business_date`, `started_at`, `status`, `created_at`, `updated_at`)
SELECT 'kok130-purchase-' || `id`, 'PURCHASE_TRIP', `business_date`, `occurred_at`, 'OPEN', `occurred_at`, `occurred_at`
FROM `purchases`
WHERE `session_id` IS NULL;--> statement-breakpoint
UPDATE `purchases`
SET `session_id` = 'kok130-purchase-' || `id`
WHERE `session_id` IS NULL;--> statement-breakpoint

INSERT INTO `sessions` (`id`, `type`, `business_date`, `started_at`, `status`, `created_at`, `updated_at`)
SELECT 'kok130-production-' || `id`, 'PRODUCTION', `business_date`, `occurred_at`, 'OPEN', `occurred_at`, `occurred_at`
FROM `production_runs`
WHERE `session_id` IS NULL;--> statement-breakpoint
UPDATE `production_runs`
SET `session_id` = 'kok130-production-' || `id`
WHERE `session_id` IS NULL;--> statement-breakpoint

CREATE TABLE `__new_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`business_date` text NOT NULL,
	`supplier_name` text,
	`session_id` text NOT NULL,
	`account_id` text NOT NULL,
	`total` integer NOT NULL,
	`receipt_photo_key` text,
	`notes` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);--> statement-breakpoint
INSERT INTO `__new_purchases` (`id`, `occurred_at`, `business_date`, `supplier_name`, `session_id`, `account_id`, `total`, `receipt_photo_key`, `notes`, `deleted_at`, `created_at`, `updated_at`)
SELECT `id`, `occurred_at`, `business_date`, `supplier_name`, `session_id`, `account_id`, `total`, `receipt_photo_key`, `notes`, `deleted_at`, `created_at`, `updated_at`
FROM `purchases`;--> statement-breakpoint
DROP TABLE `purchases`;--> statement-breakpoint
ALTER TABLE `__new_purchases` RENAME TO `purchases`;--> statement-breakpoint

CREATE TABLE `__new_production_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`business_date` text NOT NULL,
	`recipe_id` text NOT NULL,
	`session_id` text NOT NULL,
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
	CONSTRAINT "production_runs_batches_check" CHECK("__new_production_runs"."batches" > 0),
	CONSTRAINT "production_runs_actual_output_qty_check" CHECK("__new_production_runs"."actual_output_qty" > 0)
);--> statement-breakpoint
INSERT INTO `__new_production_runs` (`id`, `occurred_at`, `business_date`, `recipe_id`, `session_id`, `custom_order_id`, `batches`, `output_item_id`, `actual_output_qty`, `indirect_cost`, `allocated_session_cost`, `direct_cost`, `total_cost`, `notes`, `deleted_at`, `created_at`, `updated_at`)
SELECT `id`, `occurred_at`, `business_date`, `recipe_id`, `session_id`, `custom_order_id`, `batches`, `output_item_id`, `actual_output_qty`, `indirect_cost`, `allocated_session_cost`, `direct_cost`, `total_cost`, `notes`, `deleted_at`, `created_at`, `updated_at`
FROM `production_runs`;--> statement-breakpoint
DROP TABLE `production_runs`;--> statement-breakpoint
ALTER TABLE `__new_production_runs` RENAME TO `production_runs`;--> statement-breakpoint

-- Normalize legacy duplicate OPEN sessions before installing the hard S-1b invariant. The oldest
-- session (created_at, then id) remains OPEN; later duplicates are closed at their start time.
UPDATE `sessions` AS `duplicate`
SET
	`status` = 'CLOSED',
	`ended_at` = COALESCE(`duplicate`.`ended_at`, `duplicate`.`started_at`),
	`duration_min` = COALESCE(`duplicate`.`duration_min`, 0),
	`updated_at` = COALESCE(`duplicate`.`updated_at`, `duplicate`.`created_at`)
WHERE `duplicate`.`status` = 'OPEN'
	AND `duplicate`.`deleted_at` IS NULL
	AND EXISTS (
		SELECT 1
		FROM `sessions` AS `keeper`
		WHERE `keeper`.`type` = `duplicate`.`type`
			AND `keeper`.`status` = 'OPEN'
			AND `keeper`.`deleted_at` IS NULL
			AND (`keeper`.`created_at` < `duplicate`.`created_at`
				OR (`keeper`.`created_at` = `duplicate`.`created_at` AND `keeper`.`id` < `duplicate`.`id`))
	);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_sessions_open_per_type` ON `sessions` (`type`) WHERE `status` = 'OPEN' AND `deleted_at` IS NULL;--> statement-breakpoint

PRAGMA foreign_keys=ON;--> statement-breakpoint
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
    AS linked_event_count
FROM sessions s
WHERE s.deleted_at IS NULL;
