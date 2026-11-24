-- Private media for V3 services; retrospective never uploads here.
CREATE TABLE v3_service_uploads (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL,
 family TEXT NOT NULL CHECK(family IN ('convite','identidade_visual')),
 field_key TEXT NOT NULL,
 original_filename TEXT NOT NULL,
 mime_type TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes>0 AND size_bytes<=15728640),
 r2_key TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 FOREIGN KEY(order_id,family) REFERENCES v3_order_services(order_id,family) ON DELETE CASCADE
);
CREATE INDEX v3_service_uploads_field_idx ON v3_service_uploads(order_id,family,field_key);
