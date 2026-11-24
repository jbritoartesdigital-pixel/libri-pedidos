// Shared stock accounting for V2/V3 Mercado Pago checkouts.
export async function couponUsageCount(db,couponId,customerId=null){
 const where=customerId==null?'':' AND customer_id=?';
 const args=customerId==null?[couponId,couponId]:[couponId,customerId,couponId,customerId];
 const row=await db.prepare(`SELECT (SELECT COUNT(*) FROM v2_coupon_uses WHERE coupon_id=?${where})+
 (SELECT COUNT(*) FROM v3_coupon_reservations r WHERE coupon_id=?${where}
 AND NOT EXISTS(SELECT 1 FROM v2_coupon_uses u WHERE u.coupon_id=r.coupon_id AND u.order_id=r.order_id)) AS total`).bind(...args).first();
 return Number(row?.total||0);
}
const fail=(message)=>{throw Object.assign(new Error(message),{status:409,code:'coupon_reservation_limit'});};
export async function reserveCheckoutCoupon(db,orderId,holdToken){
 const order=await db.prepare('SELECT o.customer_id,p.coupon_discount_cents,p.pricing_snapshot_json FROM v2_orders o JOIN v2_order_pricing p ON p.order_id=o.id WHERE o.id=?').bind(orderId).first();
 if(!order)return false;
 let snapshot;try{snapshot=JSON.parse(order.pricing_snapshot_json||'{}');}catch{return false;}
 const coupon=snapshot?.coupon;
 const existing=await db.prepare('SELECT * FROM v3_coupon_reservations WHERE order_id=?').bind(orderId).first();
 if(!coupon?.id||!order.coupon_discount_cents){
   if(existing)fail('O cupom anterior precisa ser conciliado antes de mudar o pedido.');
   return false;
 }
 if(existing&&(existing.coupon_id!==coupon.id||existing.customer_id!==order.customer_id))fail('O cupom anterior precisa ser conciliado antes de mudar o pedido.');
 const used=await db.prepare('SELECT 1 FROM v2_coupon_uses WHERE order_id=? AND coupon_id=?').bind(orderId,coupon.id).first();
 if(used)return false;
 if(existing){
   if(existing.hold_token===holdToken)return true;
   // A pre-migration reservation or an unknown provider response cannot
   // be discarded merely because a new hold exists.
   if(existing.hold_token&&!existing.provider_order_id)fail('A reserva anterior do cupom precisa de conferência.');
   if(existing.provider_order_id){
     const previous=await db.prepare('SELECT status FROM v2_payments WHERE order_id=? AND provider_order_id=?').bind(orderId,existing.provider_order_id).first();
     if(!['expired','cancelled','rejected'].includes(previous?.status))fail('A cobrança anterior do cupom ainda precisa ser conciliada.');
   }else if(!existing.hold_token){
     const pending=await db.prepare("SELECT 1 FROM v2_payments WHERE order_id=? AND status IN ('pending','approved','refunded')").bind(orderId).first();
     if(pending)fail('A cobrança anterior do cupom ainda precisa ser conciliada.');
   }
   await db.prepare('UPDATE v3_coupon_reservations SET hold_token=?,provider_order_id=NULL WHERE order_id=?').bind(holdToken,orderId).run();
   return true;
 }
 try{
   await db.prepare('INSERT INTO v3_coupon_reservations(order_id,coupon_id,customer_id,hold_token) VALUES(?,?,?,?)').bind(orderId,coupon.id,order.customer_id,holdToken).run();
 }catch(e){if(String(e.message).includes('coupon_reservation_limit'))fail('Este cupom atingiu o limite de usos disponíveis. Confira o carrinho com a Libri.');throw e;}
 return true;
}
export async function bindCheckoutCouponProvider(db,orderId,holdToken,providerOrderId){
 await db.prepare('UPDATE v3_coupon_reservations SET provider_order_id=? WHERE order_id=? AND hold_token=? AND (provider_order_id IS NULL OR provider_order_id=?)').bind(providerOrderId,orderId,holdToken,providerOrderId).run();
}
export async function releaseCheckoutCouponAfterTerminal(db,orderId,providerOrderId){
 // Only called after a verified terminal provider response. Older callbacks
 // and unknown attempts must not release stock for a different charge.
 await db.prepare(`DELETE FROM v3_coupon_reservations WHERE order_id=? AND provider_order_id=?
 AND EXISTS(SELECT 1 FROM v2_payments p WHERE p.order_id=v3_coupon_reservations.order_id AND p.provider_order_id=v3_coupon_reservations.provider_order_id AND p.status IN ('expired','cancelled','rejected'))
 AND NOT EXISTS(SELECT 1 FROM v2_payments p WHERE p.order_id=v3_coupon_reservations.order_id AND p.status NOT IN ('expired','cancelled','rejected'))
 AND NOT EXISTS(SELECT 1 FROM v2_coupon_uses u WHERE u.order_id=v3_coupon_reservations.order_id AND u.coupon_id=v3_coupon_reservations.coupon_id)
 AND NOT EXISTS(SELECT 1 FROM v2_checkout_holds h WHERE h.order_id=v3_coupon_reservations.order_id AND h.token!=v3_coupon_reservations.hold_token AND h.status='active')`).bind(orderId,providerOrderId).run();
}
