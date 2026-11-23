-- Libri Ateliê: conclusão do briefing, registro auditável e reabertura administrativa.
-- Não altera o status do pedido V2 nem a política financeira ou a agenda.
CREATE TABLE IF NOT EXISTS v3_atelie_briefing_submissions (
  order_id INTEGER PRIMARY KEY REFERENCES v2_orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','reopened')),
  submitted_revision INTEGER NOT NULL CHECK(submitted_revision >= 0),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  reopened_at TEXT,
  reopened_note TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
);
CREATE TABLE IF NOT EXISTS v3_atelie_briefing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES v2_orders(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('submitted','reopened')),
  revision INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_v3_atelie_briefing_events_order
 ON v3_atelie_briefing_events(order_id,id);
