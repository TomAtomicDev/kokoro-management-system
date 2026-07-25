-- KOK-069: `v_price_health`'s `margin_wac_bp`/`margin_repl_bp`/`margin_repl_pct` columns (added in
-- migration 0001) computed `sale_price - wac`/`sale_price - replacement_cost` directly, but
-- `sale_price` is centavos per WHOLE unit while `items.wac`/`items.replacement_cost` are centavos
-- per MILLI-unit (Doc 04 §2) — a ~1000x unit mismatch that made every FINISHED item read as having
-- a ~100% margin.
--
-- Fix is removal, not an in-SQL x1000 conversion: a grep at fix-time confirms zero consumers of
-- these three columns anywhere in the codebase (nothing ever selects `FROM v_price_health` at
-- all), because `core/costing/price-health.ts` (KOK-035) already computes C-5 margins correctly in
-- application code via `computePriceMargin`, and that is what KOK-036's Price-health screen reads.
-- Keeping a second, easy-to-miscale SQL reimplementation of the same math around with no consumer
-- is exactly the kind of duplication that produced this bug; the view now exposes only the raw
-- per-item columns its FINISHED/active projection is actually for. See Doc 04 §4 amendment in the
-- same PR (D-6).
DROP VIEW `v_price_health`;--> statement-breakpoint
CREATE VIEW v_price_health AS
SELECT
  i.id AS item_id, i.name, i.sale_price, i.wac, i.replacement_cost,
  i.replacement_cost_updated_at
FROM items i
WHERE i.kind = 'FINISHED' AND i.is_active = 1;
