import { nowIso } from './http.js';
import { isV2LegacyImport } from './v2-legacy-order-marker.js';

// Correct the workflow after a real, approved direct Pix receipt. Never
// generate a payment, change its value, or infer one from an invoice/link.
// The action also repairs historical V1 receipts recorded before this fix.
export async function reconcileV2LegacyPixStatus(db, orderCode) {
  if (!/^LIBRI-\d+$/.test(orderCode || '')) {
    const error = new Error('Código do pedido inválido.');
    error.status = 422;
    throw error;
  }
  const row = await db.prepare(`
    SELECT o.id,o.status,o.briefing_status,o.source,o.event_subtype,
           pr.payment_method,pr.total_cents,pr.pricing_snapshot_json,
           EXISTS(SELECT 1 FROM v2_order_items i WHERE i.order_id=o.id
             AND i.item_type='product' AND i.item_code GLOB 'legacy_*') AS legacy_product
    FROM v2_orders o
    JOIN v2_order_pricing pr ON pr.order_id=o.id
    WHERE o.order_code=? LIMIT 1
  `).bind(orderCode).first();
  if (!row) {
    const error = new Error('Pedido não encontrado.');
    error.status = 404;
    throw error;
  }
  if (row.payment_method !== 'pix' || !(
    row.source === 'manual_whatsapp'
    || isV2LegacyImport(row, row.legacy_product
      ? [{ item_type: 'product', item_code: 'legacy_import' }] : [])
  )) {
    const error = new Error('Conciliação manual disponível somente para pedidos Pix manuais ou importados da V1.');
    error.status = 403;
    throw error;
  }
  const sums = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status='approved' AND payment_type!='refund'
        THEN amount_cents ELSE 0 END),0) AS received_cents,
      COALESCE(SUM(CASE WHEN status='approved' AND payment_type='refund'
        THEN amount_cents ELSE 0 END),0) AS refunded_cents,
      SUM(CASE WHEN status='approved' AND provider='direct_pix'
        AND payment_type!='refund' THEN 1 ELSE 0 END) AS manual_count
    FROM v2_payments WHERE order_id=?
  `).bind(row.id).first();
  const paid = Math.max(0,
    Number(sums?.received_cents || 0) - Number(sums?.refunded_cents || 0));
  if (Number(sums?.manual_count || 0) < 1 || paid <= 0) {
    const error = new Error('Não há Pix manual aprovado com saldo positivo neste pedido. Confira os lançamentos antes de atualizar o status.');
    error.status = 409;
    throw error;
  }
  // An existing production or delivery stage must never be rewound.
  if (row.status !== 'awaiting_payment') {
    return { changed: false, status: row.status,
      briefingStatus: row.briefing_status, paidCents: paid,
      remainingCents: Math.max(0, Number(row.total_cents || 0) - paid) };
  }
  const briefingStatus = row.briefing_status === 'locked'
    ? 'available' : row.briefing_status;
  const newStatus = briefingStatus === 'completed'
    ? 'ready_for_production' : 'briefing_pending';
  const nextAction = briefingStatus === 'completed'
    ? 'Iniciar produção' : 'Aguardar dados da festa';
  const stamp = nowIso();
  const updated = await db.prepare(`
    UPDATE v2_orders SET status=?, briefing_status=?, next_action=?, updated_at=?
    WHERE id=? AND status='awaiting_payment'
      AND EXISTS (SELECT 1 FROM v2_payments p
        WHERE p.order_id=v2_orders.id AND p.provider='direct_pix'
          AND p.status='approved' AND p.payment_type!='refund')
  `).bind(newStatus, briefingStatus, nextAction, stamp, row.id).run();
  if (Number(updated.meta?.changes || 0) !== 1) {
    const error = new Error('O pedido mudou. Atualize a Central antes de tentar novamente.');
    error.status = 409;
    throw error;
  }
  await db.prepare(`
    INSERT INTO v2_order_history
      (order_id, action_code, description, metadata_json, created_at)
    VALUES (?, 'finance_manual_receipt_reconciled',
      'Status do pedido corrigido após confirmação de Pix já recebido.', ?, ?)
  `).bind(row.id, JSON.stringify({
    source: 'admin_pix_reconciliation', beforeStatus: row.status,
    afterStatus: newStatus, beforeBriefingStatus: row.briefing_status,
    afterBriefingStatus: briefingStatus, paidCents: paid,
    note: 'Nenhum lançamento financeiro foi criado ou alterado.',
  }), stamp).run();
  return { changed: true, status: newStatus, briefingStatus,
    paidCents: paid,
    remainingCents: Math.max(0, Number(row.total_cents || 0) - paid) };
}
