-- ==================================================
-- LIBRI CONVITES
-- PEDIDOS V2 | NOTIFICAÇÕES + WEB PUSH
--
-- Migration aditiva.
-- Amplia o sino do Admin e prepara Web Push/PWA.
-- ==================================================

PRAGMA foreign_keys = ON;

ALTER TABLE v2_notifications
  ADD COLUMN dedupe_key TEXT;

ALTER TABLE v2_notifications
  ADD COLUMN push_attempted_at TEXT;

ALTER TABLE v2_notifications
  ADD COLUMN push_sent_at TEXT;

ALTER TABLE v2_notifications
  ADD COLUMN push_error TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_notifications_dedupe
  ON v2_notifications(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_v2_notifications_push_pending
  ON v2_notifications(
    push_eligible,
    push_sent_at,
    created_at
  );

CREATE TABLE IF NOT EXISTS v2_notification_preferences (
  event_code TEXT PRIMARY KEY,

  bell_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (bell_enabled IN (0,1)),

  push_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (push_enabled IN (0,1)),

  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO v2_notification_preferences(
  event_code,
  bell_enabled,
  push_enabled
)
VALUES
  ('PAYMENT_CONFIRMED', 1, 1),
  ('BRIEFING_COMPLETED', 1, 1),
  ('URGENCY_REQUESTED', 1, 1),
  ('PREVIEW_APPROVED', 1, 1),
  ('BALANCE_RECEIVED', 1, 1),
  ('EVENT_TODAY', 1, 1),
  ('CAPACITY_RELEASED', 1, 1),
  ('ADMIN_PASSKEY_REGISTERED', 1, 0),
  ('ADMIN_PASSKEY_REVOKED', 1, 0);
