-- Libri Drive | sincronização opt-in de prévias com retry limitado
CREATE TABLE IF NOT EXISTS v2_drive_sync_settings (
  account_key TEXT PRIMARY KEY CHECK(account_key='primary'),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  enabled_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO v2_drive_sync_settings(account_key,enabled)
VALUES ('primary',0);
CREATE TABLE IF NOT EXISTS v2_drive_sync_attempts (
  preview_id INTEGER PRIMARY KEY NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_failed_at TEXT,
  FOREIGN KEY(preview_id) REFERENCES v2_previews(id) ON DELETE CASCADE
);
