-- Rascunho criativo próprio do Ateliê. Não toca em briefings nem pedidos V2 existentes.
-- Dados privados acessíveis somente via token individual já usado na Área da Cliente.
CREATE TABLE IF NOT EXISTS v3_atelie_briefings (
  order_id INTEGER PRIMARY KEY REFERENCES v2_orders(id) ON DELETE CASCADE,
  data_json TEXT NOT NULL DEFAULT '{}',
  current_section TEXT NOT NULL DEFAULT 'celebracao',
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
