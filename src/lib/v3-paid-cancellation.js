import {withV2PaymentLock} from './v2-payment-lock.js';
import {fetchMercadoPagoOrder,cancelMercadoPagoOrder,normalizePaymentStatus,mpFetch} from './v2-mercadopago.js';
import {nowIso} from './http.js';
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const terminal=['expired','cancelled','rejected'];
async function order(db,code){
 const o=await db.prepare('SELECT o.* FROM v2_orders o JOIN v3_order_checkout_snapshots s ON s.order_id=o.id WHERE o.order_code=?').bind(code).first();
 if(!o)fail('Pedido V3 não encontrado.',404);return o;
}
export async function getV3Cancellation(db,id,{admin=false}={}){
 const c=await db.prepare('SELECT * FROM v3_paid_cancellations WHERE order_id=?').bind(id).first();
 if(!c)return null;
 const charges=(await db.prepare('SELECT * FROM v3_cancellation_charges WHERE order_id=? ORDER BY charge_key').bind(id).all()).results||[];
 const refundCents=charges.filter(x=>x.status==='refunded').reduce((n,x)=>n+x.amount_cents,0);
 return {status:c.status,createdAt:c.created_at,completedAt:c.completed_at,refundCents,...(admin?{reason:c.reason,charges:charges.map(x=>({key:x.charge_key,provider:x.provider,amountCents:x.amount_cents,status:x.status,providerOrderId:x.provider_order_id,refundedAt:x.refund_confirmed_at}))}:{})};
}
async function inventory(db,o){
 const originals=(await db.prepare('SELECT * FROM v2_payments WHERE order_id=? ORDER BY id').bind(o.id).all()).results||[];
 const supplements=(await db.prepare(`SELECT p.*,a.total_cents FROM v3_supplement_payments p JOIN v3_service_supplements a ON a.id=p.supplement_id JOIN v3_order_services s ON s.id=a.service_id WHERE s.order_id=? ORDER BY p.id`).bind(o.id).all()).results||[];
 const holds=(await db.prepare('SELECT COUNT(*) AS n FROM v2_checkout_holds WHERE order_id=?').bind(o.id).first()).n;
 if(holds!==originals.filter(p=>p.provider==='mercado_pago'&&p.payment_type!=='refund').length)fail('Há uma tentativa original sem identificação. Concilie antes de concluir.');
 if(originals.some(p=>p.payment_type==='refund'||!['mercado_pago','direct_pix'].includes(p.provider)))fail('Histórico com devolução prévia precisa de conferência individual.');
 return [...originals.map(p=>({key:'original:'+p.id,provider:p.provider,providerId:p.provider_order_id,reference:o.order_code,amount:p.amount_cents,paidAt:p.paid_at,status:p.status})),...supplements.map(p=>({key:'supplement:'+p.id,provider:'mercado_pago',providerId:p.provider_order_id,reference:p.external_reference,amount:p.total_cents,paidAt:p.paid_at,status:p.status}))];
}
export async function openV3PaidCancellation(env,code,input={}){
 if(input.confirmed!==true||typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>500)fail('Confirme a suspensão do pedido e informe o motivo.',422);
 const db=env.DB,o=await order(db,code);
 return withV2PaymentLock(db,o.id,async()=>{
  const current=await order(db,code),prior=await getV3Cancellation(db,o.id,{admin:true});
  if(prior)return prior;
  if(current.archived_at||current.status==='cancelled')fail('Pedido indisponível.');
  const charges=await inventory(db,current);
  if(!charges.some(p=>p.paidAt||['approved','refunded'].includes(p.status)))fail('Utilize o cancelamento de pedidos sem pagamento.');
  const at=nowIso();
  await db.batch([
   db.prepare("INSERT INTO v3_paid_cancellations(order_id,status,reason,created_at) VALUES(?,'review',?,?)").bind(o.id,input.reason.trim(),at),
   ...charges.map(p=>db.prepare("INSERT INTO v3_cancellation_charges(order_id,charge_key,provider,provider_order_id,reference,amount_cents,original_paid_at,status,refund_key,updated_at) VALUES(?,?,?,?,?,?,?,'review',?,?)").bind(o.id,p.key,p.provider,p.providerId||null,p.reference,p.amount,p.paidAt||null,crypto.randomUUID(),at)),
   db.prepare("UPDATE v2_orders SET next_action='Cancelamento em conferência',updated_at=? WHERE id=?").bind(at,o.id),
   db.prepare("INSERT INTO v2_order_history(order_id,action_code,description,metadata_json,created_at) VALUES(?,'v3_paid_cancel_review','Produção suspensa para conferência de cancelamento.',?,?)").bind(o.id,JSON.stringify({reason:input.reason.trim()}),at)
  ]);
  return getV3Cancellation(db,o.id,{admin:true});
 });
}
function verifiedStatus(remote,c){
 if(String(remote?.id)!==String(c.provider_order_id)||remote.external_reference!==c.reference||Math.round(Number(remote.total_amount)*100)!==c.amount_cents)fail('Cobrança divergente; confira no Mercado Pago.');
 if(remote.status==='refunded'&&remote.status_detail==='refunded')return 'refunded';
 if(remote.status==='charged_back'||String(remote.status_detail).includes('refund'))return 'review';
 const s=normalizePaymentStatus(remote);
 if(s==='approved')return 'paid';
 if(terminal.includes(s))return c.original_paid_at?'review':'terminal';
 return 'pending';
}
async function inspect(env,c,{cancelPending=false}={}){
 if(c.status==='refunded'&&c.provider==='direct_pix')return {status:'refunded',evidence:JSON.parse(c.evidence_json||'{}')};
 if(c.provider==='direct_pix')return {status:c.original_paid_at?'paid':'review'};
 if(!c.provider_order_id)return {status:'review'};
 let remote=await fetchMercadoPagoOrder(env,c.provider_order_id),status=verifiedStatus(remote,c);
 if(status==='pending'&&cancelPending){
   try{await cancelMercadoPagoOrder(env,c.provider_order_id);}catch{}
   remote=await fetchMercadoPagoOrder(env,c.provider_order_id);status=verifiedStatus(remote,c);
 }
 // Never discard an uncertain refund just because a provider read is delayed.
 if(c.status==='refund_requested'&&status!=='refunded')status='refund_requested';
 return {status,evidence:{providerOrderId:c.provider_order_id,status:remote.status,statusDetail:remote.status_detail}};
}
async function record(db,c,result){
 const at=nowIso();
 await db.batch([
 db.prepare("UPDATE v3_cancellation_charges SET status=?,refund_confirmed_at=CASE WHEN ?='refunded' THEN COALESCE(refund_confirmed_at,?) ELSE refund_confirmed_at END,evidence_json=COALESCE(?,evidence_json),updated_at=? WHERE order_id=? AND charge_key=?").bind(result.status,result.status,at,result.evidence?JSON.stringify(result.evidence):null,at,c.order_id,c.charge_key),
 ...(result.status==='refunded'&&c.status!=='refunded'?[db.prepare("INSERT INTO v2_order_history(order_id,action_code,description,metadata_json,created_at) VALUES(?,'v3_refund_confirmed','Devolução integral confirmada.',?,?)").bind(c.order_id,JSON.stringify({chargeKey:c.charge_key,amountCents:c.amount_cents,provider:c.provider}),at)]:[])
 ]);
}
export async function refreshV3Cancellation(env,code){
 const db=env.DB,o=await order(db,code);
 return withV2PaymentLock(db,o.id,async()=>{
  const c=await getV3Cancellation(db,o.id);if(!c||c.status!=='review')fail('Cancelamento não está em conferência.');
  const rows=(await db.prepare('SELECT * FROM v3_cancellation_charges WHERE order_id=?').bind(o.id).all()).results||[];
  for(const row of rows){if(row.status==='refunded')continue;await record(db,row,await inspect(env,row,{cancelPending:true}));}
  return getV3Cancellation(db,o.id,{admin:true});
 });
}
export async function refundV3CancellationCharge(env,code,input={}){
 const db=env.DB,o=await order(db,code);
 if(input.confirmed!==true||typeof input.chargeKey!=='string'||!Number.isSafeInteger(input.amountCents))fail('Confirme a cobrança e o valor da devolução.',422);
 return withV2PaymentLock(db,o.id,async()=>{
  const review=await getV3Cancellation(db,o.id);
  if(!review||review.status!=='review')fail('Cancelamento não está em conferência.');
  let c=await db.prepare('SELECT * FROM v3_cancellation_charges WHERE order_id=? AND charge_key=?').bind(o.id,input.chargeKey).first();
  if(!c||c.amount_cents!==input.amountCents)fail('Confira o valor integral desta cobrança.',422);
  if(c.status==='refunded')return getV3Cancellation(db,o.id,{admin:true});
  const result=await inspect(env,c);
  if(result.status==='refunded'){await record(db,c,result);return getV3Cancellation(db,o.id,{admin:true});}
  if(c.provider==='direct_pix'){
   if(result.status!=='paid'||typeof input.proof!=='string'||input.proof.trim().length<8||input.proof.length>500)fail('Registre a devolução Pix já realizada e a referência do comprovante.',422);
   await record(db,c,{status:'refunded',evidence:{source:'admin_confirmed_pix_refund',proof:input.proof.trim()}});
  }else{
   if(!['paid','refund_requested'].includes(result.status))fail('A cobrança não está elegível para devolução integral.');
   // Persist the stable key before the provider call. Retrying does not
   // create a different refund. Full refund intentionally omits amount.
   await db.prepare("UPDATE v3_cancellation_charges SET status='refund_requested',updated_at=? WHERE order_id=? AND charge_key=?").bind(nowIso(),o.id,c.charge_key).run();
   try{await mpFetch(env,'/v1/orders/'+encodeURIComponent(c.provider_order_id)+'/refund',{method:'POST',body:{},idempotencyKey:c.refund_key});}catch{}
   c={...c,status:'refund_requested'};
   await record(db,c,await inspect(env,c));
  }
  return getV3Cancellation(db,o.id,{admin:true});
 });
}
export async function finalizeV3PaidCancellation(env,code,input={}){
 if(input.confirmed!==true)fail('Confirme o encerramento definitivo do pedido.',422);
 const db=env.DB,o=await order(db,code);
 return withV2PaymentLock(db,o.id,async()=>{
  const cancellation=await getV3Cancellation(db,o.id);
  if(!cancellation)fail('Cancelamento não encontrado.');
  if(cancellation.status==='completed')return getV3Cancellation(db,o.id,{admin:true});
  const charges=await inventory(db,o),rows=(await db.prepare('SELECT * FROM v3_cancellation_charges WHERE order_id=?').bind(o.id).all()).results||[];
  if(charges.length!==rows.length||charges.some(p=>!rows.some(r=>r.charge_key===p.key&&r.amount_cents===p.amount&&r.provider_order_id===(p.providerId||null))))fail('O histórico financeiro mudou. Confira antes de encerrar.');
  for(const row of rows){
   const result=await inspect(env,row,{cancelPending:false});await record(db,row,result);
   if(!['terminal','refunded'].includes(result.status))fail('Ainda existem cobranças sem devolução integral ou encerramento comprovado.');
  }
  const at=nowIso();
  const updates=rows.map(r=>{const [type,id]=r.charge_key.split(':');const table=type==='original'?'v2_payments':'v3_supplement_payments';return db.prepare(`UPDATE ${table} SET status=(SELECT CASE WHEN status='refunded' THEN 'refunded' ELSE 'cancelled' END FROM v3_cancellation_charges WHERE order_id=? AND charge_key=?),updated_at=? WHERE id=?`).bind(o.id,r.charge_key,at,Number(id));});
  await db.batch([
   ...updates,
   db.prepare("UPDATE v2_orders SET status='cancelled',next_action='Cancelamento e devoluções conferidos',updated_at=? WHERE id=?").bind(at,o.id),
   db.prepare("UPDATE v3_order_services SET production_status=CASE WHEN production_status='delivered' THEN 'delivered' ELSE 'cancelled' END,production_version=production_version+1,updated_at=? WHERE order_id=?").bind(at,o.id),
   db.prepare("UPDATE v3_service_supplements SET status='cancelled',updated_at=? WHERE service_id IN (SELECT id FROM v3_order_services WHERE order_id=?) AND status IN ('offered','accepted','payment_pending','review') AND applied_at IS NULL").bind(at,o.id),
   db.prepare("UPDATE v3_service_supplements SET status='review',updated_at=? WHERE service_id IN (SELECT id FROM v3_order_services WHERE order_id=?) AND applied_at IS NOT NULL").bind(at,o.id),
   db.prepare("UPDATE v2_checkout_holds SET status='cancelled',updated_at=? WHERE status='active' AND (order_id=? OR id IN (SELECT p.hold_id FROM v3_supplement_payments p JOIN v3_service_supplements a ON a.id=p.supplement_id JOIN v3_order_services s ON s.id=a.service_id WHERE s.order_id=?))").bind(at,o.id,o.id),
   db.prepare("DELETE FROM v2_agenda_allocations WHERE order_id=? AND day>date('now','-3 hours')").bind(o.id),
   db.prepare("UPDATE v3_paid_cancellations SET status='completed',completed_at=? WHERE order_id=?").bind(at,o.id),
   db.prepare("INSERT INTO v2_order_history(order_id,action_code,description,created_at) VALUES(?,'v3_paid_cancelled','Cancelamento concluído após conciliação integral; agenda futura liberada.',?)").bind(o.id,at)
  ]);
  // Redeemed gifts/coupons remain consumed: no automatic new participation.
  return getV3Cancellation(db,o.id,{admin:true});
 });
}
