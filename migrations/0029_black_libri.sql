-- Black Libri: estrutura inativa até ativação explícita por variáveis seguras.
-- Os pesos somam 200 (100% na disponibilidade inicial). O estoque é real,
-- considerando reservas não expiradas + prêmios vinculados ou pagos.
CREATE TABLE IF NOT EXISTS v2_black_libri_prizes (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('fixed','percent','gift')),
  value INTEGER NOT NULL DEFAULT 0 CHECK(value >= 0),
  weight INTEGER NOT NULL CHECK(weight > 0),
  max_claims INTEGER CHECK(max_claims IS NULL OR max_claims > 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS v2_black_libri_claims (
  id TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL UNIQUE,
  client_request_id TEXT NOT NULL,
  prize_code TEXT NOT NULL REFERENCES v2_black_libri_prizes(code),
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK(status IN ('reserved','attached','redeemed','expired')),
  order_id INTEGER REFERENCES v2_orders(id) ON DELETE SET NULL,
  revealed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_black_libri_stock ON v2_black_libri_claims(prize_code,status,expires_at);
CREATE INDEX IF NOT EXISTS idx_black_libri_order ON v2_black_libri_claims(order_id);

INSERT OR IGNORE INTO v2_black_libri_prizes
  (code,label,kind,value,weight,max_claims,description,sort_order) VALUES
  ('off_10','R$ 10 de desconto','fixed',1000,30,NULL,'Desconto fixo',1),
  ('off_15','R$ 15 de desconto','fixed',1500,20,30,'Desconto fixo',2),
  ('off_20','R$ 20 de desconto','fixed',2000,8,15,'Desconto fixo',3),
  ('off_5p','5% OFF','percent',5,30,NULL,'Desconto percentual',4),
  ('off_8p','8% OFF','percent',8,14,15,'Desconto percentual',5),
  ('off_10p','10% OFF','percent',10,6,8,'Desconto percentual',6),
  ('save_static','Save the Date estático','gift',0,18,30,'Uma arte digital estática',7),
  ('save_animated','Save the Date animado','gift',0,6,12,'Uma arte digital animada',8),
  ('photo_filter','Filtro ou moldura digital','gift',0,14,20,'Um filtro ou moldura temática',9),
  ('thanks_card','Cartão digital de agradecimento','gift',0,12,20,'Uma arte digital de agradecimento',10),
  ('reminder_static','Lembrete estático','gift',0,12,25,'Uma arte estática',11),
  ('countdown','Contagem regressiva de 3 artes','gift',0,8,12,'Três artes digitais',12),
  ('personalized_art','Arte para 1 personalizado','gift',0,8,15,'Um arquivo de arte digital para personalizado, sem impressão',13),
  ('welcome_sign','Plaquinha de boas-vindas digital','gift',0,6,12,'Uma arte digital para impressão',14),
  ('reminder_animated','Lembrete animado','gift',0,3,8,'Um vídeo curto de lembrete',15),
  ('thanks_video','Vídeo de agradecimento','gift',0,2,5,'Um vídeo curto de agradecimento',16),
  ('mini_retrospective','Mini retrospectiva com até 5 fotos','gift',0,1,3,'Vídeo com até cinco fotos fornecidas pela família',17),
  ('character_birthday','Vídeo do personagem dando parabéns','gift',0,1,5,'Vídeo curto no tema, quando aplicável',18),
  ('child_birthday','Vídeo da criança para Stories','gift',0,1,8,'Vídeo vertical de aniversário com fotos da criança',19);
