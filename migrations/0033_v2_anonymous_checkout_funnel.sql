-- Anonymous first-party checkout funnel. No phone, email, name, IP or cart content.
-- Only a random per-tab UUID and the last checkout step, for 45-day retention.
CREATE TABLE IF NOT EXISTS v2_funnel_sessions (
  id TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_step INTEGER NOT NULL CHECK(last_step BETWEEN 0 AND 10),
  max_step INTEGER NOT NULL CHECK(max_step BETWEEN 0 AND 10),
  checkout_created INTEGER NOT NULL DEFAULT 0 CHECK(checkout_created IN (0,1)),
  simulated INTEGER NOT NULL DEFAULT 0 CHECK(simulated IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_v2_funnel_first ON v2_funnel_sessions(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_v2_funnel_last ON v2_funnel_sessions(last_seen_at);
