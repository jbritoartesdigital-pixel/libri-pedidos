-- ==================================================
-- LIBRI CONVITES
-- PEDIDOS V2 | DEFAULTS COMERCIAIS E CONTATOS
-- ==================================================

PRAGMA foreign_keys = ON;

-- Combos aprovados no planejamento original.
INSERT OR IGNORE INTO v2_combos(
  code,
  name,
  description,
  discount_type,
  discount_value,
  active,
  config_json
) VALUES
(
  'convite_save',
  'Convite + Save',
  'Convite principal + Save the Date.',
  'fixed',
  500,
  1,
  '{"includesInvitation":true}'
),
(
  'antes_festa',
  'Antes da Festa',
  'Convite principal + Save the Date + Lembrete.',
  'fixed',
  1000,
  1,
  '{"includesInvitation":true}'
),
(
  'organizacao',
  'Organização',
  'Convite principal + Confirmação de Presença Libri + Lembrete.',
  'fixed',
  1000,
  1,
  '{"includesInvitation":true}'
),
(
  'festa_completa',
  'Festa Completa',
  'Convite principal + Confirmação de Presença Libri + Libri Moments.',
  'fixed',
  1500,
  1,
  '{"includesInvitation":true}'
),
(
  'libri_completo',
  'Libri Completo',
  'Convite principal + Save the Date + Lembrete + Confirmação de Presença Libri + Libri Moments.',
  'fixed',
  2500,
  1,
  '{"includesInvitation":true}'
);

INSERT INTO v2_combo_items(combo_id,item_type,item_code,required)
SELECT c.id, 'addon_group', 'save_the_date', 1
FROM v2_combos c
WHERE c.code = 'convite_save'
  AND NOT EXISTS (
    SELECT 1 FROM v2_combo_items i
    WHERE i.combo_id = c.id
      AND i.item_type = 'addon_group'
      AND i.item_code = 'save_the_date'
  );

INSERT OR IGNORE INTO v2_combo_items(
  combo_id,
  item_type,
  item_code,
  required
)
SELECT id, 'addon_group', 'save_the_date', 1
FROM v2_combos
WHERE code = 'antes_festa';

INSERT OR IGNORE INTO v2_combo_items(
  combo_id,
  item_type,
  item_code,
  required
)
SELECT id, 'addon_group', 'reminder', 1
FROM v2_combos
WHERE code = 'antes_festa';

INSERT OR IGNORE INTO v2_combo_items(
  combo_id,
  item_type,
  item_code,
  required
)
SELECT id, 'addon', 'confirmation_libri', 1
FROM v2_combos
WHERE code = 'organizacao';

INSERT OR IGNORE INTO v2_combo_items(
  combo_id,
  item_type,
  item_code,
  required
)
SELECT id, 'addon_group', 'reminder', 1
FROM v2_combos
WHERE code = 'organizacao';

INSERT OR IGNORE INTO v2_combo_items(
  combo_id,
  item_type,
  item_code,
  required
)
SELECT id, 'addon', 'confirmation_libri', 1
FROM v2_combos
WHERE code = 'festa_completa';

INSERT OR IGNORE INTO v2_combo_items(
  combo_id,
  item_type,
  item_code,
  required
)
SELECT id, 'addon_group', 'moments', 1
FROM v2_combos
WHERE code = 'festa_completa';

INSERT OR IGNORE INTO v2_combo_items(
  combo_id,
  item_type,
  item_code,
  required
)
SELECT id, 'addon_group', 'save_the_date', 1
FROM v2_combos
WHERE code = 'libri_completo';

INSERT OR IGNORE INTO v2_combo_items(
  combo_id,
  item_type,
  item_code,
  required
)
SELECT id, 'addon_group', 'reminder', 1
FROM v2_combos
WHERE code = 'libri_completo';

INSERT OR IGNORE INTO v2_combo_items(
  combo_id,
  item_type,
  item_code,
  required
)
SELECT id, 'addon', 'confirmation_libri', 1
FROM v2_combos
WHERE code = 'libri_completo';

INSERT OR IGNORE INTO v2_combo_items(
  combo_id,
  item_type,
  item_code,
  required
)
SELECT id, 'addon_group', 'moments', 1
FROM v2_combos
WHERE code = 'libri_completo';

-- Cupons-modelo ficam inativos até a Julianna decidir usar.
INSERT OR IGNORE INTO v2_coupons(
  code,
  discount_type,
  discount_value,
  min_order_cents,
  max_uses,
  max_uses_per_customer,
  valid_from,
  valid_until,
  active,
  restrictions_json
) VALUES
(
  'JU10',
  'percent',
  10,
  0,
  NULL,
  NULL,
  NULL,
  NULL,
  0,
  '{}'
),
(
  'CLIENTE10',
  'percent',
  10,
  0,
  NULL,
  NULL,
  NULL,
  NULL,
  0,
  '{}'
),
(
  'JU20',
  'fixed',
  2000,
  0,
  NULL,
  NULL,
  NULL,
  NULL,
  0,
  '{}'
);

-- Defaults públicos da marca. Não sobrescreve informação real já preenchida.
UPDATE v2_settings
SET value = '@libriconvites'
WHERE key = 'company_instagram'
  AND TRIM(COALESCE(value, '')) = '';

UPDATE v2_settings
SET value = 'Luziânia'
WHERE key = 'company_city'
  AND TRIM(COALESCE(value, '')) = '';

UPDATE v2_settings
SET value = 'GO'
WHERE key = 'company_state'
  AND TRIM(COALESCE(value, '')) = '';
