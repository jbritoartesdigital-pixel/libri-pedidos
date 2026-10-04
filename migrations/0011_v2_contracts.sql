-- ==================================================
-- LIBRI CONVITES
-- PEDIDOS V2 | CONTRATOS ELETRÔNICOS
--
-- Migration aditiva.
-- Complementa o modelo já criado em 0003 e 0008.
-- ==================================================

PRAGMA foreign_keys = ON;

ALTER TABLE v2_contracts
  ADD COLUMN template_version INTEGER;

ALTER TABLE v2_contracts
  ADD COLUMN sent_to_customer_at TEXT;

ALTER TABLE v2_contracts
  ADD COLUMN pdf_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_v2_contracts_order_status
  ON v2_contracts(order_id, status, version DESC);

INSERT OR IGNORE INTO v2_notification_preferences(
  event_code,
  bell_enabled,
  push_enabled
)
VALUES
  ('CONTRACT_READY_CUSTOMER', 1, 0),
  ('CONTRACT_SIGNED', 1, 1);
