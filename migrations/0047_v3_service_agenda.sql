-- V3 partitions the existing confirmed capacity, not a second capacity ledger.
ALTER TABLE v2_agenda_allocations ADD COLUMN service_family TEXT CHECK(service_family IN ('convite','identidade_visual','retrospectiva'));
ALTER TABLE v3_order_services ADD COLUMN delivery_start TEXT;
ALTER TABLE v3_order_services ADD COLUMN delivery_end TEXT;
ALTER TABLE v3_order_services ADD COLUMN scheduled_at TEXT;
ALTER TABLE v3_order_services ADD COLUMN depends_on_identity INTEGER CHECK(depends_on_identity IN (0,1));
CREATE INDEX idx_v3_agenda_service ON v2_agenda_allocations(order_id,service_family,day);
-- Fail atomically if concurrent reservations consume the proposed capacity.
-- Existing V2 reservations and historical rows remain unchanged.
CREATE TRIGGER trg_v3_service_allocation_capacity
BEFORE INSERT ON v2_agenda_allocations
WHEN NEW.service_family IS NOT NULL
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM v3_order_services s WHERE s.order_id=NEW.order_id AND s.family=NEW.service_family)
 THEN RAISE(ABORT,'v3_service_missing') END;
 SELECT CASE WHEN NEW.points_units + COALESCE((SELECT SUM(points_units) FROM v2_agenda_allocations WHERE day=NEW.day),0)
 + COALESCE((SELECT SUM(a.points_units) FROM v2_checkout_hold_allocations a JOIN v2_checkout_holds h ON h.id=a.hold_id WHERE a.day=NEW.day AND h.status='active' AND julianday(h.expires_at)>julianday('now')),0)
 > COALESCE((SELECT CASE WHEN blocked=1 THEN 0 ELSE sellable_capacity_units END FROM v2_agenda_days WHERE day=NEW.day),400)
 THEN RAISE(ABORT,'v3_capacity_changed') END;
END;
