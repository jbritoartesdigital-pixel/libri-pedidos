// Internal persistence for the combined checkout, not a public endpoint.
// Parent, pricing, service snapshots, terms and idempotency are written together.
// Payment creation, capacity hold and customer-area routing must be integrated
// before calling this from any HTTP route. No Mercado Pago calls here.
import {normalizeV3Coupon} from './v3-promotions.js';
import {normalizeV3ExtraSelection} from './v3-extras-catalog.js';
import {quoteV3Cart,V3CartValidationError} from './v3-cart-quote.js';
import {validateV2DeliveryWindow,planV2AllocationForWindow} from './v2-agenda.js';

const fail=(message,code)=>{throw new V3CartValidationError(message,code);};
function required(value,max,label){
  if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail(label+' inválido.','order_input_invalid');
  return value.trim();
}
async function hash(value){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
}
function date(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('Data inválida.','order_date_invalid');
  const d=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)fail('Data inválida.','order_date_invalid');
  return value;
}
async function existingOrder(db,requestKey,requestHash){
  const row=await db.prepare(`SELECT s.request_hash,o.id,o.order_code,o.public_token
    FROM v3_order_checkout_snapshots s JOIN v2_orders o ON o.id=s.order_id WHERE s.request_key=?`).bind(requestKey).first();
  if(!row)return null;
  if(row.request_hash!==requestHash)fail('Esta tentativa já pertence a outro conjunto de escolhas.','order_request_conflict');
  return {orderId:row.id,orderCode:row.order_code,publicToken:row.public_token,recovered:true};
}
function canonicalItems(items){
  if(!Array.isArray(items)||items.length<1||items.length>3)fail('Selecione de um a três serviços.','order_multi_required');
  return items.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||!Array.isArray(item.addonCodes??[]))fail('Serviço inválido.','order_item_invalid');
    // No client-supplied monetary values or capacity enter the order.
    if(item.couponCode)fail('Cupons conjuntos ainda não estão configurados.','cart_promotion_pending');
    return {productCode:required(item.productCode,80,'Produto'),variantCode:required(item.variantCode,80,'Variante'),
      addonCodes:[...new Set(item.addonCodes??[])].sort(),extras:normalizeV3ExtraSelection(item.extras),comboCode:item.comboCode||''};
  }).sort((a,b)=>a.productCode.localeCompare(b.productCode));
}
export async function createV3OrderRecords(db,{customerId,orderCode,publicToken,body,termsEvidence={},contactSnapshot=null}){
  // customerId, orderCode and publicToken must come from the trusted checkout
  // orchestrator, never from a public JSON payload.
  if(!Number.isSafeInteger(customerId)||customerId<=0)fail('Cliente inválida.','order_customer_invalid');
  if(!/^LIBRI-\d{1,12}$/.test(orderCode||'')||!/^ord_[a-zA-Z0-9_-]{24,120}$/.test(publicToken||''))
    fail('Identificador do pedido inválido.','order_identity_invalid');
  const requestKey=required(body?.clientRequestId,120,'Tentativa');
  if(!/^[a-zA-Z0-9_-]{12,120}$/.test(requestKey))fail('Tentativa inválida.','order_request_invalid');
  if(body.termsAccepted!==true)fail('Aceite as condições do pedido.','terms_required');
  if(body.comboCode)fail('Descontos conjuntos ainda não estão configurados.','cart_promotion_pending');
  if(!['pix','card'].includes(body.paymentMethod))fail('Escolha Pix ou cartão.','order_payment_invalid');
  if(!Number.isSafeInteger(body.expectedTotalCents)||body.expectedTotalCents<=0)fail('Confira o total do pedido.','order_total_invalid');
  const event={type:required(body.eventType,80,'Tipo de evento'),honoree:required(body.honoreeName,180,'Homenageado'),
    subtype:typeof body.eventSubtype==='string'?body.eventSubtype.trim().slice(0,120):'',date:date(body.eventDate)};
  const delivery={start:date(body.deliveryWindow?.start),end:date(body.deliveryWindow?.end)};
  const items=canonicalItems(body.items);
  const couponCode=normalizeV3Coupon(body.couponCode);
  const blackLibriClaimId=body.blackLibriClaimId||'';
  if(items.length===1&&!/^retrospectiva_(070|100|150|200|250)$/.test(items[0].productCode)&&!(/^atelie_(essencia|encanto|universo)$/.test(items[0].productCode)&&items[0].extras.length))fail('Use o fluxo individual vigente para este serviço.','order_multi_required');
  const accepted={version:required(body.termsVersion,40,'Versão dos termos'),
    atelie:body.atelieTermsAccepted===true?required(body.atelieTermsVersion,100,'Termos Ateliê'):'',
    retrospective:body.retrospectiveTermsAccepted===true?required(body.retrospectiveTermsVersion,100,'Termos Retrospectiva'):''};
  const requestHash=await hash(JSON.stringify({customerId,event,delivery,items,accepted,...(couponCode?{couponCode}:{}),...(blackLibriClaimId?{blackLibriClaimId}:{}),paymentMethod:body.paymentMethod,expectedTotalCents:body.expectedTotalCents,...(contactSnapshot?{contactSnapshot}:{})}));
  const prior=await existingOrder(db,requestKey,requestHash);
  if(prior)return prior;
  const quote=await quoteV3Cart(db,{items,eventType:event.type,paymentMethod:body.paymentMethod,couponCode,blackLibriClaimId,customer:body.customer,clientRequestId:requestKey},{includeSnapshots:true,requireSale:true,customerId});
  if(quote.totalCents!==body.expectedTotalCents)fail('O total mudou. Revise o carrinho antes de confirmar.','order_total_changed');
  const terms=await db.prepare('SELECT version,body,content_hash FROM v2_terms_versions WHERE active=1 ORDER BY published_at DESC LIMIT 1').first();
  if(!terms||terms.version!==accepted.version)fail('As condições foram atualizadas. Confira novamente.','terms_changed');
  const termsHash=terms.content_hash||await hash(terms.body);
  const evidence={...termsEvidence,services:{}};
  for(const line of quote.items){
    if(line.family==='identidade_visual'){
      const specific=line.commercialSnapshot.variant.config?.atelie;
      if(!specific?.specificTerms||!specific.termsVersion||accepted.atelie!==specific.termsVersion)
        fail('Aceite a versão atual das condições do Ateliê.','atelie_terms_required');
      evidence.services[line.family]={version:specific.termsVersion,hash:await hash(specific.specificTerms),accepted:true};
    }
    // Retrospectiva must provide its actual versioned terms before activation.
    if(line.family==='retrospectiva'){
      const specific=line.commercialSnapshot.variant.config?.retrospective;
      if(!specific?.specificTerms||!specific.termsVersion||accepted.retrospective!==specific.termsVersion)
        fail('Aceite a versão atual das condições da Retrospectiva.','retro_terms_required');
      evidence.services[line.family]={version:specific.termsVersion,hash:await hash(specific.specificTerms),accepted:true};
    }
  }
  const capacity={eventDate:event.date,...delivery,pointsUnits:quote.pointsUnits,productionDays:quote.productionDays};
  await validateV2DeliveryWindow(db,capacity);
  const plan=await planV2AllocationForWindow(db,capacity);
  if(!plan.fits)fail('A agenda mudou. Escolha outra janela.','order_capacity_unavailable');
  const stamp=new Date().toISOString();
  const pricing={...quote,schemaVersion:3,productionDays:quote.productionDays,...(contactSnapshot?{contactSnapshot}:{}),
    payment:{method:quote.paymentMethod,depositPercent:100,depositCents:quote.totalCents,balanceCents:0},
    comboDiscountCents:quote.discountCents-quote.couponDiscountCents,couponDiscountCents:quote.couponDiscountCents};
  // No existing V2 payment endpoint can reach this internal helper. Until the
  // shared orchestrator is finished, the order is only a configuring record.
  const idSql='(SELECT id FROM v2_orders WHERE order_code=?)';
  const statements=[
    db.prepare(`INSERT INTO v2_orders(order_code,public_token,customer_id,event_type,event_subtype,honoree_display_name,event_date,
       status,next_action,delivery_start,delivery_end,urgency_enabled,briefing_status,source,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,'configuring','Preparando contratação conjunta',?,?,0,'locked','store',?,?)`)
       .bind(orderCode,publicToken,customerId,event.type,event.subtype,event.honoree,event.date,delivery.start,delivery.end,stamp,stamp),
    db.prepare(`INSERT INTO v3_order_checkout_snapshots(order_id,request_key,request_hash,quote_json,terms_version,created_at)
      VALUES(${idSql},?,?,?,?,?)`).bind(orderCode,requestKey,requestHash,JSON.stringify(pricing),terms.version,stamp),
    db.prepare(`INSERT INTO v2_order_pricing(order_id,subtotal_cents,combo_discount_cents,coupon_discount_cents,urgency_percent,
      urgency_amount_cents,total_cents,payment_method,deposit_percent,deposit_cents,balance_cents,currency,pricing_snapshot_json,updated_at)
      VALUES(${idSql},?,?,?,0,0,?,?,100,?,0,'BRL',?,?)`)
      .bind(orderCode,quote.subtotalCents,quote.discountCents-quote.couponDiscountCents,quote.couponDiscountCents,quote.totalCents,quote.paymentMethod,quote.totalCents,JSON.stringify(pricing),stamp),
    db.prepare(`INSERT INTO v2_briefings(order_id,schema_version,data_json,completion_percent,updated_at)
      VALUES(${idSql},'3.0','{}',0,?)`).bind(orderCode,stamp),
    db.prepare(`INSERT INTO v2_order_terms_acceptances(order_id,terms_version,terms_hash,accepted_at,evidence_json)
      VALUES(${idSql},?,?,?,?)`).bind(orderCode,terms.version,termsHash,stamp,JSON.stringify(evidence)),
    db.prepare(`INSERT INTO v2_order_history(order_id,action_code,description,metadata_json,created_at)
      VALUES(${idSql},'order_created','Pedido combinado V3 preparado.',?,?)`).bind(orderCode,JSON.stringify({families:quote.items.map(x=>x.family),totalCents:quote.totalCents}),stamp)
  ];
  statements.push(...v3LineStatements(db,quote,idSql,orderCode,stamp));
  try{
    await db.batch(statements);
  }catch(error){
    const retry=await existingOrder(db,requestKey,requestHash);
    if(retry)return retry;
    if(String(error.message).includes('v3_black_reservation_changed'))fail('A reserva da surpresa mudou. Confira com a Libri.','black_libri_reservation_changed');
    throw error;
  }
  const created=await existingOrder(db,requestKey,requestHash);
  if(!created)throw new Error('Registro do pedido combinado não encontrado.');
  return {...created,recovered:false};
}

export function v3LineStatements(db,quote,idSql,orderKey,stamp){
 const statements=[];
  for(const line of quote.items){
    const q=line.commercialSnapshot;
    statements.push(db.prepare(`INSERT INTO v3_order_services(order_id,family,product_code,variant_code,gross_cents,discount_cents,total_cents,
      points_units,production_days,commercial_snapshot_json,created_at,updated_at) VALUES(${idSql},?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(orderKey,line.family,line.productCode,line.variantCode,line.grossCents,line.discountCents,line.totalCents,line.pointsUnits,
        line.productionDays,JSON.stringify(q),stamp,stamp));
    const records=[{type:'product',code:q.variant.code,name:q.product.pricingMode==='scene_count'?q.product.name+' • '+q.variant.label:q.product.name,
      price:q.variant.priceCents,points:q.variant.pointsUnits,config:{productCode:q.product.code,productSlug:q.product.slug,variantCode:q.variant.code,
        sceneCount:q.variant.sceneCount,...q.variant.config,serviceFamily:line.family}},
      ...q.addons.map(a=>({type:'addon',code:a.code,name:a.name,price:a.priceCents,points:a.pointsUnits,config:{...a.config,serviceFamily:line.family}})),
      ...(q.v3Extras||[]).map(a=>({type:'addon',code:a.code,name:a.name,price:a.priceCents,points:a.pointsUnits,quantity:a.quantity,config:{v3Extra:true,unitPointsUnits:a.pointsUnits,serviceFamily:line.family}}))];
    for(const item of records){
      statements.push(db.prepare(`INSERT INTO v2_order_items(order_id,item_type,item_code,name_snapshot,quantity,unit_price_cents,points_units,configuration_json,created_at)
        VALUES(${idSql},?,?,?,?,?,?,?,?)`).bind(orderKey,item.type,item.code,item.name,item.quantity||1,item.price,item.points,JSON.stringify(item.config),stamp));
    }
  }

 return statements;
}
