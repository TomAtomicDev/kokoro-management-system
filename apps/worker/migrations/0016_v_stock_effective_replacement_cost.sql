-- KOK-103 follow-up (PR #22's "known follow-up"): `v_stock` never selected
-- `replacement_cost_updated_at`, so core/inventory/queries.ts's listStock had no way to apply the
-- C-3c effective-replacement-cost fallback (Doc 03 §4) the way core/catalog/dto.ts's toItemDto and
-- core/costing/price-health.ts already do — the Stock screen kept showing the raw stored column,
-- a false `0` for any item never purchased. No table change, just widening the view's SELECT list.
DROP VIEW `v_stock`;--> statement-breakpoint
CREATE VIEW v_stock AS
SELECT
  i.id AS item_id,
  i.name, i.kind, i.category, i.unit,
  i.wac_mc, i.replacement_cost_mc, i.replacement_cost_updated_at,
  i.sale_price_mc, i.min_stock_qty, i.is_active,
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
