PRAGMA foreign_keys = ON;

-- LIBRI CONVITES | PEDIDOS V2
-- Migration aditiva: preserva integralmente as tabelas V1.

CREATE TABLE IF NOT EXISTS v2_customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_v2_customers_whatsapp ON v2_customers(whatsapp);

CREATE TABLE IF NOT EXISTS v2_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_description TEXT,
  pricing_mode TEXT NOT NULL CHECK (pricing_mode IN ('fixed','scene_count')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS v2_product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  scene_count INTEGER,
  price_cents INTEGER NOT NULL,
  points_units INTEGER NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(product_id) REFERENCES v2_products(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_v2_product_variants_product ON v2_product_variants(product_id, sort_order);

CREATE TABLE IF NOT EXISTS v2_addons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  addon_group TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  points_units INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS v2_combos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('fixed','percent')),
  discount_value INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS v2_combo_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  combo_id INTEGER NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('main_product','addon','addon_group')),
  item_code TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(combo_id) REFERENCES v2_combos(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_v2_combo_items_combo ON v2_combo_items(combo_id);

CREATE TABLE IF NOT EXISTS v2_coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('fixed','percent')),
  discount_value INTEGER NOT NULL,
  min_order_cents INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER,
  max_uses_per_customer INTEGER,
  valid_from TEXT,
  valid_until TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  restrictions_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS v2_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL UNIQUE,
  public_token TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  event_subtype TEXT,
  honoree_display_name TEXT NOT NULL,
  event_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN (
    'configuring','awaiting_urgency_decision','urgency_approved','awaiting_payment',
    'briefing_pending','ready_for_production','in_production','waiting_customer',
    'adjustments','approved','balance_pending','ready_for_delivery','finalized','cancelled'
  )),
  next_action TEXT,
  delivery_start TEXT,
  delivery_end TEXT,
  recommended_target_date TEXT,
  urgency_enabled INTEGER NOT NULL DEFAULT 0 CHECK (urgency_enabled IN (0,1)),
  briefing_status TEXT NOT NULL DEFAULT 'locked' CHECK (briefing_status IN ('locked','available','in_progress','completed')),
  source TEXT NOT NULL DEFAULT 'store' CHECK (source IN ('store','manual_whatsapp')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  finalized_at TEXT,
  FOREIGN KEY(customer_id) REFERENCES v2_customers(id)
);
CREATE INDEX IF NOT EXISTS idx_v2_orders_customer ON v2_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_v2_orders_event_date ON v2_orders(event_date);
CREATE INDEX IF NOT EXISTS idx_v2_orders_status ON v2_orders(status);
CREATE INDEX IF NOT EXISTS idx_v2_orders_delivery ON v2_orders(delivery_start, delivery_end);

CREATE TABLE IF NOT EXISTS v2_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('product','addon','combo_adjustment')),
  item_code TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  points_units INTEGER NOT NULL DEFAULT 0,
  configuration_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(order_id) REFERENCES v2_orders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_v2_order_items_order ON v2_order_items(order_id);

CREATE TABLE IF NOT EXISTS v2_order_pricing (
  order_id INTEGER PRIMARY KEY,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  combo_discount_cents INTEGER NOT NULL DEFAULT 0,
  coupon_discount_cents INTEGER NOT NULL DEFAULT 0,
  urgency_percent INTEGER NOT NULL DEFAULT 0,
  urgency_amount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT CHECK (payment_method IN ('pix','card')),
  deposit_percent INTEGER NOT NULL DEFAULT 50,
  deposit_cents INTEGER NOT NULL DEFAULT 0,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'BRL',
  pricing_snapshot_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(order_id) REFERENCES v2_orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS v2_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('mercado_pago','direct_pix')),
  payment_type TEXT NOT NULL CHECK (payment_type IN ('deposit','full_payment','balance','refund')),
  provider_payment_id TEXT,
  method TEXT NOT NULL CHECK (method IN ('pix','card')),
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled','refunded','expired')),
  amount_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0,
  net_cents INTEGER,
  installments INTEGER,
  provider_payload_json TEXT NOT NULL DEFAULT '{}',
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(order_id) REFERENCES v2_orders(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_payments_provider_id ON v2_payments(provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_v2_payments_order ON v2_payments(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS v2_briefings (
  order_id INTEGER PRIMARY KEY,
  schema_version TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  current_section TEXT,
  completion_percent INTEGER NOT NULL DEFAULT 0 CHECK (completion_percent BETWEEN 0 AND 100),
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(order_id) REFERENCES v2_orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS v2_briefing_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('person','outfit','reference','addon','other')),
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(order_id) REFERENCES v2_orders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_v2_briefing_uploads_order ON v2_briefing_uploads(order_id, category);

CREATE TABLE IF NOT EXISTS v2_agenda_days (
  day TEXT PRIMARY KEY,
  sellable_capacity_units INTEGER NOT NULL DEFAULT 400,
  internal_buffer_units INTEGER NOT NULL DEFAULT 100,
  blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0,1)),
  internal_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS v2_agenda_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  points_units INTEGER NOT NULL CHECK (points_units > 0),
  allocation_type TEXT NOT NULL DEFAULT 'confirmed' CHECK (allocation_type IN ('confirmed','anticipated')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(order_id) REFERENCES v2_orders(id) ON DELETE CASCADE,
  FOREIGN KEY(day) REFERENCES v2_agenda_days(day)
);
CREATE INDEX IF NOT EXISTS idx_v2_agenda_allocations_day ON v2_agenda_allocations(day);
CREATE INDEX IF NOT EXISTS idx_v2_agenda_allocations_order ON v2_agenda_allocations(order_id);

CREATE TABLE IF NOT EXISTS v2_checkout_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  order_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','converted','expired','cancelled')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(order_id) REFERENCES v2_orders(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS v2_checkout_hold_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hold_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  points_units INTEGER NOT NULL CHECK (points_units > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(hold_id) REFERENCES v2_checkout_holds(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_v2_checkout_hold_allocations_hold ON v2_checkout_hold_allocations(hold_id);
CREATE INDEX IF NOT EXISTS idx_v2_checkout_hold_allocations_day ON v2_checkout_hold_allocations(day);

CREATE TABLE IF NOT EXISTS v2_urgency_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  urgency_percent INTEGER NOT NULL DEFAULT 30,
  requested_delivery_start TEXT,
  requested_delivery_end TEXT,
  decision_note TEXT,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  FOREIGN KEY(order_id) REFERENCES v2_orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS v2_previews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('video','image')),
  original_r2_key TEXT,
  preview_r2_key TEXT NOT NULL UNIQUE,
  watermark_label TEXT NOT NULL DEFAULT 'PRÉVIA • LIBRI CONVITES',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','approved','expired','replaced','revoked')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(order_id) REFERENCES v2_orders(id) ON DELETE CASCADE,
  UNIQUE(order_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_v2_previews_order ON v2_previews(order_id, version_number DESC);

CREATE TABLE IF NOT EXISTS v2_preview_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  preview_id INTEGER NOT NULL UNIQUE,
  order_id INTEGER NOT NULL,
  approved_at TEXT NOT NULL DEFAULT (datetime('now')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(preview_id) REFERENCES v2_previews(id) ON DELETE CASCADE,
  FOREIGN KEY(order_id) REFERENCES v2_orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS v2_terms_versions (
  version TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  content_hash TEXT,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS v2_order_terms_acceptances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  terms_version TEXT NOT NULL,
  terms_hash TEXT,
  accepted_at TEXT NOT NULL DEFAULT (datetime('now')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(order_id) REFERENCES v2_orders(id) ON DELETE CASCADE,
  FOREIGN KEY(terms_version) REFERENCES v2_terms_versions(version)
);
CREATE INDEX IF NOT EXISTS idx_v2_terms_acceptances_order ON v2_order_terms_acceptances(order_id, accepted_at DESC);

CREATE TABLE IF NOT EXISTS v2_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','waiting_libri','waiting_customer','signed','superseded','cancelled')),
  body_snapshot TEXT NOT NULL,
  pdf_r2_key TEXT,
  document_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  signed_at TEXT,
  FOREIGN KEY(order_id) REFERENCES v2_orders(id) ON DELETE CASCADE,
  UNIQUE(order_id, version)
);

CREATE TABLE IF NOT EXISTS v2_contract_signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  party TEXT NOT NULL CHECK (party IN ('libri','customer')),
  signer_name TEXT NOT NULL,
  signed_at TEXT NOT NULL DEFAULT (datetime('now')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(contract_id) REFERENCES v2_contracts(id) ON DELETE CASCADE,
  UNIQUE(contract_id, party)
);

CREATE TABLE IF NOT EXISTS v2_gallery_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL,
  event_type TEXT,
  theme_label TEXT,
  preview_r2_key TEXT,
  media_r2_key TEXT,
  external_url TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_v2_gallery_product ON v2_gallery_items(product_code, active, sort_order);

CREATE TABLE IF NOT EXISTS v2_coupon_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coupon_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL,
  used_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(coupon_id) REFERENCES v2_coupons(id),
  FOREIGN KEY(order_id) REFERENCES v2_orders(id) ON DELETE CASCADE,
  FOREIGN KEY(customer_id) REFERENCES v2_customers(id)
);
CREATE INDEX IF NOT EXISTS idx_v2_coupon_uses_coupon ON v2_coupon_uses(coupon_id, used_at DESC);

CREATE TABLE IF NOT EXISTS v2_order_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  action_code TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(order_id) REFERENCES v2_orders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_v2_order_history_order ON v2_order_history(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS v2_internal_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(order_id) REFERENCES v2_orders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_v2_internal_notes_order ON v2_internal_notes(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS v2_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_code TEXT NOT NULL,
  order_id INTEGER,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_url TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  push_eligible INTEGER NOT NULL DEFAULT 0 CHECK (push_eligible IN (0,1)),
  read_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(order_id) REFERENCES v2_orders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_v2_notifications_open ON v2_notifications(resolved_at, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS v2_push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS v2_admin_passkeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports_json TEXT NOT NULL DEFAULT '[]',
  device_label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS v2_admin_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_token_hash TEXT NOT NULL UNIQUE,
  passkey_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  FOREIGN KEY(passkey_id) REFERENCES v2_admin_passkeys(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS v2_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO v2_settings(key, value) VALUES
  ('points_unit_scale', '100'),
  ('default_sellable_points_per_day_units', '400'),
  ('default_internal_buffer_points_per_day_units', '100'),
  ('recommended_delivery_days_before_event', '40'),
  ('urgency_percent', '30'),
  ('pix_deposit_percent', '50'),
  ('preview_expiry_hours', '24'),
  ('checkout_hold_minutes', '30'),
  ('libri_whatsapp', ''),
  ('balance_pix_key', ''),
  ('balance_pix_recipient_name', '');

INSERT OR IGNORE INTO v2_products
(code, slug, name, short_description, pricing_mode, active, sort_order, config_json)
VALUES
('cinematic_video','cinematografico-video','Cinematográfico em Vídeo','Convite personalizado em vídeo com abertura e narrativa cinematográfica.','scene_count',1,10,'{"minScenes":1,"maxScenes":8,"recommendedShortScenes":3,"recommendedCompleteScenes":6,"openingOutsideSceneCount":true}'),
('cinematic_interactive','cinematografico-interativo','Cinematográfico Interativo','Vídeo cinematográfico personalizado com experiência interativa final.','scene_count',1,20,'{"minScenes":1,"maxScenes":8,"recommendedShortScenes":3,"recommendedCompleteScenes":6,"openingOutsideSceneCount":true}'),
('interactive_essential','interativo','Interativo Essencial','Uma composição personalizada com recursos interativos.','fixed',1,30,'{"includedInteractiveResources":3,"musicOptionalIncluded":true}'),
('interactive_animated','interativo-animado','Interativo com Abertura Animada','Abertura animada personalizada que revela a arte principal interativa.','fixed',1,40,'{"includedInteractiveResources":3,"musicOptionalIncluded":true}'),
('interactive_gif','interativo-gif','Interativo GIF','Composição principal personalizada com movimento contínuo e recursos interativos.','fixed',1,50,'{"includedInteractiveResources":3,"musicOptionalIncluded":true,"customerChoosesMotion":false}'),
('book','livro','Convite em Livro','Experiência digital em formato de livro com capa e páginas.','fixed',1,60,'{"maxInternalPages":6,"countdownDefault":false}'),
('infinite','infinito','Convite Infinito','Experiência vertical contínua com seções conectadas.','fixed',1,70,'{"maxConnectedSections":6,"heroOutsideSectionCount":true,"countdownOptionalIncluded":true}');

INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,sort_order)
SELECT id,'cinematic_video_1','1 cena',1,4000,200,1 FROM v2_products WHERE code='cinematic_video';
INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,sort_order)
SELECT id,'cinematic_video_2','2 cenas',2,5500,200,2 FROM v2_products WHERE code='cinematic_video';
INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,sort_order)
SELECT id,'cinematic_video_3','3 cenas',3,7000,300,3 FROM v2_products WHERE code='cinematic_video';
INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,sort_order)
SELECT id,'cinematic_video_4','4 cenas',4,8500,300,4 FROM v2_products WHERE code='cinematic_video';
INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,sort_order)
SELECT id,'cinematic_video_5','5 cenas',5,11000,400,5 FROM v2_products WHERE code='cinematic_video';
INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,sort_order)
SELECT id,'cinematic_video_6','6 cenas',6,13500,400,6 FROM v2_products WHERE code='cinematic_video';
INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,sort_order)
SELECT id,'cinematic_video_7','7 cenas',7,16000,500,7 FROM v2_products WHERE code='cinematic_video';
INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,sort_order)
SELECT id,'cinematic_video_8','8 cenas',8,18500,500,8 FROM v2_products WHERE code='cinematic_video';

INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,sort_order)
SELECT id,'cinematic_interactive_1','1 cena',1,5500,300,1 FROM v2_products WHERE code='cinematic_interactive';
INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,sort_order)
SELECT id,'cinematic_interactive_2','2 cenas',2,7500,300,2 FROM v2_products WHERE code='cinematic_interactive';
INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,sort_order)
SELECT id,'cinematic_interactive_3','3 cenas',3,10000,400,3 FROM v2_products WHERE code='cinematic_interactive';
INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,sort_order)
SELECT id,'cinematic_interactive_4','4 cenas',4,12500,400,4 FROM v2_products WHERE code='cinematic_interactive';
INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,sort_order)
SELECT id,'cinematic_interactive_5','5 cenas',5,15500,500,5 FROM v2_products WHERE code='cinematic_interactive';
INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,sort_order)
SELECT id,'cinematic_interactive_6','6 cenas',6,19000,500,6 FROM v2_products WHERE code='cinematic_interactive';
INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,sort_order)
SELECT id,'cinematic_interactive_7','7 cenas',7,22000,600,7 FROM v2_products WHERE code='cinematic_interactive';
INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,sort_order)
SELECT id,'cinematic_interactive_8','8 cenas',8,25000,600,8 FROM v2_products WHERE code='cinematic_interactive';

INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,is_default,sort_order)
SELECT id,'interactive_essential_default','Padrão',NULL,3500,100,1,1 FROM v2_products WHERE code='interactive_essential';
INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,is_default,sort_order)
SELECT id,'interactive_animated_default','Padrão',NULL,6500,200,1,1 FROM v2_products WHERE code='interactive_animated';
INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,is_default,sort_order)
SELECT id,'interactive_gif_default','Padrão',NULL,5500,150,1,1 FROM v2_products WHERE code='interactive_gif';
INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,is_default,sort_order)
SELECT id,'book_default','Padrão',NULL,15000,300,1,1 FROM v2_products WHERE code='book';
INSERT OR IGNORE INTO v2_product_variants(product_id,code,label,scene_count,price_cents,points_units,is_default,sort_order)
SELECT id,'infinite_default','Padrão',NULL,8500,300,1,1 FROM v2_products WHERE code='infinite';

INSERT OR IGNORE INTO v2_addons(code,name,addon_group,price_cents,points_units,sort_order,config_json) VALUES
('confirmation_libri','Confirmação de Presença Libri','confirmation',3500,50,10,'{"modes":["free","guest_list","undecided"]}'),
('custom_filter','Filtro Personalizado','filter',3500,50,20,'{"standalonePlatforms":["instagram","libri_app"],"includedWithMomentsPlatform":"libri_app"}'),
('save_static','Save the Date Estático','save_the_date',2000,50,30,'{}'),
('save_animated','Save the Date Animado','save_the_date',3500,100,31,'{}'),
('reminder_static','Lembrete do Evento Estático','reminder',2000,50,40,'{}'),
('reminder_animated','Lembrete do Evento Animado','reminder',3500,100,41,'{}'),
('moments_festa','Libri Moments • Festa','moments',7900,50,50,'{"photoLimit":200,"availabilityDays":30,"filterIncluded":true,"filterPlatform":"libri_app"}'),
('moments_premium','Libri Moments • Premium','moments',11900,50,51,'{"photoLimit":400,"availabilityDays":60,"filterIncluded":true,"filterPlatform":"libri_app"}'),
('moments_exclusive','Libri Moments • Exclusive','moments',14900,50,52,'{"photoLimit":700,"availabilityDays":90,"filterIncluded":true,"filterPlatform":"libri_app"}'),
('moments_extra_100','Libri Moments • +100 fotos','moments_extra',1500,0,53,'{"extraPhotos":100}');

INSERT OR IGNORE INTO v2_terms_versions(version,body,active) VALUES (
'2.0',
'CONDIÇÕES DO PEDIDO | LIBRI CONVITES

1. PAGAMENTO
Nos pedidos pagos por Pix, é necessário o pagamento de 50% do valor total para confirmar a contratação, reservar a vaga e liberar o briefing. Os outros 50% serão pagos depois que o convite for aprovado e antes da entrega final.
Nos pedidos pagos por cartão, o valor total da contratação será pago no momento do pedido.
A produção somente será iniciada após a confirmação do pagamento aplicável e a conclusão das informações necessárias para produção.

2. RESERVA E JANELA DE ENTREGA
Durante a contratação, a cliente escolherá uma janela de entrega disponível conforme a agenda de produção da Libri Convites.
A janela apresentada corresponde ao período previsto para entrega, e não necessariamente a um dia exato.
A vaga somente será confirmada após a aprovação do pagamento. Reservas temporárias de checkout poderão expirar quando o pagamento não for concluído dentro do período informado.
Se houver atraso no envio de informações, fotos, materiais ou aprovações necessárias por parte da cliente, a janela de entrega poderá precisar ser reajustada conforme a disponibilidade da agenda.

3. PEDIDO URGENTE
Quando não houver uma janela regular compatível com a data do evento, a cliente poderá solicitar análise de encaixe urgente.
O encaixe depende exclusivamente da disponibilidade da Libri Convites e não é garantido.
Quando aprovado, será aplicada uma taxa de urgência de 30% sobre o valor comercial do pedido após os descontos aplicáveis.
A nova janela de entrega será informada antes do pagamento.

4. BRIEFING E INÍCIO DA PRODUÇÃO
O briefing completo é liberado após a confirmação do pagamento inicial aplicável.
A produção começa depois que o pagamento necessário estiver confirmado, o briefing estiver concluído e as fotos, referências e demais materiais necessários tiverem sido enviados.
Enquanto estivermos aguardando informações, arquivos, respostas ou aprovação da cliente, a produção poderá ficar pausada.

5. REPRESENTAÇÃO DE PESSOAS E MASCOTES
Quando o pedido incluir representação visual de criança, adulto, casal ou outra pessoa, a criação será feita a partir das fotos e informações fornecidas.
A Libri busca preservar as principais características da pessoa, mas a representação artística não será uma cópia exata da fotografia e poderá apresentar pequenas diferenças decorrentes do processo criativo e das ferramentas utilizadas.
Quando houver etapa específica de aprovação da representação, a produção seguirá utilizando a versão aprovada como referência.

6. AJUSTES INCLUÍDOS
Quando aplicável ao produto contratado, o pedido inclui até 2 rodadas de ajustes na representação/mascote, 1 rodada de ajustes nas falas quando a cliente escolher aprová-las previamente e até 2 rodadas de ajustes simples no convite, desde que não exijam refazer cenas, animações, personagem ou partes já produzidas.
Erros da Libri em relação às informações corretamente enviadas pela cliente não contam como rodada de ajustes.

7. DEPOIS DE APROVAR
Quando uma etapa ou versão é aprovada, a produção continuará utilizando aquela aprovação como base.
Alterações posteriores em partes já aprovadas podem exigir novo prazo e valor adicional, que serão informados antes da realização da mudança.

8. MUDANÇAS MAIORES
Troca de tema, mudança completa da direção visual, substituição de representação já aprovada, alteração significativa da estrutura do projeto ou refação de partes prontas não são consideradas ajustes simples.
Essas alterações podem gerar novo orçamento e nova previsão de entrega.

9. INFORMAÇÕES DO EVENTO
A cliente é responsável por conferir os dados fornecidos, incluindo nomes, idade quando aplicável, data, horário, local, endereço, textos, frases, links, chave Pix e demais informações destinadas ao convite.
Caso a Libri insira uma informação diferente da que foi corretamente enviada, a correção será realizada sem contar como alteração.

10. FOTOS, ARQUIVOS E REFERÊNCIAS
Fotos claras, atuais e com boa visualização das características importantes ajudam a alcançar melhor resultado.
Quando os arquivos enviados não forem suficientes, a Libri poderá solicitar novos materiais antes de prosseguir.
Referências fornecidas pela cliente são utilizadas como direção de conteúdo, estética ou inspiração e não significam reprodução obrigatória ou idêntica de trabalhos de terceiros.

11. PRESENTES E PIX
Quando a cliente optar por incluir sugestões de presentes, links ou chave Pix no convite, é responsabilidade da cliente fornecer e conferir corretamente essas informações.
A Libri Convites não se responsabiliza por transferências realizadas com base em dados incorretos fornecidos pela própria contratante.

12. CANCELAMENTO
Depois que a produção tiver começado, caso a cliente decida cancelar o pedido, os valores relativos ao trabalho já iniciado poderão não ser devolvidos, incluindo a entrada paga, respeitados os casos em que a legislação aplicável determine cancelamento, estorno ou reembolso.
Pedidos pagos integralmente serão analisados considerando a etapa de produção já executada e as disposições legais aplicáveis.

13. CONVITES INTERATIVOS
Convites interativos, incluindo formatos como Interativo Essencial, GIF, Abertura Animada, Livro, Infinito e Cinematográfico Interativo, funcionam pela internet e devem ser acessados através do link fornecido pela Libri.
É necessário utilizar conexão com a internet e navegador ou dispositivo compatível e atualizado.
Quando aplicável, o link ficará disponível até 1 dia após a data do evento e poderá ser retirado do ar após esse período.
Recursos interativos disponíveis dependem especificamente do produto e dos adicionais contratados.

14. CONVITES EM VÍDEO
Quando o pedido incluir entrega em vídeo, a cliente receberá o arquivo final e deverá armazená-lo em seu próprio dispositivo ou serviço de armazenamento.
A disponibilidade futura do arquivo nos sistemas da Libri não substitui a responsabilidade da cliente de guardar sua versão entregue.

15. CONFIRMAÇÃO DE PRESENÇA LIBRI
Quando contratada, a Confirmação de Presença Libri constitui um adicional específico e diferente de um simples botão de confirmação presente no convite.
As funcionalidades disponibilizadas dependerão da modalidade contratada e poderão incluir acompanhamento das respostas e organização de convidados.
Informações privadas relacionadas a confirmações ou listas de convidados não serão utilizadas como material público de portfólio.

16. LIBRI MOMENTS
Quando contratado, o Libri Moments seguirá o limite de fotos, período de disponibilidade e demais condições correspondentes ao plano escolhido.
O filtro incluído no Libri Moments é destinado ao App Libri.
Conteúdos enviados ou publicados pelos participantes deverão respeitar os direitos das pessoas retratadas e demais regras aplicáveis ao serviço.

17. SAVE THE DATE E LEMBRETE
Save the Date e Lembrete são peças próprias e independentes do convite principal, quando contratadas.
A versão escolhida poderá ser estática ou animada conforme a opção adquirida.
Alterações nesses materiais seguem as mesmas regras gerais de aprovação e ajustes previstas nestas condições.

18. FOTOS E INFORMAÇÕES ENVIADAS
As informações, fotografias e arquivos fornecidos serão utilizados para preparar, produzir e entregar os materiais contratados.
Quando houver dados ou imagens de criança ou adolescente, a pessoa responsável pela contratação declara possuir legitimidade e autorização para fornecer essas informações e imagens à Libri Convites para a realização do pedido.

19. DIVULGAÇÃO E PORTFÓLIO
Ao aceitar estas Condições do Pedido e concluir a contratação, o responsável autoriza a Libri Convites a utilizar o trabalho produzido para fins de divulgação do portfólio da marca.
Essa divulgação poderá incluir artes, representações, mascotes, imagens, trechos de vídeo, animações, cenas do convite e demais elementos criados durante o projeto, podendo ser publicados nas redes sociais, site, portfólio e materiais de apresentação da Libri Convites.
Quando o trabalho utilizar imagem, fotografia ou representação identificável de criança ou adolescente, o aceite deverá ser realizado pelo pai, mãe ou responsável legal.
A Libri Convites não divulgará telefone da cliente, links privados, lista de convidados, dados de confirmação de presença ou outros dados pessoais de contato que não façam parte da apresentação pública do trabalho.

20. ACEITE DAS CONDIÇÕES
Ao marcar “Li e concordo com as condições” e prosseguir com a contratação, o responsável declara ter lido e aceitado estas Condições do Pedido.
O sistema poderá registrar a versão aceita, data e horário do aceite e sua vinculação ao respectivo pedido.
Quando houver atualização das Condições antes da conclusão do pagamento, poderá ser solicitado novo aceite da versão vigente.

21. CONTRATO ADICIONAL
Estas Condições acompanham a contratação padrão da Libri Convites.
Caso a cliente solicite um contrato específico, a Libri poderá gerar documento complementar relacionado ao pedido, contendo escopo, valores, condições e identificação das partes.
Quando emitido, o contrato poderá exigir assinatura eletrônica das partes e ficará vinculado ao pedido correspondente.',
1
);
