-- ==================================================
-- LIBRI CONVITES
-- PEDIDOS V2 | MERCADO PAGO ORDERS API
--
-- Migration aditiva. Não altera nem apaga dados V1.
-- ==================================================

PRAGMA foreign_keys = ON;

ALTER TABLE v2_payments
  ADD COLUMN provider_order_id TEXT;

ALTER TABLE v2_payments
  ADD COLUMN provider_status TEXT;

ALTER TABLE v2_payments
  ADD COLUMN provider_status_detail TEXT;

ALTER TABLE v2_payments
  ADD COLUMN checkout_url TEXT;

ALTER TABLE v2_payments
  ADD COLUMN external_reference TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_payments_provider_order
  ON v2_payments(provider, provider_order_id)
  WHERE provider_order_id IS NOT NULL;

INSERT OR IGNORE INTO v2_settings(key, value) VALUES
  ('mercado_pago_max_installments', '12'),
  ('mercado_pago_installments_cost', 'buyer'),
  ('mercado_pago_order_expiry_minutes', '25');
