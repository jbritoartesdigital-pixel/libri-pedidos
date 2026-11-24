-- Independent production and approval history. No changes to V2 previews.
ALTER TABLE v3_order_services ADD COLUMN production_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE v3_order_services ADD COLUMN revisions_used INTEGER NOT NULL DEFAULT 0 CHECK(revisions_used>=0);
CREATE TABLE v3_service_previews (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 service_id INTEGER NOT NULL REFERENCES v3_order_services(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version>0),
 r2_key TEXT NOT NULL UNIQUE,
 mime_type TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes>0),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','adjustments','approved','replaced')),
 published_at TEXT NOT NULL,
 adjustment_deadline TEXT NOT NULL,
 approved_at TEXT,
 UNIQUE(service_id,version)
);
CREATE TABLE v3_service_production_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 service_id INTEGER NOT NULL REFERENCES v3_order_services(id) ON DELETE CASCADE,
 action TEXT NOT NULL,
 actor TEXT NOT NULL CHECK(actor IN ('admin','customer')),
 note TEXT NOT NULL DEFAULT '',
 preview_id INTEGER REFERENCES v3_service_previews(id),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_v3_production_history ON v3_service_production_events(service_id,id);
