-- Only short-lived device authorizations, isolated from orders, payments and customer records.
-- No raw tokens, biometrics or administrative session cookies are stored here.
CREATE TABLE IF NOT EXISTS v2_flow_device_grants (
 token_hash TEXT PRIMARY KEY NOT NULL,
 nonce_hash TEXT NOT NULL,
 device_label TEXT NOT NULL,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_v2_flow_device_grants_expires
 ON v2_flow_device_grants(expires_at, used_at);
