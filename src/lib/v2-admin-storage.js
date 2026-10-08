// Manual, auditable cleanup. No scheduled task uses these functions.
import { nowIso } from './http.js';

function dayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const fields = Object.fromEntries(parts.map(item => [item.type, item.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function daysAgo(day, number) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - number);
  return date.toISOString().slice(0, 10);
}

async function retentionDays(db) {
  const row = await db.prepare(
    "SELECT value FROM v2_settings WHERE key = 'upload_retention_days'",
  ).first();
  const days = Number(row?.value || 0);
  return Number.isInteger(days) && days >= 30 && days <= 3650 ? days : 0;
}

export async function previewV2PhotoRetention(db) {
  const days = await retentionDays(db);
  if (!days) return {
    enabled: false, days: 0, automaticDeletion: false, orders: [],
    message: 'Sem prazo de revisão configurado. Nenhum arquivo será excluído.',
  };
  const cutoff = daysAgo(dayInSaoPaulo(), days);
  const rows = await db.prepare(`
    SELECT o.order_code, o.honoree_display_name, o.finalized_at,
      COUNT(u.id) AS photo_count
    FROM v2_orders o
    JOIN v2_briefing_uploads u ON u.order_id = o.id
    WHERE o.status = 'finalized'
      AND o.finalized_at IS NOT NULL AND substr(o.finalized_at, 1, 10) <= ?
    GROUP BY o.id
    ORDER BY o.finalized_at ASC LIMIT 100
  `).bind(cutoff).all();
  return {
    enabled: true, days, automaticDeletion: false, cutoff,
    orders: (rows.results || []).map(row => ({
      code: row.order_code, honoreeName: row.honoree_display_name,
      finalizedAt: row.finalized_at, photoCount: Number(row.photo_count || 0),
    })),
    message: 'Faça backup da pasta antes de excluir as fotos manualmente. Nada é apagado automaticamente.',
  };
}

export async function purgeV2FinishedOrderPhotos(env, orderCode, body = {}) {
  if (!/^LIBRI-\d+$/.test(orderCode || '') ||
    body.confirmCode !== orderCode || body.backupConfirmed !== true) {
    throw new Error('Confirme o código exato e que já guardou o backup do pedido.');
  }
  const retention = await previewV2PhotoRetention(env.DB);
  if (!retention.enabled || !retention.orders.some(row => row.code === orderCode)) {
    throw new Error('Fotos fora do prazo de revisão ou pedido não finalizado.');
  }
  if (!env.FILES) throw new Error('Armazenamento indisponível.');
  const row = await env.DB.prepare(
    'SELECT id FROM v2_orders WHERE order_code = ? AND status = ?',
  ).bind(orderCode, 'finalized').first();
  if (!row) throw new Error('Pedido não encontrado.');
  const uploads = await env.DB.prepare(
    'SELECT id, r2_key FROM v2_briefing_uploads WHERE order_id = ? ORDER BY id',
  ).bind(row.id).all();
  const items = uploads.results || [];
  const base = 'orders/' + row.id + '/briefing/';
  if (items.some(item => !String(item.r2_key || '').startsWith(base))) {
    throw new Error('Chaves de arquivo inesperadas. Nenhuma foto foi excluída.');
  }
  // Delete each R2 file before dropping its database reference. A failed
  // storage call leaves the remaining references visible and retryable.
  let removed = 0;
  for (const item of items) {
    await env.FILES.delete(item.r2_key);
    await env.DB.prepare(
      'DELETE FROM v2_briefing_uploads WHERE id = ? AND order_id = ?',
    ).bind(item.id, row.id).run();
    removed++;
  }
  await env.DB.prepare(`
    INSERT INTO v2_order_history(order_id, action_code, description, metadata_json, created_at)
    VALUES (?, 'photos_deleted_manually', 'Fotos antigas excluídas após confirmação de backup.', ?, ?)
  `).bind(row.id, JSON.stringify({ removed, retentionDays: retention.days }), nowIso()).run();
  return { ok: true, code: orderCode, removed };
}
