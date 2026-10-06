-- ==================================================
-- LIBRI CONVITES
-- RENOME COMERCIAL DO LIBRI MOMENTS
-- ==================================================

PRAGMA foreign_keys = ON;

UPDATE v2_addons
SET name = CASE code
  WHEN 'moments_festa' THEN 'Álbum da Festa • Festa'
  WHEN 'moments_premium' THEN 'Álbum da Festa • Premium'
  WHEN 'moments_exclusive' THEN 'Álbum da Festa • Exclusive'
  WHEN 'moments_extra_100' THEN 'Álbum da Festa • +100 fotos'
  ELSE name
END
WHERE code IN (
  'moments_festa',
  'moments_premium',
  'moments_exclusive',
  'moments_extra_100'
);

UPDATE v2_combos
SET description = replace(
  description,
  'Libri Moments',
  'Álbum da Festa'
)
WHERE description LIKE '%Libri Moments%';

INSERT OR REPLACE INTO v2_settings(
  key,
  value,
  updated_at
)
VALUES (
  'moments_public_label',
  'Álbum da Festa',
  datetime('now')
);
