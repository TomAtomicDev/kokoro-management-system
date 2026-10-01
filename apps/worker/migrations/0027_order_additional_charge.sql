-- KOK-205 / ADR-022 / Doc 04 §3.4.1: keep the separately quoted customer charge on the order and
-- snapshot it on the order-owned sale. It is independent of provider expenses and customer receipts.
ALTER TABLE `custom_orders`
  ADD `additional_charge` INTEGER NOT NULL DEFAULT 0
  CONSTRAINT `custom_orders_additional_charge_check` CHECK (`additional_charge` >= 0);--> statement-breakpoint
ALTER TABLE `sales`
  ADD `additional_charge` INTEGER NOT NULL DEFAULT 0
  CONSTRAINT `sales_additional_charge_check` CHECK (`additional_charge` >= 0);
