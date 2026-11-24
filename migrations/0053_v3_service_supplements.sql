-- Supplemental offers are independent from original paid checkout records.
CREATE TABLE v3_service_supplements (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 service_id INTEGER NOT NULL REFERENCES v3_order_services(id) ON DELETE RESTRICT,
 request_key TEXT NOT NULL UNIQUE,
 selection_json TEXT NOT NULL,
 offer_json TEXT NOT NULL,
 base_production_version INTEGER NOT NULL,
 base_snapshot_json TEXT NOT NULL,
 subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents>0),
 card_fee_cents INTEGER NOT NULL CHECK(card_fee_cents>=0),
 total_cents INTEGER NOT NULL CHECK(total_cents=subtotal_cents+card_fee_cents),
 points_units INTEGER NOT NULL CHECK(points_units>=0),
 payment_method TEXT NOT NULL CHECK(payment_method IN ('pix','card')),
 status TEXT NOT NULL DEFAULT 'offered' CHECK(status IN ('offered','accepted','declined','cancelled','payment_pending','paid','review')),
 note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 decided_at TEXT,
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX v3_one_open_supplement ON v3_service_supplements(service_id)
 WHERE status IN ('offered','accepted','payment_pending','review');
CREATE INDEX v3_service_supplement_history ON v3_service_supplements(service_id,id);
