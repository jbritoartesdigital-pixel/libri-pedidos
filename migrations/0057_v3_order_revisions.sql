CREATE TABLE v3_order_revisions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL REFERENCES v2_orders(id) ON DELETE RESTRICT,
 request_key TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('edit','manual')),
 status TEXT NOT NULL DEFAULT 'offered' CHECK(status IN ('offered','accepted','cancelled')),
 input_json TEXT NOT NULL,
 previous_quote_json TEXT,
 quote_json TEXT NOT NULL,
 terms_json TEXT NOT NULL,
 reason TEXT NOT NULL,
 created_at TEXT NOT NULL,
 accepted_at TEXT
);
CREATE UNIQUE INDEX v3_one_pending_revision ON v3_order_revisions(order_id) WHERE status='offered';
