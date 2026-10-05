import { nowIso } from './http.js';
import { planV2AllocationForWindow } from './v2-agenda.js';
import { repriceApprovedV2Urgency } from './v2-checkout.js';
import { withV2PaymentLock } from './v2-payment-lock.js';

export function brazilToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function validateUrgencyWindow(start, end, eventDate) {
  const valid = x => /^\d{4}-\d{2}-\d{2}$/.test(x || '')
    && !Number.isNaN(Date.parse(`${x}T12:00:00Z`))
    && new Date(`${x}T12:00:00Z`).toISOString().slice(0, 10) === x;
  if (!valid(start) || !valid(end) || start > end || start < brazilToday() || end > eventDate) {
    throw new Error('Informe uma janela válida, de hoje até a data do evento.');
  }
}

export async function decideV2Urgency(db, orderCode, body) {
  if (!['approve', 'reject'].includes(body.decision)) throw new Error('Escolha aprovar ou rejeitar.');
  const row = await db.prepare(`SELECT o.*, u.status AS urgency_status, p.pricing_snapshot_json
    FROM v2_orders o JOIN v2_urgency_requests u ON u.order_id = o.id
    JOIN v2_order_pricing p ON p.order_id = o.id WHERE o.order_code = ?`).bind(orderCode).first();
  if (!row) throw Object.assign(new Error('Solicitação não encontrada.'), { status: 404 });
  return withV2PaymentLock(db, row.id, async () => {
    const current = await db.prepare(`SELECT o.status, u.status AS urgency_status
      FROM v2_orders o JOIN v2_urgency_requests u ON u.order_id = o.id WHERE o.id = ?`).bind(row.id).first();
    if (current.status !== 'awaiting_urgency_decision' || current.urgency_status !== 'pending') {
      throw Object.assign(new Error('Esta solicitação já recebeu uma decisão.'), { status: 409 });
    }
    const approved = body.decision === 'approve';
    const start = approved ? String(body.deliveryStart || '') : null;
    const end = approved ? String(body.deliveryEnd || '') : null;
    const note = String(body.note || '').trim().slice(0, 2000);
    if (!approved && !note) throw new Error('Informe o motivo da rejeição.');
    let pricing = null;
    if (approved) {
      validateUrgencyWindow(start, end, row.event_date);
      const snapshot = JSON.parse(row.pricing_snapshot_json || '{}');
      const plan = await planV2AllocationForWindow(db, { start, end, pointsUnits: snapshot.pointsUnits });
      if (!plan.fits) throw Object.assign(new Error('A janela não tem capacidade disponível.'), { status: 409 });
      pricing = await repriceApprovedV2Urgency(db, row.id);
    }
    const stamp = nowIso();
    await db.batch([
      db.prepare(`UPDATE v2_urgency_requests SET status = ?, urgency_percent = 30,
        requested_delivery_start = ?, requested_delivery_end = ?, decision_note = ?, decided_at = ?
        WHERE order_id = ? AND status = 'pending'`).bind(approved ? 'approved' : 'rejected', start, end, note, stamp, row.id),
      db.prepare(`UPDATE v2_orders SET status = ?, next_action = ?, delivery_start = ?, delivery_end = ?,
        urgency_enabled = ?, updated_at = ? WHERE id = ? AND status = 'awaiting_urgency_decision'`)
        .bind(approved ? 'urgency_approved' : 'cancelled', approved ? 'Encaixe aprovado; aguardando pagamento' : 'Encaixe não aprovado', start, end, approved ? 1 : 0, stamp, row.id),
      db.prepare(`INSERT INTO v2_order_history(order_id, action_code, description, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?)`).bind(row.id, approved ? 'urgency_approved' : 'urgency_rejected',
        approved ? 'Encaixe aprovado; pagamento liberado com adicional de 30%.' : 'Encaixe rejeitado.', JSON.stringify({ start, end, note }), stamp),
      db.prepare(`UPDATE v2_notifications SET resolved_at = ? WHERE order_id = ?
        AND event_code = 'URGENCY_REQUESTED' AND resolved_at IS NULL`).bind(stamp, row.id),
    ]);
    return { approved, pricing, deliveryWindow: { start, end }, note };
  });
}
