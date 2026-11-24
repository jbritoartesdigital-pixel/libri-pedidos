// V3 payment confirmation uses the verified provider payment and existing
// order status. Service briefings never unlock from a browser success URL.
export function isV3PaymentSnapshot(json){
  try{return JSON.parse(json||'{}')?.schemaVersion===3;}catch{return false;}
}
export async function assertV3ConfirmedPayment(db,payment){
  const row=await db.prepare(`SELECT p.total_cents,p.deposit_cents,p.deposit_percent,p.balance_cents,p.payment_method,
    s.quote_json,(SELECT COUNT(*) FROM v3_order_services WHERE order_id=p.order_id AND origin_supplement_id IS NULL) AS service_count
    FROM v2_order_pricing p JOIN v3_order_checkout_snapshots s ON s.order_id=p.order_id WHERE p.order_id=?`)
    .bind(payment.order_id).first();
  const quote=JSON.parse(row?.quote_json||'{}');
  if(!row||row.service_count<1||row.service_count>3||row.service_count!==quote.items?.length||row.deposit_percent!==100||row.balance_cents!==0||
    row.total_cents!==quote.totalCents||row.deposit_cents!==row.total_cents||payment.amount_cents!==row.total_cents||
    payment.method!==row.payment_method||quote.paymentMethod!==row.payment_method||payment.payment_type==='refund')
    throw new Error('Pagamento combinado divergente do valor integral contratado; revisão necessária.');
}
// Add to the parent's transaction wherever possible. Repeat callbacks must
// preserve in-progress/completed modules; cancelled orders are not reopened.
export function v3PaidServiceUnlockStatement(db,orderId,stamp){
  return db.prepare(`UPDATE v3_order_services SET briefing_status='available',updated_at=?
    WHERE order_id=? AND briefing_status='locked' AND production_status='pending'
      AND EXISTS(SELECT 1 FROM v2_orders o WHERE o.id=v3_order_services.order_id
        AND o.briefing_status IN ('available','in_progress','completed')
        AND o.status NOT IN ('cancelled','configuring','awaiting_payment'))
      AND EXISTS(SELECT 1 FROM v2_payments p JOIN v2_order_pricing pr ON pr.order_id=p.order_id
        WHERE p.order_id=v3_order_services.order_id AND p.status='approved' AND p.provider='mercado_pago'
          AND p.payment_type!='refund' AND p.amount_cents=pr.total_cents AND p.method=pr.payment_method
          AND pr.deposit_percent=100 AND pr.balance_cents=0)`).bind(stamp,orderId);
}
