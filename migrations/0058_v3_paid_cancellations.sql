CREATE TABLE v3_paid_cancellations (
 order_id INTEGER PRIMARY KEY REFERENCES v2_orders(id) ON DELETE RESTRICT,
 status TEXT NOT NULL CHECK(status IN ('review','completed')),
 reason TEXT NOT NULL,
 created_at TEXT NOT NULL,
 completed_at TEXT
);
CREATE TABLE v3_cancellation_charges (
 order_id INTEGER NOT NULL REFERENCES v3_paid_cancellations(order_id),
 charge_key TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('mercado_pago','direct_pix')),
 provider_order_id TEXT,
 reference TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 original_paid_at TEXT,
 status TEXT NOT NULL CHECK(status IN ('review','pending','paid','terminal','refund_requested','refunded')),
 refund_key TEXT NOT NULL UNIQUE,
 refund_confirmed_at TEXT,
 evidence_json TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(order_id,charge_key)
);
