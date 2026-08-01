CREATE TABLE `costing_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`business_date` text NOT NULL,
	`item_id` text NOT NULL,
	`trigger_event_type` text NOT NULL,
	`trigger_event_id` text NOT NULL,
	`affected_sale_line_ids` text NOT NULL,
	`affected_stock_exit_ids` text NOT NULL,
	`cost_delta` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "costing_adjustments_trigger_event_type_check" CHECK("costing_adjustments"."trigger_event_type" IN ('purchase','production_run','stock_exit'))
);
--> statement-breakpoint
CREATE INDEX `ix_costing_adj_item_date` ON `costing_adjustments` (`item_id`,`business_date`);