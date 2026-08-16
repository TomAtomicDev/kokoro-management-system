CREATE TABLE `replacement_cost_history` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`replacement_cost_mc` integer NOT NULL,
	`observed_at` text NOT NULL,
	`business_date` text NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "replacement_cost_history_source_check" CHECK("replacement_cost_history"."source" IN ('PURCHASE','NIGHTLY','MANUAL'))
);
