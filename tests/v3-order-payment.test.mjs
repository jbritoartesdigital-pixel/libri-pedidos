import test from 'node:test';
import assert from 'node:assert/strict';
import {database,day,providerMock} from './helpers.mjs';
import {setAtelieSaleStatus} from '../src/lib/v3-atelie-release.js';
import {quoteV3Cart} from '../src/lib/v3-cart-quote.js';
import {createV3OrderRecords} from '../src/lib/v3-order-records.js';
import {previewV3CartDelivery} from '../src/lib/v3-cart-delivery.js';

async function setup(){
  const db=database();
  await setAtelieSaleStatus(db,'essencia',true);
  const customerId=Number(db.sqlite.prepare("INSERT INTO v2_customers(name,whatsapp) VALUES('Teste','5561999999999')").run().lastInsertRowid);
  const items=[{productCode:'interactive_essential',variantCode:'interactive_essential_default',addonCodes:[]},
    {productCode:'atelie_essencia',variantCode:'atelie_essencia_default',addonCodes:[]}];
  const eventDate=day(65);
  const preview=await previewV3CartDelivery(db,{items,eventType:'birthday',eventDate,paymentMethod:'pix'});
  const termsVersion=db.sqlite.prepare('SELECT version FROM v2_terms_versions WHERE active=1').get().version;
  const atelieTermsVersion=db.sqlite.prepare("SELECT updated_at FROM v3_atelie_packages WHERE code='essencia'").get().updated_at;
  const body={items,eventType:'birthday',eventDate,honoreeName:'Teste',paymentMethod:'pix',clientRequestId:'v3_test_request_0001',
    termsAccepted:true,termsVersion,atelieTermsAccepted:true,atelieTermsVersion,
    expectedTotalCents:preview.quote.totalCents,deliveryWindow:preview.delivery.options[0]};
  const input={customerId,orderCode:'LIBRI-9000',publicToken:'ord_'+crypto.randomUUID(),body};
  return {db,input};
}
import {prepareV3Payment} from '../src/lib/v3-order-payment.js';
import {resumeV2Payment} from '../src/lib/v2-checkout.js';

test('V3 uses one real capacity hold and one provider checkout for the whole order',async t=>{
  const {db,input}=await setup();
  const mp=providerMock(t);
  const order=await createV3OrderRecords(db,input);
  const env={DB:db,MERCADO_PAGO_ACCESS_TOKEN:'TEST-token'};
  const request=new Request('https://test/internal-v3');
  const result=await prepareV3Payment(request,env,order.orderId);
  assert.equal(result.ok,true);
  assert.equal(result.totalCents,19400);
  assert.equal(mp.posts,1);
  assert.equal(Number(mp.bodies[0].total_amount),194);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments').get().n,1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_checkout_holds').get().n,1);
  assert.equal(db.sqlite.prepare('SELECT SUM(points_units) AS n FROM v2_checkout_hold_allocations').get().n,400);
  assert.equal(db.sqlite.prepare('SELECT status FROM v2_orders WHERE id=?').get(order.orderId).status,'awaiting_payment');
  const retry=await prepareV3Payment(request,env,order.orderId);
  assert.equal(retry.recovered,true);
  assert.equal(retry.providerOrderId,result.providerOrderId);
  assert.equal(mp.posts,1);
  await assert.rejects(resumeV2Payment(request,env,order.publicToken,{paymentMethod:'card'}),/checkout V3/);
  assert.equal(mp.posts,1);
});
test('V3 fails closed on modified pricing and cannot create a partial charge',async t=>{
  const {db,input}=await setup();
  const mp=providerMock(t);
  const order=await createV3OrderRecords(db,input);
  db.sqlite.prepare('UPDATE v2_order_pricing SET deposit_cents=100 WHERE order_id=?').run(order.orderId);
  await assert.rejects(prepareV3Payment(new Request('https://test/internal-v3'),{DB:db,MERCADO_PAGO_ACCESS_TOKEN:'TEST-token'},order.orderId),/revisão antes do pagamento/);
  assert.equal(mp.posts,0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_checkout_holds').get().n,0);
});
test('V3 does not issue a replacement charge when the earlier hold expires',async t=>{
  const {db,input}=await setup();
  const mp=providerMock(t);
  const order=await createV3OrderRecords(db,input);
  const env={DB:db,MERCADO_PAGO_ACCESS_TOKEN:'TEST-token'};
  const request=new Request('https://test/internal-v3');
  await prepareV3Payment(request,env,order.orderId);
  db.sqlite.exec("UPDATE v2_checkout_holds SET expires_at='2000-01-01T00:00:00.000Z'");
  await assert.rejects(prepareV3Payment(request,env,order.orderId),/conciliada/);
  assert.equal(mp.posts,1);
});
