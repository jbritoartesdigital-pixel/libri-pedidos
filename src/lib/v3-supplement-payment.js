import {contextV3Briefing} from './v3-modular-briefing.js';
import {withV2PaymentLock} from './v2-payment-lock.js';
import {loadV2Settings,v2IntSetting} from './v2-catalog.js';
import {mpFetch,paymentMethodConfig,normalizePaymentStatus,fetchMercadoPagoOrder,cancelMercadoPagoOrder} from './v2-mercadopago.js';
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const nextDay=d=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+1);return x.toISOString().slice(0,10);};
const stamp=()=>new Date().toISOString();
const active=['creating','pending','review','approved','refunded'];
const terminal=['expired','cancelled','rejected'];
async function access(db,token,family,id){
 const ctx=await contextV3Briefing(db,token);
 if(!ctx)return null;
 if(ctx.locked||ctx.order.archived_at||ctx.order.status==='cancelled')fail('Pedido indisponível.',403);
 const s=ctx.services.find(x=>x.family===family);
 if(!s)fail('Serviço não contratado.',404);
 const offer=await db.prepare('SELECT * FROM v3_service_supplements WHERE id=? AND service_id=?').bind(id,s.id).first();
 if(!offer)fail('Proposta não encontrada.',404);
 return {ctx,s,offer};
}
const baseSnapshot=s=>s.effective_snapshot_json||s.commercial_snapshot_json;
const snapshotMatches=(s,o)=>s.production_version===o.base_production_version&&baseSnapshot(s)===o.base_snapshot_json;
const revisionOnly=o=>JSON.parse(o.offer_json).items.every(x=>x.code.endsWith('_revision'));
function ensureEligible(s,o){
 if(!snapshotMatches(s,o))fail('A produção mudou. Solicite uma nova proposta.');
 if(s.production_status!=='ready'&&!(s.production_status==='adjustments'&&revisionOnly(o)))fail('Confirme a agenda e a etapa do serviço antes de cobrar o adicional.');
 if(!s.delivery_end||!s.scheduled_at)fail('O serviço precisa ter uma janela de entrega confirmada.');
}
async function loadAttempt(db,id){return db.prepare('SELECT * FROM v3_supplement_payments WHERE supplement_id=? ORDER BY id DESC LIMIT 1').bind(id).first();}
function view(p){return {status:p.status,checkoutUrl:p.status==='pending'?p.checkout_url:null,expiresAt:p.expires_at,paidAt:p.paid_at};}
function safeUrl(value){
 try{const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password&&/(^|\.)mercadopago\.com(\.br)?$/.test(u.hostname))return u.href;}catch{}
 fail('A cobrança precisa de conferência.',502);
}
async function plan(db,ctx,s,offer){
 // Keep the promised service window; never extend the date silently.
 const now=today(),end=s.delivery_end;
 if(end<=now)fail('A data de entrega precisa de revisão antes de cobrar.');
 const partition=(await db.prepare('SELECT service_family,allocation_type,points_units FROM v2_agenda_allocations WHERE order_id=?').bind(ctx.order.id).all()).results||[];
 if(partition.some(x=>!x.service_family||x.allocation_type!=='confirmed')||ctx.services.some(x=>partition.filter(a=>a.service_family===x.family).reduce((n,a)=>n+a.points_units,0)!==x.points_units))fail('A agenda original precisa estar distribuída por serviço.');
 const settings=await loadV2Settings(db),capacity=v2IntSetting(settings,'default_sellable_points_per_day_units',400);
 let left=offer.points_units,alloc=[];
 for(let d=nextDay(now);d<=end&&left;d=nextDay(d)){
   if([0,6].includes(new Date(d+'T12:00:00Z').getUTCDay()))continue;
   const row=await db.prepare(`SELECT COALESCE((SELECT CASE WHEN blocked=1 THEN 0 ELSE sellable_capacity_units END FROM v2_agenda_days WHERE day=?),?) AS capacity,
   COALESCE((SELECT SUM(points_units) FROM v2_agenda_allocations WHERE day=?),0) AS used,
   COALESCE((SELECT SUM(a.points_units) FROM v2_checkout_hold_allocations a JOIN v2_checkout_holds h ON h.id=a.hold_id WHERE a.day=? AND h.status='active' AND julianday(h.expires_at)>julianday('now')),0) AS held`).bind(d,capacity,d,d).first();
   const units=Math.min(left,Math.max(0,row.capacity-row.used-row.held));
   if(units){alloc.push({day:d,units});left-=units;}
 }
 if(left)fail('Sem capacidade adicional dentro do prazo contratado. Revise a agenda com a cliente antes de cobrar.');
 return {alloc,capacity,settings};
}
export async function previewV3SupplementCapacity(db,token,family,id){
 const x=await access(db,token,family,id);if(!x)return null;
 if(x.offer.status!=='accepted')fail('A proposta precisa ser aceita.');
 ensureEligible(x.s,x.offer);
 const p=await plan(db,x.ctx,x.s,x.offer);
 return {allocation:p.alloc,pointsUnits:x.offer.points_units,deliveryEnd:x.s.delivery_end};
}
export async function startV3SupplementPayment(request,env,token,family,id,{renew=false}={}){
 // Separate release gate: no new real charges until end-to-end verification.
 if(env.LIBRI_V3_SUPPLEMENT_PAYMENT_ENABLED!=='true')fail('Cobrança complementar ainda indisponível.',503);
 const db=env.DB,x=await access(db,token,family,id);if(!x)return null;
 return withV2PaymentLock(db,x.ctx.order.id,async()=>{
  const {ctx,s,offer}=await access(db,token,family,id);
  let p=await loadAttempt(db,id);
  if(p&&p.status==='approved')return view(p);
  if(p&&p.status==='pending'&&Date.parse(p.expires_at)>Date.now())return view(p);
  if(p&&p.status!=='creating'&&active.includes(p.status))fail('A cobrança complementar anterior precisa ser conciliada.');
  if(p&&terminal.includes(p.status)&&!renew)fail('Confirme a renovação da cobrança anterior.');
  if(!['accepted','payment_pending'].includes(offer.status))fail('A proposta não está disponível para pagamento.');
  ensureEligible(s,offer);
  if(!p||terminal.includes(p.status)){
   const a=await plan(db,ctx,s,offer);
   const key=crypto.randomUUID(),hold='supplement_'+key,reference='SUP-'+key,at=stamp(),until=new Date(Date.now()+Math.min(180,Math.max(5,v2IntSetting(a.settings,'mercado_pago_order_expiry_minutes',25)))*60000).toISOString();
   const amount=(offer.total_cents/100).toFixed(2),area=new URL(request.url).origin+'/meu-pedido/'+encodeURIComponent(token);
   const body={type:'online',processing_mode:'manual',total_amount:amount,external_reference:reference,items:[{title:'Adicionais '+ctx.order.order_code,quantity:1,unit_price:amount}],config:{online:{success_url:area+'?supplement=success',pending_url:area+'?supplement=pending',failure_url:area+'?supplement=failure',auto_return:'approved'},payment_method:paymentMethodConfig(offer.payment_method,a.settings)}};
   const statements=[
    db.prepare("INSERT INTO v2_checkout_holds(token,order_id,status,expires_at,created_at,updated_at) VALUES(?,NULL,'active','9999-12-31T23:59:59.000Z',?,?)").bind(hold,at,at),
    db.prepare("INSERT INTO v3_supplement_payments(supplement_id,attempt_key,hold_id,external_reference,request_json,expires_at,created_at,updated_at) VALUES(?,?,(SELECT id FROM v2_checkout_holds WHERE token=?),?,?,?,?,?)").bind(id,key,hold,reference,JSON.stringify(body),until,at,at)
   ];
   for(const r of a.alloc){
    statements.push(db.prepare('INSERT OR IGNORE INTO v2_agenda_days(day,sellable_capacity_units) VALUES(?,?)').bind(r.day,a.capacity));
    statements.push(db.prepare('INSERT INTO v2_checkout_hold_allocations(hold_id,day,points_units,created_at) VALUES((SELECT id FROM v2_checkout_holds WHERE token=?),?,?,?)').bind(hold,r.day,r.units,at));
   }
   statements.push(db.prepare("UPDATE v3_service_supplements SET status='payment_pending',updated_at=? WHERE id=?").bind(at,id));
   try{await db.batch(statements);}catch(e){if(String(e.message).includes('v3_supplement_capacity_changed'))fail('A capacidade mudou. Confira novamente.');throw e;}
   p=await loadAttempt(db,id);
  }
  // Identical provider request and idempotency key after a transport failure.
  // Never retry an unknown creation after its intended expiry automatically.
  if(Date.parse(p.expires_at)<=Date.now())fail('A tentativa anterior precisa de conferência antes de criar outra cobrança.');
  let remote;
  try{remote=await mpFetch(env,'/v1/orders',{method:'POST',body:JSON.parse(p.request_json),idempotencyKey:p.attempt_key,cardCheckout:offer.payment_method==='card'});}catch{fail('Não foi possível confirmar a criação da cobrança. Retome esta mesma tentativa.',502);}
  if(!remote?.id||remote.external_reference!==p.external_reference||Math.round(Number(remote.total_amount)*100)!==offer.total_cents)fail('Resposta da cobrança divergente. Confira com a Libri.',502);
  const url=safeUrl(remote.checkout_url);
  await db.prepare("UPDATE v3_supplement_payments SET provider_order_id=?,checkout_url=?,status='pending',updated_at=? WHERE id=?").bind(String(remote.id),url,stamp(),p.id).run();
  return view({...p,status:'pending',checkout_url:url});
 });
}
function effectiveScope(s,offer){
 const snapshot=JSON.parse(baseSnapshot(s)),q=JSON.parse(offer.offer_json);
 if(s.family==='convite')snapshot.addons=[...(snapshot.addons||[]),...q.items];
 else{
  const extras=[...(snapshot.v3Extras||[])];
  for(const item of q.items){
   const i=extras.findIndex(x=>x.code===item.code);
   if(i<0)extras.push(item);
   else extras[i]={...extras[i],quantity:extras[i].quantity+item.quantity,totalCents:extras[i].totalCents+item.totalCents,totalPointsUnits:extras[i].totalPointsUnits+item.totalPointsUnits};
  }
  snapshot.v3Extras=extras;
 }
 snapshot.pointsUnits=s.points_units+offer.points_units;
 return snapshot;
}
export async function syncV3SupplementPayment(env,providerOrderId){
 const db=env.DB;
 const initial=await db.prepare(`SELECT p.*,s.order_id,s.family,o.public_token FROM v3_supplement_payments p JOIN v3_service_supplements a ON a.id=p.supplement_id JOIN v3_order_services s ON s.id=a.service_id JOIN v2_orders o ON o.id=s.order_id WHERE p.provider_order_id=?`).bind(providerOrderId).first();
 if(!initial)return {found:false};
 return withV2PaymentLock(db,initial.order_id,async()=>{
  const {ctx,s,offer}=await access(db,initial.public_token,initial.family,initial.supplement_id);
  const p=await db.prepare('SELECT * FROM v3_supplement_payments WHERE id=?').bind(initial.id).first();
  let remote=await fetchMercadoPagoOrder(env,providerOrderId);
  const verify=r=>{if(String(r.id)!==String(providerOrderId)||r.external_reference!==p.external_reference||Math.round(Number(r.total_amount)*100)!==offer.total_cents)fail('Pagamento complementar divergente.');};
  verify(remote);
  let status=normalizePaymentStatus(remote);
  if(status==='pending'&&Date.parse(p.expires_at)<=Date.now()&&!offer.applied_at){
   try{await cancelMercadoPagoOrder(env,providerOrderId);}catch{}
   remote=await fetchMercadoPagoOrder(env,providerOrderId);verify(remote);status=normalizePaymentStatus(remote);
  }
  const at=stamp();
  if(offer.applied_at){
   if(status==='refunded'){
    await db.batch([db.prepare("UPDATE v3_supplement_payments SET status='refunded',updated_at=? WHERE id=?").bind(at,p.id),db.prepare("UPDATE v3_service_supplements SET status='review',updated_at=? WHERE id=?").bind(at,offer.id)]);
    return {found:true,status:'refunded',needsReview:true};
   }
   return {found:true,status:'approved',alreadyApplied:true};
  }
  if(status==='approved'){
   const allocations=(await db.prepare('SELECT day,points_units FROM v2_checkout_hold_allocations WHERE hold_id=? ORDER BY day').bind(p.hold_id).all()).results||[];
   const hold=await db.prepare('SELECT status FROM v2_checkout_holds WHERE id=?').bind(p.hold_id).first();
   const valid=snapshotMatches(s,offer)&&hold?.status==='active'&&allocations.reduce((n,r)=>n+r.points_units,0)===offer.points_units&&allocations.every(r=>r.day>=today()&&r.day<=s.delivery_end)&& (s.production_status==='ready'||s.production_status==='adjustments'&&revisionOnly(offer));
   const review=async()=>{await db.batch([db.prepare("UPDATE v3_supplement_payments SET status='review',paid_at=COALESCE(paid_at,?),updated_at=? WHERE id=?").bind(at,at,p.id),db.prepare("UPDATE v3_service_supplements SET status='review',updated_at=? WHERE id=?").bind(at,offer.id)]);return {found:true,status:'review',needsReview:true};};
   if(!valid)return review();
   const snapshot=effectiveScope(s,offer),reopen=s.production_status==='ready';
   const statements=[
    db.prepare("UPDATE v2_checkout_holds SET status='converted',updated_at=? WHERE id=? AND status='active'").bind(at,p.hold_id),
    ...allocations.map(r=>db.prepare("INSERT INTO v2_agenda_allocations(order_id,day,points_units,allocation_type,service_family) VALUES(?,?,?,'confirmed',?)").bind(ctx.order.id,r.day,r.points_units,s.family)),
    db.prepare(`UPDATE v3_order_services SET effective_snapshot_json=?,points_units=points_units+?,production_version=production_version+1,
      production_status=CASE WHEN ? THEN 'pending' ELSE production_status END,
      briefing_status=CASE WHEN ? THEN 'in_progress' ELSE briefing_status END,
      reviewed_at=CASE WHEN ? THEN NULL ELSE reviewed_at END,scheduled_at=CASE WHEN ? THEN NULL ELSE scheduled_at END,
      complement_note=CASE WHEN ? THEN 'Adicionais confirmados. Confira e complemente os dados.' ELSE complement_note END,updated_at=? WHERE id=?`).bind(JSON.stringify(snapshot),offer.points_units,Number(reopen),Number(reopen),Number(reopen),Number(reopen),Number(reopen),at,s.id),
    db.prepare("UPDATE v3_supplement_payments SET status='approved',paid_at=COALESCE(paid_at,?),updated_at=? WHERE id=?").bind(at,at,p.id),
    db.prepare("UPDATE v3_service_supplements SET status='paid',applied_at=?,updated_at=? WHERE id=?").bind(at,at,offer.id),
    db.prepare("INSERT INTO v2_order_history(order_id,action_code,description,metadata_json,created_at) VALUES(?,'v3_supplement_paid','Pagamento complementar confirmado e escopo atualizado.',?,?)").bind(ctx.order.id,JSON.stringify({family:s.family,id:offer.id,providerOrderId,totalCents:offer.total_cents}),at)
   ];
   if(reopen){
    statements.push(db.prepare("UPDATE v3_order_briefing_drafts SET revision=revision+1,updated_at=? WHERE order_id=? AND module=?").bind(at,ctx.order.id,s.family));
    if(s.family==='retrospectiva')statements.push(db.prepare('UPDATE v3_retro_material_receipts SET complete_at=NULL WHERE order_id=?').bind(ctx.order.id));
   }
   try{await db.batch(statements);}catch(e){if(String(e.message).includes('v3_capacity_changed'))return review();throw e;}
   return {found:true,status:'approved',applied:true};
  }
  if(terminal.includes(status)){
   // Release only after verified terminal provider status. A stale old
   // callback may not reset a newer attempt or its hold.
   const latest=await loadAttempt(db,offer.id);
   await db.batch([
    db.prepare("UPDATE v3_supplement_payments SET status=?,updated_at=? WHERE id=?").bind(status,at,p.id),
    db.prepare("UPDATE v2_checkout_holds SET status='cancelled',updated_at=? WHERE id=? AND status='active'").bind(at,p.hold_id),
    ...(latest.id===p.id?[db.prepare("UPDATE v3_service_supplements SET status='accepted',updated_at=? WHERE id=? AND status='payment_pending'").bind(at,offer.id)]:[])
   ]);
   return {found:true,status};
  }
  if(status==='refunded'){
   await db.batch([db.prepare("UPDATE v3_supplement_payments SET status='review',updated_at=? WHERE id=?").bind(at,p.id),db.prepare("UPDATE v3_service_supplements SET status='review',updated_at=? WHERE id=?").bind(at,offer.id)]);
   return {found:true,status:'review',needsReview:true};
  }
  return {found:true,status:'pending'};
 });
}
export async function reconcileV3Supplements(env,{limit=10}={}){
 const rows=(await env.DB.prepare("SELECT provider_order_id FROM v3_supplement_payments WHERE provider_order_id IS NOT NULL AND status='pending' ORDER BY updated_at,id LIMIT ?").bind(limit).all()).results||[];
 const result={synced:0,failed:0};
 for(const row of rows){try{await syncV3SupplementPayment(env,row.provider_order_id);result.synced++;}catch{result.failed++;}}
 return result;
}
