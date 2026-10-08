import { normalizeWhatsapp } from './http.js';

function day(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

export async function lookupReturningV2Customer(db, phone) {
  const digits = normalizeWhatsapp(String(phone || ''));
  if (!/^55\d{10,11}$/.test(digits)) return null;
  const row = await db.prepare(`
    SELECT c.name, c.whatsapp, c.email,
      (SELECT COUNT(*) FROM v2_orders o WHERE o.customer_id = c.id) AS order_count,
      (SELECT MAX(event_date) FROM v2_orders o WHERE o.customer_id = c.id) AS last_event
    FROM v2_customers c
    WHERE c.whatsapp = ?
    ORDER BY c.id DESC LIMIT 1
  `).bind(digits).first();
  return row ? {
    name: row.name, whatsapp: row.whatsapp, email: row.email || '',
    previousOrders: Number(row.order_count || 0), lastEvent: row.last_event,
  } : null;
}

export async function searchV2AdminOrders(db, filters = {}) {
  const query = String(filters.q || '').trim().slice(0, 100);
  const status = String(filters.status || '').slice(0, 60);
  const product = String(filters.product || '').slice(0, 80);
  const from = day(filters.from);
  const to = day(filters.to);
  const archived = String(filters.archived || 'all');
  if (filters.from && !from || filters.to && !to || from && to && from > to) {
    throw new Error('Confira o período de busca.');
  }
  if (status && !/^[a-z_]{2,50}$/.test(status)) throw new Error('Status inválido.');
  if (product && !/^[a-z0-9_-]{2,80}$/.test(product)) throw new Error('Formato inválido.');
  const pattern = '%' + query + '%';
  const result = await db.prepare(`
    SELECT o.order_code, o.honoree_display_name, o.event_date, o.status,
      o.archived_at, o.delivery_start, c.name AS customer_name, c.whatsapp,
      (SELECT COALESCE(json_extract(oi.configuration_json, '$.productCode'), oi.item_code)
       FROM v2_order_items oi WHERE oi.order_id = o.id AND oi.item_type = 'product'
       ORDER BY oi.id LIMIT 1) AS product_code
    FROM v2_orders o
    JOIN v2_customers c ON c.id = o.customer_id
    WHERE (? = '' OR o.order_code LIKE ? OR o.honoree_display_name LIKE ?
      OR c.name LIKE ? OR c.whatsapp LIKE ?)
      AND (? = '' OR o.status = ?)
      AND (? = '' OR EXISTS (SELECT 1 FROM v2_order_items item WHERE item.order_id = o.id
        AND item.item_type = 'product'
        AND (item.item_code = ? OR json_extract(item.configuration_json, '$.productCode') = ?)))
      AND (? = '' OR o.event_date >= ?)
      AND (? = '' OR o.event_date <= ?)
      AND (? = 'all' OR (? = 'yes' AND o.archived_at IS NOT NULL)
        OR (? = 'no' AND o.archived_at IS NULL))
    ORDER BY o.created_at DESC, o.id DESC LIMIT 100
  `).bind(query, pattern, pattern, pattern, pattern,
    status, status, product, product, product,
    from, from, to, to, archived, archived, archived).all();
  return (result.results || []).map(row => ({
    code: row.order_code, honoreeName: row.honoree_display_name,
    customerName: row.customer_name, whatsapp: row.whatsapp,
    eventDate: row.event_date, deliveryStart: row.delivery_start,
    status: row.status, archived: Boolean(row.archived_at),
    productCode: row.product_code || '',
  }));
}
