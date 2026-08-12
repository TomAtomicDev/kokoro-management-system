CREATE TABLE assembly_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  output_item_id TEXT NOT NULL REFERENCES items(id),  -- FINISHED, unit UNIT (service-enforced)
  output_qty INTEGER NOT NULL CHECK (output_qty > 0), -- milli-units produced by 1 execution
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX ux_assembly_defs_default
  ON assembly_definitions(output_item_id) WHERE is_default = 1 AND is_active = 1;
--> statement-breakpoint
CREATE UNIQUE INDEX ux_assembly_defs_name
  ON assembly_definitions(name) WHERE is_active = 1;
--> statement-breakpoint
CREATE TABLE assembly_definition_lines (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES assembly_definitions(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id),  -- SEMI_FINISHED, FINISHED or PACKAGING only
                                                -- (service-enforced) — never RAW_MATERIAL
  qty INTEGER NOT NULL CHECK (qty > 0)
);
--> statement-breakpoint
CREATE INDEX ix_assembly_def_lines_item ON assembly_definition_lines(item_id);
