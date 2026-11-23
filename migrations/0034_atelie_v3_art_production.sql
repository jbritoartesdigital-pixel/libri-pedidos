-- Produção artística do Ateliê acoplada ao pedido existente (somente novos pedidos Ateliê).
-- Não altera status V2, pagamentos, agenda, briefings, pedidos ou conteúdo de crianças.
CREATE TABLE IF NOT EXISTS v3_atelie_art_production (
  order_id INTEGER PRIMARY KEY REFERENCES v2_orders(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'briefing' CHECK(stage IN ('briefing','art_direction','creation','revision','approval','delivery')),
  revisions_used INTEGER NOT NULL DEFAULT 0 CHECK(revisions_used >= 0),
  revisions_included INTEGER CHECK(revisions_included IS NULL OR revisions_included >= 0),
  version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS v3_atelie_art_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES v2_orders(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('change_stage','revision_used','extra_quote_requested')),
  from_stage TEXT,
  to_stage TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_v3_atelie_art_history_order
  ON v3_atelie_art_history(order_id, id);
