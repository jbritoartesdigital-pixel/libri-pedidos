-- Attach the private prize inside the same atomic batch as the V3 order.
-- No separate claim update can leave a paid order with an unattached gift.
CREATE TRIGGER v3_black_attach AFTER INSERT ON v3_order_checkout_snapshots
WHEN json_extract(NEW.quote_json,'$.blackLibri.claimId') IS NOT NULL
BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM v2_black_libri_claims c
  WHERE c.id=json_extract(NEW.quote_json,'$.blackLibri.claimId')
   AND c.client_request_id='v3:'||NEW.request_key
   AND c.status='reserved' AND c.order_id IS NULL AND julianday(c.expires_at)>julianday('now')
 ) THEN RAISE(ABORT,'v3_black_reservation_changed') END;
 UPDATE v2_black_libri_claims SET order_id=NEW.order_id,status='attached',updated_at=datetime('now')
 WHERE id=json_extract(NEW.quote_json,'$.blackLibri.claimId');
END;
