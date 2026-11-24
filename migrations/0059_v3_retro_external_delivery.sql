-- Retrospective previews and final delivery are recorded, not uploaded.
ALTER TABLE v3_service_previews ADD COLUMN external_channel TEXT CHECK(external_channel IN ('whatsapp','drive'));
ALTER TABLE v3_service_previews ADD COLUMN external_url TEXT;
ALTER TABLE v3_order_services ADD COLUMN external_delivery_channel TEXT CHECK(external_delivery_channel IN ('whatsapp','drive'));
ALTER TABLE v3_order_services ADD COLUMN external_delivery_url TEXT;
