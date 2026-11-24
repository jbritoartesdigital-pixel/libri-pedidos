-- Modular V3 briefing drafts. No media blobs, no automatic production start.
CREATE TABLE IF NOT EXISTS v3_order_briefing_drafts (
 order_id INTEGER NOT NULL REFERENCES v2_orders(id) ON DELETE CASCADE,
 module TEXT NOT NULL CHECK(module IN ('shared','convite','identidade_visual','retrospectiva')),
 data_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data_json)),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(order_id,module)
);
-- Retrospective media arrives via WhatsApp. Only receipt metadata lives in D1.
CREATE TABLE IF NOT EXISTS v3_retro_material_receipts (
 order_id INTEGER PRIMARY KEY REFERENCES v2_orders(id) ON DELETE CASCADE,
 photo_count INTEGER NOT NULL CHECK(photo_count>=0),
 video_count INTEGER NOT NULL CHECK(video_count>=0),
 received_at TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 CHECK(photo_count+video_count>0)
);
