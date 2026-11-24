import {V3_SERVICE_LABELS} from './v3-order-overview.js';
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
  const sceneText = String(filters.scenes || '').trim();
  const sceneCount = sceneText ? Number(sceneText) : 0;
  const eventDate = day(filters.eventDate);
  const from = day(filters.from);
  const to = day(filters.to);
  const archived = String(filters.archived || 'all');
  const family = String(filters.family || '');
  if(!['','convite','identidade_visual','retrospectiva'].includes(family))throw new Error('Serviço inválido.');
  if(!['all','yes','no'].includes(archived))throw new Error('Filtro de arquivo inválido.');
  if (filters.from && !from || filters.to && !to || from && to && from > to) {
    throw new Error('Confira o período de busca.');
  }
  if (filters.eventDate && !eventDate) throw new Error('Confira a data exata da festa.');
  if (sceneText && (!/^[1-9][0-9]?$/.test(sceneText) || sceneCount > 20)) {
    throw new Error('Número de cenas inválido.');
  }
  if (status && !/^[a-z_]{2,50}$/.test(status)) throw new Error('Status inválido.');
  if (product && !/^[a-z0-9_-]{2,80}$/.test(product)) throw new Error('Formato inválido.');
  const pattern = '%' + query + '%';
  // One result per order. The effective V3 snapshot is authoritative for
  // upgrades/new services; do not use the first V2 item for modular orders.
  const result = await db.prepare(`
    WITH lines AS (
      SELECT s.order_id,s.family,s.product_code,s.variant_code,
        COALESCE(CAST(json_extract(COALESCE(s.effective_snapshot_json,s.commercial_snapshot_json),'$.variant.sceneCount') AS INTEGER),0) AS scene_count,
        json_extract(COALESCE(s.effective_snapshot_json,s.commercial_snapshot_json),'$.product.name') AS product_name,
        s.production_status,s.briefing_status,s.reviewed_at,s.delivery_start,s.delivery_end
      FROM v3_order_services s
      UNION ALL
      SELECT o.id,
        CASE WHEN COALESCE(CASE WHEN json_valid(item.configuration_json) THEN json_extract(item.configuration_json,'$.productCode') END,product_catalog.code,item.item_code) LIKE 'atelie_%' THEN 'identidade_visual'
        WHEN COALESCE(CASE WHEN json_valid(item.configuration_json) THEN json_extract(item.configuration_json,'$.productCode') END,product_catalog.code,item.item_code) LIKE 'retrospectiva_%' THEN 'retrospectiva' ELSE 'convite' END,
        COALESCE(CASE WHEN json_valid(item.configuration_json) THEN json_extract(item.configuration_json,'$.productCode') END,product_catalog.code,item.item_code),
        item.item_code,COALESCE(CASE WHEN json_valid(item.configuration_json) THEN CAST(json_extract(item.configuration_json,'$.sceneCount') AS INTEGER) END,variant.scene_count,0),
        product_catalog.name,NULL,NULL,NULL,o.delivery_start,o.delivery_end
      FROM v2_orders o
      LEFT JOIN v2_order_items item ON item.id=(SELECT MIN(oi.id) FROM v2_order_items oi WHERE oi.order_id=o.id AND oi.item_type='product')
      LEFT JOIN v2_product_variants variant ON variant.code=item.item_code
      LEFT JOIN v2_products product_catalog ON product_catalog.id=variant.product_id
      WHERE NOT EXISTS(SELECT 1 FROM v3_order_checkout_snapshots snap WHERE snap.order_id=o.id)
    ), orders AS (
      SELECT o.id,o.order_code,o.honoree_display_name,o.event_date,o.status AS parent_status,o.archived_at,o.delivery_start,o.created_at,c.name AS customer_name,c.whatsapp,
        EXISTS(SELECT 1 FROM v3_order_checkout_snapshots snap WHERE snap.order_id=o.id) AS modular,
        (SELECT status FROM v3_paid_cancellations cc WHERE cc.order_id=o.id) AS cancellation,
        CASE WHEN o.status='cancelled' THEN 'cancelled'
          WHEN EXISTS(SELECT 1 FROM v3_paid_cancellations cc WHERE cc.order_id=o.id AND cc.status='review') THEN 'cancellation_review'
          WHEN NOT EXISTS(SELECT 1 FROM v3_order_checkout_snapshots snap WHERE snap.order_id=o.id) THEN o.status
          WHEN o.briefing_status='locked' OR o.status IN ('configuring','awaiting_payment') THEN 'awaiting_payment'
          WHEN o.status='capacity_review' THEN 'capacity_review'
          WHEN EXISTS(SELECT 1 FROM lines l WHERE l.order_id=o.id AND l.production_status='adjustments') THEN 'adjustments'
          WHEN EXISTS(SELECT 1 FROM lines l WHERE l.order_id=o.id AND l.production_status='waiting_customer') THEN 'waiting_customer'
          WHEN EXISTS(SELECT 1 FROM lines l WHERE l.order_id=o.id AND l.production_status='in_production') THEN 'in_production'
          WHEN EXISTS(SELECT 1 FROM lines l WHERE l.order_id=o.id AND l.production_status='ready') THEN 'ready_for_production'
          WHEN EXISTS(SELECT 1 FROM lines l WHERE l.order_id=o.id AND l.production_status='approved') THEN 'approved'
          WHEN EXISTS(SELECT 1 FROM lines l WHERE l.order_id=o.id AND l.production_status='pending') THEN 'briefing_pending'
          WHEN EXISTS(SELECT 1 FROM lines l WHERE l.order_id=o.id) AND NOT EXISTS(SELECT 1 FROM lines l WHERE l.order_id=o.id AND l.production_status!='delivered') THEN 'finalized'
          ELSE o.status END AS status
      FROM v2_orders o JOIN v2_customers c ON c.id=o.customer_id
    )
    SELECT o.*, (SELECT json_group_array(json_object('family',l.family,'productCode',l.product_code,'variantCode',l.variant_code,'sceneCount',l.scene_count,'productName',l.product_name,'productionStatus',l.production_status,'briefingStatus',l.briefing_status,'reviewedAt',l.reviewed_at,'deliveryStart',l.delivery_start,'deliveryEnd',l.delivery_end)) FROM lines l WHERE l.order_id=o.id) AS services_json
    FROM orders o
    WHERE (?='' OR o.order_code LIKE ? OR o.honoree_display_name LIKE ? OR o.customer_name LIKE ? OR o.whatsapp LIKE ?)
      AND (?='' OR o.status=? OR (o.modular=1 AND o.cancellation IS NULL AND o.status NOT IN ('cancelled','awaiting_payment') AND EXISTS(SELECT 1 FROM lines l WHERE l.order_id=o.id AND l.production_status=CASE ? WHEN 'briefing_pending' THEN 'pending' WHEN 'ready_for_production' THEN 'ready' ELSE ? END)))
      AND EXISTS(SELECT 1 FROM lines l WHERE l.order_id=o.id AND (?='' OR l.family=?) AND (?='' OR l.product_code=? OR l.variant_code=?) AND (?=0 OR l.scene_count=?))
      AND (?='' OR o.event_date=?) AND (?='' OR o.event_date>=?) AND (?='' OR o.event_date<=?)
      AND (?='all' OR (?='yes' AND o.archived_at IS NOT NULL) OR (?='no' AND o.archived_at IS NULL))
    ORDER BY CASE WHEN ?=1 THEN o.event_date END ASC,o.created_at DESC,o.id DESC LIMIT 100
  `).bind(query,pattern,pattern,pattern,pattern,status,status,status,status,family,family,product,product,product,sceneCount,sceneCount,eventDate,eventDate,from,from,to,to,archived,archived,archived,eventDate||from||to?1:0).all();
  return (result.results||[]).map(row=>{
    const services=JSON.parse(row.services_json||'[]').map(s=>({...s,statusLabel:V3_SERVICE_LABELS[s.productionStatus]||null}));
    const first=services.find(s=>s.family==='convite')||services[0]||{};
    return {code:row.order_code,honoreeName:row.honoree_display_name,customerName:row.customer_name,whatsapp:row.whatsapp,eventDate:row.event_date,deliveryStart:row.delivery_start,status:row.status,archived:Boolean(row.archived_at),productCode:first.productCode||'',sceneCount:Number(first.sceneCount||0),modular:Boolean(row.modular),services:row.modular?services:[]};
  });
}
