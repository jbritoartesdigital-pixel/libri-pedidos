-- V3 adds per-service tracking to the EXISTING order model. No backfill,
-- checkout activation, payment creation or changes to historical orders.
CREATE TABLE IF NOT EXISTS v3_order_checkout_snapshots (
 order_id INTEGER PRIMARY KEY REFERENCES v2_orders(id) ON DELETE CASCADE,
 request_key TEXT NOT NULL UNIQUE,
 request_hash TEXT NOT NULL,
 quote_json TEXT NOT NULL CHECK(json_valid(quote_json)),
 terms_version TEXT NOT NULL REFERENCES v2_terms_versions(version),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS v3_order_services (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL REFERENCES v2_orders(id) ON DELETE CASCADE,
 family TEXT NOT NULL CHECK(family IN ('convite','identidade_visual','retrospectiva')),
 product_code TEXT NOT NULL,
 variant_code TEXT NOT NULL,
 gross_cents INTEGER NOT NULL CHECK(gross_cents>=0),
 discount_cents INTEGER NOT NULL CHECK(discount_cents>=0),
 total_cents INTEGER NOT NULL CHECK(total_cents>=0 AND total_cents=gross_cents-discount_cents),
 points_units INTEGER NOT NULL CHECK(points_units>=0),
 production_days INTEGER NOT NULL CHECK(production_days>=0),
 commercial_snapshot_json TEXT NOT NULL CHECK(json_valid(commercial_snapshot_json)),
 briefing_status TEXT NOT NULL DEFAULT 'locked' CHECK(briefing_status IN ('locked','available','in_progress','completed')),
 production_status TEXT NOT NULL DEFAULT 'pending' CHECK(production_status IN ('pending','ready','in_production','waiting_customer','adjustments','approved','delivered','cancelled')),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(order_id,family)
);
