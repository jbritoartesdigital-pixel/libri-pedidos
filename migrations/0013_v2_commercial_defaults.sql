-- ==================================================
-- LIBRI PEDIDOS V2 | DEFAULTS COMERCIAIS APROVADOS
-- Combos oficiais + defaults públicos conhecidos.
-- Descontos dos combos permanecem configuráveis no Admin.
-- Nenhum cupom ativo é criado sem código/valor aprovado.
-- ==================================================

PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO v2_combos
(code, name, description, discount_type, discount_value, active, config_json)
VALUES
(
  'convite_save',
  'Convite + Save',
  'Convite principal + Save the Date.',
  'percent',
  0,
  1,
  '{"discountConfiguredByAdmin":true}'
),
(
  'antes_festa',
  'Antes da Festa',
  'Convite principal + Save the Date + Lembrete.',
  'percent',
  0,
  1,
  '{"discountConfiguredByAdmin":true}'
),
(
  'organizacao',
  'Organização',
  'Convite principal + Confirmação de Presença Libri + Lembrete.',
  'percent',
  0,
  1,
  '{"discountConfiguredByAdmin":true}'
),
(
  'festa_completa',
  'Festa Completa',
  'Convite principal + Confirmação de Presença Libri + Libri Moments.',
  'percent',
  0,
  1,
  '{"discountConfiguredByAdmin":true}'
),
(
  'libri_completo',
  'Libri Completo',
  'Convite principal + Save the Date + Lembrete + Confirmação de Presença Libri + Libri Moments.',
  'percent',
  0,
  1,
  '{"discountConfiguredByAdmin":true}'
);

INSERT INTO v2_combo_items(combo_id, item_type, item_code, required)
SELECT id, 'addon_group', 'save_the_date', 1
FROM v2_combos
WHERE code = 'convite_save'
  AND NOT EXISTS (
    SELECT 1 FROM v2_combo_items i
    WHERE i.combo_id = v2_combos.id
      AND i.item_type = 'addon_group'
      AND i.item_code = 'save_the_date'
  );

INSERT INTO v2_combo_items(combo_id, item_type, item_code, required)
SELECT id, 'addon_group', 'save_the_date', 1
FROM v2_combos
WHERE code = 'antes_festa'
  AND NOT EXISTS (
    SELECT 1 FROM v2_combo_items i
    WHERE i.combo_id = v2_combos.id
      AND i.item_type = 'addon_group'
      AND i.item_code = 'save_the_date'
  );

INSERT INTO v2_combo_items(combo_id, item_type, item_code, required)
SELECT id, 'addon_group', 'reminder', 1
FROM v2_combos
WHERE code = 'antes_festa'
  AND NOT EXISTS (
    SELECT 1 FROM v2_combo_items i
    WHERE i.combo_id = v2_combos.id
      AND i.item_type = 'addon_group'
      AND i.item_code = 'reminder'
  );

INSERT INTO v2_combo_items(combo_id, item_type, item_code, required)
SELECT id, 'addon_group', 'confirmation', 1
FROM v2_combos
WHERE code = 'organizacao'
  AND NOT EXISTS (
    SELECT 1 FROM v2_combo_items i
    WHERE i.combo_id = v2_combos.id
      AND i.item_type = 'addon_group'
      AND i.item_code = 'confirmation'
  );

INSERT INTO v2_combo_items(combo_id, item_type, item_code, required)
SELECT id, 'addon_group', 'reminder', 1
FROM v2_combos
WHERE code = 'organizacao'
  AND NOT EXISTS (
    SELECT 1 FROM v2_combo_items i
    WHERE i.combo_id = v2_combos.id
      AND i.item_type = 'addon_group'
      AND i.item_code = 'reminder'
  );

INSERT INTO v2_combo_items(combo_id, item_type, item_code, required)
SELECT id, 'addon_group', 'confirmation', 1
FROM v2_combos
WHERE code = 'festa_completa'
  AND NOT EXISTS (
    SELECT 1 FROM v2_combo_items i
    WHERE i.combo_id = v2_combos.id
      AND i.item_type = 'addon_group'
      AND i.item_code = 'confirmation'
  );

INSERT INTO v2_combo_items(combo_id, item_type, item_code, required)
SELECT id, 'addon_group', 'moments', 1
FROM v2_combos
WHERE code = 'festa_completa'
  AND NOT EXISTS (
    SELECT 1 FROM v2_combo_items i
    WHERE i.combo_id = v2_combos.id
      AND i.item_type = 'addon_group'
      AND i.item_code = 'moments'
  );

INSERT INTO v2_combo_items(combo_id, item_type, item_code, required)
SELECT id, 'addon_group', 'save_the_date', 1
FROM v2_combos
WHERE code = 'libri_completo'
  AND NOT EXISTS (
    SELECT 1 FROM v2_combo_items i
    WHERE i.combo_id = v2_combos.id
      AND i.item_type = 'addon_group'
      AND i.item_code = 'save_the_date'
  );

INSERT INTO v2_combo_items(combo_id, item_type, item_code, required)
SELECT id, 'addon_group', 'reminder', 1
FROM v2_combos
WHERE code = 'libri_completo'
  AND NOT EXISTS (
    SELECT 1 FROM v2_combo_items i
    WHERE i.combo_id = v2_combos.id
      AND i.item_type = 'addon_group'
      AND i.item_code = 'reminder'
  );

INSERT INTO v2_combo_items(combo_id, item_type, item_code, required)
SELECT id, 'addon_group', 'confirmation', 1
FROM v2_combos
WHERE code = 'libri_completo'
  AND NOT EXISTS (
    SELECT 1 FROM v2_combo_items i
    WHERE i.combo_id = v2_combos.id
      AND i.item_type = 'addon_group'
      AND i.item_code = 'confirmation'
  );

INSERT INTO v2_combo_items(combo_id, item_type, item_code, required)
SELECT id, 'addon_group', 'moments', 1
FROM v2_combos
WHERE code = 'libri_completo'
  AND NOT EXISTS (
    SELECT 1 FROM v2_combo_items i
    WHERE i.combo_id = v2_combos.id
      AND i.item_type = 'addon_group'
      AND i.item_code = 'moments'
  );

INSERT OR IGNORE INTO v2_settings(key, value) VALUES
  ('company_name', 'Libri Convites'),
  ('company_instagram', '@libriconvites');

UPDATE v2_settings
SET value = 'Libri Convites',
    updated_at = datetime('now')
WHERE key = 'company_name'
  AND trim(COALESCE(value, '')) = '';

UPDATE v2_settings
SET value = '@libriconvites',
    updated_at = datetime('now')
WHERE key = 'company_instagram'
  AND trim(COALESCE(value, '')) = '';
