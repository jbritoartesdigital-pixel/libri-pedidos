PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS drafts (
  token TEXT PRIMARY KEY,
  step INTEGER NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT UNIQUE,
  public_token TEXT NOT NULL UNIQUE,
  draft_token TEXT,

  customer_name TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  honoree_name TEXT NOT NULL,
  display_name TEXT,
  age INTEGER,

  event_date TEXT,
  event_time TEXT,
  venue_name TEXT,
  venue_address TEXT,
  location_url TEXT,
  theme TEXT,

  experience TEXT NOT NULL CHECK (experience IN ('full', 'reduced')),
  format TEXT NOT NULL CHECK (format IN ('video', 'interactive')),
  addons_json TEXT NOT NULL DEFAULT '{}',
  briefing_json TEXT NOT NULL DEFAULT '{}',
  pricing_json TEXT NOT NULL DEFAULT '{}',

  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  urgency_enabled INTEGER NOT NULL DEFAULT 0 CHECK (urgency_enabled IN (0,1)),
  urgency_percent INTEGER NOT NULL DEFAULT 0,
  urgency_amount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  deposit_percent INTEGER NOT NULL DEFAULT 50,
  deposit_cents INTEGER NOT NULL DEFAULT 0,
  balance_cents INTEGER NOT NULL DEFAULT 0,

  terms_version TEXT NOT NULL,
  terms_accepted_at TEXT NOT NULL,
  portfolio_consent INTEGER NOT NULL CHECK (portfolio_consent IN (0,1)),

  status TEXT NOT NULL DEFAULT 'new',
  photos_status TEXT NOT NULL DEFAULT 'waiting',
  photos_note TEXT,
  entry_status TEXT NOT NULL DEFAULT 'waiting',
  mascot_status TEXT NOT NULL DEFAULT 'waiting',
  mascot_revisions INTEGER NOT NULL DEFAULT 0,
  speech_mode TEXT NOT NULL DEFAULT 'libri',
  speech_status TEXT NOT NULL DEFAULT 'not_required',
  speech_revisions INTEGER NOT NULL DEFAULT 0,
  invitation_status TEXT NOT NULL DEFAULT 'waiting',
  invitation_revisions INTEGER NOT NULL DEFAULT 0,
  balance_status TEXT NOT NULL DEFAULT 'waiting',

  production_started_at TEXT,
  production_paused_at TEXT,
  paused_total_seconds INTEGER NOT NULL DEFAULT 0,
  production_deadline_at TEXT,
  deadline_override_at TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finalized_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_event_date ON orders(event_date);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_order_code ON orders(order_code);

CREATE TABLE IF NOT EXISTS order_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  action_code TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_history_order_id ON order_history(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS internal_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notes_order_id ON internal_notes(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS terms_versions (
  version TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES
  ('price_video_full_cents', '15000', datetime('now')),
  ('price_video_reduced_cents', '7500', datetime('now')),
  ('price_interactive_full_cents', '18000', datetime('now')),
  ('price_interactive_reduced_cents', '10500', datetime('now')),
  ('addon_confirmation_cents', '2500', datetime('now')),
  ('addon_filter_cents', '3000', datetime('now')),
  ('addon_extra_scene_cents', '3000', datetime('now')),
  ('addon_extra_person_cents', '3000', datetime('now')),
  ('deposit_percent', '50', datetime('now')),
  ('urgency_percent', '30', datetime('now')),
  ('deadline_business_days', '5', datetime('now')),
  ('pix_key', '', datetime('now')),
  ('pix_recipient_name', '', datetime('now')),
  ('libri_whatsapp', '', datetime('now')),
  ('example_interactive_full_url', '', datetime('now')),
  ('example_interactive_reduced_url', '', datetime('now')),
  ('example_video_full_url', '', datetime('now')),
  ('example_video_reduced_url', '', datetime('now')),
  ('example_confirmation_url', '', datetime('now')),
  ('example_filter_url', '', datetime('now'));

INSERT OR IGNORE INTO terms_versions(version, body, active, created_at) VALUES (
  '1.0',
  'CONDIÇÕES DO PEDIDO | LIBRI CONVITES\n\n1. PAGAMENTO\nPara começar a produção, é necessário o pagamento de 50% do valor total do pedido. Os outros 50% serão pagos depois que o convite for aprovado e antes da entrega da versão final.\n\n2. PRAZO\nO prazo normal de produção é de até 5 dias úteis. O prazo começa depois que a entrada estiver confirmada, o formulário estiver completo e as fotos e informações necessárias tiverem sido enviadas. Quando estivermos aguardando resposta ou aprovação da cliente, o prazo fica pausado.\n\n3. PEDIDO URGENTE\nPedidos com prazo menor que 5 dias úteis dependem da disponibilidade da Libri e, quando aceitos, recebem taxa de 30% sobre o valor total.\n\n4. CRIAÇÃO DO MASCOTE\nO mascote é criado com base nas fotos enviadas. Buscamos manter as principais características da criança, mas, por ser uma recriação artística, ele não será uma cópia exata da foto e pode apresentar pequenas diferenças. Antes de continuar a produção, a cliente poderá conferir e aprovar o mascote.\n\n5. AJUSTES INCLUÍDOS\nO pedido inclui até 2 rodadas de ajustes no mascote, 1 rodada de ajustes nas falas quando a cliente escolher aprová-las e até 2 rodadas de ajustes no convite. Erros da Libri em relação às informações enviadas não contam como rodada.\n\n6. DEPOIS DE APROVAR\nQuando uma etapa é aprovada, seguimos para a próxima usando aquela versão como base. Mudanças em partes já aprovadas podem exigir novo prazo e valor adicional, informado antes de continuar.\n\n7. MUDANÇAS MAIORES\nTroca de tema, mudança completa do estilo, troca de mascote aprovado ou refação de partes prontas não são ajustes simples e podem ter novo prazo e valor.\n\n8. INFORMAÇÕES DA FESTA\nA cliente deve conferir nome, idade, data, horário, local, endereço, frases e demais informações. Se a Libri inserir algo diferente do que foi enviado, a correção será feita sem contar como alteração.\n\n9. FOTOS\nFotos claras, sem filtro e com o rosto aparecendo bem ajudam no resultado. Se precisarmos de fotos melhores, entraremos em contato antes de continuar.\n\n10. CANCELAMENTO\nDepois que a produção tiver começado, caso a cliente decida cancelar, a entrada de 50% não será devolvida, pois também corresponde ao tempo e trabalho já dedicados, respeitados os casos em que a lei determine cancelamento ou reembolso.\n\n11. CONVITE INTERATIVO\nO Convite Interativo funciona pela internet e deve ser aberto pelo link enviado pela Libri. É necessário ter conexão com a internet e usar um celular ou navegador atualizado. O link fica disponível até 1 dia após a data da festa e poderá ser retirado do ar depois desse período.\n\n12. CONVITE EM VÍDEO\nQuando o pedido incluir vídeo, a cliente recebe o arquivo final e deve guardá-lo no celular, computador ou outro local de sua preferência.\n\n13. FOTOS E INFORMAÇÕES ENVIADAS\nAs informações e fotos enviadas serão usadas para preparar e entregar o convite contratado. Quando houver dados e imagens de criança, o responsável deverá autorizar o uso necessário para a criação do pedido.\n\n14. DIVULGAÇÃO\nA autorização para divulgação é escolhida separadamente. Não autorizar a divulgação não impede a contratação nem a produção do convite.',
  1,
  datetime('now')
);
