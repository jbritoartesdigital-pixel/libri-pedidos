-- ==================================================
-- LIBRI CONVITES
-- ATUALIZAÇÃO DOS PREÇOS COMERCIAIS ATIVOS
-- ==================================================

UPDATE settings
SET
  value = '15000',
  updated_at = datetime('now')
WHERE key = 'price_video_full_cents';

UPDATE settings
SET
  value = '6500',
  updated_at = datetime('now')
WHERE key = 'price_video_reduced_cents';

UPDATE settings
SET
  value = '18000',
  updated_at = datetime('now')
WHERE key = 'price_interactive_full_cents';

UPDATE settings
SET
  value = '9500',
  updated_at = datetime('now')
WHERE key = 'price_interactive_reduced_cents';

UPDATE settings
SET
  value = '3900',
  updated_at = datetime('now')
WHERE key = 'addon_filter_cents';
