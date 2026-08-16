-- Dev/staging fixture catalog + recipes (Doc 04 §7). NOT part of migration 0001 — apply only to
-- dev/staging, never prod, e.g.:
--   wrangler d1 execute kokoro-dev --local --file=./migrations/seed-fixtures.sql
--   wrangler d1 execute kokoro-staging --remote --file=./migrations/seed-fixtures.sql
--
-- Ids are readable slugs (not UUIDv7) for the same reason the financial_accounts seed in
-- 0001_init.sql uses 'acc_bank'/'acc_cash': fixture rows are hand-authored, not app-generated,
-- and stable slugs make test/demo assertions readable. Timestamps are a fixed baseline date.

-- Agua is intentionally owner-editable: 231 milli-centavos/L = Bs 0.00231/L,
-- a tariff-derived Bolivia utility estimate.
INSERT INTO items (id, name, kind, category, unit, wac_mc, replacement_cost_mc, sale_price_mc, min_stock_qty, is_unmetered, is_active, notes, created_at, updated_at) VALUES
  ('item_masa_madre',   'Masa madre',              'SEMI_FINISHED', 'BAKERY',     'KG',   8000000000, 8000000000, NULL, 200, 0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_harina',       'Harina',                  'RAW_MATERIAL',  'INGREDIENT', 'KG',   12000000, 12000000, NULL, 10000,  0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_leche',        'Leche',                   'RAW_MATERIAL',  'DAIRY',      'L',    8000000, 8000000, NULL, 5000,   0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_kefir',        'Kéfir',                   'RAW_MATERIAL',  'DAIRY',      'L',    10000000, 10000000, NULL, 2000,   0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_pan_masa_madre','Pan de masa madre',      'FINISHED',      'BAKERY',     'UNIT', 1200000, 1350000, 2500000, 5000, 0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_pan_500g',      'Pan de masa madre 500 g','FINISHED',      'BAKERY',     'UNIT', 0, 0, 1800000, NULL,   0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_rollos_canela', 'Rollos de canela',       'FINISHED',      'BAKERY',     'UNIT', 0, 0, 1800000, 5000,   0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_cunapes',       'Cuñapés',                'FINISHED',      'BAKERY',     'UNIT', 0, 0, 1200000, 5000,   0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_queso_kefir',   'Queso crema de kéfir',   'FINISHED',      'DAIRY',      'UNIT', 0, 0, 3000000, 3000,   0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_ghee',          'Ghee',                   'FINISHED',      'DAIRY',      'KG',   7000000, 7750000, 8000000, NULL, 0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_ghee_200g',     'Ghee 200 g',             'FINISHED',      'DAIRY',      'UNIT', 0, 0, 2500000, NULL,   0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_kefir_granel',  'Kéfir natural a granel', 'FINISHED',      'DAIRY',      'L',    800000, 900000, NULL, 3000, 0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_kefir_500ml',   'Kéfir natural 500 ml',   'FINISHED',      'DAIRY',      'UNIT', 0, 0, 1000000, 5000, 0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_kefir_1l',      'Kéfir natural 1 L',      'FINISHED',      'DAIRY',      'UNIT', 0, 0, 1800000, 3000, 0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_desayuno_kokoro','Desayuno Kokoro',       'FINISHED',      'OTHER',      'UNIT', 0, 0, 6000000, 1000, 0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_agua',          'Agua',                   'RAW_MATERIAL',  'INGREDIENT', 'L',    0, 231, NULL, 0,        1, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_cajas',         'Cajas',                  'PACKAGING',     'NOT_EATABLE','UNIT', 300000, 330000, NULL, 20000,  0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_etiquetas',     'Etiquetas',              'PACKAGING',     'NOT_EATABLE','UNIT', 20000, 20000, NULL, 50000,   0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_bolsas_pan',    'Bolsas para pan 500 g',  'PACKAGING',     'NOT_EATABLE','UNIT', 80000, 80000, NULL, 10000,   0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_frascos_ghee',  'Frasco, tapa y sello para ghee 200 g', 'PACKAGING', 'NOT_EATABLE', 'UNIT', 380000, 380000, NULL, 5000, 0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_cordel',        'Cordel',                 'PACKAGING',     'NOT_EATABLE','UNIT', 50000, 50000, NULL, 5000,    0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_tarjetas',      'Tarjetas',               'PACKAGING',     'NOT_EATABLE','UNIT', 50000, 50000, NULL, 5000,    0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_botella_kefir_500', 'Botella de kéfir 500 ml', 'PACKAGING', 'NOT_EATABLE', 'UNIT', 150000, 150000, NULL, 500, 0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('item_botella_kefir_1l',  'Botella de kéfir 1 L',    'PACKAGING', 'NOT_EATABLE', 'UNIT', 180000, 180000, NULL, 300, 0, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z');

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
  ('rl_pan_masa',      'recipe_pan_masa_madre', 'item_masa_madre',  1), -- BI-22 G-to-KG fixture conversion rounds the legacy sub-gram value up to 1 g.
  ('rl_rollos_harina', 'recipe_rollos_canela',  'item_harina',      2500),
  ('rl_rollos_masa',   'recipe_rollos_canela',  'item_masa_madre',  1), -- BI-22 G-to-KG fixture conversion rounds the legacy sub-gram value up to 1 g.
  ('rl_rollos_leche',  'recipe_rollos_canela',  'item_leche',       500),
  ('rl_cunapes_harina','recipe_cunapes',        'item_harina',      2000),
  ('rl_cunapes_leche', 'recipe_cunapes',        'item_leche',       1000),
  ('rl_queso_kefir',   'recipe_queso_kefir',    'item_kefir',       4000),
  ('rl_ghee_leche',    'recipe_ghee',           'item_leche',       3000);

INSERT INTO assembly_definitions (id, name, output_item_id, output_qty, is_default, is_active, notes, created_at, updated_at) VALUES
  ('assembly_def_pan_500g',          'Pan de masa madre 500 g', 'item_pan_500g',          10000, 1, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('assembly_def_ghee_200g',         'Ghee 200 g',              'item_ghee_200g',          5000, 1, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('assembly_def_kefir_500ml',       'Kéfir natural 500 ml', 'item_kefir_500ml',       10000, 1, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('assembly_def_kefir_1l',          'Kéfir natural 1 L',    'item_kefir_1l',           5000, 1, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z'),
  ('assembly_def_desayuno_kokoro',   'Desayuno Kokoro',      'item_desayuno_kokoro',    5000, 1, 1, NULL, '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z');

INSERT INTO assembly_definition_lines (id, definition_id, item_id, qty) VALUES
  ('adl_pan_base',              'assembly_def_pan_500g',        'item_pan_masa_madre',    10000),
  ('adl_pan_bolsa',             'assembly_def_pan_500g',        'item_bolsas_pan',        10000),
  ('adl_pan_etiqueta',          'assembly_def_pan_500g',        'item_etiquetas',         10000),
  ('adl_ghee_base',             'assembly_def_ghee_200g',       'item_ghee',               1000),
  ('adl_ghee_frasco',           'assembly_def_ghee_200g',       'item_frascos_ghee',       5000),
  ('adl_ghee_etiqueta',         'assembly_def_ghee_200g',       'item_etiquetas',          5000),
  ('adl_kefir_500_granel',     'assembly_def_kefir_500ml',     'item_kefir_granel',       5000),
  ('adl_kefir_500_botella',   'assembly_def_kefir_500ml',     'item_botella_kefir_500', 10000),
  ('adl_kefir_500_etiqueta',  'assembly_def_kefir_500ml',     'item_etiquetas',         10000),
  ('adl_kefir_1l_granel',     'assembly_def_kefir_1l',        'item_kefir_granel',       5000),
  ('adl_kefir_1l_botella',    'assembly_def_kefir_1l',        'item_botella_kefir_1l',   5000),
  ('adl_kefir_1l_etiqueta',   'assembly_def_kefir_1l',        'item_etiquetas',          5000),
  ('adl_desayuno_pan',        'assembly_def_desayuno_kokoro', 'item_pan_500g',            5000),
  ('adl_desayuno_ghee',       'assembly_def_desayuno_kokoro', 'item_ghee_200g',           5000),
  ('adl_desayuno_kefir',      'assembly_def_desayuno_kokoro', 'item_kefir_500ml',        5000),
  ('adl_desayuno_caja',       'assembly_def_desayuno_kokoro', 'item_cajas',               5000),
  ('adl_desayuno_cordel',     'assembly_def_desayuno_kokoro', 'item_cordel',              5000),
  ('adl_desayuno_tarjeta',    'assembly_def_desayuno_kokoro', 'item_tarjetas',            5000);
