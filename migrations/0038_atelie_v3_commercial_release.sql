-- Commercial release gate. Existing invitations, coupons, payments and orders untouched.
-- All packages remain NOT FOR SALE unless explicitly approved inside the Admin.
ALTER TABLE v3_atelie_packages ADD COLUMN sale_enabled INTEGER NOT NULL DEFAULT 0 CHECK(sale_enabled IN (0,1));
ALTER TABLE v3_atelie_packages ADD COLUMN specific_terms TEXT NOT NULL DEFAULT '';
ALTER TABLE v3_atelie_packages ADD COLUMN activated_at TEXT;
