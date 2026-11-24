import {withV2PaymentLock} from './v2-payment-lock.js';
import {cancelMercadoPagoOrder,syncMercadoPagoOrder} from './v2-mercadopago.js';
import {nowIso} from './http.js';
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const terminal=new Set(['expired','cancelled','rejected']);
export function validV3PaymentPlan(row){
 const total=Number(row.total_cents),percent=Number(row.deposit_percent),deposit=Number(row.deposit_cents);
 return Number.isSafeInteger(total)&&total>0&&((percent===100&&deposit===total&&row.balance_cents===0)||
 (percent===50&&row.payment_method==='pix'&&row.authorized_percent===50&&deposit===Math.ceil(total/2)&&row.balance_cents===total-deposit));
}
export async function originalV3FinancialState(db,orderId){
 const row=await db.prepare(`SELECT p.*,a.deposit_percent AS authorized_percent,o.status,o.briefing_status,o.archived_at
 FROM v2_order_pricing p JOIN v2_orders o ON o.id=p.order_id JOIN v3_order_checkout_snapshots s ON s.order_id=o.id
 LEFT JOIN v3_admin_payment_policies a ON a.order_id=o.id WHERE o.id=?`).bind(orderId).first();
 if(!row)return null;
 const payments=(await db.prepare('SELECT id,provider,payment_type,status,amount_cents,method,paid_at,provider_order_id FROM v2_payments WHERE order_id=? ORDER BY id').bind(orderId).all()).results||[];
 const approved=payments.filter(p=>p.status==='approved'&&p.payment_type!=='refund');
 const refunds=payments.filter(p=>p.status==='approved'&&p.payment_type==='refund');
 const initial=approved.filter(p=>p.provider==='mercado_pago'&&p.amount_cents===row.deposit_cents&&p.method===row.payment_method&&p.payment_type!=='balance');
 const remaining=approved.filter(p=>p.provider==='direct_pix'&&p.payment_type==='balance'&&p.method==='pix');
 const paidCents=approved.reduce((n,p)=>n+p.amount_cents,0)-refunds.reduce((n,p)=>n+p.amount_cents,0);
 const valid=validV3PaymentPlan(row)&&!refunds.length&&!payments.some(p=>['refunded','pending'].includes(p.status))&&initial.length===1&&initial.length+remaining.length===approved.length&&paidCents<=row.total_cents&&(row.deposit_percent===50||!remaining.length);
 return {row,payments,valid,depositConfirmed:valid,paidCents:Math.max(0,paidCents),remainingCents:Math.max(0,row.total_cents-paidCents),fullyPaid:valid&&paidCents===row.total_cents};
}
async function lookup(db,code){
 const row=await db.prepare("SELECT o.id,o.public_token,o.status,o.archived_at,o.briefing_status,p.* FROM v2_orders o JOIN v3_order_checkout_snapshots s ON s.order_id=o.id JOIN v2_order_pricing p ON p.order_id=o.id WHERE o.order_code=?").bind(code).first();
 if(!row)fail('Pedido V3 não encontrado.',404);
 return row;
}
// Verify every known remote attempt, even locally terminal ones. Unknown
// holds never become proof that a charge was not created.
export async function endUnpaidAttempts(env,row){
 const db=env.DB,id=row.id;
 const payments=(await db.prepare("SELECT provider,provider_order_id,status FROM v2_payments WHERE order_id=? ORDER BY id").bind(id).all()).results||[];
 const holds=(await db.prepare('SELECT id,status FROM v2_checkout_holds WHERE order_id=?').bind(id).all()).results||[];
 if(holds.length!==payments.length||payments.some(p=>p.provider!=='mercado_pago'||!p.provider_order_id||p.status==='approved'||p.status==='refunded'))fail('Existe uma tentativa incerta ou pagamento registrado. Concilie antes de alterar.');
 for(const p of payments){
  let state=await syncMercadoPagoOrder(env,p.provider_order_id,{lock:false});
  if(state.paymentStatus==='pending'){await cancelMercadoPagoOrder(env,p.provider_order_id);state=await syncMercadoPagoOrder(env,p.provider_order_id,{lock:false});}
  if(!state.found||!terminal.has(state.paymentStatus))fail('A cobrança anterior não está comprovadamente encerrada. Nenhuma nova cobrança será gerada.');
 }
 if(await db.prepare("SELECT 1 FROM v2_payments WHERE order_id=? AND status NOT IN ('expired','cancelled','rejected')").bind(id).first())fail('Há pagamento ativo ou recebido.');
 return payments.length;
}
export async function changeV3AdminDeposit(env,code,input={}){
 const {depositPercent,confirmed,reason}=input;
 if(confirmed!==true||![50,100].includes(depositPercent)||typeof reason!=='string'||reason.trim().length<5||reason.length>500)fail('Confirme a condição excepcional e informe o motivo.',422);
 const initial=await lookup(env.DB,code);
 return withV2PaymentLock(env.DB,initial.id,async()=>{
  const db=env.DB,row=await lookup(db,code);
  if(row.payment_method!=='pix'||row.archived_at||row.briefing_status!=='locked'||!['configuring','awaiting_payment'].includes(row.status))fail('Somente pedidos Pix ainda não pagos podem mudar a entrada.');
  if(await db.prepare("SELECT 1 FROM v3_order_revisions WHERE order_id=? AND status='offered'").bind(row.id).first())fail('Aguarde o aceite da proposta revisada antes de mudar a entrada.');
  const count=await endUnpaidAttempts(env,row);
  const at=nowIso(),deposit=depositPercent===50?Math.ceil(row.total_cents/2):row.total_cents;
  await db.batch([
   db.prepare("INSERT INTO v3_admin_payment_policies(order_id,deposit_percent,reason,updated_at) VALUES(?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET deposit_percent=excluded.deposit_percent,reason=excluded.reason,updated_at=excluded.updated_at").bind(row.id,depositPercent,reason.trim(),at),
   db.prepare('UPDATE v2_order_pricing SET deposit_percent=?,deposit_cents=?,balance_cents=?,updated_at=? WHERE order_id=?').bind(depositPercent,deposit,row.total_cents-deposit,at,row.id),
   db.prepare("UPDATE v2_checkout_holds SET status='cancelled',updated_at=? WHERE order_id=? AND status='active'").bind(at,row.id),
   db.prepare("INSERT INTO v2_order_history(order_id,action_code,description,metadata_json,created_at) VALUES(?,'v3_admin_deposit','Condição de entrada autorizada pela administradora.',?,?)").bind(row.id,JSON.stringify({depositPercent,depositCents:deposit,reason:reason.trim(),closedAttempts:count}),at)
  ]);
  return {orderCode:code,depositPercent,depositCents:deposit,balanceCents:row.total_cents-deposit};
 });
}
export async function recordV3AdminBalance(env,code,input={}){
 const {confirmed,requestKey,amountCents,paidDate,note}=input;
 if(confirmed!==true||! /^[a-f0-9]{36}$/.test(requestKey||'')||!Number.isSafeInteger(amountCents)||amountCents<1||! /^\d{4}-\d{2}-\d{2}$/.test(paidDate||'')||typeof note!=='string'||note.trim().length<5||note.length>500)fail('Confirme o Pix efetivamente recebido, a data e a referência.',422);
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const date=new Date(paidDate+'T12:00:00Z');
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==paidDate||paidDate>today)fail('Data do recebimento inválida.',422);
 const initial=await lookup(env.DB,code);
 return withV2PaymentLock(env.DB,initial.id,async()=>{
  const db=env.DB,row=await lookup(db,code),state=await originalV3FinancialState(db,row.id),at=nowIso(),paidAt=paidDate+'T12:00:00.000Z';
  if(await db.prepare('SELECT 1 FROM v3_paid_cancellations WHERE order_id=?').bind(row.id).first())fail('Pedido em cancelamento.');
  const prior=await db.prepare('SELECT * FROM v3_admin_pix_receipts WHERE request_key=?').bind(requestKey).first();
  if(prior){if(prior.order_id!==row.id||prior.amount_cents!==amountCents||prior.paid_at!==paidAt||prior.note!==note.trim())fail('Identificador de recebimento já utilizado.');return {alreadyRecorded:true,paymentId:prior.payment_id,remainingCents:state.remainingCents};}
  if(!state.valid||row.deposit_percent!==50||row.archived_at||row.status==='cancelled'||row.payment_method!=='pix'||amountCents!==state.remainingCents)fail('Registre somente o saldo integral aberto, após a entrada confirmada.');
  await db.batch([
   db.prepare("INSERT INTO v2_payments(order_id,provider,payment_type,method,status,amount_cents,fee_cents,net_cents,provider_payload_json,paid_at,created_at,updated_at) VALUES(?,'direct_pix','balance','pix','approved',?,0,?,?,?,?,?)").bind(row.id,amountCents,amountCents,JSON.stringify({source:'v3_admin_balance',requestKey,note:note.trim()}),paidAt,at,at),
   db.prepare("INSERT INTO v3_admin_pix_receipts(request_key,order_id,payment_id,amount_cents,paid_at,note) VALUES(?,?,(SELECT id FROM v2_payments WHERE order_id=? AND json_extract(provider_payload_json,'$.requestKey')=?),?,?,?)").bind(requestKey,row.id,row.id,requestKey,amountCents,paidAt,note.trim()),
   db.prepare("INSERT INTO v2_order_history(order_id,action_code,description,metadata_json,created_at) VALUES(?,'v3_balance_received','Saldo Pix recebido e registrado pela administradora.',?,?)").bind(row.id,JSON.stringify({amountCents,paidAt,note:note.trim(),requestKey}),at)
  ]);
  return {remainingCents:0,receivedCents:amountCents};
 });
}
export async function cancelV3UnpaidOrder(env,code,input={}){
 if(input.confirmed!==true||typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>500)fail('Confirme o cancelamento e informe o motivo.',422);
 const initial=await lookup(env.DB,code);
 return withV2PaymentLock(env.DB,initial.id,async()=>{
  const db=env.DB,row=await lookup(db,code);
  if(row.status==='cancelled')return {alreadyCancelled:true};
  if(row.briefing_status!=='locked'||!['configuring','awaiting_payment'].includes(row.status)||row.archived_at)fail('Pedido recebido ou em produção exige revisão de cancelamento e reembolso.');
  await endUnpaidAttempts(env,row);
  const at=nowIso();
  await db.batch([
   db.prepare("UPDATE v2_orders SET status='cancelled',next_action='Pedido cancelado',updated_at=? WHERE id=?").bind(at,row.id),
   db.prepare("UPDATE v3_order_revisions SET status='cancelled' WHERE order_id=? AND status='offered'").bind(row.id),
   db.prepare("UPDATE v3_order_services SET production_status='cancelled',updated_at=? WHERE order_id=?").bind(at,row.id),
   db.prepare("UPDATE v2_checkout_holds SET status='cancelled',updated_at=? WHERE order_id=? AND status='active'").bind(at,row.id),
   db.prepare("UPDATE v2_black_libri_claims SET status='expired',updated_at=? WHERE order_id=? AND status='attached' AND client_request_id LIKE 'v3:%'").bind(at,row.id),
   db.prepare("DELETE FROM v3_coupon_reservations WHERE order_id=? AND NOT EXISTS(SELECT 1 FROM v2_coupon_uses u WHERE u.order_id=?)").bind(row.id,row.id),
   db.prepare("INSERT INTO v2_order_history(order_id,action_code,description,metadata_json,created_at) VALUES(?,'v3_unpaid_cancelled','Pedido sem pagamento cancelado após conciliação.',?,?)").bind(row.id,JSON.stringify({reason:input.reason.trim()}),at)
  ]);
  return {cancelled:true};
 });
}
