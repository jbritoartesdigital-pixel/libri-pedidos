// Complementary charges deliberately live outside v2_payments. Count each
// approved, applied supplement once, preserving original order totals.
export async function getV3SupplementFinance(db,range){
 const rows=(await db.prepare(`SELECT a.id,a.status,a.total_cents,a.applied_at,a.decided_at,a.payment_method,a.offer_json,o.order_code,c.name AS customer_name,s.family,
 (SELECT status FROM v3_paid_cancellations WHERE order_id=o.id) AS cancellation_status
 FROM v3_service_supplements a JOIN v3_order_services s ON s.id=a.service_id JOIN v2_orders o ON o.id=s.order_id JOIN v2_customers c ON c.id=o.customer_id ORDER BY a.id DESC`).all()).results||[];
 const payments=(await db.prepare(`SELECT p.id,p.supplement_id,p.status,p.paid_at,a.total_cents,
 (SELECT cc.status FROM v3_cancellation_charges cc WHERE cc.order_id=s.order_id AND cc.charge_key='supplement:'||p.id) AS refund_status
 FROM v3_supplement_payments p JOIN v3_service_supplements a ON a.id=p.supplement_id JOIN v3_order_services s ON s.id=a.service_id
 WHERE p.paid_at IS NOT NULL AND p.status IN ('approved','review','refunded') ORDER BY p.paid_at,p.id`).all()).results||[];
 const inRange=d=>!!d&&String(d)>=range.start&&String(d)<range.endExclusive;
 const paid=rows.filter(r=>inRange(r.applied_at));
 const cash=payments.filter(p=>inRange(p.paid_at));
 const pending=rows.filter(r=>['accepted','payment_pending'].includes(r.status)&&!r.cancellation_status);
 const review=rows.filter(r=>r.status==='review'&&r.cancellation_status!=='completed');
 const sum=xs=>xs.reduce((n,r)=>n+Number(r.total_cents),0);
 const rowMap=new Map(rows.map(r=>[r.id,r]));
 const view=(r,p=null)=>({id:r.id,chargeId:p?.id||null,orderCode:r.order_code,customerName:r.customer_name,family:JSON.parse(r.offer_json).targetFamily||r.family,kind:JSON.parse(r.offer_json).kind||'extras',status:p?(p.refund_status==='refunded'?'refunded':!r.applied_at||p.status==='review'||p.status==='refunded'?'review':'paid'):r.status,amountCents:r.total_cents,paymentMethod:r.payment_method,paidAt:p?.paid_at||null});
 return {paidCount:paid.length,paidCents:sum(paid),cashCount:cash.length,cashCents:sum(cash),unreconciledRefundCount:payments.filter(p=>p.status==='refunded'&&p.refund_status!=='refunded').length,pendingCents:sum(pending),pendingPeriodCents:sum(pending.filter(r=>inRange(r.decided_at))),reviewCents:sum(review),movements:cash.map(p=>view(rowMap.get(p.supplement_id),p)),receivables:pending.map(r=>view(r)),review:review.map(r=>view(r))};
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
  supplementalSalesCents:extra.paidCents,supplementalSalesCount:extra.paidCount,supplementalCashInCents:extra.cashCents,supplementalPendingCents:extra.pendingCents,supplementalReviewCents:extra.reviewCents,
  salesCents:original.salesCents+extra.paidCents,cashInCents:original.cashInCents+extra.cashCents,
  v3RefundsCents:refunds.refundCents,refundsCents:original.refundsCents+refunds.refundCents,
  netCashMovementCents:original.netCashMovementCents-refunds.refundCents,
  receivableCents:original.receivableCents+extra.pendingPeriodCents,openReceivableAllCents:original.openReceivableAllCents+extra.pendingCents,
  mercadoPagoFeePendingCount:original.mercadoPagoFeePendingCount+extra.cashCount,
  mercadoPagoFeesComplete:original.mercadoPagoFeesComplete&&!extra.cashCount&&!extra.unreconciledRefundCount&&!refunds.mercadoPagoRefundCount,
  netCashMovementComplete:original.netCashMovementComplete&&!extra.cashCount&&!extra.unreconciledRefundCount&&!extra.reviewCents&&!refunds.mercadoPagoRefundCount&&!refunds.unknownDateCount&&!refunds.reviewCents};
}
