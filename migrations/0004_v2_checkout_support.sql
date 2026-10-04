-- ==================================================
-- LIBRI CONVITES
-- PEDIDOS V2 | SUPORTE AO CHECKOUT E RESERVA DE AGENDA
--
-- Migration aditiva. Não altera nem apaga dados V1.
-- ==================================================

PRAGMA foreign_keys = ON;

-- ==================================================
-- SEQUÊNCIA VISÍVEL DOS PEDIDOS
-- Mantém códigos LIBRI-XXXX sem reiniciar a numeração
-- do portal antigo.
-- ==================================================

CREATE TABLE IF NOT EXISTS v2_sequences (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

INSERT OR IGNORE INTO v2_sequences(name, value)
SELECT
  'order_number',
  MAX(
    1000,
    COALESCE(
      (
        SELECT MAX(
          CAST(
            SUBSTR(order_code, 7)
            AS INTEGER
          )
        )
        FROM orders
        WHERE order_code GLOB 'LIBRI-[0-9]*'
      ),
      0
    )
  );

-- ==================================================
-- IDEMPOTÊNCIA DO CHECKOUT
-- Evita criar dois pedidos quando a cliente toca
-- duas vezes, recarrega ou a internet repete a chamada.
-- ==================================================

CREATE TABLE IF NOT EXISTS v2_checkout_requests (
  request_key TEXT PRIMARY KEY,
  order_id INTEGER,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (
    status IN ('processing','completed','failed')
  ),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(order_id) REFERENCES v2_orders(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_checkout_requests_order
  ON v2_checkout_requests(order_id);

-- ==================================================
-- ÍNDICES DE RESERVA
-- ==================================================

CREATE INDEX IF NOT EXISTS idx_v2_checkout_holds_active_expiry
  ON v2_checkout_holds(status, expires_at);

-- ==================================================
-- CONFIGURAÇÕES ADICIONAIS
-- Valor inicial configurável. Não é hard lock.
-- ==================================================

INSERT OR IGNORE INTO v2_settings(key, value) VALUES
  ('minimum_delivery_days_before_event', '3');
