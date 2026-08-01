-- KOK-033 (O-2, ADR-012, Doc 04 §4): `v_receivables` must report what is actually OUTSTANDING.
--
-- A delivered custom order's sale carries the FULL `agreed_total` (O-2: "the system creates the
-- linked Sale for the full agreed total"), but its deposit was already banked at confirm time as
-- its own INCOME/ORDER_DEPOSIT transaction. The original view reported `s.total`, so an ON_CREDIT
-- delivery showed the whole agreed total as still-owed and double-counted the deposit in SC-02's
-- and SC-10's "Por cobrar" figures.
--
-- The `total` COLUMN NAME is deliberately unchanged (ReceivableDto.total, core/sales'
-- listReceivables and the web receivables screen all read it); what changed is its definition:
-- it is now the uncollected remainder, `s.total - deposit_paid`, for a sale linked to a custom
-- order, and plain `s.total` for every ordinary CATALOG sale. core/sales' `outstandingForSale`
-- computes the identical figure on the cash side so a collection can never credit more than the
-- view says is owed.
--
-- `v_liability` is deliberately NOT touched: cancel/FORFEIT recategorizes the deposit row itself to
-- OTHER_INCOME, which drops it out of that view's `category IN ('ORDER_DEPOSIT','DEPOSIT_REFUND')`
-- filter, so the liability already nets correctly without a definition change.
DROP VIEW `v_receivables`;--> statement-breakpoint
CREATE VIEW v_receivables AS
SELECT
  s.id AS sale_id, s.occurred_at, s.business_date,
  s.customer_id, c.name AS customer_name,
  s.total - COALESCE(o.deposit_paid, 0) AS total,
  s.channel, s.custom_order_id,
  CAST(julianday('now') - julianday(s.occurred_at) AS INTEGER) AS days_outstanding
FROM sales s
LEFT JOIN customers c ON c.id = s.customer_id
LEFT JOIN custom_orders o ON o.id = s.custom_order_id AND o.deleted_at IS NULL
WHERE s.payment_status = 'ON_CREDIT' AND s.deleted_at IS NULL;
