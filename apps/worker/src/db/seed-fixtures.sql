-- Dev/staging fixture catalog + recipes (Doc 04 §7). NOT part of migration 0001 — apply only to
-- dev/staging, never prod, e.g.:
--   wrangler d1 execute kokoro-dev --local --file=./migrations/seed-fixtures.sql
--   wrangler d1 execute kokoro-staging --remote --file=./migrations/seed-fixtures.sql
--
-- Ids are readable slugs (not UUIDv7) for the same reason the financial_accounts seed in
-- 0001_init.sql uses 'acc_bank'/'acc_cash': fixture rows are hand-authored, not app-generated,
-- and stable slugs make test/demo assertions readable. Timestamps are a fixed baseline date.

-- Agua is intentionally owner-editable: 500 milli-centavos/L = Bs 0.005/L (about Bs 5/m³),
-- a rough Bolivia utility estimate rather than a tariff-derived value.
INSERT INTO items (id, name, kind, category, unit, wac_mc, replacement_cost_mc, sale_price_mc, min_stock_qty, is_unmetered, is_active, notes, created_at, updated_at) VALUES
  ('item_masa_madre',   'Masa madre',              'SEMI_FINISHED', 'BAKERY',     'KG',   8000000000, 8000000000, NULL, 200, 0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_harina',       'Harina',                  'RAW_MATERIAL',  'INGREDIENT', 'KG',   12000000, 12000000, NULL, 10000,  0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_leche',        'Leche',                   'RAW_MATERIAL',  'DAIRY',      'L',    8000000, 8000000, NULL, 5000,   0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_kefir',        'Kéfir',                   'RAW_MATERIAL',  'DAIRY',      'L',    10000000, 10000000, NULL, 2000,   0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_pan_masa_madre','Pan de masa madre',      'FINISHED',      'BAKERY',     'UNIT', 0, 0, 2500000, 5000,   0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_rollos_canela', 'Rollos de canela',       'FINISHED',      'BAKERY',     'UNIT', 0, 0, 1800000, 5000,   0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_cunapes',       'Cuñapés',                'FINISHED',      'BAKERY',     'UNIT', 0, 0, 1200000, 5000,   0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_queso_kefir',   'Queso crema de kéfir',   'FINISHED',      'DAIRY',      'UNIT', 0, 0, 3000000, 3000,   0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_ghee',          'Ghee',                   'FINISHED',      'DAIRY',      'L',    0, 0, 4500000000, 3,  0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_agua',          'Agua',                   'RAW_MATERIAL',  'INGREDIENT', 'L',    0, 231, NULL, 0,        1, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_cajas',         'Cajas',                  'PACKAGING',     'NOT_EATABLE','UNIT', 2500000, 2500000, NULL, 20000,  0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_etiquetas',     'Etiquetas',              'PACKAGING',     'NOT_EATABLE','UNIT', 500000, 500000, NULL, 50000,   0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z');

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
  ('recipe_ghee',             'Ghee',                  'item_ghee',            2,     120, 1, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z');

INSERT INTO recipe_lines (id, recipe_id, item_id, qty) VALUES
  ('rl_pan_harina',    'recipe_pan_masa_madre', 'item_harina',      3000),
  ('rl_pan_masa',      'recipe_pan_masa_madre', 'item_masa_madre',  1), -- BI-22 G-to-KG fixture conversion rounds the legacy sub-gram value up to 1 g.
  ('rl_pan_caja',      'recipe_pan_masa_madre', 'item_cajas',       6000),
  ('rl_rollos_harina', 'recipe_rollos_canela',  'item_harina',      2500),
  ('rl_rollos_masa',   'recipe_rollos_canela',  'item_masa_madre',  1), -- BI-22 G-to-KG fixture conversion rounds the legacy sub-gram value up to 1 g.
  ('rl_rollos_leche',  'recipe_rollos_canela',  'item_leche',       500),
  ('rl_cunapes_harina','recipe_cunapes',        'item_harina',      2000),
  ('rl_cunapes_leche', 'recipe_cunapes',        'item_leche',       1000),
  ('rl_queso_kefir',   'recipe_queso_kefir',    'item_kefir',       4000),
  ('rl_ghee_leche',    'recipe_ghee',           'item_leche',       3000);
