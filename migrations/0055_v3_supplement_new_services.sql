-- Newly contracted families are separate from the original checkout's immutable scope.
ALTER TABLE v3_order_services ADD COLUMN origin_supplement_id INTEGER REFERENCES v3_service_supplements(id);
CREATE UNIQUE INDEX v3_service_origin_supplement ON v3_order_services(origin_supplement_id) WHERE origin_supplement_id IS NOT NULL;
