-- ==================================================
-- LIBRI CONVITES
-- PEDIDOS V2 | ÁREA PRIVADA + BRIEFING
-- ==================================================

PRAGMA foreign_keys = ON;

ALTER TABLE v2_briefing_uploads
  ADD COLUMN field_key TEXT;

ALTER TABLE v2_briefing_uploads
  ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE v2_briefing_uploads
  ADD COLUMN updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_v2_briefing_uploads_field
  ON v2_briefing_uploads(order_id, field_key, sort_order, id);
