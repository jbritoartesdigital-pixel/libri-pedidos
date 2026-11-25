import {normalizeWhatsapp,randomToken} from './http.js';
import {nextOrderCode} from './v2-checkout.js';
import {findOrCreateCustomer} from './v3-checkout.js';
import {createV3OrderRecords} from './v3-order-records.js';
import {getV3BlackClaim,v3BlackStatus} from './v3-black-libri.js';
import {listV3Extras,normalizeV3ExtraSelection} from './v3-extras-catalog.js';
import {quoteV3Cart} from './v3-cart-quote.js';
import {validateV2DeliveryWindow,planV2AllocationForWindow,findV2DeliveryOptions,validateV3ManualDeliveryWindow} from './v2-agenda.js';
import {withV2PaymentLock} from './v2-payment-lock.js';
import {endUnpaidAttempts} from './v3-admin-payment-policy.js';
import {v3LineStatements} from './v3-order-records.js';
import {nowIso} from './http.js';
import {loadV2Catalog} from './v2-catalog.js';
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
async function load(db,code){
 const row=await db.prepare(`SELECT o.*,p.total_cents,p.payment_method,p.deposit_percent,s.quote_json,s.request_key FROM v2_orders o JOIN v3_order_checkout_snapshots s ON s.order_id=o.id JOIN v2_order_pricing p ON p.order_id=o.id WHERE o.order_code=?`).bind(code).first();
 if(!row)fail('Pedido V3 não encontrado.',404);
 return row;
}
async function eligible(db,row){
 if(await db.prepare('SELECT 1 FROM v2_urgency_requests WHERE order_id=?').bind(row.id).first())fail('Encaixe urgente precisa preservar a aprovação e o valor originais; não pode ser recotado pela revisão comum.');
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
// A suggestion may only extend a pristine, unpaid manual proposal.
async function manualUpsell(db,row,r){
 if(row.source!=='manual_whatsapp'||r.kind!=='manual'||r.status!=='offered'||row.briefing_status!=='locked'||row.archived_at)return null;
 if(await db.prepare('SELECT 1 FROM v2_payments WHERE order_id=? UNION ALL SELECT 1 FROM v2_checkout_holds WHERE order_id=? UNION ALL SELECT 1 FROM v2_contracts WHERE order_id=?').bind(row.id,row.id,row.id).first())return null;
 const old=JSON.parse(r.quote_json),data=JSON.parse(r.input_json),terms=JSON.parse(r.terms_json);
 if(old.blackLibri||old.coupon||old.couponComparison||old.discountCents||!Array.isArray(data.items))return null;
 const index=data.items.findIndex(i=>!i.productCode.startsWith('atelie_')&&!i.productCode.startsWith('retrospectiva_'));
 if(index<0)return null;
 const line=data.items[index],previous=old.items.find(i=>i.family==='convite');
 if(!previous)return null;
 const catalogue=await loadV2Catalog(db),owned=new Set(line.addonCodes||[]),groups=new Set(catalogue.addons.filter(a=>owned.has(a.code)).map(a=>a.group));
 const names={filter:'Ofereça um filtro personalizado na câmera Libri.',confirmation:'Acompanhe as confirmações de presença em um painel.',save_the_date:'Avise a data aos convidados com antecedência.',reminder:'Relembre os convidados perto da festa.',moments:'Reúna as fotos dos convidados em um álbum digital.'};
 const candidates=[];
 const target={cinematic_video:'cinematic_interactive',interactive_essential:'interactive_animated'}[line.productCode];
 const product=catalogue.products.find(p=>p.code===target),v=product?.variants.find(v=>target==='cinematic_interactive'?Number(v.sceneCount)===Number(previous.commercialSnapshot.variant.sceneCount):true);
 if(v)candidates.push({key:'upgrade:'+v.code,title:target==='cinematic_interactive'?'Que tal deixar seu vídeo interativo?':'Que tal uma abertura animada?',description:target==='cinematic_interactive'?'A mesma quantidade de cenas, com acesso às informações da festa pelo convite.':'Uma animação especial revela a arte do convite.',line:{...line,productCode:target,variantCode:v.code}});
 for(const group of ['confirmation','filter','moments','save_the_date','reminder']){
  if(groups.has(group)||group==='filter'&&groups.has('moments')||group==='confirmation'&&line.productCode==='cinematic_video'||group==='moments'&&groups.has('filter'))continue;
  const a=catalogue.addons.filter(a=>a.group===group&&!owned.has(a.code)).sort((a,b)=>a.priceCents-b.priceCents)[0];
  if(a)candidates.push({key:'addon:'+a.code,title:'Gostaria de adicionar '+a.name+'?',description:names[group],line:{...line,addonCodes:[...owned,a.code]}});
 }
 if(line.productCode!=='cinematic_video'){
  const confirmation=candidates.findIndex(c=>c.key.startsWith('addon:')&&catalogue.addons.some(a=>a.group==='confirmation'&&c.key==='addon:'+a.code));
  if(confirmation>0)candidates.unshift(candidates.splice(confirmation,1)[0]);
  const filter=candidates.findIndex(c=>catalogue.addons.some(a=>a.group==='filter'&&c.key==='addon:'+a.code));
  if(confirmation<0&&filter>0)candidates.unshift(candidates.splice(filter,1)[0]);
 }
 for(const c of candidates.slice(0,4)){
  try{
   const items=data.items.map((item,i)=>i===index?c.line:item);
   const p=await price(db,row,{items});
   const q=p.quote;
   if(q.totalCents<=old.totalCents||q.discountCents||q.couponComparison||JSON.stringify(p.terms)!==JSON.stringify(terms))continue;
   // Do not silently reprice other services or existing add-ons.
   const unchanged=q.items.every(n=>{const o=old.items.find(i=>i.family===n.family);return o&&(n.family==='convite'?o.commercialSnapshot.addons.every(a=>n.commercialSnapshot.addons.some(b=>b.code===a.code&&b.priceCents===a.priceCents))&&(c.key.startsWith('upgrade:')||o.productCents===n.productCents):o.totalCents===n.totalCents);});
   if(!unchanged)continue;
   const w=data.deliveryWindow,capacity={...p.capacity,...w};
   if(data.flexibleDelivery===true)validateV3ManualDeliveryWindow(capacity);else await validateV2DeliveryWindow(db,capacity);if(!(await planV2AllocationForWindow(db,capacity)).fits)continue;
   const depositCents=row.deposit_percent===50?Math.ceil(q.totalCents/2):q.totalCents;
   return {key:c.key,title:c.title,description:c.description,increaseCents:q.totalCents-old.totalCents,totalCents:q.totalCents,depositCents,balanceCents:q.totalCents-depositCents,depositPercent:row.deposit_percent,items,pricing:{...q,schemaVersion:3,...(old.manualFlexibleDelivery===true?{manualFlexibleDelivery:true}:{}),contactSnapshot:old.contactSnapshot||null,comboDiscountCents:q.discountCents-q.couponDiscountCents,payment:{method:q.paymentMethod,depositPercent:row.deposit_percent,depositCents,balanceCents:q.totalCents-depositCents}}};
  }catch{/* Incompatible suggestions are skipped, never block the original. */}
 }
 return null;
}
export async function getV3ManualUpsell(db,token){
 const row=await db.prepare("SELECT o.order_code FROM v2_orders o JOIN v3_order_checkout_snapshots s ON s.order_id=o.id WHERE o.public_token=? AND o.source='manual_whatsapp'").bind(token).first();if(!row)return null;
 const order=await load(db,row.order_code);await eligible(db,order);
 const revision=await db.prepare("SELECT * FROM v3_order_revisions WHERE order_id=? AND status='offered' AND kind='manual'").bind(order.id).first();if(!revision)return null;
 const u=await manualUpsell(db,order,revision);if(!u)return null;
 const {items,pricing,...publicOffer}=u;return publicOffer;
}

async function manualCheckoutContext(db,token){
 const link=await db.prepare("SELECT order_code FROM v2_orders WHERE public_token=? AND source='manual_whatsapp'").bind(token).first();
 if(!link)fail('Pedido não encontrado.',404);
 const row=await load(db,link.order_code);await eligible(db,row);
 const r=await db.prepare("SELECT * FROM v3_order_revisions WHERE order_id=? AND kind='manual' AND status='offered'").bind(row.id).first();
 if(!r)fail('Este pedido já avançou para pagamento. Abra o link novamente.');
 if(await db.prepare('SELECT 1 FROM v2_payments WHERE order_id=? UNION ALL SELECT 1 FROM v2_checkout_holds WHERE order_id=? UNION ALL SELECT 1 FROM v2_contracts WHERE order_id=?').bind(row.id,row.id,row.id).first())fail('O pagamento já foi iniciado. Reabra seu pedido.');
 const old=JSON.parse(r.quote_json),data=JSON.parse(r.input_json);
 const catalogue=await loadV2Catalog(db),invite=data.items.find(i=>!i.productCode.startsWith('atelie_')&&!i.productCode.startsWith('retrospectiva_'));
 const owned=new Set(invite?.addonCodes||[]),groups=new Set(catalogue.addons.filter(a=>owned.has(a.code)).map(a=>a.group));
 const addons=invite?catalogue.addons.filter(a=>!owned.has(a.code)&&!groups.has(a.group)&&!(invite.productCode==='cinematic_video'&&a.group==='confirmation')&&!(groups.has('moments')&&a.group==='filter')&&!(groups.has('filter')&&a.group==='moments')&&!(data.items.some(i=>i.productCode.startsWith('retrospectiva_'))&&a.group==='retrospectiva')).map(a=>({code:a.code,name:a.name,group:a.group,priceCents:a.priceCents})):[];
 const extras=old.items.flatMap(l=>listV3Extras(l.family,l.productCode).map(e=>({code:e.code,name:e.name,family:l.family,priceCents:e.priceCents,maxQuantity:e.maxQuantity-(l.extras||[]).filter(x=>x.code===e.code).reduce((n,x)=>n+x.quantity,0)}))).filter(x=>x.maxQuantity>0);
 return {row,r,old,data,addons,extras,invite};
}
function manualPublicQuote(q,percent){
 const deposit=percent===50?Math.ceil(q.totalCents/2):q.totalCents;
 return {totalCents:q.totalCents,depositCents:deposit,balanceCents:q.totalCents-deposit,depositPercent:percent,discountCents:q.discountCents||0,cardFeeCents:q.cardFeeCents||0,blackLibri:q.blackLibri,blackLibriDiscountCents:q.blackLibriDiscountCents||0,items:q.items.map(l=>({family:l.family,productName:l.productName,variantName:l.variantName,grossCents:l.grossCents,totalCents:l.totalCents,addons:l.commercialSnapshot.addons.map(a=>a.name),extras:(l.extras||[]).map(e=>({name:e.name,quantity:e.quantity}))}))};
}
async function manualCheckoutQuote(db,c,input={}){
 const {row,r,old,data,addons,extras,invite}=c;
 const selected=input.addonCodes??[],additional=normalizeV3ExtraSelection(input.extras);
 if(!Array.isArray(selected)||selected.length>20||new Set(selected).size!==selected.length||selected.some(x=>!addons.some(a=>a.code===x)))fail('Escolha apenas os adicionais disponíveis.',422);
 const groups=selected.map(code=>addons.find(a=>a.code===code).group);
 if(new Set(groups).size!==groups.length||groups.includes('filter')&&groups.includes('moments'))fail('Escolha apenas uma opção por tipo. O álbum já inclui filtro.',422);
 if(additional.some(x=>!extras.some(e=>e.code===x.code&&e.maxQuantity>=x.quantity)))fail('Confira as quantidades dos adicionais.',422);
 const items=data.items.map(i=>{
  const oldLine=old.items.find(l=>l.productCode===i.productCode);
  const quantities=new Map((i.extras||[]).map(x=>[x.code,x.quantity]));
  for(const x of additional.filter(x=>extras.some(e=>e.code===x.code&&e.family===oldLine.family)))quantities.set(x.code,(quantities.get(x.code)||0)+x.quantity);
  return {...i,addonCodes:[...(i.addonCodes||[]),...(invite?.productCode===i.productCode?selected:[])],extras:[...quantities].map(([code,quantity])=>({code,quantity}))};
 });
 const customer=old.contactSnapshot||await db.prepare('SELECT name,whatsapp,email FROM v2_customers WHERE id=?').bind(row.customer_id).first();
 const blackBody={items,eventType:row.event_type,paymentMethod:row.payment_method,couponCode:old.couponComparison?.code||old.coupon?.code||'',customer:{...customer,whatsapp:'+'+String(customer.whatsapp).replace(/\D/g,'')},clientRequestId:row.request_key};
 let q=old;
 if(selected.length||additional.length||input.blackLibriClaimId){
  const claim=input.blackLibriClaimId?await getV3BlackClaim(db,{...blackBody,blackLibriClaimId:input.blackLibriClaimId}):null;
  q=await quoteV3Cart(db,blackBody,{includeSnapshots:true,requireSale:true,customerId:row.customer_id,attachedBlackClaim:claim,excludeCouponOrderId:row.id});
  // No change to the originally contracted product, unit prices or terms.
  for(const l of old.items){
   const n=q.items.find(x=>x.family===l.family);
   if(!n||n.productCode!==l.productCode||n.variantCode!==l.variantCode||n.commercialSnapshot.variant.priceCents!==l.commercialSnapshot.variant.priceCents||!l.commercialSnapshot.addons.every(a=>n.commercialSnapshot.addons.some(b=>b.code===a.code&&b.priceCents===a.priceCents))||!(l.extras||[]).every(a=>n.extras.some(b=>b.code===a.code&&b.priceCents===a.priceCents&&b.quantity>=a.quantity)))fail('O catálogo mudou desde o seu pedido. Fale com a Libri para preservar os valores combinados.');
  }
  if(JSON.stringify(await termsFor(db,q))!==JSON.stringify(JSON.parse(r.terms_json)))fail('As condições do pedido precisam de conferência pela Libri.');
  if(q.totalCents>old.totalCents+selected.reduce((n,code)=>n+addons.find(a=>a.code===code).priceCents,0)+additional.reduce((n,x)=>n+extras.find(e=>e.code===x.code).priceCents*x.quantity,0)+(q.cardFeeCents-old.cardFeeCents))fail('O valor combinado precisa ser preservado. Fale com a Libri.');
 }
 const w=data.deliveryWindow,capacity={eventDate:row.event_date,...w,pointsUnits:q.pointsUnits,productionDays:q.productionDays};
 if(data.flexibleDelivery===true)validateV3ManualDeliveryWindow(capacity);else await validateV2DeliveryWindow(db,capacity);
 if(!(await planV2AllocationForWindow(db,capacity)).fits)fail('A agenda não comporta essa seleção. Retire um adicional ou fale com a Libri.');
 const priced={...q,schemaVersion:3,...(old.manualFlexibleDelivery===true?{manualFlexibleDelivery:true}:{}),contactSnapshot:old.contactSnapshot||null,comboDiscountCents:q.discountCents-q.couponDiscountCents,payment:{method:row.payment_method,depositPercent:row.deposit_percent,depositCents:row.deposit_percent===50?Math.ceil(q.totalCents/2):q.totalCents,balanceCents:row.deposit_percent===50?Math.floor(q.totalCents/2):0}};
 return {q:priced,items,blackBody,public:manualPublicQuote(priced,row.deposit_percent)};
}
export async function getV3ManualCheckout(env,token,action,input={}){
 const c=await manualCheckoutContext(env.DB,token);
 if(action==='catalog')return {orderCode:c.row.order_code,event:{honoreeName:c.row.honoree_display_name,date:c.row.event_date},deliveryWindow:c.data.deliveryWindow,paymentMethod:c.row.payment_method,depositPercent:c.row.deposit_percent,terms:JSON.parse(c.r.terms_json),revisionId:c.r.id,addons:c.addons,extras:c.extras,ownedAddonCodes:c.invite?.addonCodes||[],quote:manualPublicQuote(c.old,c.row.deposit_percent)};
 const p=await manualCheckoutQuote(env.DB,c,input);
 if(action==='quote'||action==='preview')return {quote:p.public};
 if(action==='status'||action==='reveal')return v3BlackStatus(env,{...p.blackBody,balloon:input.balloon},{reveal:action==='reveal'});
 fail('Operação inválida.',422);
}

export async function acceptV3Revision(db,token,input={}){
 const initial=await db.prepare('SELECT order_code,id FROM v2_orders WHERE public_token=?').bind(token).first();if(!initial)return null;
 return withV2PaymentLock(db,initial.id,async()=>{
  const row=await load(db,initial.order_code);await eligible(db,row);
  const r=await db.prepare('SELECT * FROM v3_order_revisions WHERE order_id=? AND id=?').bind(row.id,input.id).first();
  if(!r)fail('Proposta não encontrada.',404);
  if(r.status==='accepted')return {accepted:true,alreadyAccepted:true};
  if(r.status!=='offered')fail('Esta proposta não está disponível.');
  let q=JSON.parse(r.quote_json),data=JSON.parse(r.input_json);const terms=JSON.parse(r.terms_json);
  if(input.manualCheckout===true){if(r.kind!=='manual'||row.source!=='manual_whatsapp'||input.upsellKey)fail('Este pedido não permite essa contratação.',422);const c=await manualCheckoutContext(db,token);if(c.r.id!==r.id)fail('Pedido atualizado. Reabra o link.');const p=await manualCheckoutQuote(db,c,input);q=p.q;data={...data,items:p.items};}
  if(input.upsellKey){const u=await manualUpsell(db,row,r);if(!u||u.key!==input.upsellKey||u.totalCents!==input.expectedTotalCents)fail('A sugestão mudou. Reabra a proposta original antes de continuar.');q=u.pricing;data={...data,items:u.items};}
  const quoteJson=JSON.stringify(q);
  if(input.confirmed!==true||input.termsAccepted!==true||input.expectedTotalCents!==q.totalCents)fail('Confira os valores e aceite as condições da proposta.',422);
  if(await db.prepare("SELECT 1 FROM v2_payments WHERE order_id=? AND status NOT IN ('expired','cancelled','rejected')").bind(row.id).first())fail('Existe cobrança a conciliar.');
  const w=data.deliveryWindow,capacity={eventDate:row.event_date,...w,pointsUnits:q.pointsUnits,productionDays:q.productionDays};
  if(r.kind==='manual'&&data.flexibleDelivery===true)validateV3ManualDeliveryWindow(capacity);else await validateV2DeliveryWindow(db,capacity);if(!(await planV2AllocationForWindow(db,capacity)).fits)fail('A agenda mudou. Solicite uma nova proposta.');
  const at=nowIso(),deposit=q.payment.depositCents;
  await db.batch([
   db.prepare('DELETE FROM v2_order_items WHERE order_id=?').bind(row.id),
   db.prepare('DELETE FROM v3_order_services WHERE order_id=?').bind(row.id),
   ...v3LineStatements(db,q,'?',row.id,at),
   db.prepare('UPDATE v3_order_checkout_snapshots SET quote_json=?,terms_version=? WHERE order_id=?').bind(quoteJson,terms.general.version,row.id),
   db.prepare('UPDATE v2_order_pricing SET subtotal_cents=?,combo_discount_cents=?,coupon_discount_cents=?,total_cents=?,deposit_cents=?,balance_cents=?,pricing_snapshot_json=?,updated_at=? WHERE order_id=?').bind(q.subtotalCents,q.comboDiscountCents,q.couponDiscountCents,q.totalCents,deposit,q.totalCents-deposit,quoteJson,at,row.id),
   db.prepare("UPDATE v2_orders SET delivery_start=?,delivery_end=?,next_action='Aguardando pagamento',updated_at=? WHERE id=?").bind(w.start,w.end,at,row.id),
   db.prepare("INSERT INTO v2_order_terms_acceptances(order_id,terms_version,terms_hash,accepted_at,evidence_json) VALUES(?,?,?,?,?)").bind(row.id,terms.general.version,terms.general.content_hash||null,at,JSON.stringify({revisionId:r.id,services:terms.services.map(s=>({family:s.family,version:s.version,accepted:true}))})),
   db.prepare("UPDATE v3_order_revisions SET status='accepted',accepted_at=?,quote_json=?,input_json=? WHERE id=?").bind(at,quoteJson,JSON.stringify(data),r.id),
   db.prepare("INSERT INTO v2_order_history(order_id,action_code,description,metadata_json,created_at) VALUES(?,'v3_revision_accepted','Cliente confirmou os termos e valores antes de pagar.',?,?)").bind(row.id,JSON.stringify({revisionId:r.id,totalCents:q.totalCents}),at)
  ]);
  return {accepted:true};
 });
}

export async function getV3RevisionEditor(db,code=null){
 const row=code?await load(db,code):null;if(row)await eligible(db,row);
 const q=row?JSON.parse(row.quote_json):{items:[]};
 const variants=(await db.prepare("SELECT p.code AS productCode,p.name,v.code AS variantCode,v.label AS variantName,v.price_cents AS priceCents FROM v2_products p JOIN v2_product_variants v ON v.product_id=p.id WHERE p.active=1 AND v.active=1 ORDER BY p.sort_order,v.sort_order,p.code,v.code").all()).results||[];
 const retros=(await db.prepare("SELECT code,name,price_cents FROM v3_retrospective_packages WHERE scope_approved=1 AND sale_enabled=1 AND revision_limit IS NOT NULL AND specific_terms!='' ORDER BY max_photos").all()).results||[];
 for(const r of retros){const productCode='retrospectiva_'+r.code.slice(6);variants.push({productCode,variantCode:productCode+'_default',name:r.name,variantName:r.name,priceCents:r.price_cents});}
 for(const v of variants){v.family=v.productCode.startsWith('atelie_')?'identidade_visual':v.productCode.startsWith('retrospectiva_')?'retrospectiva':'convite';v.extras=listV3Extras(v.family,v.productCode);}
 const addons=(await db.prepare("SELECT code,name,price_cents AS priceCents FROM v2_addons WHERE active=1 ORDER BY sort_order,code").all()).results||[];
 const items=q.items.map(l=>({family:l.family,productCode:l.productCode,variantCode:l.variantCode,addonCodes:l.commercialSnapshot.addons.filter(a=>!a.config?.blackLibriGift).map(a=>a.code),extras:(l.extras||[]).map(x=>({code:x.code,quantity:x.quantity})),comboCode:l.comboCode||l.availableComboCode||''}));
 return {items,variants,addons,couponCode:q.couponComparison?.code||q.coupon?.code||'',paymentMethod:row?.payment_method||'pix',blackLibri:q.blackLibri||null};
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

function manualInput(input){
 const customer={name:String(input.customer?.name||'').trim(),whatsapp:normalizeWhatsapp(input.customer?.whatsapp),email:String(input.customer?.email||'').trim()};
 if(!customer.name||customer.name.length>160||!/^\d{10,15}$/.test(customer.whatsapp)||customer.email.length>240||customer.email&&!/^\S+@\S+\.\S+$/.test(customer.email))fail('Confira os dados da cliente.',422);
 const event=input.event||{};
 if(!event.honoreeName||!/^\d{4}-\d{2}-\d{2}$/.test(event.date||'')||!event.type)fail('Confira os dados da comemoração.',422);
 const depositPercent=input.depositPercent??100;
 if(!['pix','card'].includes(input.paymentMethod)||![50,100].includes(depositPercent)||depositPercent===50&&input.paymentMethod!=='pix')fail('Confira a forma de pagamento.',422);
 if(depositPercent===50&&(typeof input.reason!=='string'||input.reason.trim().length<5))fail('Informe o motivo da autorização excepcional de 50%.',422);
 return {customer,event,depositPercent,reason:String(input.reason||'Contratação preparada pelo atendimento Libri.').trim().slice(0,500)};
}
export async function previewV3ManualOrder(db,input){
 const x=manualInput(input);
 const owner=await db.prepare('SELECT id FROM v2_customers WHERE whatsapp=? ORDER BY id DESC LIMIT 1').bind(x.customer.whatsapp).first();
 const q=await quoteV3Cart(db,{items:input.items,eventType:x.event.type,paymentMethod:input.paymentMethod,couponCode:input.couponCode},{includeSnapshots:true,requireSale:true,customerId:owner?.id||null});
 const capacity={eventDate:x.event.date,pointsUnits:q.pointsUnits,productionDays:q.productionDays};
 const windows=await findV2DeliveryOptions(db,{...capacity,limit:8});
 const depositCents=x.depositPercent===50?Math.ceil(q.totalCents/2):q.totalCents;
 return {totalCents:q.totalCents,pointsUnits:q.pointsUnits,productionDays:q.productionDays,depositCents,balanceCents:q.totalCents-depositCents,options:windows.options.map(w=>({start:w.start,end:w.end,recommended:!!w.recommended})),terms:await termsFor(db,q)};
}
export async function createV3ManualOrder(env,input){
 const db=env.DB,x=manualInput(input);
 if(input.confirmed!==true||! /^[a-f0-9]{36}$/.test(input.requestKey||''))fail('Confirme a criação da proposta.',422);
 const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({customer:x.customer,event:x.event,depositPercent:x.depositPercent,reason:x.reason,items:input.items,paymentMethod:input.paymentMethod,couponCode:input.couponCode||'',deliveryWindow:input.deliveryWindow,expectedTotalCents:input.expectedTotalCents})))),b=>b.toString(16).padStart(2,'0')).join('');
 const old=await db.prepare("SELECT o.id,o.order_code,o.public_token,r.input_json FROM v3_order_revisions r JOIN v2_orders o ON o.id=r.order_id WHERE r.request_key=? AND r.kind='manual'").bind(input.requestKey).first();
 if(old){if(JSON.parse(old.input_json).manualFingerprint!==fingerprint)fail('Identificador já utilizado em outra proposta.');return {orderCode:old.order_code,customerAreaPath:'/meu-pedido/'+old.public_token,recovered:true};}
 const p=await previewV3ManualOrder(db,input),w=input.deliveryWindow;
 if(p.totalCents!==input.expectedTotalCents||!w)fail('O valor mudou ou a entrega não foi escolhida. Calcule novamente.');
 try{validateV3ManualDeliveryWindow({eventDate:x.event.date,start:w.start,end:w.end,productionDays:p.productionDays});}catch(e){fail(e.message,422);}
 const customerId=await findOrCreateCustomer(db,x.customer),orderCode=await nextOrderCode(db),publicToken=randomToken('ord_');
 const atelie=p.terms.services.find(s=>s.family==='identidade_visual'),retro=p.terms.services.find(s=>s.family==='retrospectiva');
 const result=await createV3OrderRecords(db,{customerId,orderCode,publicToken,contactSnapshot:x.customer,manualDraft:{depositPercent:x.depositPercent,reason:x.reason,fingerprint,flexibleDelivery:true},body:{clientRequestId:input.requestKey,items:input.items,couponCode:input.couponCode,eventType:x.event.type,eventSubtype:x.event.subtype||'',honoreeName:x.event.honoreeName,eventDate:x.event.date,paymentMethod:input.paymentMethod,deliveryWindow:w,expectedTotalCents:p.totalCents,termsVersion:p.terms.general.version,atelieTermsAccepted:!!atelie,atelieTermsVersion:atelie?.version,retrospectiveTermsAccepted:!!retro,retrospectiveTermsVersion:retro?.version}});
 return {orderCode:result.orderCode,customerAreaPath:'/meu-pedido/'+result.publicToken,recovered:result.recovered};
}
