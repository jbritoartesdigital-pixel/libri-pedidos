-- BLACK LIBRI | Administração e trilha de auditoria.
-- Campanha totalmente DESATIVADA após a migração.
CREATE TABLE IF NOT EXISTS v2_black_libri_campaign_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  admin_enabled INTEGER NOT NULL DEFAULT 0 CHECK (admin_enabled IN (0,1)),
  compliance_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (compliance_confirmed IN (0,1)),
  authorization_reference TEXT NOT NULL DEFAULT '',
  admin_note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO v2_black_libri_campaign_state
  (id,admin_enabled,compliance_confirmed,authorization_reference,admin_note)
  VALUES (1,0,0,'','');
CREATE TABLE IF NOT EXISTS v2_black_libri_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_code TEXT NOT NULL,
  target_code TEXT,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_black_libri_audit_created
 ON v2_black_libri_audit(created_at DESC);
