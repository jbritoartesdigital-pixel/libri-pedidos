// Server-side orchestration; public route remains disabled until the full
// storefront, modular briefing, promotions and admin workflows pass validation.
import {normalizeWhatsapp,randomToken,nowIso} from './http.js';
import {nextOrderCode,V2CheckoutError} from './v2-checkout.js';
import {createV3OrderRecords} from './v3-order-records.js';
import {prepareV3Payment,reconcileV3Payment} from './v3-order-payment.js';
import {quoteV3Cart} from './v3-cart-quote.js';
const fail=(message,code='checkout_invalid',status=422)=>{throw new V2CheckoutError(message,{code,status});};
const clean=(s,max)=>typeof s==='string'&&s.trim().length<=max?s.trim():'';
export function v3CheckoutEnabled(env){return env.LIBRI_V3_CHECKOUT_ENABLED==='true';}
export async function getV3CheckoutTerms(db,body){
  const q=await quoteV3Cart(db,body,{includeSnapshots:true});
  const general=await db.prepare('SELECT version,body FROM v2_terms_versions WHERE active=1 ORDER BY published_at DESC LIMIT 1').first();
  if(!general)fail('Condições comerciais indisponíveis.','terms_unavailable',503);
  const services=q.items.flatMap(line=>{
    const config=line.commercialSnapshot.variant.config;
    const specific=config?.atelie||config?.retrospective;
    return specific?[{family:line.family,version:specific.termsVersion,body:specific.specificTerms}]:[];
  });
  return {general,services};
}
export async function findOrCreateCustomer(db,{name,whatsapp,email}){
  // A public checkout must not overwrite another customer's saved contact.
  const lookup=()=>db.prepare('SELECT id FROM v2_customers WHERE whatsapp=? ORDER BY id DESC LIMIT 1').bind(whatsapp).first();
  const existing=await lookup();
  if(existing)return Number(existing.id);
  try{
    const r=await db.prepare('INSERT INTO v2_customers(name,whatsapp,email,created_at,updated_at) VALUES(?,?,?,?,?)')
      .bind(name,whatsapp,email,nowIso(),nowIso()).run();
    return Number(r.meta.last_row_id);
  }catch(error){
    const concurrent=await lookup();if(concurrent)return Number(concurrent.id);throw error;
  }
}
export async function startV3Checkout(request,env,body){
  if(!v3CheckoutEnabled(env))fail('A contratação V3 ainda não está disponível.','v3_checkout_disabled',503);
  if(!body||typeof body!=='object'||Array.isArray(body))fail('Dados inválidos.');
  // A cryptographically random key is a private retry credential.
  if(!/^[a-f0-9]{36}$/.test(body.clientRequestId||''))fail('Atualize a tentativa de checkout.','invalid_client_request_id');
  const name=clean(body.customer?.name,160),whatsapp=normalizeWhatsapp(body.customer?.whatsapp);
  const email=clean(body.customer?.email,240);
  if(!name||whatsapp.length<10||whatsapp.length>15||(body.customer?.email&&(!email||!/^\S+@\S+\.\S+$/.test(email))))fail('Confira seus dados de contato.');
  if(body.termsAccepted!==true)fail('Aceite as condições do pedido.','terms_required');
  // Check a retry against the existing request hash before repricing. Existing
  // orders preserve the agreed price even if the commercial catalogue changed.
  const prior=await env.DB.prepare('SELECT o.id,o.order_code,o.public_token,o.customer_id FROM v3_order_checkout_snapshots s JOIN v2_orders o ON o.id=s.order_id WHERE s.request_key=?').bind(body.clientRequestId).first();
  let customerId,orderCode,publicToken;
  if(prior){
    if(await env.DB.prepare('SELECT 1 FROM v3_order_revisions WHERE order_id=? LIMIT 1').bind(prior.id).first())fail('O pedido foi revisado. Retome pelo link do pedido.','order_revision_required',409);
    const owner=await env.DB.prepare('SELECT whatsapp FROM v2_customers WHERE id=?').bind(prior.customer_id).first();
    if(owner?.whatsapp!==whatsapp)fail('Esta tentativa pertence a outro pedido.','order_request_conflict',409);
    customerId=Number(prior.customer_id);orderCode=prior.order_code;publicToken=prior.public_token;
  }else{
    const q=await quoteV3Cart(env.DB,body,{requireSale:true});
    if(q.totalCents!==body.expectedTotalCents)fail('O total mudou. Confira o carrinho.','order_total_changed',409);
    customerId=await findOrCreateCustomer(env.DB,{name,whatsapp,email});
    orderCode=await nextOrderCode(env.DB);publicToken=randomToken('ord_');
  }
  const order=await createV3OrderRecords(env.DB,{customerId,orderCode,publicToken,body,contactSnapshot:{name,whatsapp,email}});
  const payment=await prepareV3Payment(request,env,order.orderId);
  return {...payment,orderCode:order.orderCode,publicToken:order.publicToken,customerAreaPath:'/meu-pedido/'+order.publicToken};
}

export async function recoverV3Checkout(request,env,body,{renew=false}={}){
  const key=typeof body?.clientRequestId==='string'?body.clientRequestId:'';
  const token=typeof body?.publicToken==='string'?body.publicToken:'';
  if((!!key===!!token)||(key&&!/^[a-f0-9]{36}$/.test(key))||(token&&!/^ord_[a-f0-9]{36}$/.test(token)))
    fail('Identificador privado inválido.','invalid_recovery_key');
  // Both credentials are unguessable bearer secrets. Never use an order number,
  // name or WhatsApp lookup as a recovery credential.
  const row=await env.DB.prepare(`SELECT o.id,o.order_code,o.public_token,o.status,o.archived_at,o.delivery_start,o.delivery_end,
      p.total_cents,p.payment_method,p.deposit_percent,p.deposit_cents,p.balance_cents FROM v3_order_checkout_snapshots s JOIN v2_orders o ON o.id=s.order_id
      JOIN v2_order_pricing p ON p.order_id=o.id WHERE ${key?'s.request_key':'o.public_token'}=?`).bind(key||token).first();
  if(!row)return {found:false};
  const status=await reconcileV3Payment(env,row.id);
  const base={found:true,orderCode:row.order_code,customerAreaPath:'/meu-pedido/'+row.public_token,totalCents:row.total_cents,paymentMethod:row.payment_method,depositPercent:row.deposit_percent,amountDueNowCents:row.deposit_cents,balanceCents:status.balanceCents??row.balance_cents,
    deliveryWindow:{start:row.delivery_start,end:row.delivery_end}};
  if(status.revisionRequired)return {...base,state:'review',revisionRequired:true,canRenew:false};
  if(status.alreadyPaid)return {...base,state:'paid',capacityReview:!!status.capacityReview,canRenew:false};
  if(row.archived_at||row.status==='cancelled')return {...base,state:'review',canRenew:false};
  if(status.pending)return {...base,state:'pending',checkoutUrl:status.checkoutUrl,canRenew:false};
  const eligible=!!(status.terminal||status.notStarted)&&['configuring','awaiting_payment'].includes(row.status)&&v3CheckoutEnabled(env);
  if(!renew)return {...base,state:status.terminal?'expired':status.notStarted?'not_started':'review',canRenew:eligible};
  if(!eligible)fail('Não é seguro gerar uma nova cobrança. Confira o pedido com a Libri.','v3_recovery_review',409);
  // Explicit renewal rechecks all provider payments under the order lock,
  // preserves the original amount/method, and revalidates the original agenda.
  const payment=await prepareV3Payment(request,env,row.id,{renew:true});
  return {...base,state:payment.alreadyPaid?'paid':'pending',checkoutUrl:payment.checkoutUrl,capacityReview:!!payment.capacityReview,canRenew:false};
}
