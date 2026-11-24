-- V3: novos pacotes de Retrospectivas (rascunhos comerciais), sem criar
-- produto ativo ou outro aplicativo. A fonte de preço continua sendo D1.
-- Pix, pedidos, addons e variantes existentes permanecem inalterados.
CREATE TABLE IF NOT EXISTS v3_retrospective_packages (
 code TEXT PRIMARY KEY CHECK(code IN ('RETRO_070','RETRO_100','RETRO_150','RETRO_200','RETRO_250')),
 name TEXT NOT NULL,
 max_photos INTEGER NOT NULL CHECK(max_photos > 0),
 max_videos INTEGER NOT NULL CHECK(max_videos >= 0),
 captions_included INTEGER NOT NULL DEFAULT 0 CHECK(captions_included IN (0,1)),
 price_cents INTEGER NOT NULL CHECK(price_cents > 0),
 points_units INTEGER NOT NULL CHECK(points_units > 0),
 included_json TEXT NOT NULL DEFAULT '[]',
 revision_limit INTEGER,
 minimum_production_days INTEGER NOT NULL DEFAULT 15 CHECK(minimum_production_days >= 15),
 scope_approved INTEGER NOT NULL DEFAULT 0 CHECK(scope_approved IN (0,1)),
 sale_enabled INTEGER NOT NULL DEFAULT 0 CHECK(sale_enabled IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO v3_retrospective_packages
 (code,name,max_photos,max_videos,captions_included,price_cents,points_units,included_json)
SELECT
 json_extract(config_json,'$.retroPackageCode'),name,
 CAST(json_extract(config_json,'$.maxPhotos') AS INTEGER),
 CAST(json_extract(config_json,'$.maxVideos') AS INTEGER),
 CASE WHEN json_extract(config_json,'$.captions')=1 THEN 1 ELSE 0 END,
 price_cents,points_units,
 COALESCE(json_extract(config_json,'$.benefits'),'[]')
FROM v2_addons
WHERE addon_group='retrospectiva' AND code IN ('retro_070','retro_100','retro_150','retro_200','retro_250');
