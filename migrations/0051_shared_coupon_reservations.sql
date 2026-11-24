-- One reservation per order, shared by V2 and V3 provider checkouts.
-- Unknown provider outcomes remain reserved; elapsed time alone is not proof of cancellation.
CREATE TABLE v3_coupon_reservations (
 order_id INTEGER PRIMARY KEY REFERENCES v2_orders(id) ON DELETE CASCADE,
 coupon_id INTEGER NOT NULL REFERENCES v2_coupons(id),
 customer_id INTEGER NOT NULL REFERENCES v2_customers(id),
 hold_token TEXT,
 provider_order_id TEXT,
 reserved_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_v3_coupon_reservations_coupon ON v3_coupon_reservations(coupon_id,customer_id);
-- Conservatively preserve pre-existing pending and uncertain checkout attempts.
INSERT INTO v3_coupon_reservations(order_id,coupon_id,customer_id,hold_token,provider_order_id)
SELECT o.id,c.id,o.customer_id,NULL,NULL
FROM v2_orders o JOIN v2_order_pricing p ON p.order_id=o.id
JOIN v2_coupons c ON c.id=json_extract(CASE WHEN json_valid(p.pricing_snapshot_json) THEN p.pricing_snapshot_json ELSE '{}' END,'$.coupon.id')
WHERE p.coupon_discount_cents>0
AND NOT EXISTS(SELECT 1 FROM v2_coupon_uses u WHERE u.order_id=o.id AND u.coupon_id=c.id)
AND (EXISTS(SELECT 1 FROM v2_payments pay WHERE pay.order_id=o.id AND pay.status IN ('pending','approved','refunded'))
OR EXISTS(SELECT 1 FROM v2_checkout_holds h WHERE h.order_id=o.id AND h.status IN ('active','expired') AND NOT EXISTS(SELECT 1 FROM v2_payments pay WHERE pay.order_id=o.id)));
CREATE TRIGGER v3_coupon_reservation_limit BEFORE INSERT ON v3_coupon_reservations
BEGIN
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM v2_coupons c WHERE c.id=NEW.coupon_id AND (
 (c.max_uses IS NOT NULL AND c.max_uses <=
 (SELECT COUNT(*) FROM v2_coupon_uses u WHERE u.coupon_id=c.id)
 + (SELECT COUNT(*) FROM v3_coupon_reservations r WHERE r.coupon_id=c.id AND NOT EXISTS(SELECT 1 FROM v2_coupon_uses u WHERE u.coupon_id=r.coupon_id AND u.order_id=r.order_id)))
 OR (c.max_uses_per_customer IS NOT NULL AND c.max_uses_per_customer <=
 (SELECT COUNT(*) FROM v2_coupon_uses u WHERE u.coupon_id=c.id AND u.customer_id=NEW.customer_id)
 + (SELECT COUNT(*) FROM v3_coupon_reservations r WHERE r.coupon_id=c.id AND r.customer_id=NEW.customer_id AND NOT EXISTS(SELECT 1 FROM v2_coupon_uses u WHERE u.coupon_id=r.coupon_id AND u.order_id=r.order_id)))
 )) THEN RAISE(ABORT,'coupon_reservation_limit') END;
END;
