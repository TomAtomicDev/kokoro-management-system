-- KOK-207 / ADR-022 / Doc 03 O-8 and Doc 04 §3.4.1:
--   * Catalog receivables remain sale-based and unchanged.
--   * Custom-order receivables are derived by core from order price + active linked receipts.
--   * The old ADR-012 customer_deposits snapshot history remains separately identified; snapshots
--     after this cutover do not claim a new ADR-012 liability value.
--
-- No business-event backfill is performed. Existing snapshot values are moved verbatim into the
-- versioned historical column; the new exposure column stays NULL until the new job writes it.

DROP VIEW `v_receivables`;--> statement-breakpoint
DROP VIEW `v_liability`;--> statement-breakpoint

CREATE VIEW v_receivables AS
SELECT
  s.id AS sale_id,
  s.occurred_at,
  s.business_date,
  s.customer_id,
  c.name AS customer_name,
  s.total AS total,
  s.channel,
  s.custom_order_id,
  CAST(julianday('now') - julianday(s.occurred_at) AS INTEGER) AS days_outstanding,
  s.code AS code
FROM sales s
LEFT JOIN customers c ON c.id = s.customer_id
WHERE s.channel = 'CATALOG'
  AND s.payment_status = 'ON_CREDIT'
  AND s.deleted_at IS NULL;--> statement-breakpoint

-- Set-based, per-order inputs for the shared integer-centavo projection in core/finance. This
-- view deliberately sums only qualifying receipt/refund rows; it does not subtract amounts or
-- calculate expected/excess. Delivered order sale payment_status is a compatibility field only.
CREATE VIEW v_order_finance_projection AS
SELECT
  o.id AS order_id,
  o.status AS order_status,
  o.customer_id,
  c.name AS customer_name,
  o.code AS order_code,
  o.agreed_total,
  o.additional_charge,
  o.sale_id,
  s.id AS active_sale_id,
  s.custom_order_id AS active_sale_order_id,
  s.channel AS active_sale_channel,
  s.total AS active_sale_total,
  s.occurred_at AS active_sale_occurred_at,
  s.business_date AS active_sale_business_date,
  s.code AS active_sale_code,
  COALESCE(SUM(CASE
    WHEN t.type = 'INCOME' AND t.category IN ('ORDER_DEPOSIT','ORDER_BALANCE') THEN t.amount
    ELSE 0
  END), 0) AS qualifying_receipts,
  COALESCE(SUM(CASE
    WHEN t.type = 'EXPENSE' AND t.category = 'ORDER_REFUND' THEN t.amount
    ELSE 0
  END), 0) AS order_refunds
FROM custom_orders o
LEFT JOIN customers c ON c.id = o.customer_id
LEFT JOIN sales s ON s.id = o.sale_id AND s.deleted_at IS NULL
LEFT JOIN financial_transactions t
  ON t.custom_order_id = o.id
  AND t.deleted_at IS NULL
  AND t.source_event_id IS NULL
  AND (
    (t.type = 'INCOME' AND t.category IN ('ORDER_DEPOSIT','ORDER_BALANCE'))
    OR (t.type = 'EXPENSE' AND t.category = 'ORDER_REFUND')
  )
WHERE o.deleted_at IS NULL
GROUP BY
  o.id,
  o.status,
  o.customer_id,
  c.name,
  o.code,
  o.agreed_total,
  o.additional_charge,
  o.sale_id,
  s.id,
  s.custom_order_id,
  s.channel,
  s.total,
  s.occurred_at,
  s.business_date,
  s.code;--> statement-breakpoint

-- Preserve the old deposit-liability observations as a distinct historical series. A NULL
-- pre_delivery_order_cash_exposure means the snapshot predates the ADR-022 projection boundary.
CREATE TABLE `__new_daily_snapshots` (
  `business_date` text PRIMARY KEY NOT NULL,
  `stock_value` integer NOT NULL,
  `bank_balance` integer NOT NULL,
  `cash_balance` integer NOT NULL,
  `accounts_receivable` integer NOT NULL,
  `customer_deposits_adr012` integer,
  `pre_delivery_order_cash_exposure` integer,
  `created_at` text NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_daily_snapshots` (
  `business_date`, `stock_value`, `bank_balance`, `cash_balance`, `accounts_receivable`,
  `customer_deposits_adr012`, `pre_delivery_order_cash_exposure`, `created_at`
)
SELECT
  `business_date`, `stock_value`, `bank_balance`, `cash_balance`, `accounts_receivable`,
  `customer_deposits`, NULL, `created_at`
FROM `daily_snapshots`;--> statement-breakpoint
DROP TABLE `daily_snapshots`;--> statement-breakpoint
ALTER TABLE `__new_daily_snapshots` RENAME TO `daily_snapshots`;
