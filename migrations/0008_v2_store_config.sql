-- ==================================================
-- LIBRI CONVITES
-- PEDIDOS V2 | LOJA E CONFIGURAÇÕES
--
-- Migration aditiva.
-- Amplia galeria, dados da empresa e modelos de contrato.
-- ==================================================

PRAGMA foreign_keys = ON;

ALTER TABLE v2_gallery_items
  ADD COLUMN media_type TEXT;

ALTER TABLE v2_gallery_items
  ADD COLUMN original_filename TEXT;

ALTER TABLE v2_gallery_items
  ADD COLUMN mime_type TEXT;

ALTER TABLE v2_gallery_items
  ADD COLUMN size_bytes INTEGER;

ALTER TABLE v2_gallery_items
  ADD COLUMN caption TEXT;

CREATE TABLE IF NOT EXISTS v2_contract_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_v2_contract_templates_active
  ON v2_contract_templates(active, version DESC);

INSERT OR IGNORE INTO v2_settings(key, value) VALUES
  ('company_name', 'Libri Convites'),
  ('company_legal_name', ''),
  ('company_document', ''),
  ('company_email', ''),
  ('company_instagram', '@libriconvites'),
  ('company_address', ''),
  ('company_city', ''),
  ('company_state', ''),
  ('gallery_max_upload_mb', '80');

INSERT OR IGNORE INTO v2_settings(key, value) VALUES
  ('mercado_pago_installments_cost', 'buyer');
