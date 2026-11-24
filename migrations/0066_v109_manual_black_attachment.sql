-- Bind a reserved Black surprise to the already-existing manual checkout.
-- The same immutable request key used by the original manual snapshot proves ownership.
CREATE TRIGGER v3_black_attach_manual_update
AFTER UPDATE OF quote_json ON v3_order_checkout_snapshots
WHEN json_extract(OLD.quote_json,'$.blackLibri.claimId') IS NULL
 AND json_extract(NEW.quote_json,'$.blackLibri.claimId') IS NOT NULL
BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM v2_orders o JOIN v2_black_libri_claims c
   ON c.id=json_extract(NEW.quote_json,'$.blackLibri.claimId')
  WHERE o.id=NEW.order_id AND o.source='manual_whatsapp'
   AND c.client_request_id='v3:'||NEW.request_key
   AND c.status='reserved' AND c.order_id IS NULL
   AND julianday(c.expires_at)>julianday('now')
 ) THEN RAISE(ABORT,'v3_black_reservation_changed') END;
 UPDATE v2_black_libri_claims SET order_id=NEW.order_id,status='attached',updated_at=datetime('now')
 WHERE id=json_extract(NEW.quote_json,'$.blackLibri.claimId');
END;
