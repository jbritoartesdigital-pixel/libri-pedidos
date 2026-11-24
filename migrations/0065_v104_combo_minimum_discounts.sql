-- V104: initial fixed combo incentives, in cents. Preserve custom values and inactive combos.
UPDATE v2_combos
SET discount_type='fixed', discount_value=CASE code
  WHEN 'convite_save' THEN 500
  WHEN 'antes_festa' THEN 800
  WHEN 'organizacao' THEN 800
  WHEN 'festa_completa' THEN 1000
  WHEN 'libri_completo' THEN 1500
END
WHERE active=1 AND discount_value=0
  AND code IN ('convite_save','antes_festa','organizacao','festa_completa','libri_completo');
