CREATE TABLE assemblies (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL, business_date TEXT NOT NULL,
  definition_id TEXT REFERENCES assembly_definitions(id),  -- NULLable, same rationale as
                                                            -- production_runs.recipe_id
  session_id TEXT NOT NULL REFERENCES sessions(id),        -- required (Doc 03 S-1), PRODUCTION type
  custom_order_id TEXT REFERENCES custom_orders(id),
  output_item_id TEXT NOT NULL REFERENCES items(id),
  planned_output_qty INTEGER CHECK (planned_output_qty > 0),  -- milli-units, informative
  actual_output_qty INTEGER NOT NULL CHECK (actual_output_qty > 0),
  direct_cost INTEGER NOT NULL DEFAULT 0,  -- centavos, derived C-10
  notes TEXT, deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX ix_assemblies_date ON assemblies(business_date);
--> statement-breakpoint
CREATE INDEX ix_assemblies_order ON assemblies(custom_order_id);
--> statement-breakpoint
CREATE TABLE assembly_consumptions (
  id TEXT PRIMARY KEY,
  assembly_id TEXT NOT NULL REFERENCES assemblies(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_cost_snapshot_mc INTEGER NOT NULL
);
