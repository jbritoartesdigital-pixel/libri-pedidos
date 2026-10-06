-- ==================================================
-- LIBRI PEDIDOS V2
-- ARQUIVO OPERACIONAL DE PEDIDOS
-- ==================================================

PRAGMA foreign_keys = ON;

ALTER TABLE v2_orders
ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_v2_orders_archived_at
ON v2_orders(archived_at);

-- Legados históricos já finalizados entram no arquivo automaticamente.
-- Eles continuam disponíveis para consulta e permanecem no histórico financeiro.
UPDATE v2_orders
SET archived_at = COALESCE(
  finalized_at,
  updated_at,
  datetime('now')
)
WHERE
  archived_at IS NULL
  AND event_subtype = 'legacy_v1'
  AND status = 'finalized'
  AND event_date < date('now');
