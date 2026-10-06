import { nowIso } from './http.js';
import { syncMercadoPagoOrder } from './v2-mercadopago.js';
import { createV2AdminNotification, runV2NotificationScheduler } from './v2-notifications.js';
import { cleanupAbandonedUnpaidV2Orders } from './v2-admin-core.js';

export async function runV2Scheduler(env) {
  const result = { synced: 0, failed: 0 };
  const pending = await env.DB.prepare(`SELECT p.provider_order_id
    FROM v2_payments p
    INNER JOIN v2_orders o
      ON o.id = p.order_id
    WHERE
      p.provider = 'mercado_pago'
      AND p.provider_order_id IS NOT NULL
      AND (
        p.status = 'pending'
        OR (
          p.status = 'approved'
          AND (
            (
              o.briefing_status = 'locked'
              AND o.status IN ('awaiting_payment', 'urgency_approved')
            )
            OR datetime(p.updated_at) < datetime('now', '-1 day')
          )
        )
      )
    ORDER BY p.updated_at, p.id
    LIMIT 20`).all();
  for (const payment of pending.results || []) {
    try { await syncMercadoPagoOrder(env, payment.provider_order_id); result.synced++; }
    catch (error) {
      result.failed++; console.error('V2 payment sync failed', payment.provider_order_id, error.message);
      if (error.code !== 'order_busy') await env.DB.prepare('UPDATE v2_payments SET updated_at = ? WHERE provider_order_id = ?')
        .bind(nowIso(), payment.provider_order_id).run();
    }
  }
  const stamp = nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE v2_checkout_holds SET status = 'expired', updated_at = ?
      WHERE status = 'active' AND expires_at <= ?`).bind(stamp, stamp),
    env.DB.prepare(`UPDATE v2_previews SET status = 'expired'
      WHERE status = 'active' AND expires_at <= ?`).bind(stamp),
    // A Worker request cannot still own a lock after this interval.
    env.DB.prepare(`DELETE FROM v2_checkout_requests WHERE status = 'processing'
      AND datetime(updated_at) < datetime('now', '-15 minutes')`),
    env.DB.prepare(`DELETE FROM v2_admin_webauthn_challenges WHERE expires_at <= ?`).bind(stamp),
  ]);
  // Repair a notification whose initial creation failed without losing the request.
  const urgency = await env.DB.prepare(`SELECT o.id, o.order_code, o.honoree_display_name FROM v2_orders o
    JOIN v2_urgency_requests u ON u.order_id = o.id WHERE u.status = 'pending'
    AND NOT EXISTS (SELECT 1 FROM v2_notifications n WHERE n.order_id = o.id AND n.event_code = 'URGENCY_REQUESTED') LIMIT 50`).all();
  for (const order of urgency.results || []) {
    await createV2AdminNotification(env, { eventCode: 'URGENCY_REQUESTED', orderId: order.id,
      title: 'Pedido de encaixe urgente', body: `${order.order_code} • ${order.honoree_display_name}`,
      actionUrl: `/admin-v2?order=${encodeURIComponent(order.order_code)}`, priority: 'high',
      pushEligible: true, dedupeKey: `urgency-requested:${order.id}` });
  }
  result.abandonedOrders = await cleanupAbandonedUnpaidV2Orders(env);
  result.notifications = await runV2NotificationScheduler(env);
  return result;
}
