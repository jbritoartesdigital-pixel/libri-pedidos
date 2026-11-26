-- A date explicitly assigned by the administrator is not subject to the public sales limit.
-- Only the authenticated manual-order production action requests this exception.
ALTER TABLE v2_agenda_allocations ADD COLUMN manual_override INTEGER NOT NULL DEFAULT 0 CHECK(manual_override IN (0,1));
DROP TRIGGER trg_v3_service_allocation_capacity;
CREATE TRIGGER trg_v3_service_allocation_capacity
BEFORE INSERT ON v2_agenda_allocations
WHEN NEW.service_family IS NOT NULL OR NEW.manual_override=1
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM v3_order_services s WHERE s.order_id=NEW.order_id AND s.family=NEW.service_family)
 THEN RAISE(ABORT,'v3_service_missing') END;
 SELECT CASE WHEN NEW.manual_override=1 AND (
  NEW.allocation_type!='confirmed' OR NOT EXISTS(
   SELECT 1 FROM v2_orders o JOIN v3_order_checkout_snapshots snap ON snap.order_id=o.id
   WHERE o.id=NEW.order_id AND o.source='manual_whatsapp' AND o.archived_at IS NULL
   AND o.briefing_status!='locked' AND o.status NOT IN ('configuring','awaiting_payment','cancelled')
   AND EXISTS(SELECT 1 FROM v2_payments p WHERE p.order_id=o.id AND p.status='approved' AND p.payment_type!='refund')
   AND NOT EXISTS(SELECT 1 FROM v3_paid_cancellations c WHERE c.order_id=o.id)
  )
 ) THEN RAISE(ABORT,'v3_manual_override_not_allowed') END;
 SELECT CASE WHEN NEW.manual_override=1 AND NEW.points_units+
  COALESCE((SELECT SUM(a.points_units) FROM v2_agenda_allocations a WHERE a.order_id=NEW.order_id AND a.service_family=NEW.service_family),0)
  > (SELECT s.points_units-COALESCE(s.released_points_units,0) FROM v3_order_services s WHERE s.order_id=NEW.order_id AND s.family=NEW.service_family)
 THEN RAISE(ABORT,'v3_manual_points_exceeded') END;
 SELECT CASE WHEN NEW.manual_override=0 AND NEW.points_units + COALESCE((SELECT SUM(points_units) FROM v2_agenda_allocations WHERE day=NEW.day),0)
 + COALESCE((SELECT SUM(a.points_units) FROM v2_checkout_hold_allocations a JOIN v2_checkout_holds h ON h.id=a.hold_id WHERE h.status='active' AND julianday(h.expires_at)>julianday('now')),0)
 > COALESCE((SELECT CASE WHEN blocked=1 THEN 0 ELSE sellable_capacity_units END FROM v2_agenda_days WHERE day=NEW.day),400)
 THEN RAISE(ABORT,'v3_capacity_changed') END;
END;
