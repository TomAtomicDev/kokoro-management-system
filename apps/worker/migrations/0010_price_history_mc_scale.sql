-- KOK-071 vertical 4/4 (ADR-017): historical sale rates move from INTEGER centavos per
-- WHOLE unit to INTEGER milli-centavos per WHOLE unit. This is exactly x1,000.
-- No SQL view references `price_history`; only this table needs rebuilding.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_price_history` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`price_mc` integer NOT NULL,
	`effective_from` text NOT NULL,
	`note` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_price_history` ("id", "item_id", "price_mc", "effective_from", "note")
SELECT "id", "item_id", CAST(ROUND("price" * 1000) AS INTEGER), "effective_from", "note" FROM `price_history`;
--> statement-breakpoint
DROP TABLE `price_history`;--> statement-breakpoint
ALTER TABLE `__new_price_history` RENAME TO `price_history`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
