CREATE TABLE stock_exit_packaging_lines (
  id TEXT PRIMARY KEY,
  stock_exit_id TEXT NOT NULL REFERENCES stock_exits(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),  -- PACKAGING only (service-enforced)
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_cost_snapshot_mc INTEGER NOT NULL
);
