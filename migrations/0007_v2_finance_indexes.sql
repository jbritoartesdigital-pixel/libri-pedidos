-- ==================================================
-- LIBRI CONVITES
-- PEDIDOS V2 | ÍNDICES FINANCEIROS
--
-- Migration aditiva.
-- Não altera valores nem movimentações.
-- Apenas otimiza os relatórios do Financeiro V2.
-- ==================================================

PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_v2_payments_finance_paid
  ON v2_payments(status, paid_at, order_id);

CREATE INDEX IF NOT EXISTS idx_v2_payments_finance_order
  ON v2_payments(order_id, status, payment_type, paid_at);

CREATE INDEX IF NOT EXISTS idx_v2_order_items_finance_product
  ON v2_order_items(item_type, order_id, item_code);
