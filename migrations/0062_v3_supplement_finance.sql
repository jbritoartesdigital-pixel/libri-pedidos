ALTER TABLE v3_supplement_payments ADD COLUMN finance_payment_id TEXT;
ALTER TABLE v3_supplement_payments ADD COLUMN finance_net_cents INTEGER CHECK(finance_net_cents>=0);
ALTER TABLE v3_supplement_payments ADD COLUMN finance_fee_cents INTEGER CHECK(finance_fee_cents>=0);
ALTER TABLE v3_supplement_payments ADD COLUMN finance_paid_at TEXT;
ALTER TABLE v3_supplement_payments ADD COLUMN finance_verified_at TEXT;
ALTER TABLE v3_supplement_payments ADD COLUMN finance_attempted_at TEXT;
CREATE UNIQUE INDEX v3_supplement_finance_payment_unique ON v3_supplement_payments(finance_payment_id) WHERE finance_payment_id IS NOT NULL;
