import { nowIso } from './http.js';

// Capacity review is independent of collecting the customer's briefing.
// It is never an authorization to start production without reserved agenda.
export async function pendingPaidCapacityReview(db, orderId) {
  const row = await db.prepare(`
    SELECT
      EXISTS (
        SELECT 1 FROM v2_order_history h
        WHERE h.order_id = ? AND h.action_code = 'payment_capacity_review'
      ) AS opened,
      EXISTS (
        SELECT 1 FROM v2_order_history h
        WHERE h.order_id = ? AND h.action_code = 'delivery_capacity_confirmed'
      ) AS resolved,
      EXISTS (
        SELECT 1 FROM v2_agenda_allocations a WHERE a.order_id = ?
      ) AS allocated
  `).bind(orderId, orderId, orderId).first();
  return Boolean(row?.opened && !row?.resolved && !row?.allocated);
}

// Only an already-approved, non-refunded payment can unlock the form.
// The order moves to briefing_pending rather than ready_for_production.
export async function openPaidCapacityReview(db, orderId, source = 'mercado_pago') {
  const stamp = nowIso();
  const approved = `EXISTS (
    SELECT 1 FROM v2_payments p WHERE p.order_id = v2_orders.id
      AND p.status = 'approved' AND p.payment_type != 'refund'
  )`;
  const changes = await db.batch([
    db.prepare(`
      UPDATE v2_orders
      SET status = 'briefing_pending',
          briefing_status = 'available',
          next_action = 'Dados liberados; conferir janela de entrega antes da produção',
          updated_at = ?
      WHERE id = ? AND briefing_status = 'locked'
        AND status IN ('awaiting_payment', 'urgency_approved')
        AND ${approved}
        AND NOT EXISTS (
          SELECT 1 FROM v2_agenda_allocations a WHERE a.order_id = v2_orders.id
        )
    `).bind(stamp, orderId),
    db.prepare(`
      INSERT INTO v2_order_history (
        order_id, action_code, description, metadata_json, created_at
      )
      SELECT ?, 'payment_capacity_review',
        'Pagamento recebido. Dados liberados; agenda exige revisão antes da produção.',
        ?, ?
      WHERE EXISTS (
        SELECT 1 FROM v2_payments p WHERE p.order_id = ?
          AND p.status = 'approved' AND p.payment_type != 'refund'
      )
        AND EXISTS (
          SELECT 1 FROM v2_orders o
          WHERE o.id = ? AND o.status = 'briefing_pending'
        )
        AND NOT EXISTS (
          SELECT 1 FROM v2_agenda_allocations a WHERE a.order_id = ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM v2_order_history h
          WHERE h.order_id = ? AND h.action_code = 'payment_capacity_review'
        )
    `).bind(orderId, JSON.stringify({ source }), stamp, orderId, orderId, orderId, orderId),
  ]);
  return {
    unlocked: Number(changes?.[0]?.meta?.changes || 0) === 1,
    pending: await pendingPaidCapacityReview(db, orderId),
  };
}
