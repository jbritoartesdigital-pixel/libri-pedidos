-- ==================================================
-- LIBRI CONVITES
-- APOSENTADORIA V1 | MIGRAÇÃO HISTÓRICA PARA V2
--
-- IMPORTANTE:
-- - idempotente
-- - não apaga nem altera registros V1
-- - preserva order_code e public_token
-- - importa somente pedidos V1 com código público válido
-- ==================================================

PRAGMA foreign_keys = ON;

-- Preserva versões antigas de termos para que o aceite histórico
-- continue referenciável sem reativar termos V1 na loja atual.
INSERT OR IGNORE INTO v2_terms_versions(
  version,
  body,
  content_hash,
  active,
  published_at,
  created_at
)
SELECT
  version,
  body,
  NULL,
  0,
  created_at,
  created_at
FROM terms_versions;

-- Completa configurações V2 que ainda estejam vazias com os valores
-- conhecidos do legado. Nunca sobrescreve configuração V2 já preenchida.
UPDATE v2_settings
SET
  value = COALESCE(
    (
      SELECT value
      FROM settings
      WHERE key = 'libri_whatsapp'
      LIMIT 1
    ),
    value
  ),
  updated_at = datetime('now')
WHERE
  key = 'libri_whatsapp'
  AND trim(COALESCE(value, '')) = ''
  AND EXISTS (
    SELECT 1
    FROM settings
    WHERE key = 'libri_whatsapp'
      AND trim(COALESCE(value, '')) != ''
  );

UPDATE v2_settings
SET
  value = COALESCE(
    (
      SELECT value
      FROM settings
      WHERE key = 'pix_key'
      LIMIT 1
    ),
    value
  ),
  updated_at = datetime('now')
WHERE
  key = 'balance_pix_key'
  AND trim(COALESCE(value, '')) = ''
  AND EXISTS (
    SELECT 1
    FROM settings
    WHERE key = 'pix_key'
      AND trim(COALESCE(value, '')) != ''
  );

UPDATE v2_settings
SET
  value = COALESCE(
    (
      SELECT value
      FROM settings
      WHERE key = 'pix_recipient_name'
      LIMIT 1
    ),
    value
  ),
  updated_at = datetime('now')
WHERE
  key = 'balance_pix_recipient_name'
  AND trim(COALESCE(value, '')) = ''
  AND EXISTS (
    SELECT 1
    FROM settings
    WHERE key = 'pix_recipient_name'
      AND trim(COALESCE(value, '')) != ''
  );

-- Um cadastro V2 por WhatsApp legado quando ainda não existe cliente
-- correspondente. O pedido continuará sendo a fonte de verdade do nome.
INSERT INTO v2_customers(
  name,
  whatsapp,
  email,
  created_at,
  updated_at
)
SELECT
  MIN(o.customer_name),
  o.whatsapp,
  NULL,
  MIN(o.created_at),
  MAX(o.updated_at)
FROM orders o
WHERE
  trim(COALESCE(o.order_code, '')) != ''
  AND NOT EXISTS (
    SELECT 1
    FROM v2_customers c
    WHERE c.whatsapp = o.whatsapp
  )
GROUP BY o.whatsapp;

-- Pedidos.
INSERT INTO v2_orders(
  order_code,
  public_token,
  customer_id,
  event_type,
  event_subtype,
  honoree_display_name,
  event_date,
  status,
  next_action,
  delivery_start,
  delivery_end,
  recommended_target_date,
  urgency_enabled,
  briefing_status,
  source,
  created_at,
  updated_at,
  finalized_at
)
SELECT
  o.order_code,
  o.public_token,
  (
    SELECT c.id
    FROM v2_customers c
    WHERE c.whatsapp = o.whatsapp
    ORDER BY c.id DESC
    LIMIT 1
  ),
  'birthday',
  'legacy_v1',
  COALESCE(
    NULLIF(trim(o.display_name), ''),
    NULLIF(trim(o.honoree_name), ''),
    o.order_code
  ),
  COALESCE(
    NULLIF(trim(o.event_date), ''),
    substr(o.created_at, 1, 10),
    date('now')
  ),
  CASE
    WHEN o.status = 'cancelled' THEN 'cancelled'
    WHEN o.status = 'finished' THEN 'finalized'
    WHEN o.invitation_status = 'approved' AND o.balance_status = 'confirmed'
      THEN 'ready_for_delivery'
    WHEN o.invitation_status = 'approved'
      THEN 'balance_pending'
    WHEN o.status = 'waiting_balance' THEN 'balance_pending'
    WHEN o.status = 'revisions' THEN 'adjustments'
    WHEN o.status = 'waiting_client' THEN 'waiting_customer'
    WHEN o.status = 'producing' THEN 'in_production'
    WHEN o.status = 'ready' THEN 'ready_for_production'
    WHEN o.entry_status = 'confirmed' THEN 'ready_for_production'
    ELSE 'awaiting_payment'
  END,
  CASE
    WHEN o.status = 'cancelled' THEN 'Cancelado • importado da V1'
    WHEN o.status = 'finished' THEN 'Finalizado • importado da V1'
    WHEN o.invitation_status = 'approved' AND o.balance_status = 'confirmed'
      THEN 'Pronto para entrega'
    WHEN o.invitation_status = 'approved' OR o.status = 'waiting_balance'
      THEN 'Aguardando saldo'
    WHEN o.status = 'revisions' THEN 'Ajustes em andamento'
    WHEN o.status = 'waiting_client' THEN 'Aguardando cliente'
    WHEN o.status = 'producing' THEN 'Em produção'
    WHEN o.entry_status = 'confirmed' THEN 'Produção pendente'
    ELSE 'Pagamento pendente'
  END,
  date(
    COALESCE(
      NULLIF(substr(o.deadline_override_at, 1, 10), ''),
      NULLIF(substr(o.production_deadline_at, 1, 10), ''),
      date(COALESCE(NULLIF(o.event_date, ''), substr(o.created_at, 1, 10)), '-3 day')
    ),
    '-2 day'
  ),
  COALESCE(
    NULLIF(substr(o.deadline_override_at, 1, 10), ''),
    NULLIF(substr(o.production_deadline_at, 1, 10), ''),
    date(COALESCE(NULLIF(o.event_date, ''), substr(o.created_at, 1, 10)), '-3 day')
  ),
  COALESCE(
    NULLIF(substr(o.deadline_override_at, 1, 10), ''),
    NULLIF(substr(o.production_deadline_at, 1, 10), ''),
    date(COALESCE(NULLIF(o.event_date, ''), substr(o.created_at, 1, 10)), '-3 day')
  ),
  CASE WHEN o.urgency_enabled = 1 THEN 1 ELSE 0 END,
  CASE
    WHEN trim(COALESCE(o.briefing_json, '')) NOT IN ('', '{}')
      THEN 'completed'
    WHEN o.entry_status = 'confirmed'
      THEN 'available'
    ELSE 'locked'
  END,
  'store',
  o.created_at,
  o.updated_at,
  CASE
    WHEN o.status = 'finished'
      THEN COALESCE(NULLIF(o.finalized_at, ''), o.updated_at)
    ELSE NULL
  END
FROM orders o
WHERE
  trim(COALESCE(o.order_code, '')) != ''
  AND trim(COALESCE(o.public_token, '')) != ''
  AND NOT EXISTS (
    SELECT 1
    FROM v2_orders v
    WHERE
      v.order_code = o.order_code
      OR v.public_token = o.public_token
  );

-- Produto principal legado. Mantém a nomenclatura antiga visível e,
-- ao mesmo tempo, informa o produto V2 equivalente para relatórios.
INSERT INTO v2_order_items(
  order_id,
  item_type,
  item_code,
  name_snapshot,
  quantity,
  unit_price_cents,
  points_units,
  configuration_json,
  created_at
)
SELECT
  v.id,
  'product',
  'legacy_' || o.format || '_' || o.experience,
  'Legado • '
    || CASE WHEN o.format = 'interactive' THEN 'Convite Interativo' ELSE 'Convite em Vídeo' END
    || ' • '
    || CASE WHEN o.experience = 'reduced' THEN 'Reduzido' ELSE 'Completo' END,
  1,
  CASE
    WHEN json_valid(o.pricing_json)
      THEN COALESCE(CAST(json_extract(o.pricing_json, '$.productCents') AS INTEGER), o.subtotal_cents)
    ELSE o.subtotal_cents
  END,
  CASE
    WHEN o.format = 'interactive' THEN
      CASE
        WHEN (
          CASE WHEN o.experience = 'reduced' THEN 3 ELSE 6 END
          + CASE
              WHEN json_valid(o.addons_json)
                THEN COALESCE(CAST(json_extract(o.addons_json, '$.extraScene') AS INTEGER), 0)
              ELSE 0
            END
        ) <= 2 THEN 300
        WHEN (
          CASE WHEN o.experience = 'reduced' THEN 3 ELSE 6 END
          + CASE WHEN json_valid(o.addons_json) THEN COALESCE(CAST(json_extract(o.addons_json, '$.extraScene') AS INTEGER), 0) ELSE 0 END
        ) <= 4 THEN 400
        WHEN (
          CASE WHEN o.experience = 'reduced' THEN 3 ELSE 6 END
          + CASE WHEN json_valid(o.addons_json) THEN COALESCE(CAST(json_extract(o.addons_json, '$.extraScene') AS INTEGER), 0) ELSE 0 END
        ) <= 6 THEN 500
        WHEN (
          CASE WHEN o.experience = 'reduced' THEN 3 ELSE 6 END
          + CASE WHEN json_valid(o.addons_json) THEN COALESCE(CAST(json_extract(o.addons_json, '$.extraScene') AS INTEGER), 0) ELSE 0 END
        ) <= 8 THEN 600
        ELSE 700
      END
    ELSE
      CASE
        WHEN (
          CASE WHEN o.experience = 'reduced' THEN 3 ELSE 6 END
          + CASE WHEN json_valid(o.addons_json) THEN COALESCE(CAST(json_extract(o.addons_json, '$.extraScene') AS INTEGER), 0) ELSE 0 END
        ) <= 2 THEN 200
        WHEN (
          CASE WHEN o.experience = 'reduced' THEN 3 ELSE 6 END
          + CASE WHEN json_valid(o.addons_json) THEN COALESCE(CAST(json_extract(o.addons_json, '$.extraScene') AS INTEGER), 0) ELSE 0 END
        ) <= 4 THEN 300
        WHEN (
          CASE WHEN o.experience = 'reduced' THEN 3 ELSE 6 END
          + CASE WHEN json_valid(o.addons_json) THEN COALESCE(CAST(json_extract(o.addons_json, '$.extraScene') AS INTEGER), 0) ELSE 0 END
        ) <= 6 THEN 400
        WHEN (
          CASE WHEN o.experience = 'reduced' THEN 3 ELSE 6 END
          + CASE WHEN json_valid(o.addons_json) THEN COALESCE(CAST(json_extract(o.addons_json, '$.extraScene') AS INTEGER), 0) ELSE 0 END
        ) <= 8 THEN 500
        ELSE 600
      END
  END,
  json_object(
    'legacy', 1,
    'productCode', CASE WHEN o.format = 'interactive' THEN 'cinematic_interactive' ELSE 'cinematic_video' END,
    'legacyFormat', o.format,
    'legacyExperience', o.experience,
    'sceneCount',
      MIN(
        10,
        MAX(
          1,
          CASE WHEN o.experience = 'reduced' THEN 3 ELSE 6 END
          + CASE
              WHEN json_valid(o.addons_json)
                THEN COALESCE(CAST(json_extract(o.addons_json, '$.extraScene') AS INTEGER), 0)
              ELSE 0
            END
        )
      ),
    'legacyAddonsJson', COALESCE(o.addons_json, '{}')
  ),
  o.created_at
FROM orders o
JOIN v2_orders v
  ON v.order_code = o.order_code
WHERE
  v.event_subtype = 'legacy_v1'
  AND NOT EXISTS (
    SELECT 1
    FROM v2_order_items i
    WHERE i.order_id = v.id
      AND i.item_type = 'product'
  );

-- Adicionais legados conhecidos. O valor histórico continua preservado
-- em v2_order_pricing; estas linhas existem para o escopo aparecer no pedido.
INSERT INTO v2_order_items(
  order_id, item_type, item_code, name_snapshot,
  quantity, unit_price_cents, points_units, configuration_json, created_at
)
SELECT
  v.id, 'addon', 'confirmation_libri',
  'Confirmação de Presença Libri • legado',
  1, 0, 50,
  json_object('legacy', 1, 'legacyAddonsJson', o.addons_json),
  o.created_at
FROM orders o
JOIN v2_orders v ON v.order_code = o.order_code
WHERE
  v.event_subtype = 'legacy_v1'
  AND json_valid(o.addons_json)
  AND json_extract(o.addons_json, '$.confirmation') = 1
  AND NOT EXISTS (
    SELECT 1 FROM v2_order_items i
    WHERE i.order_id = v.id AND i.item_code = 'confirmation_libri'
  );

INSERT INTO v2_order_items(
  order_id, item_type, item_code, name_snapshot,
  quantity, unit_price_cents, points_units, configuration_json, created_at
)
SELECT
  v.id, 'addon', 'custom_filter',
  'Filtro Personalizado • legado',
  1, 0, 50,
  json_object('legacy', 1, 'legacyAddonsJson', o.addons_json),
  o.created_at
FROM orders o
JOIN v2_orders v ON v.order_code = o.order_code
WHERE
  v.event_subtype = 'legacy_v1'
  AND json_valid(o.addons_json)
  AND json_extract(o.addons_json, '$.filter') = 1
  AND NOT EXISTS (
    SELECT 1 FROM v2_order_items i
    WHERE i.order_id = v.id AND i.item_code = 'custom_filter'
  );

INSERT INTO v2_order_items(
  order_id, item_type, item_code, name_snapshot,
  quantity, unit_price_cents, points_units, configuration_json, created_at
)
SELECT
  v.id, 'addon', 'legacy_extra_person',
  'Pessoa extra • legado',
  MAX(1, CAST(json_extract(o.addons_json, '$.extraPerson') AS INTEGER)),
  0, 0,
  json_object('legacy', 1, 'legacyAddonsJson', o.addons_json),
  o.created_at
FROM orders o
JOIN v2_orders v ON v.order_code = o.order_code
WHERE
  v.event_subtype = 'legacy_v1'
  AND json_valid(o.addons_json)
  AND COALESCE(CAST(json_extract(o.addons_json, '$.extraPerson') AS INTEGER), 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM v2_order_items i
    WHERE i.order_id = v.id AND i.item_code = 'legacy_extra_person'
  );

INSERT INTO v2_order_items(
  order_id, item_type, item_code, name_snapshot,
  quantity, unit_price_cents, points_units, configuration_json, created_at
)
SELECT
  v.id,
  'addon',
  CASE json_extract(o.addons_json, '$.photoAlbumPlan')
    WHEN 'premium' THEN 'moments_premium'
    WHEN 'exclusive' THEN 'moments_exclusive'
    ELSE 'moments_festa'
  END,
  'Libri Moments • '
    || CASE json_extract(o.addons_json, '$.photoAlbumPlan')
      WHEN 'premium' THEN 'Premium'
      WHEN 'exclusive' THEN 'Exclusive'
      ELSE 'Festa'
    END
    || ' • legado',
  1, 0, 50,
  json_object('legacy', 1, 'legacyAddonsJson', o.addons_json),
  o.created_at
FROM orders o
JOIN v2_orders v ON v.order_code = o.order_code
WHERE
  v.event_subtype = 'legacy_v1'
  AND json_valid(o.addons_json)
  AND json_extract(o.addons_json, '$.photoAlbumPlan') IN ('festa','premium','exclusive')
  AND NOT EXISTS (
    SELECT 1 FROM v2_order_items i
    WHERE i.order_id = v.id
      AND i.item_code IN ('moments_festa','moments_premium','moments_exclusive')
  );

INSERT INTO v2_order_items(
  order_id, item_type, item_code, name_snapshot,
  quantity, unit_price_cents, points_units, configuration_json, created_at
)
SELECT
  v.id, 'addon', 'moments_extra_100',
  'Libri Moments • +100 fotos • legado',
  MAX(1, CAST(json_extract(o.addons_json, '$.photoAlbumExtra100') AS INTEGER)),
  0, 0,
  json_object('legacy', 1, 'legacyAddonsJson', o.addons_json),
  o.created_at
FROM orders o
JOIN v2_orders v ON v.order_code = o.order_code
WHERE
  v.event_subtype = 'legacy_v1'
  AND json_valid(o.addons_json)
  AND COALESCE(CAST(json_extract(o.addons_json, '$.photoAlbumExtra100') AS INTEGER), 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM v2_order_items i
    WHERE i.order_id = v.id AND i.item_code = 'moments_extra_100'
  );

-- Snapshot financeiro do pedido antigo.
INSERT OR IGNORE INTO v2_order_pricing(
  order_id,
  subtotal_cents,
  combo_discount_cents,
  coupon_discount_cents,
  urgency_percent,
  urgency_amount_cents,
  total_cents,
  payment_method,
  deposit_percent,
  deposit_cents,
  balance_cents,
  currency,
  pricing_snapshot_json,
  updated_at
)
SELECT
  v.id,
  o.subtotal_cents,
  0,
  0,
  o.urgency_percent,
  o.urgency_amount_cents,
  o.total_cents,
  'pix',
  o.deposit_percent,
  o.deposit_cents,
  o.balance_cents,
  'BRL',
  json_object(
    'legacyV1', 1,
    'legacyPricingJson', COALESCE(o.pricing_json, '{}'),
    'legacyAddonsJson', COALESCE(o.addons_json, '{}'),
    'portfolioConsent', o.portfolio_consent
  ),
  o.updated_at
FROM orders o
JOIN v2_orders v
  ON v.order_code = o.order_code
WHERE v.event_subtype = 'legacy_v1';

-- Briefing: preserva o JSON V1 e acrescenta as chaves V2 usadas pelo painel.
INSERT OR IGNORE INTO v2_briefings(
  order_id,
  schema_version,
  data_json,
  current_section,
  completion_percent,
  started_at,
  completed_at,
  updated_at
)
SELECT
  v.id,
  'legacy-v1',
  json_patch(
    CASE
      WHEN json_valid(o.briefing_json) THEN o.briefing_json
      ELSE '{}'
    END,
    json_object(
      'age', o.age,
      'event_time', o.event_time,
      'venue_name', o.venue_name,
      'venue_address', o.venue_address,
      'location_url', o.location_url,
      'theme_or_style', o.theme,
      '_legacy_v1',
        json_object(
          'experience', o.experience,
          'format', o.format,
          'portfolioConsent', o.portfolio_consent,
          'addonsJson', COALESCE(o.addons_json, '{}')
        )
    )
  ),
  NULL,
  CASE
    WHEN trim(COALESCE(o.briefing_json, '')) NOT IN ('', '{}') THEN 100
    ELSE 0
  END,
  o.created_at,
  CASE
    WHEN trim(COALESCE(o.briefing_json, '')) NOT IN ('', '{}')
      THEN COALESCE(NULLIF(o.terms_accepted_at, ''), o.updated_at)
    ELSE NULL
  END,
  o.updated_at
FROM orders o
JOIN v2_orders v
  ON v.order_code = o.order_code
WHERE v.event_subtype = 'legacy_v1';

-- Aceite histórico dos termos.
INSERT INTO v2_order_terms_acceptances(
  order_id,
  terms_version,
  terms_hash,
  accepted_at,
  evidence_json
)
SELECT
  v.id,
  o.terms_version,
  NULL,
  o.terms_accepted_at,
  json_object(
    'source', 'legacy_v1',
    'portfolioConsent', o.portfolio_consent,
    'legacyOrderCode', o.order_code
  )
FROM orders o
JOIN v2_orders v
  ON v.order_code = o.order_code
WHERE
  v.event_subtype = 'legacy_v1'
  AND EXISTS (
    SELECT 1
    FROM v2_terms_versions t
    WHERE t.version = o.terms_version
  )
  AND NOT EXISTS (
    SELECT 1
    FROM v2_order_terms_acceptances a
    WHERE a.order_id = v.id
      AND a.terms_version = o.terms_version
      AND a.accepted_at = o.terms_accepted_at
  );

-- Pagamentos manuais que já estavam confirmados na V1.
INSERT INTO v2_payments(
  order_id,
  provider,
  payment_type,
  method,
  status,
  amount_cents,
  fee_cents,
  net_cents,
  provider_payload_json,
  paid_at,
  created_at,
  updated_at
)
SELECT
  v.id,
  'direct_pix',
  'deposit',
  'pix',
  'approved',
  o.deposit_cents,
  0,
  o.deposit_cents,
  json_object('source', 'legacy_v1', 'legacyStatus', o.entry_status),
  COALESCE(
    (
      SELECT MIN(h.created_at)
      FROM order_history h
      WHERE h.order_id = o.id
        AND h.action_code = 'update_entry_status'
        AND h.description LIKE '%confirm%'
    ),
    o.updated_at,
    o.created_at
  ),
  o.created_at,
  o.updated_at
FROM orders o
JOIN v2_orders v
  ON v.order_code = o.order_code
WHERE
  v.event_subtype = 'legacy_v1'
  AND o.entry_status = 'confirmed'
  AND o.deposit_cents > 0
  AND NOT EXISTS (
    SELECT 1
    FROM v2_payments p
    WHERE p.order_id = v.id
      AND p.provider = 'direct_pix'
      AND p.payment_type = 'deposit'
  );

INSERT INTO v2_payments(
  order_id,
  provider,
  payment_type,
  method,
  status,
  amount_cents,
  fee_cents,
  net_cents,
  provider_payload_json,
  paid_at,
  created_at,
  updated_at
)
SELECT
  v.id,
  'direct_pix',
  'balance',
  'pix',
  'approved',
  o.balance_cents,
  0,
  o.balance_cents,
  json_object('source', 'legacy_v1', 'legacyStatus', o.balance_status),
  COALESCE(
    (
      SELECT MIN(h.created_at)
      FROM order_history h
      WHERE h.order_id = o.id
        AND h.action_code = 'update_balance_status'
        AND h.description LIKE '%confirm%'
    ),
    o.updated_at,
    o.created_at
  ),
  o.created_at,
  o.updated_at
FROM orders o
JOIN v2_orders v
  ON v.order_code = o.order_code
WHERE
  v.event_subtype = 'legacy_v1'
  AND o.balance_status = 'confirmed'
  AND o.balance_cents > 0
  AND NOT EXISTS (
    SELECT 1
    FROM v2_payments p
    WHERE p.order_id = v.id
      AND p.provider = 'direct_pix'
      AND p.payment_type = 'balance'
  );

-- Histórico e observações internos.
INSERT INTO v2_order_history(
  order_id,
  action_code,
  description,
  metadata_json,
  created_at
)
SELECT
  v.id,
  'legacy_v1_' || h.action_code,
  h.description,
  CASE
    WHEN json_valid(h.metadata_json) THEN h.metadata_json
    ELSE json_object('legacyMetadata', COALESCE(h.metadata_json, ''))
  END,
  h.created_at
FROM order_history h
JOIN orders o
  ON o.id = h.order_id
JOIN v2_orders v
  ON v.order_code = o.order_code
WHERE
  v.event_subtype = 'legacy_v1'
  AND NOT EXISTS (
    SELECT 1
    FROM v2_order_history vh
    WHERE vh.order_id = v.id
      AND vh.action_code = 'legacy_v1_' || h.action_code
      AND vh.description = h.description
      AND vh.created_at = h.created_at
  );

INSERT INTO v2_order_history(
  order_id,
  action_code,
  description,
  metadata_json,
  created_at
)
SELECT
  v.id,
  'legacy_v1_imported',
  'Pedido importado da V1 para a V2; origem preservada no D1.',
  json_object(
    'legacyOrderId', o.id,
    'legacyOrderCode', o.order_code,
    'legacyPublicToken', o.public_token
  ),
  datetime('now')
FROM orders o
JOIN v2_orders v
  ON v.order_code = o.order_code
WHERE
  v.event_subtype = 'legacy_v1'
  AND NOT EXISTS (
    SELECT 1
    FROM v2_order_history h
    WHERE h.order_id = v.id
      AND h.action_code = 'legacy_v1_imported'
  );

INSERT INTO v2_internal_notes(
  order_id,
  note,
  created_at
)
SELECT
  v.id,
  n.note,
  n.created_at
FROM internal_notes n
JOIN orders o
  ON o.id = n.order_id
JOIN v2_orders v
  ON v.order_code = o.order_code
WHERE
  v.event_subtype = 'legacy_v1'
  AND NOT EXISTS (
    SELECT 1
    FROM v2_internal_notes vn
    WHERE vn.order_id = v.id
      AND vn.note = n.note
      AND vn.created_at = n.created_at
  );

-- Agenda dos pedidos ativos importados. Distribui a carga em até dois dias
-- da janela para que o legado passe a contar na capacidade da V2.
INSERT INTO v2_agenda_allocations(
  order_id,
  day,
  points_units,
  allocation_type,
  created_at
)
SELECT
  v.id,
  v.delivery_start,
  MIN(400, totals.points_units),
  'confirmed',
  o.created_at
FROM orders o
JOIN v2_orders v
  ON v.order_code = o.order_code
JOIN (
  SELECT
    order_id,
    SUM(points_units * quantity) AS points_units
  FROM v2_order_items
  GROUP BY order_id
) totals
  ON totals.order_id = v.id
WHERE
  v.event_subtype = 'legacy_v1'
  AND v.status NOT IN ('finalized', 'cancelled', 'awaiting_payment')
  AND totals.points_units > 0
  AND NOT EXISTS (
    SELECT 1
    FROM v2_agenda_allocations a
    WHERE a.order_id = v.id
  );

INSERT INTO v2_agenda_allocations(
  order_id,
  day,
  points_units,
  allocation_type,
  created_at
)
SELECT
  v.id,
  date(v.delivery_start, '+1 day'),
  totals.points_units - 400,
  'confirmed',
  o.created_at
FROM orders o
JOIN v2_orders v
  ON v.order_code = o.order_code
JOIN (
  SELECT
    order_id,
    SUM(points_units * quantity) AS points_units
  FROM v2_order_items
  GROUP BY order_id
) totals
  ON totals.order_id = v.id
WHERE
  v.event_subtype = 'legacy_v1'
  AND v.status NOT IN ('finalized', 'cancelled', 'awaiting_payment')
  AND totals.points_units > 400
  AND NOT EXISTS (
    SELECT 1
    FROM v2_agenda_allocations a
    WHERE a.order_id = v.id
      AND a.day = date(v.delivery_start, '+1 day')
  );

-- Mantém a sequência acima de qualquer código histórico ou V2 existente.
UPDATE v2_sequences
SET value = MAX(
  value,
  COALESCE(
    (
      SELECT MAX(CAST(SUBSTR(order_code, 7) AS INTEGER))
      FROM orders
      WHERE order_code GLOB 'LIBRI-[0-9]*'
    ),
    0
  ),
  COALESCE(
    (
      SELECT MAX(CAST(SUBSTR(order_code, 7) AS INTEGER))
      FROM v2_orders
      WHERE order_code GLOB 'LIBRI-[0-9]*'
    ),
    0
  )
)
WHERE name = 'order_number';

INSERT OR REPLACE INTO v2_settings(
  key,
  value,
  updated_at
)
VALUES (
  'legacy_v1_runtime_status',
  'retired',
  datetime('now')
);
