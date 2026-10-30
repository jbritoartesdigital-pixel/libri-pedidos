import { loadV2Catalog } from './v2-catalog.js';
import { sceneLinkUrl } from '../../public/js/v2-scene-links.js';

// Safe query layer for a future private MCP integration. This module does not
// create any HTTP routes or authentication bypasses.
const ORDER_COLUMNS = [
  'SELECT o.order_code AS code, o.honoree_display_name AS honoree_name,',
  'c.name AS customer_name, o.event_date, o.delivery_start, o.delivery_end,',
  'o.status, o.next_action, o.briefing_status,',
  'p.total_cents, p.payment_method,',
  '(SELECT i.name_snapshot FROM v2_order_items i',
  "WHERE i.order_id = o.id AND i.item_type = 'product'",
  'ORDER BY i.id LIMIT 1) AS product_name,',
  '(SELECT json_extract(i.configuration_json, \'$.sceneCount\')',
  "FROM v2_order_items i WHERE i.order_id = o.id AND i.item_type = 'product'",
  'ORDER BY i.id LIMIT 1) AS scene_count,',
  'COALESCE((SELECT SUM(CASE',
  "WHEN pay.status = 'approved' AND pay.payment_type = 'refund' THEN -pay.amount_cents",
  "WHEN pay.status = 'approved' THEN pay.amount_cents",
  'ELSE 0 END) FROM v2_payments pay WHERE pay.order_id = o.id), 0) AS paid_cents',
  'FROM v2_orders o',
  'JOIN v2_customers c ON c.id = o.customer_id',
  'JOIN v2_order_pricing p ON p.order_id = o.id',
].join(' ');

const BASE_ORIGIN = 'https://pedidos.libriconvites.com.br';

function readDate(value, field) {
  const text = String(value || '').trim();
  if (text && !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error('Data inválida: ' + field);
  }
  return text;
}

function readStatus(value) {
  const text = String(value || '').trim();
  if (text && !/^[a-z_]{2,50}$/.test(text)) {
    throw new Error('Status inválido.');
  }
  return text;
}

function publicSummary(row) {
  if (!row) return null;
  const totalCents = Math.max(0, Number(row.total_cents || 0));
  const paidCents = Math.max(0, Number(row.paid_cents || 0));
  return {
    code: row.code,
    honoreeName: row.honoree_name,
    customerName: row.customer_name,
    eventDate: row.event_date,
    deliveryWindow: { start: row.delivery_start, end: row.delivery_end },
    status: row.status,
    nextAction: row.next_action || '',
    briefingStatus: row.briefing_status,
    productName: row.product_name || '',
    sceneCount: Number(row.scene_count || 0),
    paymentMethod: row.payment_method,
    totalCents,
    paidCents,
    remainingBalanceCents: Math.max(0, totalCents - paidCents),
  };
}

// Returns only approved fields. Never returns customer contacts, private
// order tokens, checkout links, payment identifiers, notes or media.
export async function listLibriAssistantOrders(db, options = {}) {
  const query = String(options.query || '').trim().slice(0, 80);
  const status = readStatus(options.status);
  const from = readDate(options.deliveryFrom, 'deliveryFrom');
  const to = readDate(options.deliveryTo, 'deliveryTo');
  if (from && to && from > to) {
    throw new Error('Período de entrega inválido.');
  }

  const clauses = ['o.archived_at IS NULL'];
  const values = [];
  if (query) {
    const pattern = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
    clauses.push("(o.order_code LIKE ? ESCAPE '\\' OR o.honoree_display_name LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')");
    values.push(pattern, pattern, pattern);
  }
  if (status) { clauses.push('o.status = ?'); values.push(status); }
  if (from) { clauses.push('o.delivery_start >= ?'); values.push(from); }
  if (to) { clauses.push('o.delivery_start <= ?'); values.push(to); }

  const requestedLimit = Number(options.limit);
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 25) : 15;
  const sql = ORDER_COLUMNS + ' WHERE ' + clauses.join(' AND ')
    + ' ORDER BY o.delivery_start IS NULL, o.delivery_start, o.created_at DESC LIMIT ?';
  const rows = await db.prepare(sql).bind(...values, limit).all();
  return (rows.results || []).map(publicSummary);
}

export async function getLibriAssistantOrder(db, orderCode) {
  const code = String(orderCode || '').trim().toUpperCase();
  if (!/^LIBRI-\d{1,12}$/.test(code)) {
    throw new Error('Código de pedido inválido.');
  }
  const row = await db.prepare(
    ORDER_COLUMNS + ' WHERE o.order_code = ? LIMIT 1'
  ).bind(code).first();
  return publicSummary(row);
}

// Reuses the existing storefront scene-count link rules. It verifies that the
// requested scene count is an active variant; it never invents a price.
export async function getLibriAssistantSceneLink(db, productCode, sceneCount) {
  const code = String(productCode || '').trim();
  const scenes = Number(sceneCount);
  if (!/^[a-z0-9_-]{2,80}$/.test(code)
    || !Number.isSafeInteger(scenes) || scenes < 1 || scenes > 99) {
    throw new Error('Produto ou quantidade de cenas inválida.');
  }
  const catalog = await loadV2Catalog(db);
  const product = catalog.products.find(item => item.code === code);
  if (!product || product.pricingMode !== 'scene_count') {
    throw new Error('Produto não disponível para escolha de cenas.');
  }
  const variant = product.variants.find(item => Number(item.sceneCount) === scenes);
  if (!variant) throw new Error('Quantidade de cenas não está ativa no catálogo.');
  return {
    productCode: product.code,
    productName: product.name,
    sceneCount: scenes,
    variantCode: variant.code,
    variantLabel: variant.label,
    priceCents: Number(variant.priceCents),
    url: sceneLinkUrl(BASE_ORIGIN, product.slug, scenes),
  };
}
