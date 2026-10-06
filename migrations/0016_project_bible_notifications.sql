-- ==================================================
-- LIBRI PEDIDOS V2 | PROJECT BIBLE
-- Preferências para eventos operacionais adicionais.
-- ==================================================

PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO v2_notification_preferences(
  event_code,
  bell_enabled,
  push_enabled
)
VALUES
  ('EVENT_TOMORROW', 1, 1),
  ('DELIVERY_TOMORROW', 1, 1),
  ('ACTION_REQUIRED', 1, 1);
