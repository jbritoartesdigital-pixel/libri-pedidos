-- Supplemental provider orders are never original v2_payments.
-- A null-parent hold participates in the shared agenda without being converted
-- by a repeated webhook for the original paid order.
CREATE TABLE v3_supplement_payments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 supplement_id INTEGER NOT NULL REFERENCES v3_service_supplements(id) ON DELETE RESTRICT,
 attempt_key TEXT NOT NULL UNIQUE,
 hold_id INTEGER NOT NULL UNIQUE REFERENCES v2_checkout_holds(id) ON DELETE RESTRICT,
 external_reference TEXT NOT NULL UNIQUE,
 provider_order_id TEXT UNIQUE,
 checkout_url TEXT,
 request_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating','pending','approved','cancelled','expired','rejected','review','refunded')),
 expires_at TEXT NOT NULL,
 paid_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX v3_one_live_supplement_payment ON v3_supplement_payments(supplement_id)
 WHERE status IN ('creating','pending','approved','review','refunded');
ALTER TABLE v3_order_services ADD COLUMN effective_snapshot_json TEXT;
ALTER TABLE v3_service_supplements ADD COLUMN applied_at TEXT;
CREATE TRIGGER v3_supplement_hold_capacity BEFORE INSERT ON v2_checkout_hold_allocations
WHEN EXISTS(SELECT 1 FROM v3_supplement_payments p WHERE p.hold_id=NEW.hold_id)
BEGIN
 SELECT CASE WHEN NEW.points_units+COALESCE((SELECT SUM(points_units) FROM v2_agenda_allocations WHERE day=NEW.day),0)
 +COALESCE((SELECT SUM(a.points_units) FROM v2_checkout_hold_allocations a JOIN v2_checkout_holds h ON h.id=a.hold_id WHERE a.day=NEW.day AND h.status='active' AND julianday(h.expires_at)>julianday('now')),0)
 >COALESCE((SELECT CASE WHEN blocked=1 THEN 0 ELSE sellable_capacity_units END FROM v2_agenda_days WHERE day=NEW.day),400)
 THEN RAISE(ABORT,'v3_supplement_capacity_changed') END;
END;
