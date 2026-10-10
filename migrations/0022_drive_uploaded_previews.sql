-- Libri Drive | registro de uploads de prévias aprovadas
-- Arquivos externos só são enviados após OAuth e vínculo explícito.
CREATE TABLE IF NOT EXISTS v2_drive_uploaded_previews (
  preview_id INTEGER PRIMARY KEY NOT NULL,
  order_code TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(preview_id) REFERENCES v2_previews(id) ON DELETE CASCADE,
  FOREIGN KEY(order_code) REFERENCES v2_orders(order_code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_v2_drive_uploaded_order ON v2_drive_uploaded_previews(order_code);
