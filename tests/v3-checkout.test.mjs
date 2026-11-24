import test from 'node:test';
import assert from 'node:assert/strict';
import {database,day,providerMock} from './helpers.mjs';
import worker from '../src/index.js';
import {previewV3CartDelivery} from '../src/lib/v3-cart-delivery.js';
import {getV3CheckoutTerms} from '../src/lib/v3-checkout.js';
import {setAtelieSaleStatus} from '../src/lib/v3-atelie-release.js';
import {randomToken} from '../src/lib/http.js';
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
