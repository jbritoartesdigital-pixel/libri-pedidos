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
('book','livro','Convite em Livro','Experiência digital em formato de livro 