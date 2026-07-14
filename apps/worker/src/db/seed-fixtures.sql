-- Dev/staging fixture catalog + recipes (Doc 04 §7). NOT part of migration 0001 — apply only to
-- dev/staging, never prod, e.g.:
--   wrangler d1 execute kokoro-dev --local --file=./migrations/seed-fixtures.sql
--   wrangler d1 execute kokoro-staging --remote --file=./migrations/seed-fixtures.sql
--
-- Ids are readable slugs (not UUIDv7) for the same reason the financial_accounts seed in
-- 0001_init.sql uses 'acc_bank'/'acc_cash': fixture rows are hand-authored, not app-generated,
-- and stable slugs make test/demo assertions readable. Timestamps are a fixed baseline date.

INSERT INTO items (id, name, kind, category, unit, wac, replacement_cost, sale_price, min_stock_qty, is_active, notes, created_at, updated_at) VALUES
  ('item_masa_madre',   'Masa madre',              'SEMI_FINISHED', 'BAKERY',    'G',    8.0,   8.0,   NULL, 200000, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_harina',       'Harina',                  'RAW_MATERIAL',  'INGREDIENT','KG',   12.0,  12.0,  NULL, 10000,  1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_leche',        'Leche',                   'RAW_MATERIAL',  'DAIRY',     'L',    8.0,   8.0,   NULL, 5000,   1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_kefir',        'Kéfir',                   'RAW_MATERIAL',  'DAIRY',     'L',    10.0,  10.0,  NULL, 2000,   1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_pan_masa_madre','Pan de masa madre',      'FINISHED',      'BAKERY',    'UNIT', 0,     0,     2500, 5000,   1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_rollos_canela', 'Rollos de canela',       'FINISHED',      'BAKERY',    'UNIT', 0,     0,     1800, 5000,   1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_cunapes',       'Cuñapés',                'FINISHED',      'BAKERY',    'UNIT', 0,     0,     1200, 5000,   1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_queso_kefir',   'Queso crema de kéfir',   'FINISHED',      'DAIRY',     'UNIT', 0,     0,     3000, 3000,   1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_ghee',          'Ghee',                   'FINISHED',      'DAIRY',     'ML',   0,     0,     4500, 3000,   1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_cajas',         'Cajas',                  'RAW_MATERIAL',  'PACKAGING', 'UNIT', 2.5,   2.5,   NULL, 20000,  1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_etiquetas',     'Etiquetas',               'RAW_MATERIAL',  'LABEL',     'UNIT', 0.5,   0.5,   NULL, 50000,  1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z');

INSERT INTO item_aliases (id, item_id, alias) VALUES
  ('alias_harina_flour',  'item_harina', 'flour'),
  ('alias_leche_milk',    'item_leche',  'milk'),
  ('alias_kefir_kefir',   'item_kefir',  'kefir grains'),
  ('alias_ghee_mantequilla_clarificada', 'item_ghee', 'mantequilla clarificada');

INSERT INTO recipes (id, name, output_item_id, expected_yield_qty, est_labor_min, is_default, is_active, notes, created_at, updated_at) VALUES
  ('recipe_pan_masa_madre',   'Pan de masa madre',    'item_pan_masa_madre',  6000,  180, 1, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('recipe_rollos_canela',    'Rollos de canela',     'item_rollos_canela',   12000, 150, 1, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('recipe_cunapes',          'Cuñapés',               'item_cunapes',         20000, 90,  1, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('recipe_queso_kefir',      'Queso crema de kéfir',  'item_queso_kefir',     3000,  30,  1, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('recipe_ghee',             'Ghee',                  'item_ghee',            2000,  120, 1, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z');

INSERT INTO recipe_lines (id, recipe_id, item_id, qty) VALUES
  ('rl_pan_harina',    'recipe_pan_masa_madre', 'item_harina',      3000),
  ('rl_pan_masa',      'recipe_pan_masa_madre', 'item_masa_madre',  600),
  ('rl_pan_caja',      'recipe_pan_masa_madre', 'item_cajas',       6000),
  ('rl_rollos_harina', 'recipe_rollos_canela',  'item_harina',      2500),
  ('rl_rollos_masa',   'recipe_rollos_canela',  'item_masa_madre',  400),
  ('rl_rollos_leche',  'recipe_rollos_canela',  'item_leche',       500),
  ('rl_cunapes_harina','recipe_cunapes',        'item_harina',      2000),
  ('rl_cunapes_leche', 'recipe_cunapes',        'item_leche',       1000),
  ('rl_queso_kefir',   'recipe_queso_kefir',    'item_kefir',       4000),
  ('rl_ghee_leche',    'recipe_ghee',           'item_leche',       3000);
