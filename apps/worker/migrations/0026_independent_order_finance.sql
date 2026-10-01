-- KOK-204 / ADR-022 / Doc 03 O-8 and Doc 04 §3.4.1: make the order association independent of
-- transaction source identity, allow order refunds, and link purchase-owned expenses to orders.
--
-- financial_transactions needs a rebuild because its category CHECK must admit ORDER_REFUND and
-- the new manual order-category guards must be installed together with the custom_order_id FK.
-- Defer the circular custom_orders.deposit_tx_id reference and transfer self-reference while the
-- table is replaced; all rows, codes, timestamps, account links and pair links are copied verbatim.
-- Legacy system-owned order deposits/balances remain valid without an order FK during the disposable
-- pre-cutover interval; no historical association or code rewrite is performed. The temporary link
-- snapshot below exists only because SQLite's ON DELETE RESTRICT action is immediate even with
-- deferred FK checks: clear the two incoming references for the DROP, then restore the exact ids.
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint

ALTER TABLE `purchases` ADD `custom_order_id` text REFERENCES `custom_orders`(`id`) ON UPDATE no action ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `ix_purchases_order` ON `purchases` (`custom_order_id`);--> statement-breakpoint

DROP TRIGGER IF EXISTS `trg_financial_transactions_manual_code_assign`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `trg_financial_transactions_transfer_code_assign`;--> statement-breakpoint
DROP VIEW `v_liability`;--> statement-breakpoint
DROP VIEW `v_cashflow_daily`;--> statement-breakpoint

CREATE TABLE `__new_financial_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`business_date` text NOT NULL,
	`account_id` text NOT NULL,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`amount` integer NOT NULL,
	`counterpart_tx_id` text,
	`source_event_type` text,
	`source_event_id` text,
	`custom_order_id` text,
	`code` text,
	`description` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`counterpart_tx_id`) REFERENCES `__new_financial_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`custom_order_id`) REFERENCES `custom_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "financial_transactions_type_check" CHECK("__new_financial_transactions"."type" IN ('INCOME','EXPENSE','TRANSFER_IN','TRANSFER_OUT')),
	CONSTRAINT "financial_transactions_category_check" CHECK("__new_financial_transactions"."category" IN ('SALE','ORDER_DEPOSIT','ORDER_BALANCE','DEBT_COLLECTION','OTHER_INCOME','SUPPLY_PURCHASE','OPERATING_EXPENSE','EQUIPMENT','DEPOSIT_REFUND','ORDER_REFUND','OWNER_WITHDRAWAL','TRANSFER','OTHER_EXPENSE')),
	CONSTRAINT "financial_transactions_amount_check" CHECK("__new_financial_transactions"."amount" > 0),
	CONSTRAINT "financial_transactions_order_receipt_check" CHECK("__new_financial_transactions"."category" NOT IN ('ORDER_DEPOSIT','ORDER_BALANCE') OR ("__new_financial_transactions"."type" = 'INCOME' AND ("__new_financial_transactions"."source_event_id" IS NOT NULL OR "__new_financial_transactions"."custom_order_id" IS NOT NULL))),
	CONSTRAINT "financial_transactions_order_refund_check" CHECK("__new_financial_transactions"."category" != 'ORDER_REFUND' OR ("__new_financial_transactions"."type" = 'EXPENSE' AND "__new_financial_transactions"."source_event_id" IS NULL AND "__new_financial_transactions"."custom_order_id" IS NOT NULL))
);--> statement-breakpoint

INSERT INTO `__new_financial_transactions` (`id`,`occurred_at`,`business_date`,`account_id`,`type`,`category`,`amount`,`counterpart_tx_id`,`source_event_type`,`source_event_id`,`custom_order_id`,`code`,`description`,`deleted_at`,`created_at`,`updated_at`)
SELECT `id`,`occurred_at`,`business_date`,`account_id`,`type`,`category`,`amount`,`counterpart_tx_id`,`source_event_type`,`source_event_id`,NULL,`code`,`description`,`deleted_at`,`created_at`,`updated_at`
FROM `financial_transactions`;--> statement-breakpoint

CREATE TABLE `__kok204_order_deposit_refs` (`order_id` text PRIMARY KEY NOT NULL, `deposit_tx_id` text NOT NULL);--> statement-breakpoint
INSERT INTO `__kok204_order_deposit_refs` (`order_id`,`deposit_tx_id`)
SELECT `id`,`deposit_tx_id` FROM `custom_orders` WHERE `deposit_tx_id` IS NOT NULL;--> statement-breakpoint
UPDATE `custom_orders` SET `deposit_tx_id` = NULL WHERE `deposit_tx_id` IS NOT NULL;--> statement-breakpoint
UPDATE `financial_transactions` SET `counterpart_tx_id` = NULL WHERE `counterpart_tx_id` IS NOT NULL;--> statement-breakpoint
DROP TABLE `financial_transactions`;--> statement-breakpoint
ALTER TABLE `__new_financial_transactions` RENAME TO `financial_transactions`;--> statement-breakpoint
UPDATE `custom_orders`
SET `deposit_tx_id` = (SELECT `deposit_tx_id` FROM `__kok204_order_deposit_refs` WHERE `order_id` = `custom_orders`.`id`)
WHERE `id` IN (SELECT `order_id` FROM `__kok204_order_deposit_refs`);--> statement-breakpoint
DROP TABLE `__kok204_order_deposit_refs`;--> statement-breakpoint

CREATE INDEX `ix_tx_account_date` ON `financial_transactions` (`account_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `ix_tx_source` ON `financial_transactions` (`source_event_type`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `ix_tx_category_date` ON `financial_transactions` (`category`,`business_date`);--> statement-breakpoint
CREATE INDEX `ix_tx_custom_order_date` ON `financial_transactions` (`custom_order_id`,`business_date`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_financial_transactions_code` ON `financial_transactions` (`code`) WHERE `type` != 'TRANSFER_IN';--> statement-breakpoint

-- Manual order receipts share the existing ING sequence; refunds use the existing GTO sequence.
-- Source-owned legacy rows still have NULL codes and are deliberately not backfilled.
CREATE TRIGGER `trg_financial_transactions_manual_code_assign`
AFTER INSERT ON `financial_transactions`
WHEN NEW.code IS NULL AND NEW.source_event_id IS NULL AND NEW.category != 'TRANSFER'
BEGIN
  INSERT INTO code_sequences (event_type, year, next_seq)
  VALUES (
    CASE
      WHEN NEW.category IN ('OTHER_INCOME','ORDER_DEPOSIT','ORDER_BALANCE') THEN 'income'
      WHEN NEW.category = 'OWNER_WITHDRAWAL' THEN 'withdrawal'
      ELSE 'expense'
    END,
    substr(NEW.created_at, 1, 4),
    1
  )
  ON CONFLICT(event_type, year) DO UPDATE SET next_seq = next_seq + 1;

  UPDATE financial_transactions
  SET code = (
      CASE
        WHEN NEW.category IN ('OTHER_INCOME','ORDER_DEPOSIT','ORDER_BALANCE') THEN 'ING-'
        WHEN NEW.category = 'OWNER_WITHDRAWAL' THEN 'RET-'
        ELSE 'GTO-'
      END
    ) || printf('%04d', (
      SELECT next_seq FROM code_sequences
      WHERE event_type = (
        CASE
          WHEN NEW.category IN ('OTHER_INCOME','ORDER_DEPOSIT','ORDER_BALANCE') THEN 'income'
          WHEN NEW.category = 'OWNER_WITHDRAWAL' THEN 'withdrawal'
          ELSE 'expense'
        END
      )
        AND year = substr(NEW.created_at, 1, 4)
    )) || '-' || substr(NEW.created_at, 1, 4)
  WHERE id = NEW.id;
END;--> statement-breakpoint

-- Preserve KOK-185 transfer pairing semantics: the OUT leg's link update assigns one code to both
-- legs after both rows exist, regardless of which counterpart UPDATE is issued first.
CREATE TRIGGER `trg_financial_transactions_transfer_code_assign`
AFTER UPDATE OF `counterpart_tx_id` ON `financial_transactions`
WHEN NEW.type = 'TRANSFER_OUT' AND NEW.code IS NULL AND NEW.counterpart_tx_id IS NOT NULL
BEGIN
  INSERT INTO code_sequences (event_type, year, next_seq)
  VALUES ('transfer', substr(NEW.created_at, 1, 4), 1)
  ON CONFLICT(event_type, year) DO UPDATE SET next_seq = next_seq + 1;

  UPDATE financial_transactions
  SET code = 'TRF-' || printf('%04d', (
    SELECT next_seq FROM code_sequences WHERE event_type = 'transfer' AND year = substr(NEW.created_at, 1, 4)
  )) || '-' || substr(NEW.created_at, 1, 4)
  WHERE id IN (NEW.id, NEW.counterpart_tx_id);
END;
--> statement-breakpoint

-- Recreate the only existing views whose definitions read financial_transactions. They retain the
-- legacy ADR-012 semantics until KOK-207's coordinated projection cutover.
CREATE VIEW v_liability AS
SELECT
  COALESCE(SUM(CASE WHEN t.category = 'ORDER_DEPOSIT' THEN t.amount ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN t.category = 'DEPOSIT_REFUND' THEN t.amount ELSE 0 END), 0)
  - COALESCE((
      SELECT SUM(o.deposit_paid)
      FROM custom_orders o
      WHERE o.status = 'DELIVERED' AND o.deleted_at IS NULL
    ), 0) AS customer_deposits
FROM financial_transactions t
WHERE t.deleted_at IS NULL AND t.category IN ('ORDER_DEPOSIT', 'DEPOSIT_REFUND');--> statement-breakpoint

CREATE VIEW v_cashflow_daily AS
SELECT
  business_date, category, type,
  SUM(amount) AS total_amount,
  COUNT(*) AS tx_count
FROM financial_transactions
WHERE deleted_at IS NULL
GROUP BY business_date, category, type;
