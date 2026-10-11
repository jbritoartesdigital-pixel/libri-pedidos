-- Stable exact relationship, never inferred from a display name.
-- No payments, guest details or media bytes.
CREATE TABLE IF NOT EXISTS v2_flow_publication_links (
 order_code TEXT NOT NULL PRIMARY KEY,
 slug TEXT NOT NULL UNIQUE,
 verified_at TEXT NOT NULL DEFAULT (datetime('now')),
 FOREIGN KEY(order_code) REFERENCES v2_orders(order_code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_v2_flow_publication_links_slug ON v2_flow_publication_links(slug);
