-- Private creative reference files of Libri Ateliê, linked to the existing order.
-- No V2 uploads altered. No public gallery. No automatic portfolio rights.
CREATE TABLE IF NOT EXISTS v3_atelie_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES v2_orders(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL CHECK (field_key IN ('referenceFiles','childPhotos')),
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','image/heic','image/heif')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 15728640),
  r2_key TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_v3_atelie_uploads_order_field
 ON v3_atelie_uploads(order_id,field_key,id);
