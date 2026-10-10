-- ETAPA 3 | conexão OAuth do Google Drive em modo opcional
-- Somente tokens AES-GCM; nunca armazenar credenciais Google sem criptografia.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS v2_drive_oauth_state (
  state_hash TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_drive_oauth_state_expiry
  ON v2_drive_oauth_state(expires_at);
CREATE TABLE IF NOT EXISTS v2_drive_oauth_connection (
  account_key TEXT PRIMARY KEY CHECK(account_key='primary'),
  encrypted_refresh TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
