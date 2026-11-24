-- Administrative exception; public cart remains 100% and immutable.
CREATE TABLE v3_admin_payment_policies (
 order_id INTEGER PRIMARY KEY REFERENCES v2_orders(id),
 deposit_percent INTEGER NOT NULL CHECK(deposit_percent IN(50,100)),
 reason TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE v3_admin_pix_receipts (
 request_key TEXT PRIMARY KEY,
 order_id INTEGER NOT NULL REFERENCES v2_orders(id),
 payment_id INTEGER NOT NULL UNIQUE REFERENCES v2_payments(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 paid_at TEXT NOT NULL,
 note TEXT NOT NULL
);
