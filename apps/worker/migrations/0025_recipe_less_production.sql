-- KOK-144 / Doc 03 §3 and Doc 04 §3.3: a recipe is an optional production template.
-- Recipe-less runs select their output item directly and persist actual consumption lines, so
-- `recipe_id` must allow NULL while the denormalized `output_item_id` remains required.
-- SQLite cannot alter nullability in place. Preserve the child consumption rows and the session
-- view while rebuilding only production_runs; recreate the human-readable code index/trigger that
-- migration 0024 installed on the replaced table.
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
DROP VIEW `v_session_hours`;--> statement-breakpoint

CREATE TABLE `__new_production_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`business_date` text NOT NULL,
	`recipe_id` text,
	`session_id` text NOT NULL,
	`custom_order_id` text,
	`batches` real NOT NULL,
	`output_item_id` text NOT NULL,
	`actual_output_qty` integer NOT NULL,
	`indirect_cost` integer DEFAULT 0 NOT NULL,
	`allocated_session_cost` integer DEFAULT 0 NOT NULL,
	`direct_cost` integer DEFAULT 0 NOT NULL,
	`total_cost` integer DEFAULT 0 NOT NULL,
	`code` text,
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
INSERT INTO `__new_production_runs` (`id`, `occurred_at`, `business_date`, `recipe_id`, `session_id`, `custom_order_id`, `batches`, `output_item_id`, `actual_output_qty`, `indirect_cost`, `allocated_session_cost`, `direct_cost`, `total_cost`, `code`, `notes`, `deleted_at`, `created_at`, `updated_at`)
SELECT `id`, `occurred_at`, `business_date`, `recipe_id`, `session_id`, `custom_order_id`, `batches`, `output_item_id`, `actual_output_qty`, `indirect_cost`, `allocated_session_cost`, `direct_cost`, `total_cost`, `code`, `notes`, `deleted_at`, `created_at`, `updated_at`
FROM `production_runs`;--> statement-breakpoint
DROP TABLE `production_runs`;--> statement-breakpoint
ALTER TABLE `__new_production_runs` RENAME TO `production_runs`;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_production_runs_code` ON `production_runs` (`code`);--> statement-breakpoint

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
END;--> statement-breakpoint

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
