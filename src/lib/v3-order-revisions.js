import {listV3Extras} from './v3-extras-catalog.js';
import {quoteV3Cart} from './v3-cart-quote.js';
import {validateV2DeliveryWindow,planV2AllocationForWindow,findV2DeliveryOptions} from './v2-agenda.js';
import {withV2PaymentLock} from './v2-payment-lock.js';
import {endUnpaidAttempts} from './v3-admin-payment-policy.js';
import {v3LineStatements} from './v3-order-records.js';
import {nowIso} from './http.js';
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
async function load(db,code){
 const row=await db.prepare(`SELECT o.*,p.total_cents,p.payment_method,p.deposit_percent,s.quote_json,s.request_key FROM v2_orders o JOIN v3_order_checkout_snapshots s ON s.order_id=o.id JOIN v2_order_pricing p ON p.order_id=o.id WHERE o.order_code=?`).bind(code).first();
 if(!row)fail('Pedido V3 não encontrado.',404);
 return row;
}
async function eligible(db,row){
 if(row.archived_at||row.briefing_status!=='locked'||!['configuring','awaiting_payment'].includes(row.status)||await db.prepare("SELECT 1 FROM v2_payments WHERE order_id=? AND status IN ('approved','refunded')").bind(row.id).first())fail('Pedido recebido ou em produção: utilize propostas complementares.');
}
export async function pendingV3Revision(db,orderId){
 const r=await db.prepare("SELECT * FROM v3_order_revisions WHERE order_id=? AND status='offered'").bind(orderId).first();
 if(!r)return null;
 const q=JSON.parse(r.quote_json),input=JSON.parse(r.input_json);
 return {id:r.id,kind:r.kind,totalCents:q.totalCents,pointsUnits:q.pointsUnits,depositPercent:input.depositPercent||100,depositCents:input.depositPercent===50?Math.ceil(q.totalCents/2):q.totalCents,deliveryWindow:input.deliveryWindow,items:q.items.map(l=>({family:l.family,productName:l.productName,variantName:l.variantName,totalCents:l.totalCents,addons:l.commercialSnapshot.addons.map(a=>a.name),extras:l.extras.map(e=>({name:e.name,quantity:e.quantity}))})),terms:JSON.parse(r.terms_json),blackLibri:q.blackLibri,reason:r.reason};
}
async function termsFor(db,q){
 const general=await db.prepare('SELECT version,body,content_hash FROM v2_terms_versions WHERE active=1 ORDER BY published_at DESC LIMIT 1').first();
 if(!general)fail('Termos indisponíveis.');
 const services=q.items.flatMap(l=>{const specific=l.commercialSnapshot.variant.config?.atelie||l.commercialSnapshot.variant.config?.retrospective;return specific?[{family:l.family,version:specific.termsVersion,body:specific.specificTerms}]:[];});
 if(services.some(s=>!s.version||!s.body))fail('Condições específicas indisponíveis.');
 return {general,services};
}
async function price(db,row,input){
 const old=JSON.parse(row.quote_json);
 if(input.paymentMethod&&input.paymentMethod!==row.payment_method)fail('Mantenha o método original nesta revisão.');
 const claim=await db.prepare("SELECT * FROM v2_black_libri_claims WHERE order_id=? AND status='attached' AND client_request_id=?").bind(row.id,'v3:'+row.request_key).first();
 if(old.blackLibri&&!claim)fail('Surpresa original precisa de conferência.');
 const couponCode=input.couponCode===undefined?(old.couponComparison?.code||old.coupon?.code||''):input.couponCode;
 const q=await quoteV3Cart(db,{items:input.items,eventType:row.event_type,paymentMethod:row.payment_method,couponCode},{includeSnapshots:true,requireSale:true,customerId:row.customer_id,attachedBlackClaim:claim,excludeCouponOrderId:row.id});
 if(claim&&q.blackLibri?.claimId!==claim.id)fail('A surpresa original precisa permanecer neste pedido.');
 const capacity={eventDate:row.event_date,pointsUnits:q.pointsUnits,productionDays:q.productionDays,excludeOrderId:row.id};
 const available=await findV2DeliveryOptions(db,{...capacity,limit:8});
 return {quote:q,terms:await termsFor(db,q),options:available.options.map(x=>({start:x.start,end:x.end})),capacity};
}
export async function previewV3Revision(db,code,input){
 const row=await load(db,code);await eligible(db,row);
 const p=await price(db,row,input);
 return {totalCents:p.quote.totalCents,pointsUnits:p.quote.pointsUnits,items:p.quote.items.map(l=>({name:l.productName,variant:l.variantName,totalCents:l.totalCents})),options:p.options,blackLibri:p.quote.blackLibri};
}
export async function createV3Revision(env,code,input={}){
 if(input.confirmed!==true||! /^[a-f0-9]{36}$/.test(input.requestKey||'')||typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>500)fail('Confirme e descreva a alteração.',422);
 const initial=await load(env.DB,code);
 return withV2PaymentLock(env.DB,initial.id,async()=>{
  const db=env.DB,row=await load(db,code);await eligible(db,row);
  const canonical=JSON.stringify({items:input.items,deliveryWindow:input.deliveryWindow,couponCode:input.couponCode,expectedTotalCents:input.expectedTotalCents,depositPercent:row.deposit_percent});
  const prior=await db.prepare('SELECT * FROM v3_order_revisions WHERE request_key=?').bind(input.requestKey).first();
  if(prior){if(prior.order_id!==row.id||prior.input_json!==canonical)fail('Identificador de revisão já utilizado.');return {id:prior.id,status:prior.status};}
  if(await pendingV3Revision(db,row.id))fail('Já existe uma proposta aguardando aceite.');
  if(await db.prepare('SELECT 1 FROM v2_contracts WHERE order_id=? LIMIT 1').bind(row.id).first())fail('Existe contrato emitido; revise-o antes de alterar o pedido.');
  const p=await price(db,row,input),q=p.quote,w=input.deliveryWindow;
  if(q.totalCents!==input.expectedTotalCents)fail('O valor mudou. Confira novamente.');
  if(!w||!p.options.some(x=>x.start===w.start&&x.end===w.end))fail('Escolha uma janela atual de entrega.');
  await endUnpaidAttempts(env,row);
  await validateV2DeliveryWindow(db,{...p.capacity,...w});
  const plan=await planV2AllocationForWindow(db,{...p.capacity,...w});
  if(!plan.fits)fail('A agenda mudou. Confira outra janela.');
  const at=nowIso(),old=JSON.parse(row.quote_json),pricing={...q,schemaVersion:3,contactSnapshot:old.contactSnapshot||null,comboDiscountCents:q.discountCents-q.couponDiscountCents,payment:{method:q.paymentMethod,depositPercent:row.deposit_percent,depositCents:row.deposit_percent===50?Math.ceil(q.totalCents/2):q.totalCents,balanceCents:row.deposit_percent===50?Math.floor(q.totalCents/2):0}};
  await db.batch([
   db.prepare("INSERT INTO v3_order_revisions(order_id,request_key,kind,input_json,previous_quote_json,quote_json,terms_json,reason,created_at) VALUES(?,?,'edit',?,?,?,?,?,?)").bind(row.id,input.requestKey,canonical,row.quote_json,JSON.stringify(pricing),JSON.stringify(p.terms),input.reason.trim(),at),
   db.prepare("UPDATE v2_checkout_holds SET status='cancelled',updated_at=? WHERE order_id=? AND status='active'").bind(at,row.id),
   db.prepare("UPDATE v2_orders SET next_action='Aguardando aceite da revisão',updated_at=? WHERE id=?").bind(at,row.id),
   db.prepare("INSERT INTO v2_order_history(order_id,action_code,description,metadata_json,created_at) VALUES(?,'v3_revision_offered','Proposta de alteração enviada sem gerar cobrança.',?,?)").bind(row.id,JSON.stringify({reason:input.reason.trim(),oldTotalCents:row.total_cents,newTotalCents:q.totalCents}),at)
  ]);
  return pendingV3Revision(db,row.id);
 });
}
export async function acceptV3Revision(db,token,input={}){
 const initial=await db.prepare('SELECT order_code,id FROM v2_orders WHERE public_token=?').bind(token).first();if(!initial)return null;
 return withV2PaymentLock(db,initial.id,async()=>{
  const row=await load(db,initial.order_code);await eligible(db,row);
  const r=await db.prepare('SELECT * FROM v3_order_revisions WHERE order_id=? AND id=?').bind(row.id,input.id).first();
  if(!r)fail('Proposta não encontrada.',404);
  if(r.status==='accepted')return {accepted:true,alreadyAccepted:true};
  if(r.status!=='offered')fail('Esta proposta não está disponível.');
  const q=JSON.parse(r.quote_json),data=JSON.parse(r.input_json),terms=JSON.parse(r.terms_json);
  if(input.confirmed!==true||input.termsAccepted!==true||input.expectedTotalCents!==q.totalCents)fail('Confira os valores e aceite as condições da proposta.',422);
  if(await db.prepare("SELECT 1 FROM v2_payments WHERE order_id=? AND status NOT IN ('expired','cancelled','rejected')").bind(row.id).first())fail('Existe cobrança a conciliar.');
  const w=data.deliveryWindow,capacity={eventDate:row.event_date,...w,pointsUnits:q.pointsUnits,productionDays:q.productionDays};
  await validateV2DeliveryWindow(db,capacity);if(!(await planV2AllocationForWindow(db,capacity)).fits)fail('A agenda mudou. Solicite uma nova proposta.');
  const at=nowIso(),deposit=q.payment.depositCents;
  await db.batch([
   db.prepare('DELETE FROM v2_order_items WHERE order_id=?').bind(row.id),
   db.prepare('DELETE FROM v3_order_services WHERE order_id=?').bind(row.id),
   ...v3LineStatements(db,q,'?',row.id,at),
   db.prepare('UPDATE v3_order_checkout_snapshots SET quote_json=?,terms_version=? WHERE order_id=?').bind(r.quote_json,terms.general.version,row.id),
   db.prepare('UPDATE v2_order_pricing SET subtotal_cents=?,combo_discount_cents=?,coupon_discount_cents=?,total_cents=?,deposit_cents=?,balance_cents=?,pricing_snapshot_json=?,updated_at=? WHERE order_id=?').bind(q.subtotalCents,q.comboDiscountCents,q.couponDiscountCents,q.totalCents,deposit,q.totalCents-deposit,r.quote_json,at,row.id),
   db.prepare("UPDATE v2_orders SET delivery_start=?,delivery_end=?,next_action='Aguardando pagamento',updated_at=? WHERE id=?").bind(w.start,w.end,at,row.id),
   db.prepare("INSERT INTO v2_order_terms_acceptances(order_id,terms_version,terms_hash,accepted_at,evidence_json) VALUES(?,?,?,?,?)").bind(row.id,terms.general.version,terms.general.content_hash||null,at,JSON.stringify({revisionId:r.id,services:terms.services.map(s=>({family:s.family,version:s.version,accepted:true}))})),
   db.prepare("UPDATE v3_order_revisions SET status='accepted',accepted_at=? WHERE id=?").bind(at,r.id),
   db.prepare("INSERT INTO v2_order_history(order_id,action_code,description,metadata_json,created_at) VALUES(?,'v3_revision_accepted','Cliente aceitou a alteração antes de pagar.',?,?)").bind(row.id,JSON.stringify({revisionId:r.id,totalCents:q.totalCents}),at)
  ]);
  return {accepted:true};
 });
}

export async function getV3RevisionEditor(db,code){
 const row=await load(db,code);await eligible(db,row);
 const q=JSON.parse(row.quote_json);
 const variants=(await db.prepare("SELECT p.code AS productCode,p.name,v.code AS variantCode,v.label AS variantName,v.price_cents AS priceCents FROM v2_products p JOIN v2_product_variants v ON v.product_id=p.id WHERE p.active=1 AND v.active=1 ORDER BY p.sort_order,v.sort_order,p.code,v.code").all()).results||[];
 const retros=(await db.prepare("SELECT code,name,price_cents FROM v3_retrospective_packages WHERE scope_approved=1 AND sale_enabled=1 AND revision_limit IS NOT NULL AND specific_terms!='' ORDER BY max_photos").all()).results||[];
 for(const r of retros){const productCode='retrospectiva_'+r.code.slice(6);variants.push({productCode,variantCode:productCode+'_default',name:r.name,variantName:r.name,priceCents:r.price_cents});}
 for(const v of variants){v.family=v.productCode.startsWith('atelie_')?'identidade_visual':v.productCode.startsWith('retrospectiva_')?'retrospectiva':'convite';v.extras=listV3Extras(v.family,v.productCode);}
 const addons=(await db.prepare("SELECT code,name,price_cents AS priceCents FROM v2_addons WHERE active=1 ORDER BY sort_order,code").all()).results||[];
 const items=q.items.map(l=>({family:l.family,productCode:l.productCode,variantCode:l.variantCode,addonCodes:l.commercialSnapshot.addons.filter(a=>!a.config?.blackLibriGift).map(a=>a.code),extras:(l.extras||[]).map(x=>({code:x.code,quantity:x.quantity})),comboCode:l.comboCode||l.availableComboCode||''}));
 return {items,variants,addons,couponCode:q.couponComparison?.code||q.coupon?.code||'',paymentMethod:row.payment_method,blackLibri:q.blackLibri};
}
export async function withdrawV3Revision(db,code,input){
 const row=await load(db,code);
 if(input.confirmed!==true)fail('Confirme a retirada.',422);
 return withV2PaymentLock(db,row.id,async()=>{
  const fresh=await load(db,code);await eligible(db,fresh);
  const r=await db.prepare("SELECT id FROM v3_order_revisions WHERE order_id=? AND status='offered' AND kind='edit'").bind(row.id).first();
  if(!r)fail('Nenhuma revisão disponível.');
  await db.batch([db.prepare("UPDATE v3_order_revisions SET status='cancelled' WHERE id=?").bind(r.id),db.prepare("UPDATE v2_orders SET next_action='Aguardando pagamento',updated_at=? WHERE id=?").bind(nowIso(),row.id),db.prepare("INSERT INTO v2_order_history(order_id,action_code,description,created_at) VALUES(?,'v3_revision_withdrawn','Revisão retirada; condições originais preservadas.',?)").bind(row.id,nowIso())]);return {withdrawn:true};
 });
}
