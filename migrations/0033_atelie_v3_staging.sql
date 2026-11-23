-- Libri Pedidos V3 / Ateliê: rascunhos internos e isolados do catálogo de venda V2.
-- A migração é somente aditiva. Não cria produto ativo, variante, promoção ou pagamento.
-- Preço, pontos, revisões e quantidades ficam sem valor até aprovação de escopo.
CREATE TABLE IF NOT EXISTS v3_atelie_packages (
  code TEXT PRIMARY KEY CHECK (code IN ('essencia','encanto','universo')),
  name TEXT NOT NULL,
  short_description TEXT NOT NULL,
  included_json TEXT NOT NULL DEFAULT '[]',
  excluded_json TEXT NOT NULL DEFAULT '[]',
  scope_reference TEXT NOT NULL DEFAULT '',
  scope_approved INTEGER NOT NULL DEFAULT 0 CHECK (scope_approved IN (0,1)),
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents > 0),
  points_units INTEGER CHECK (points_units IS NULL OR points_units > 0),
  revision_limit INTEGER CHECK (revision_limit IS NULL OR revision_limit >= 0),
  commercial_notes TEXT NOT NULL DEFAULT '',
  showcase_visible INTEGER NOT NULL DEFAULT 1 CHECK (showcase_visible IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO v3_atelie_packages (code, name, short_description) VALUES
('essencia','Essência','Para começar a criar a aparência da festa, com brasão, nome decorado, elementos e estampa, conforme o escopo aprovado.'),
('encanto','Encanto','Uma identidade visual ampliada, com monograma e aplicações digitais de papelaria conforme o escopo aprovado.'),
('universo','Universo','A versão mais completa, com mais assinaturas, elementos, estampas e aplicações conforme o escopo aprovado.');
