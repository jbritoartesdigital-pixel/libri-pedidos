-- Explicit staff review, independent of receipt counts and draft submission.
ALTER TABLE v3_retro_material_receipts ADD COLUMN complete_at TEXT;
ALTER TABLE v3_order_services ADD COLUMN briefing_submitted_at TEXT;
ALTER TABLE v3_order_services ADD COLUMN complement_note TEXT;
ALTER TABLE v3_order_services ADD COLUMN reviewed_at TEXT;
