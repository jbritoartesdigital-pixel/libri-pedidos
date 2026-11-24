// Complementary charges deliberately live outside v2_payments. Count each
// approved, applied supplement once, preserving original order totals.
export async function getV3SupplementFinance(db,range){
 const rows=(await db.prepare(`SELECT a.id,a.status,a.total_cents,a.applied_at,a.decided_at,a.payment_method,a.offer_json,o.order_code,c.name AS customer_name,s.family,
 (SELECT MIN(p.paid_at) FROM v3_supplement_payments p WHERE p.supplement_id=a.id AND p.status='approved') AS paid_at
 FROM v3_service_supplements a JOIN v3_order_services s ON s.id=a.service_id JOIN v2_orders o ON o.id=s.order_id JOIN v2_customers c ON c.id=o.customer_id
 ORDER BY a.id DESC`).all()).results||[];
 const inRange=d=>!!d&&String(d)>=range.start&&String(d)<range.endExclusive;
 const paid=rows.filter(r=>r.status==='paid'&&r.applied_at&&inRange(r.paid_at));
 const pending=rows.filter(r=>['accepted','payment_pending'].includes(r.status));
 const review=rows.filter(r=>r.status==='review');
 const sum=xs=>xs.reduce((n,r)=>n+Number(r.total_cents),0);
 const view=r=>({id:r.id,orderCode:r.order_code,customerName:r.customer_name,family:r.family,kind:JSON.parse(r.offer_json).kind||'extras',status:r.status,amountCents:r.total_cents,paymentMethod:r.payment_method,paidAt:r.paid_at});
 return {paidCount:paid.length,paidCents:sum(paid),pendingCents:sum(pending),pendingPeriodCents:sum(pending.filter(r=>inRange(r.decided_at))),reviewCents:sum(review),movements:paid.map(view),receivables:pending.map(view),review:review.map(view)};
}
export function combineV3FinanceSummary(original,extra){
 // Fees/net of complements are not yet reconciled; never estimate the net.
 return {...original,originalSalesCents:original.salesCents,originalCashInCents:original.cashInCents,
  supplementalSalesCents:extra.paidCents,supplementalSalesCount:extra.paidCount,supplementalPendingCents:extra.pendingCents,supplementalReviewCents:extra.reviewCents,
  salesCents:original.salesCents+extra.paidCents,cashInCents:original.cashInCents+extra.paidCents,
  receivableCents:original.receivableCents+extra.pendingPeriodCents,openReceivableAllCents:original.openReceivableAllCents+extra.pendingCents,
  mercadoPagoFeePendingCount:original.mercadoPagoFeePendingCount+extra.paidCount,
  mercadoPagoFeesComplete:original.mercadoPagoFeesComplete&&!extra.paidCount,
  netCashMovementComplete:original.netCashMovementComplete&&!extra.paidCount&&!extra.reviewCents};
}
