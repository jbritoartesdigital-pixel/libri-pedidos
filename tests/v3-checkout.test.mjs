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
