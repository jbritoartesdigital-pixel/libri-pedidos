import {canonicalChange,changeKind,quoteV3Change} from './v3-supplement-changes.js';
import {contextV3Briefing} from './v3-modular-briefing.js';
import {withV2PaymentLock} from './v2-payment-lock.js';
import {listV3Extras,quoteV3Extras,normalizeV3ExtraSelection} from './v3-extras-catalog.js';
import {calculateCommercialV2Quote} from './v2-commercial-pricing.js';
import {loadV2AddonsByCodes} from './v2-catalog.js';
import {priceWithCardProcessingFee} from './v2-payment-pricing.js';
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const eligible=s=>['pending','ready','in_production','adjustments'].includes(s.production_status);
const parse=s=>JSON.parse(s||'{}');
async function access(db,token,family){
 const ctx=await contextV3Briefing(db,token);if(!ctx)return null;
 if(ctx.locked||ctx.order.archived_at||ctx.order.status==='cancelled')fail('Pedido indisponível.',403);
 const s=ctx.services.find(x=>x.family===family);
 if(!s)fail('Serviço não contratado.',404);
 return {ctx,s};
}
async function existingQuantities(db,s){
 const quantities=new Map();
 for(const x of s.snapshot.v3Extras||[])quantities.set(x.code,(quantities.get(x.code)||0)+x.quantity);
 for(const x of s.snapshot.addons||[])quantities.set(x.code,1);
 // Effective scope includes paid supplements; original snapshot remains immutable.
 return quantities;
}
export async function supplementCatalog(db,s){
 if(!eligible(s))return [];
 const bought=await existingQuantities(db,s);
 if(s.family==='convite'){
   if(!['pending','ready'].includes(s.production_status))return [];
   const rows=(await db.prepare("SELECT code,name,price_cents,points_units FROM v2_addons WHERE active=1 AND price_cents>0 ORDER BY sort_order,code").all()).results||[];
   return rows.filter(x=>!bought.has(x.code)&&!/^retro_|^moments_extra_/.test(x.code)).map(x=>({code:x.code,name:x.name,priceCents:x.price_cents,pointsUnits:x.points_units,maxQuantity:1}));
 }
 return listV3Extras(s.family,s.product_code).filter(x=>['pending','ready'].includes(s.production_status)||x.code.endsWith('_revision')&&s.production_status==='adjustments').map(x=>({...x,maxQuantity:x.maxQuantity-(bought.get(x.code)||0)})).filter(x=>x.maxQuantity>0);
}
async function quote(db,ctx,s,input){
 if(changeKind(input)!=='extras')return quoteV3Change(db,ctx,s,input);
 const selection=normalizeV3ExtraSelection(input.items);
 if(!selection.length)fail('Selecione ao menos um adicional.',422);
 if(!['pix','card'].includes(input.paymentMethod))fail('Escolha Pix ou cartão.',422);
 const catalog=await supplementCatalog(db,s);
 for(const x of selection){const option=catalog.find(a=>a.code===x.code);if(!option||x.quantity>option.maxQuantity)fail('Adicional indisponível, incompatível ou já contratado.',422);}
 let items;
 if(s.family==='convite'){
   const codes=selection.map(x=>x.code);
   const original=(s.snapshot.addons||[]).filter(a=>!a.config?.giftOnly).map(a=>a.code);
   // Revalidate compatibility and prevent replacement of previously purchased scope.
   if(ctx.services.some(x=>x.family==='retrospectiva')&&codes.some(x=>/^retro_/.test(x)))fail('Retrospectiva já contratada.',422);
   let combined;
   try{combined=await calculateCommercialV2Quote(db,{productCode:s.product_code,variantCode:s.variant_code,addonCodes:[...original,...codes],paymentMethod:'pix'},{eventType:ctx.order.event_type});}catch(e){fail(e.message,422);}
   const resolved=new Set(combined.addons.map(x=>x.code));
   if([...original,...codes].some(x=>!resolved.has(x))||resolved.size!==new Set([...original,...codes]).size)fail('O adicional altera o escopo original. Solicite uma revisão específica.',422);
   const old=(s.snapshot.addons||[]);
   // Do not charge a filter already included in a Moments package.
   if((codes.includes('custom_filter')&&old.some(a=>a.config?.filterIncluded))|| (codes.some(x=>/^moments_(festa|premium|exclusive)$/.test(x))&&old.some(a=>a.code==='custom_filter')))fail('Há sobreposição com um benefício contratado.',422);
   items=(await loadV2AddonsByCodes(db,codes)).map(x=>({...x,quantity:1,totalCents:x.priceCents,totalPointsUnits:x.pointsUnits}));
 }else items=quoteV3Extras(s.family,s.product_code,selection);
 const subtotalCents=items.reduce((n,x)=>n+x.totalCents,0),pointsUnits=items.reduce((n,x)=>n+x.totalPointsUnits,0);
 if(!Number.isSafeInteger(subtotalCents)||subtotalCents<1||!Number.isSafeInteger(pointsUnits)||pointsUnits<0)fail('Cotação inválida.',422);
 const pricing=priceWithCardProcessingFee(subtotalCents,input.paymentMethod);
 return {items,selection,subtotalCents,pointsUnits,paymentMethod:input.paymentMethod,totalCents:pricing.totalCents,cardFeeCents:pricing.cardFeeCents};
}
const view=r=>({id:r.id,family:r.family,status:r.status,kind:parse(r.offer_json).kind||'extras',targetFamily:parse(r.offer_json).targetFamily||r.family,terms:parse(r.offer_json).terms||null,deliveryWindow:parse(r.offer_json).deliveryWindow||null,absorbed:parse(r.offer_json).absorbed||[],items:parse(r.offer_json).items,subtotalCents:r.subtotal_cents,cardFeeCents:r.card_fee_cents,totalCents:r.total_cents,pointsUnits:r.points_units,paymentMethod:r.payment_method,note:r.note,createdAt:r.created_at,decidedAt:r.decided_at,paymentAvailable:false});
export async function listV3Supplements(db,orderId){
 const rows=(await db.prepare('SELECT a.*,s.family,s.production_status,s.production_version,s.scheduled_at,s.delivery_end,COALESCE(s.effective_snapshot_json,s.commercial_snapshot_json) AS current_snapshot,p.status AS attempt_status,p.checkout_url,p.expires_at,p.paid_at FROM v3_service_supplements a JOIN v3_order_services s ON s.id=a.service_id LEFT JOIN v3_supplement_payments p ON p.id=(SELECT MAX(id) FROM v3_supplement_payments WHERE supplement_id=a.id) WHERE s.order_id=? ORDER BY a.id DESC').bind(orderId).all()).results||[];
 return rows.map(r=>{
  const fresh=r.production_version===r.base_production_version&&r.current_snapshot===r.base_snapshot_json;
  const q=parse(r.offer_json);
  const eligible=q.kind==='new_service'?true:fresh&&!!r.scheduled_at&&!!r.delivery_end&&(r.production_status==='ready'||r.production_status==='adjustments'&&parse(r.offer_json).items.every(x=>x.code.endsWith('_revision')));
  const live=r.attempt_status==='pending'&&Date.parse(r.expires_at)>Date.now()&&r.status==='payment_pending';
  const retry=r.attempt_status==='creating'&&Date.parse(r.expires_at)>Date.now()&&r.status==='payment_pending';
  const renew=['expired','cancelled','rejected'].includes(r.attempt_status)&&r.status==='accepted';
  let url=null;
  if(live){try{const u=new URL(r.checkout_url);if(u.protocol==='https:'&&!u.username&&!u.password&&/(^|\.)mercadopago\.com(\.br)?$/.test(u.hostname))url=u.href;}catch{}}
  return {...view(r),paymentAvailable:eligible&&r.status==='accepted'&&!r.attempt_status,canRetry:eligible&&retry,canRenew:eligible&&renew,canVerify:r.status==='payment_pending'&&r.attempt_status==='pending',payment:{status:r.attempt_status||'not_started',checkoutUrl:url,expiresAt:r.expires_at,paidAt:r.paid_at},appliedAt:r.applied_at};
 });
}
export async function previewV3Supplement(db,token,family,input){
 const a=await access(db,token,family);if(!a)return null;
 return quote(db,a.ctx,a.s,input);
}
export async function createV3Supplement(db,token,family,input={}){
 const a=await access(db,token,family);if(!a)return null;
 if(!/^[a-f0-9]{36}$/.test(input.requestKey||''))fail('Identificador da proposta inválido.',422);
 if(typeof input.note!=='string'||input.note.trim().length>500)fail('Observação inválida.',422);
 const change=canonicalChange(input);
 const selection=normalizeV3ExtraSelection(input.items);
 const canonical=JSON.stringify({selection,paymentMethod:input.paymentMethod,note:input.note.trim(),...(change?{change}:{})});
 return withV2PaymentLock(db,a.ctx.order.id,async()=>{
 const {ctx,s}=await access(db,token,family);
 const prior=await db.prepare('SELECT a.*,s.family FROM v3_service_supplements a JOIN v3_order_services s ON s.id=a.service_id WHERE request_key=?').bind(input.requestKey).first();
 if(prior){if(prior.service_id!==s.id||prior.selection_json!==canonical)fail('Identificador já utilizado em outra proposta.');return view(prior);}
 if(!eligible(s)&&change?.kind!=='new_service')fail('Este serviço não está disponível para complementos.');
 const q=await quote(db,ctx,s,input);
 if(q.requiresWindow)fail('Escolha uma previsão de entrega para o novo serviço.',422);
 if(q.kind==='new_service'&&await db.prepare("SELECT 1 FROM v3_service_supplements a JOIN v3_order_services z ON z.id=a.service_id WHERE z.order_id=? AND a.status IN ('offered','accepted','payment_pending','review') AND json_extract(a.offer_json,'$.kind')='new_service' AND json_extract(a.offer_json,'$.targetFamily')=?").bind(ctx.order.id,q.targetFamily).first())fail('Já existe uma proposta para esta linha de serviço.');
 if(input.expectedTotalCents!==q.totalCents)fail('O valor mudou. Confira a proposta novamente.');
 if(await db.prepare("SELECT 1 FROM v3_service_supplements WHERE service_id=? AND status IN ('offered','accepted','payment_pending','review')").bind(s.id).first())fail('Já existe uma proposta complementar aberta neste serviço.');
 const stamp=new Date().toISOString();
 await db.batch([
 db.prepare('INSERT INTO v3_service_supplements(service_id,request_key,selection_json,offer_json,base_production_version,base_snapshot_json,subtotal_cents,card_fee_cents,total_cents,points_units,payment_method,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(s.id,input.requestKey,canonical,JSON.stringify(q),s.production_version,s.effective_snapshot_json||s.commercial_snapshot_json,q.subtotalCents,q.cardFeeCents,q.totalCents,q.pointsUnits,q.paymentMethod,input.note.trim(),stamp,stamp),
 db.prepare("INSERT INTO v2_order_history(order_id,action_code,description,metadata_json,created_at) VALUES(?,'v3_supplement_offered','Proposta complementar enviada.',?,?)").bind(ctx.order.id,JSON.stringify({family,totalCents:q.totalCents}),stamp)
 ]);
 return view(await db.prepare('SELECT a.*,s.family FROM v3_service_supplements a JOIN v3_order_services s ON s.id=a.service_id WHERE request_key=?').bind(input.requestKey).first());
 });
}
export async function decideV3Supplement(db,token,family,id,input={},actor='customer'){
 const a=await access(db,token,family);if(!a)return null;
 return withV2PaymentLock(db,a.ctx.order.id,async()=>{
 const {ctx,s}=await access(db,token,family);
 const r=await db.prepare('SELECT * FROM v3_service_supplements WHERE id=? AND service_id=?').bind(id,s.id).first();
 if(!r)fail('Proposta não encontrada.',404);
 const next=actor==='customer'?({accept:'accepted',decline:'declined'}[input.action]):input.action==='cancel'?'cancelled':null;
 if(!next)fail('Ação inválida.',422);
 if(r.status===next)return view({...r,family});
 if(!(r.status==='offered'||actor==='admin'&&r.status==='accepted'))fail('A proposta já foi decidida.');
 if(next==='accepted'){
   if(input.confirmed!==true||input.expectedTotalCents!==r.total_cents)fail('Confirme o valor e o escopo da proposta.',422);
   const q=parse(r.offer_json);
   if(q.terms&&input.termsAccepted!==true)fail('Aceite as condições específicas da proposta.',422);
   if(q.kind==='new_service'){if(ctx.services.some(x=>x.family===q.targetFamily))fail('Esta linha já foi contratada.');}
   else if(!eligible(s)||s.production_version!==r.base_production_version||(s.effective_snapshot_json||s.commercial_snapshot_json)!==r.base_snapshot_json)fail('A produção mudou. Solicite uma nova proposta.');
 }
 const stamp=new Date().toISOString();
 await db.batch([
 db.prepare('UPDATE v3_service_supplements SET status=?,decided_at=?,updated_at=? WHERE id=?').bind(next,stamp,stamp,id),
 db.prepare("INSERT INTO v2_order_history(order_id,action_code,description,metadata_json,created_at) VALUES(?,?,?,?,?)").bind(ctx.order.id,'v3_supplement_'+next,({accepted:'Proposta complementar aceita; aguardando cobrança.',declined:'Proposta complementar recusada.',cancelled:'Proposta complementar cancelada.'})[next],JSON.stringify({family,id,totalCents:r.total_cents}),stamp)
 ]);
 return view({...r,status:next,decided_at:stamp,family});
 });
}

export async function getV3SupplementTotals(db,orderId,originalCents){
 const rows=(await db.prepare(`SELECT a.total_cents,a.status,a.applied_at FROM v3_service_supplements a JOIN v3_order_services s ON s.id=a.service_id WHERE s.order_id=?`).bind(orderId).all()).results||[];
 const sum=pred=>rows.filter(pred).reduce((n,r)=>n+r.total_cents,0);
 const paidCents=sum(r=>r.status==='paid'),pendingCents=sum(r=>['accepted','payment_pending'].includes(r.status)),reviewCents=sum(r=>r.status==='review');
 return {originalCents,paidSupplementCents:paidCents,pendingSupplementCents:pendingCents,reviewSupplementCents:reviewCents,confirmedTotalCents:originalCents+paidCents};
}
