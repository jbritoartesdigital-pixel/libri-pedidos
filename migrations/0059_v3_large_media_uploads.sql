-- Private multipart uploads for produced retrospective media only.
CREATE TABLE v3_large_media_uploads (
 id TEXT PRIMARY KEY,
 service_id INTEGER NOT NULL REFERENCES v3_order_services(id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK(kind IN ('preview','final')),
 production_version INTEGER NOT NULL,
 filename TEXT NOT NULL,
 mime_type TEXT NOT NULL CHECK(mime_type IN ('video/mp4','video/webm')),
 size_bytes INTEGER NOT NULL CHECK(size_bytes>0 AND size_bytes<=536870912),
 r2_key TEXT NOT NULL UNIQUE,
 upload_id TEXT NOT NULL,
 parts_json TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL CHECK(status IN ('open','completed')),
 expires_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_v3_one_large_upload ON v3_large_media_uploads(service_id) WHERE status='open';
CREATE INDEX idx_v3_large_media_expiry ON v3_large_media_uploads(expires_at);
