-- ==================================================
-- LIBRI CONVITES
-- PEDIDOS V2 | PASSKEY / WEBAUTHN ADMIN
--
-- Migration aditiva.
-- Não armazena biometria.
-- Armazena apenas credenciais públicas WebAuthn,
-- challenges temporários e sessões administrativas.
-- ==================================================

PRAGMA foreign_keys = ON;

ALTER TABLE v2_admin_passkeys
  ADD COLUMN credential_device_type TEXT;

ALTER TABLE v2_admin_passkeys
  ADD COLUMN backed_up INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS v2_admin_webauthn_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  token_hash TEXT NOT NULL UNIQUE,

  purpose TEXT NOT NULL CHECK (
    purpose IN (
      'registration',
      'authentication'
    )
  ),

  challenge TEXT NOT NULL,

  expected_origin TEXT NOT NULL,

  rp_id TEXT NOT NULL,

  authorization_mode TEXT CHECK (
    authorization_mode IN (
      'recovery',
      'session',
      'public_auth'
    )
  ),

  device_label TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  expires_at TEXT NOT NULL,

  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_v2_admin_challenges_open
  ON v2_admin_webauthn_challenges(
    purpose,
    expires_at,
    used_at
  );

CREATE INDEX IF NOT EXISTS idx_v2_admin_sessions_active
  ON v2_admin_sessions(
    expires_at,
    revoked_at
  );
