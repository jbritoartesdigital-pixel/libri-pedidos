-- Final digital files are separate from previews and source materials.
ALTER TABLE v3_order_services ADD COLUMN delivered_at TEXT;
ALTER TABLE v3_order_services ADD COLUMN download_until TEXT;
ALTER TABLE v3_order_services ADD COLUMN originals_until TEXT;
ALTER TABLE v3_order_services ADD COLUMN interactive_url TEXT;
ALTER TABLE v3_service_previews ADD COLUMN purged_at TEXT;
CREATE TABLE v3_service_final_files (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 service_id INTEGER NOT NULL REFERENCES v3_order_services(id) ON DELETE CASCADE,
 filename TEXT NOT NULL,
 mime_type TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes>0),
 r2_key TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 purged_at TEXT
);
CREATE INDEX idx_v3_final_files_service ON v3_service_final_files(service_id);
CREATE INDEX idx_v3_service_retention ON v3_order_services(originals_until,download_until);
CREATE TABLE v3_delivery_notices (
 service_id INTEGER NOT NULL REFERENCES v3_order_services(id) ON DELETE CASCADE,
 notice_code TEXT NOT NULL CHECK(notice_code IN ('download_7_days','download_1_day')),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(service_id,notice_code)
);
