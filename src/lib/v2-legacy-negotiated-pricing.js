import { nowIso } from './http.js';
import { isV2LegacyImport } from './v2-legacy-order-marker.js';

function problem(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function integer(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : NaN;
}
function snapshotFrom(raw) {
  try {
    const data = JSON.parse(raw || '{}');
    return data && !Array.isArray(data) && typeof data === 'object' ? data : {};
  } catch { return {}; }
}

// Only legacy V1 orders may be repriced here. Payment evidence is never
// inferred or fabricated by this operation. Record actual receipts separately.
export async function setV2LegacyNegotiatedTotal(db, orderCode, body = {}) {
  if (!/^LIBRI-\d+$/.test(orderCode || '')) problem('Código de pedido inválido.');
  const expectedTotalCents = integer(body.expectedTotalCents);
  const agreedTotalCents = integer(body.agreedTotalCents);
  const reason = String(body.reason || '').trim();
  if (!Number.isSafeInteger(expectedTotalCents) || expectedTotalCents < 0
    || !Number.isSafeInteger(agreedTotalCents) || agreedTotalCents <= 0
    || reason.length < 5 || reason.length > 500) {
    problem('Informe o valor total combinado e o motivo do desconto (mínimo de 5 caracteres).');
  }
  const row = await db.prepare(`
    SELECT o.id, o.status, o.event_subtype, o.source,
           pr.total_cents, pr.deposit_cents, pr.balance_cents,
           pr.payment_method, pr.pricing_snapshot_json,
           EXISTS (
             SELECT 1 FROM v2_order_items i
             WHERE i.order_id=o.id AND i.item_type='product'
               AND i.item_code GLOB 'legacy_*'
           ) AS legacy_product
    FROM v2_orders o JOIN v2_order_pricing pr ON pr.order_id=o.id
    WHERE o.order_code=? LIMIT 1
  `).bind(orderCode).first();
  if (!row) problem('Pedido não encontrado.', 404);
  if (!isV2LegacyImport(row, row.legacy_product
    ? [{ item_type: 'product', item_code: 'legacy_import' }] : [])
    || row.payment_method !== 'pix') {
    problem('O ajuste de preço negociado só está disponível para pedidos Pix importados da V1.', 403);
  }
  if (['cancelled', 'finalized'].includes(row.status)) {
    problem('O pedido está encerrado. Não é possível alterar seu valor.', 409);
  }
  if (row.total_cents !== expectedTotalCents) {
    problem('O valor do pedido mudou. Atualize o pedido antes de salvar.', 409);
  }
  const mp = await db.prepare(`
    SELECT COUNT(*) AS n FROM v2_payments WHERE order_id=? AND provider='mercado_pago'
  `).bind(row.id).first();
  if (Number(mp?.n || 0) > 0) {
    problem('Há registros do Mercado Pago vinculados. Esta correção não pode alterá-los.', 409);
  }
  const sums = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status='approved' AND payment_type!='refund' THEN amount_cents ELSE 0 END),0) AS received,
      COALESCE(SUM(CASE WHEN status='approved' AND payment_type='refund' THEN amount_cents ELSE 0 END),0) AS refunded
    FROM v2_payments WHERE order_id=?
  `).bind(row.id).first();
  const paid = Math.max(0, Number(sums?.received || 0) - Number(sums?.refunded || 0));
  const oldSnapshot = snapshotFrom(row.pricing_snapshot_json);
  const original = integer(oldSnapshot.adminNegotiatedOriginalTotalCents);
  const originalTotalCents = Number.isSafeInteger(original) && original > 0
    ? original : row.total_cents;
  if (agreedTotalCents > originalTotalCents) {
    problem('Este recurso permite descontos, não acréscimos acima do valor original.');
  }
  if (agreedTotalCents < paid) {
    problem('O total combinado não pode ser menor que o valor líquido já recebido.', 409);
  }
  if (agreedTotalCents === row.total_cents) {
    return { unchanged: true, totalCents: row.total_cents,
      discountCents: originalTotalCents - row.total_cents,
      paidCents: paid, remainingCents: row.total_cents - paid };
  }
  const stamp = nowIso();
  const nextSnapshot = JSON.stringify({
    ...oldSnapshot,
    adminNegotiatedOriginalTotalCents: originalTotalCents,
    adminNegotiatedDiscountCents: originalTotalCents - agreedTotalCents,
    adminNegotiatedReason: reason,
    adminNegotiatedUpdatedAt: stamp,
  });
  const deposit = Math.min(agreedTotalCents, Math.max(0, Number(row.deposit_cents || 0)));
  // Both operations execute in the same database transaction. The history
  // entry is conditional on the updated snapshot being present.
  const results = await db.batch([
    db.prepare(`
      UPDATE v2_order_pricing SET total_cents=?, deposit_cents=?,
        balance_cents=?, pricing_snapshot_json=?, updated_at=?
      WHERE order_id=? AND total_cents=? AND pricing_snapshot_json=?
    `).bind(agreedTotalCents, deposit, agreedTotalCents - deposit,
      nextSnapshot, stamp, row.id, expectedTotalCents, row.pricing_snapshot_json),
    db.prepare(`
      INSERT INTO v2_order_history
        (order_id, action_code, description, metadata_json, created_at)
      SELECT ?, 'legacy_negotiated_discount',
        'Valor negociado com a cliente atualizado pela administradora.', ?, ?
      WHERE EXISTS(SELECT 1 FROM v2_order_pricing
        WHERE order_id=? AND total_cents=? AND pricing_snapshot_json=?)
    `).bind(row.id, JSON.stringify({
      source: 'admin_legacy_v1', beforeTotalCents: row.total_cents,
      afterTotalCents: agreedTotalCents,
      originalTotalCents, discountCents: originalTotalCents - agreedTotalCents,
      paidCents: paid, reason,
    }), stamp, row.id, agreedTotalCents, nextSnapshot),
  ]);
  if (Number(results?.[0]?.meta?.changes || 0) !== 1) {
    problem('O valor mudou durante a atualização. Abra o pedido novamente.', 409);
  }
  return { totalCents: agreedTotalCents,
    discountCents: originalTotalCents - agreedTotalCents,
    paidCents: paid, remainingCents: agreedTotalCents - paid };
}
