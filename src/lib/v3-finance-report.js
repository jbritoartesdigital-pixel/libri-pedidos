// Complementary charges deliberately live outside v2_payments. Count each
// approved, applied supplement once, preserving original order totals.
export async function getV3SupplementFinance(db,range){
 const rows=(await db.prepare(`SELECT a.id,a.status,a.total_cents,a.applied_at,a.decided_at,a.payment_method,a.offer_json,o.order_code,c.name AS customer_name,s.family,
 (SELECT MIN(p.paid_at) FROM v3_supplement_payments p WHERE p.supplement_id=a.id AND (p.status='approved' OR (p.status='refunded' AND EXISTS(SELECT 1 FROM v3_cancellation_charges cc WHERE cc.order_id=o.id AND cc.charge_key='supplement:'||p.id AND cc.status='refunded')))) AS paid_at,
 (SELECT status FROM v3_paid_cancellations WHERE order_id=o.id) AS cancellation_status
 FROM v3_service_supplements a JOIN v3_order_services s ON s.id=a.service_id JOIN v2_orders o ON o.id=s.order_id JOIN v2_customers c ON c.id=o.customer_id
 ORDER BY a.id DESC`).all()).results||[];
 const inRange=d=>!!d&&String(d)>=range.start&&String(d)<range.endExclusive;
 const paid=rows.filter(r=>r.applied_at&&inRange(r.paid_at)&&(r.status==='paid'||r.cancellation_status==='completed'));
 const pending=rows.filter(r=>['accepted','payment_pending'].includes(r.status)&&!r.cancellation_status);
 const review=rows.filter(r=>r.status==='review'&&r.cancellation_status!=='completed');
 const sum=xs=>xs.reduce((n,r)=>n+Number(r.total_cents),0);
 const view=r=>({id:r.id,orderCode:r.order_code,customerName:r.customer_name,family:r.family,kind:JSON.parse(r.offer_json).kind||'extras',status:r.cancellation_status==='completed'&&r.applied_at?'refunded':r.status,amountCents:r.total_cents,paymentMethod:r.payment_method,paidAt:r.paid_at});
 return {paidCount:paid.length,paidCents:sum(paid),pendingCents:sum(pending),pendingPeriodCents:sum(pending.filter(r=>inRange(r.decided_at))),reviewCents:sum(review),movements:paid.map(view),receivables:pending.map(view),review:review.map(view)};
}
// Refunds are separate cash outflows; use the confirmation timestamp, not the
// original payment date. This ledger never writes synthetic V2 refund payments.
export async function getV3RefundFinance(db,range){
 const rows=(await db.prepare(`SELECT cc.charge_key,cc.provider,cc.amount_cents,cc.original_paid_at,cc.status,cc.refund_confirmed_at,o.order_code,c.name AS customer_name
 FROM v3_cancellation_charges cc JOIN v2_orders o ON o.id=cc.order_id JOIN v2_customers c ON c.id=o.customer_id
 ORDER BY cc.refund_confirmed_at DESC,cc.charge_key`).all()).results||[];
 const inRange=d=>!!d&&String(d)>=range.start&&String(d)<range.endExclusive;
 const refunded=rows.filter(r=>r.status==='refunded'&&inRange(r.refund_confirmed_at));
 const unknown=rows.filter(r=>r.status==='refunded'&&(!r.original_paid_at||!r.refund_confirmed_at));
 const review=rows.filter(r=>['review','refund_requested'].includes(r.status));
 const sum=xs=>xs.reduce((n,r)=>n+Number(r.amount_cents),0);
 return {refundCents:sum(refunded),refundCount:refunded.length,mercadoPagoRefundCount:refunded.filter(r=>r.provider==='mercado_pago').length,
  reviewCents:sum(review),unknownDateCount:unknown.length,
  movements:refunded.map(r=>({orderCode:r.order_code,customerName:r.customer_name,provider:r.provider,kind:r.charge_key.startsWith('supplement:')?'supplement':'original',amountCents:r.amount_cents,confirmedAt:r.refund_confirmed_at}))};
}
export function combineV3FinanceSummary(original,extra,refunds={refundCents:0,mercadoPagoRefundCount:0,unknownDateCount:0,reviewCents:0}){
 // Fees/net of complements are not yet reconciled; never estimate the net.
 return {...original,originalSalesCents:original.salesCents,originalCashInCents:original.cashInCents,
  supplementalSalesCents:extra.paidCents,supplementalSalesCount:extra.paidCount,supplementalPendingCents:extra.pendingCents,supplementalReviewCents:extra.reviewCents,
  salesCents:original.salesCents+extra.paidCents,cashInCents:original.cashInCents+extra.paidCents,
  v3RefundsCents:refunds.refundCents,refundsCents:original.refundsCents+refunds.refundCents,
  netCashMovementCents:original.netCashMovementCents-refunds.refundCents,
  receivableCents:original.receivableCents+extra.pendingPeriodCents,openReceivableAllCents:original.openReceivableAllCents+extra.pendingCents,
  mercadoPagoFeePendingCount:original.mercadoPagoFeePendingCount+extra.paidCount,
  mercadoPagoFeesComplete:original.mercadoPagoFeesComplete&&!extra.paidCount&&!refunds.mercadoPagoRefundCount,
  netCashMovementComplete:original.netCashMovementComplete&&!extra.paidCount&&!extra.reviewCents&&!refunds.mercadoPagoRefundCount&&!refunds.unknownDateCount&&!refunds.reviewCents};
}
