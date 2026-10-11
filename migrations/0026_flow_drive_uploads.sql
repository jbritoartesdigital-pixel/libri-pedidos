-- Resumable Google Drive uploads initiated by authenticated Libri Flow admin.
-- Session URLs are confidential and never returned to the browser/app.
CREATE TABLE IF NOT EXISTS v2_flow_drive_uploads (
 id TEXT PRIMARY KEY NOT NULL,
 order_code TEXT NOT NULL,
 folder_id TEXT NOT NULL,
 filename TEXT NOT NULL,
 mime_type TEXT NOT NULL,
 size_bytes INTEGER NOT NULL,
 sha256 TEXT NOT NULL,
 session_url TEXT NOT NULL,
 offset_bytes INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','uploading','done','failed')),
 google_file_id TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 FOREIGN KEY(order_code) REFERENCES v2_orders(order_code)
);
CREATE INDEX IF NOT EXISTS idx_v2_flow_drive_order ON v2_flow_drive_uploads(order_code,created_at);
