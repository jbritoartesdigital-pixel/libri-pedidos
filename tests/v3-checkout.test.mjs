import test from 'node:test';
import assert from 'node:assert/strict';
import {database,day,providerMock} from './helpers.mjs';
import worker from '../src/index.js';
import {previewV3CartDelivery} from '../src/lib/v3-cart-delivery.js';
import {getV3CheckoutTerms} from '../src/lib/v3-checkout.js';
import {setAtelieSaleStatus} from '../src/lib/v3-atelie-release.js';
import {randomToken} from '../src/lib/http.js';
import {decideV2Urgency} from '../src/lib/v2-urgency-admin.js';
import {handleAdminBriefingV3Api} from '../src/routes/briefing-v3.js';
const items=[{productCode:'retrospectiva_070',variantCode:'retrospectiva_070_default',addonCodes:[]}];
const base={items,eventType:'birthday',paymentMethod:'pix'};
async function setup(){
  const DB=database();DB.sqlite.exec("UPDATE v3_retrospective_packages SET sale_enabled=1 WHERE code='RETRO_070'");
  const eventDate=day(65);
  const terms=await getV3CheckoutTerms(DB,base);
  const preview=await previewV3CartDelivery(DB,{...base,eventDate});
  const body={...base,eventDate,honoreeName:'Ana',customer:{name:'Teste',whatsapp:'5561999999999',email:'teste@example.com'},
    clientRequestId:randomToken(),termsAccepted:true,termsVersion:terms.general.version,retrospectiveTermsAccepted:true,
    retrospectiveTermsVersion:terms.services[0].version,expectedTotalCents:preview.quote.totalCents,deliveryWindow:preview.delivery.options[0]};
  const env={DB,MERCADO_PAGO_ACCESS_TOKEN:'TEST-token',LIBRI_V3_CHECKOUT_ENABLED:'true'};
  const call=(payload=body,override=env,path='checkout')=>worker.fetch(new Request('https://test/api/v3/cart/'+path,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),override,{waitUntil(){}});
  return {DB,body,env,call};
}
test('unified checkout remains disabled by default, terms preview is read-only',async()=>{
  const {DB,body,call}=await setup();
  const terms=await call(body,{DB},'terms');
  assert.equal(terms.status,200);
  assert.equal((await terms.json()).terms.services[0].family,'retrospectiva');
  const disabled=await call(body,{DB});
  assert.equal(disabled.status,503);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n,0);
});
test('checkout creates one order and one provider charge and refuses changed retry',async t=>{
  const {DB,body,env,call}=await setup();
  const mp=providerMock(t);
  const bad=await call({...body,expectedTotalCents:1});
  assert.equal(bad.status,409);
  assert.equal(mp.posts,0);
  const response=await call();
  assert.equal(response.status,200);
  const value=await response.json();
  assert.equal(value.totalCents,14900);
  assert.match(value.publicToken,/^ord_[a-f0-9]{36}$/);
  assert.equal(value.customerAreaPath,'/meu-pedido/'+value.publicToken);
  const second=await call();
  assert.equal(second.status,200);
  assert.equal((await second.json()).publicToken,value.publicToken);
  assert.equal(mp.posts,1);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n,1);
  const conflict=await call({...body,customer:{...body.customer,email:'other@example.com'}});
  assert.equal(conflict.status,422);
  const wrongOwner=await call({...body,customer:{...body.customer,whatsapp:'5561888888888'}});
  assert.equal(wrongOwner.status,409);
  assert.equal(mp.posts,1);
});

test('unified checkout accepts standalone Atelie with extras, preserving unit quantities',async t=>{
  const {DB,body,env,call}=await setup();
  await setAtelieSaleStatus(DB,'essencia',true);
  const mp=providerMock(t);
  const items=[{productCode:'atelie_essencia',variantCode:'atelie_essencia_default',addonCodes:[],extras:[{code:'atelie_pose',quantity:3}]}];
  const preview=await previewV3CartDelivery(DB,{...body,items});
  const terms=await getV3CheckoutTerms(DB,{...body,items});
  const payload={...body,items,expectedTotalCents:preview.quote.totalCents,deliveryWindow:preview.delivery.options[0],atelieTermsAccepted:true,atelieTermsVersion:terms.services[0].version};
  const response=await call(payload);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.totalCents,21900);
  assert.equal(mp.posts,1);
  const extra=DB.sqlite.prepare("SELECT quantity,unit_price_cents,points_units FROM v2_order_items WHERE item_code='atelie_pose'").get();
  assert.equal(extra.quantity,3);
  assert.equal(extra.unit_price_cents,2000);
  assert.equal(extra.points_units,50);
  assert.equal(DB.sqlite.prepare('SELECT points_units FROM v3_order_services').get().points_units,450);
});

test('recovery checks provider, reuses live checkout and renews only terminal payment explicitly',async t=>{
  const {DB,body,env,call}=await setup();
  const mp=providerMock(t);
  const first=await (await call()).json();
  const key={clientRequestId:body.clientRequestId};
  const recover=async(credential=key,path='recover')=>{const r=await call(credential,env,path);assert.equal(r.status,200);return r.json();};
  const pending=await recover();
  assert.equal(pending.state,'pending');
  assert.equal(pending.checkoutUrl,first.checkoutUrl);
  assert.equal(pending.canRenew,false);
  assert.equal(mp.posts,1);
  assert.equal((await recover({publicToken:first.publicToken})).state,'pending');
  assert.equal((await recover({clientRequestId:'f'.repeat(36)})).found,false);
  assert.equal((await call({clientRequestId:'LIBRI-9000'},env,'recover')).status,422);
  assert.equal((await call(key,env,'renew')).status,200);
  assert.equal(mp.posts,1);
  DB.sqlite.exec("UPDATE v2_checkout_holds SET expires_at='2000-01-01T00:00:00.000Z'");
  const expired=await recover();
  assert.equal(expired.state,'expired');
  assert.equal(expired.canRenew,true);
  assert.equal(mp.posts,1);
  assert.equal(mp.orders.get(first.providerOrderId).status,'cancelled');
  const renewed=await recover(key,'renew');
  assert.equal(renewed.state,'pending');
  assert.equal(renewed.orderCode,first.orderCode);
  assert.equal(renewed.totalCents,first.totalCents);
  assert.notEqual(renewed.checkoutUrl,first.checkoutUrl);
  assert.equal(mp.posts,2);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n,1);
  assert.equal((await recover()).checkoutUrl,renewed.checkoutUrl);
  assert.equal(mp.posts,2);
  mp.approve('ORD2');
  const paid=await recover();
  assert.equal(paid.state,'paid');
  assert.equal(paid.customerAreaPath,first.customerAreaPath);
  assert.equal(paid.canRenew,false);
  assert.equal(mp.posts,2);
});
test('recovery fails closed for unmatched capacity holds',async t=>{
  const {DB,body,env,call}=await setup();
  const mp=providerMock(t);
  await call();
  const order=DB.sqlite.prepare('SELECT id FROM v2_orders').get();
  DB.sqlite.prepare("INSERT INTO v2_checkout_holds(token,order_id,status,expires_at) VALUES('hold_unknown',?,'active','2099-01-01T00:00:00.000Z')").run(order.id);
  const res=await (await call({clientRequestId:body.clientRequestId},env,'recover')).json();
  assert.equal(res.state,'review');
  assert.equal(res.canRenew,false);
  assert.equal((await call({clientRequestId:body.clientRequestId},env,'renew')).status,409);
  assert.equal(mp.posts,1);
});

test('coupon chosen at checkout is snapshotted and redeemed only once on approval',async t=>{
 const {DB,body,env,call}=await setup(),mp=providerMock(t);
 DB.sqlite.exec("INSERT INTO v2_coupons(code,discount_type,discount_value) VALUES('RETRO10','percent',10)");
 const payload={...body,couponCode:'retro10',expectedTotalCents:13410};
 const response=await call(payload);assert.equal(response.status,200);
 const value=await response.json();assert.equal(value.totalCents,13410);
 const p=DB.sqlite.prepare('SELECT coupon_discount_cents,combo_discount_cents,pricing_snapshot_json FROM v2_order_pricing').get();
 assert.equal(p.coupon_discount_cents,1490);assert.equal(p.combo_discount_cents,0);
 assert.equal(JSON.parse(p.pricing_snapshot_json).coupon.code,'RETRO10');
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_coupon_uses').get().n,0);
 DB.sqlite.exec("UPDATE v2_coupons SET active=0 WHERE code='RETRO10'");
 assert.equal((await (await call(payload)).json()).totalCents,13410);
 assert.equal(mp.posts,1);
 mp.approve(value.providerOrderId);
 assert.equal((await (await call({clientRequestId:body.clientRequestId},env,'recover')).json()).state,'paid');
 await call({clientRequestId:body.clientRequestId},env,'recover');
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_coupon_uses').get().n,1);
 assert.equal(DB.sqlite.prepare('SELECT discount_cents FROM v2_coupon_uses').get().discount_cents,1490);
});

import {couponUsageCount,reserveCheckoutCoupon,bindCheckoutCouponProvider,releaseCheckoutCouponAfterTerminal} from '../src/lib/shared-coupon-reservations.js';
test('limited coupon reserves one slot across checkout attempts, releases only verified terminal payment',async t=>{
 const {DB,body,env,call}=await setup(),mp=providerMock(t);
 DB.sqlite.exec("INSERT INTO v2_coupons(code,discount_type,discount_value,max_uses) VALUES('ONLYONE','percent',10,1)");
 const id=DB.sqlite.prepare("SELECT id FROM v2_coupons WHERE code='ONLYONE'").get().id;
 const payload={...body,couponCode:'ONLYONE',expectedTotalCents:13410};
 const first=await call(payload);assert.equal(first.status,200);
 const result=await first.json();
 assert.equal(await couponUsageCount(DB,id),1);
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_coupon_uses').get().n,0);
 assert.equal((await call({...payload,clientRequestId:randomToken(),customer:{...body.customer,whatsapp:'5561888888888'}})).status,422);
 assert.equal(mp.posts,1);
 assert.equal((await call(payload)).status,200);
 assert.equal(mp.posts,1);
 DB.sqlite.exec("UPDATE v2_checkout_holds SET expires_at='2000-01-01T00:00:00Z'");
 // A date in the past is not proof the previous charge is terminal.
 assert.equal(await couponUsageCount(DB,id),1);
 await releaseCheckoutCouponAfterTerminal(DB,DB.sqlite.prepare('SELECT id FROM v2_orders').get().id,result.providerOrderId);
 assert.equal(await couponUsageCount(DB,id),1);
 const recovered=await call({clientRequestId:body.clientRequestId},env,'recover');
 assert.equal((await recovered.json()).state,'expired');
 assert.equal(await couponUsageCount(DB,id),0);
 const renewed=await call({clientRequestId:body.clientRequestId},env,'renew');
 assert.equal(renewed.status,200);
 assert.equal(await couponUsageCount(DB,id),1);
 assert.equal(mp.posts,2);
 mp.approve('ORD2');
 await call({clientRequestId:body.clientRequestId},env,'recover');
 assert.equal(await couponUsageCount(DB,id),1);
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_coupon_uses').get().n,1);
});
test('shared ledger atomically rejects concurrent checkout for a per-customer limit',async t=>{
 const {DB,body,env,call}=await setup();
 const mp=providerMock(t);
 DB.sqlite.exec("INSERT INTO v2_coupons(code,discount_type,discount_value,max_uses_per_customer) VALUES('ONCE','percent',10,1)");
 const first=await call({...body,couponCode:'ONCE',expectedTotalCents:13410});
 assert.equal(first.status,200);
 const second=await call({...body,clientRequestId:randomToken(),couponCode:'ONCE',expectedTotalCents:13410});
 assert.equal(second.status,422);
 assert.equal(mp.posts,1);
 const row=DB.sqlite.prepare('SELECT * FROM v3_coupon_reservations').get();
 assert.equal(await couponUsageCount(DB,row.coupon_id,row.customer_id),1);
 // Bypass quote checks to prove the database limit is enforced independently.
 DB.sqlite.prepare("INSERT INTO v2_orders(order_code,public_token,customer_id,event_type,honoree_display_name,event_date) VALUES('LIBRI-99999','ord_direct',?,'birthday','Teste',?)").run(row.customer_id,body.eventDate);
 const other=DB.sqlite.prepare("SELECT id FROM v2_orders WHERE order_code='LIBRI-99999'").get().id;
 assert.throws(()=>DB.sqlite.prepare('INSERT INTO v3_coupon_reservations(order_id,coupon_id,customer_id,hold_token) VALUES(?,?,?,?)').run(other,row.coupon_id,row.customer_id,'hold_direct'),/coupon_reservation_limit/);
});

import {saveBlackLibriCampaign} from '../src/lib/v2-black-libri-admin.js';
import {findBlackLibriClaim,expireBlackLibriClaims,revealBlackLibri} from '../src/lib/v2-black-libri.js';
test('Black V3 uses a private claim, adds gift capacity and preserves it through payment recovery',async t=>{
 const {DB,body,env,call}=await setup(),mp=providerMock(t);
 env.LIBRI_V3_BLACK_LIBRI_ENABLED='true';
 await saveBlackLibriCampaign(env,{adminEnabled:true,complianceConfirmed:true,authorizationReference:'TESTE-INTERNO',adminNote:'Dados sintéticos',validFrom:'2020-01-01',validUntil:'2030-12-31'});
 const cart={...body,items:[{productCode:'interactive_essential',variantCode:'interactive_essential_default',addonCodes:[]},...body.items]};
 assert.equal((await (await call(cart,{...env,LIBRI_V3_BLACK_LIBRI_ENABLED:'false'},'black/status')).json()).enabled,false,'release flag blocks activation');
 assert.equal((await (await call(cart,env,'black/status')).json()).enabled,true,'all current gifts have workloads');
 DB.sqlite.exec("UPDATE v2_black_libri_prizes SET enabled=CASE WHEN code='save_static' THEN 1 ELSE 0 END");
 const plain=await previewV3CartDelivery(DB,cart);
 const status=await call(cart,env,'black/status');assert.equal(status.status,200);assert.equal((await status.json()).enabled,true);
 const response=await call({...cart,balloon:1},env,'black/reveal');assert.equal(response.status,200);
 const claim=(await response.json()).claim;assert.equal(claim.code,'save_static');
 assert.equal(await findBlackLibriClaim(env,cart.customer),null);
 await assert.rejects(revealBlackLibri(env,cart.customer,'checkout_other_browser_123'),/surpresa registrada/);
 assert.equal((await call({...cart,clientRequestId:randomToken(),blackLibriClaimId:claim.id},env,'black/preview')).status,409);
 const selected={...cart,blackLibriClaimId:claim.id};
 const quote=await previewV3CartDelivery(DB,selected);
 assert.equal(quote.quote.pointsUnits,plain.quote.pointsUnits+50);
 assert.equal(quote.quote.totalCents,plain.quote.totalCents);
 assert.equal(quote.quote.blackLibri.gift.code,'save_static');
 const checkout={...selected,expectedTotalCents:quote.quote.totalCents,deliveryWindow:quote.delivery.options[0]};
 const paid=await call(checkout);assert.equal(paid.status,200);
 const value=await paid.json();assert.equal(mp.posts,1);
 assert.equal(DB.sqlite.prepare('SELECT status FROM v2_black_libri_claims').get().status,'attached');
 assert.equal(DB.sqlite.prepare("SELECT unit_price_cents,points_units FROM v2_order_items WHERE item_code='save_static'").get().points_units,50);
 DB.sqlite.exec("UPDATE v2_black_libri_claims SET expires_at='2000-01-01T00:00:00Z'");
 await expireBlackLibriClaims(DB);
 assert.equal(DB.sqlite.prepare('SELECT status FROM v2_black_libri_claims').get().status,'attached');
 assert.equal((await call(checkout)).status,200);assert.equal(mp.posts,1);
 mp.approve(value.providerOrderId);
 await call({clientRequestId:body.clientRequestId},env,'recover');await expireBlackLibriClaims(DB);
 assert.equal(DB.sqlite.prepare('SELECT status FROM v2_black_libri_claims').get().status,'redeemed');
});
test('Black monetary discount competes with combined discount and coupon, never stacks',async()=>{
 const {DB,body,env,call}=await setup();env.LIBRI_V3_BLACK_LIBRI_ENABLED='true';
 await saveBlackLibriCampaign(env,{adminEnabled:true,complianceConfirmed:true,authorizationReference:'TESTE-INTERNO',adminNote:'Dados sintéticos',validFrom:'2020-01-01',validUntil:'2030-12-31'});
 DB.sqlite.exec("UPDATE v2_black_libri_prizes SET enabled=CASE WHEN code='off_15' THEN 1 ELSE 0 END");
 const cart={...body,items:[{productCode:'interactive_essential',variantCode:'interactive_essential_default',addonCodes:[]},...body.items]};
 const claim=(await (await call({...cart,balloon:2},env,'black/reveal')).json()).claim;
 assert.ok(claim);
 const selected={...cart,blackLibriClaimId:claim.id};
 let q=(await (await call(selected,env,'black/preview')).json()).quote;
 assert.equal(q.selectedDiscount,'black_libri');assert.equal(q.discountCents,1500);assert.equal(q.combinedDiscountCents,0);
 DB.sqlite.exec("INSERT INTO v2_coupons(code,discount_type,discount_value) VALUES('BETTER','fixed',2000)");
 q=(await (await call({...selected,couponCode:'BETTER'},env,'black/preview')).json()).quote;
 assert.equal(q.selectedDiscount,'coupon');assert.equal(q.discountCents,2000);assert.equal(q.blackLibri.applied,false);
});

import {V3_BLACK_GIFT_WORKLOAD,v3BlackCandidate} from '../src/lib/v3-black-libri.js';
import {buildV3ModuleSchema} from '../src/lib/v3-modular-briefing.js';
import {quoteV3Cart} from '../src/lib/v3-cart-quote.js';
test('all gift-only prizes carry positive workload, free delivery scope and creative briefing',async()=>{
 const {DB,body}=await setup();
 const cart={...body,items:[{productCode:'interactive_essential',variantCode:'interactive_essential_default',addonCodes:[]},...body.items]};
 const q=await quoteV3Cart(DB,cart,{includeSnapshots:true});
 const invite=q.items.find(x=>x.family==='convite');
 for(const [code,points] of Object.entries(V3_BLACK_GIFT_WORKLOAD)){
  const prize=DB.sqlite.prepare('SELECT * FROM v2_black_libri_prizes WHERE code=?').get(code);
  assert.ok(prize);
  const claim={id:'test_'+code,prize_code:code,label:prize.label,kind:'gift',description:prize.description};
  const benefit=await v3BlackCandidate(DB,claim,invite);
  assert.equal(benefit.gift.pointsUnits,points);
  assert.equal(benefit.gift.priceCents,0);
  assert.equal(benefit.availableDiscountCents,0);
  assert.equal(benefit.gift.config.giftOnly,true);
  const snapshot={...invite.commercialSnapshot,addons:[...invite.commercialSnapshot.addons,benefit.gift],blackLibri:benefit};
  const schema=buildV3ModuleSchema({event_type:'birthday'},[{family:'convite',snapshot}],'convite');
  const fields=schema.sections.find(s=>s.id==='black_gift').fields;
  assert.ok(fields.some(x=>x.key==='black_gift_notes'&&x.required));
  assert.equal(fields.some(x=>x.key==='black_gift_media_sent'),['mini_retrospective','child_birthday'].includes(code));
 }
});

test('V3 full refund preserves historical gross inflow and records outflow only once',async t=>{
 const {DB,body,env,call}=await setup(),mp=providerMock(t);
 const value=await (await call()).json();
 mp.approve(value.providerOrderId);
 assert.equal((await (await call({clientRequestId:body.clientRequestId},env,'recover')).json()).state,'paid');
 const {getV2FinanceDashboard}=await import('../src/lib/v2-finance.js');
 const order=DB.sqlite.prepare('SELECT id FROM v2_orders').get();
 const payment=DB.sqlite.prepare("SELECT id,amount_cents,paid_at FROM v2_payments WHERE order_id=? AND status='approved'").get(order.id);
 const date='2026-10-05T12:00:00.000Z',refundDate='2026-11-05T12:00:00.000Z';
 DB.sqlite.prepare("UPDATE v2_payments SET paid_at=? WHERE id=?").run(date,payment.id);
 DB.sqlite.prepare("INSERT INTO v3_paid_cancellations(order_id,status,reason,created_at) VALUES(?,'review','Teste',?)").run(order.id,refundDate);
 DB.sqlite.prepare("INSERT INTO v3_cancellation_charges(order_id,charge_key,provider,provider_order_id,reference,amount_cents,original_paid_at,status,refund_key,refund_confirmed_at,updated_at) VALUES(?,?,?,?,?,?,?,'refunded',?,?,?)").run(order.id,'original:'+payment.id,'mercado_pago',value.providerOrderId,value.orderCode,payment.amount_cents,date,'test-refund-key',refundDate,refundDate);
 const october=()=>getV2FinanceDashboard(DB,{preset:'custom',start:'2026-10-01',end:'2026-10-31'});
 const november=()=>getV2FinanceDashboard(DB,{preset:'custom',start:'2026-11-01',end:'2026-11-30'});
 assert.equal((await october()).summary.cashInCents,payment.amount_cents);
 assert.equal((await november()).summary.refundsCents,payment.amount_cents);
 DB.sqlite.prepare("UPDATE v2_payments SET status='refunded' WHERE id=?").run(payment.id);
 DB.sqlite.prepare("UPDATE v2_orders SET status='cancelled' WHERE id=?").run(order.id);
 DB.sqlite.prepare("UPDATE v3_paid_cancellations SET status='completed',completed_at=? WHERE order_id=?").run(refundDate,order.id);
 const after=await october(),refund=await november();
 assert.equal(after.summary.salesCents,payment.amount_cents);
 assert.equal(after.summary.cashInCents,payment.amount_cents);
 assert.equal(after.summary.refundsCents,0);
 assert.equal(refund.summary.cashInCents,0);
 assert.equal(refund.summary.refundsCents,payment.amount_cents);
 assert.equal(refund.refunds.movements.length,1);
 assert.equal(refund.summary.netCashMovementComplete,false);
 assert.equal((await november()).summary.refundsCents,payment.amount_cents);
});

test('single invitation and standalone Atelie use one modular order and verified provider charge',async t=>{
 const {DB,body,env,call}=await setup(),mp=providerMock(t);
 await setAtelieSaleStatus(DB,'essencia',true);
 for(const item of [{productCode:'interactive_essential',variantCode:'interactive_essential_default',addonCodes:[]},{productCode:'atelie_essencia',variantCode:'atelie_essencia_default',addonCodes:[]}]){
  const selection={...base,items:[item]};
  const terms=await getV3CheckoutTerms(DB,selection);
  const delivery=await previewV3CartDelivery(DB,{...selection,eventDate:body.eventDate});
  const payload={...body,...selection,clientRequestId:randomToken(),expectedTotalCents:delivery.quote.totalCents,deliveryWindow:delivery.delivery.options[0],termsVersion:terms.general.version,...(terms.services.length?{atelieTermsAccepted:true,atelieTermsVersion:terms.services[0].version}:{})};
  const response=await call(payload);assert.equal(response.status,200,await response.clone().text());
  const result=await response.json();assert.equal(result.totalCents,delivery.quote.totalCents);
  const retry=await (await call(payload)).json();assert.equal(retry.publicToken,result.publicToken);
 }
 assert.equal(mp.posts,2);assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v3_order_checkout_snapshots').get().n,2);
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v3_order_services').get().n,2);
});

test('V3 urgent invitation requires admin approval, never charges before approval, and reuses original quote',async t=>{
 const {DB,body,env,call}=await setup();const mp=providerMock(t);
 const input={...body,items:[{productCode:'interactive_essential',variantCode:'interactive_essential_default',addonCodes:[]}],eventDate:day(2),deliveryWindow:undefined,urgencyRequested:true};
 const preview=await previewV3CartDelivery(DB,input);assert.equal(preview.delivery.options.length,0);assert.ok(preview.urgencyQuote);assert.equal(preview.urgencyQuote.urgencyPercent,30);
 input.expectedTotalCents=preview.urgencyQuote.totalCents;
 const bad=await call({...input,expectedTotalCents:preview.quote.totalCents});assert.notEqual(bad.status,200);
 const res=await call(input);assert.equal(res.status,200,await res.clone().text());const result=await res.json();assert.equal(result.urgencyRequested,true);assert.equal(mp.posts,0);
 const retry=await (await call(input)).json();assert.equal(retry.publicToken,result.publicToken);assert.equal(mp.posts,0);
 const key={publicToken:result.publicToken};assert.equal((await (await call(key,env,'recover')).json()).state,'urgency_pending');assert.equal((await call(key,env,'renew')).status,409);assert.equal(mp.posts,0);
 const url=new URL('https://test/api/admin/v2/orders/'+result.orderCode+'/v3/urgency');
 const approve=()=>new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decision:'approve',deliveryStart:day(1),deliveryEnd:day(2),note:'Capacidade conferida'})});
 assert.equal((await worker.fetch(approve(),{...env,LIBRI_V3_ADMIN_PAYMENT_ENABLED:'true'},{waitUntil(){}})).status,401);
 assert.equal((await handleAdminBriefingV3Api(approve(),env,url)).status,503);
 const admin=await handleAdminBriefingV3Api(approve(),{...env,LIBRI_V3_ADMIN_PAYMENT_ENABLED:'true'},url);assert.equal(admin.status,200,await admin.clone().text());assert.equal((await admin.json()).briefing.urgency.status,'approved');
 const approved=await (await call(key,env,'recover')).json();assert.equal(approved.state,'not_started');assert.equal(approved.canRenew,true);assert.equal(mp.posts,0);
 const paid=await call(key,env,'renew');assert.equal(paid.status,200,await paid.clone().text());assert.equal(mp.posts,1);
 assert.equal(DB.sqlite.prepare('SELECT total_cents FROM v2_order_pricing').get().total_cents,preview.urgencyQuote.totalCents);
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n,1);
});

test('urgency rejects non-invitation and normal windows; rejected request permits a new order without any charge',async t=>{
 const {DB,body,env,call}=await setup();const mp=providerMock(t);
 const input={...body,items:[{productCode:'interactive_essential',variantCode:'interactive_essential_default',addonCodes:[]}],deliveryWindow:undefined,urgencyRequested:true};
 const regular=await previewV3CartDelivery(DB,input);assert.equal(regular.urgencyQuote,null);assert.notEqual((await call({...input,expectedTotalCents:regular.quote.totalCents})).status,200);
 assert.notEqual((await call({...body,eventDate:day(2),deliveryWindow:undefined,urgencyRequested:true})).status,200);
 input.eventDate=day(2);input.expectedTotalCents=(await previewV3CartDelivery(DB,input)).urgencyQuote.totalCents;
 const r=await call(input);assert.equal(r.status,200,await r.clone().text());const order=await r.json();
 await decideV2Urgency(DB,order.orderCode,{decision:'reject',note:'Sem capacidade'});
 const recovery=await (await call({publicToken:order.publicToken},env,'recover')).json();assert.equal(recovery.state,'urgency_rejected');assert.equal(recovery.canStartNew,true);assert.equal(mp.posts,0);
});

import {recoverBlackReservationAdmin} from '../src/lib/v2-black-libri.js';
test('reserved legacy gift transfers with original private key; admin recovery retains exact prize and deadline',async()=>{
 const {DB,body,env,call}=await setup();env.LIBRI_V3_BLACK_LIBRI_ENABLED='true';
 await saveBlackLibriCampaign(env,{adminEnabled:true,complianceConfirmed:true,authorizationReference:'TESTE-INTERNO',adminNote:'Dados sintéticos',validFrom:'2020-01-01',validUntil:'2030-12-31'});
 DB.sqlite.exec("UPDATE v2_black_libri_prizes SET enabled=CASE WHEN code='save_static' THEN 1 ELSE 0 END");
 const legacy='checkout_'+crypto.randomUUID(),cart={...body,items:[{productCode:'interactive_essential',variantCode:'interactive_essential_default',addonCodes:[]},...body.items]};
 const first=(await revealBlackLibri(env,cart.customer,legacy)).claim;
 assert.equal((await call(cart,env,'black/status')).status,409);
 const result=await call({...cart,legacyRequestId:legacy},env,'black/status');assert.equal(result.status,200);const recovered=(await result.json()).claim;assert.equal(recovered.id,first.id);assert.equal(recovered.expiresAt,first.expiresAt);
 await assert.rejects(recoverBlackReservationAdmin(env,{whatsapp:cart.customer.whatsapp}),/Confirme/);
 const newCode=await recoverBlackReservationAdmin(env,{whatsapp:cart.customer.whatsapp,identityVerified:true});
 const again=await call({...cart,clientRequestId:newCode.recoveryCode},env,'black/status');assert.equal(again.status,200);assert.equal((await again.json()).claim.id,first.id);
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM v2_black_libri_claims').get().n,1);
});
