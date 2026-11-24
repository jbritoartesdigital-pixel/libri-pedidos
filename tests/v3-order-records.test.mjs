import test from 'node:test';
import assert from 'node:assert/strict';
import {database,day} from './helpers.mjs';
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
test('V3 stores one parent with individual snapshots and a single full-payment total',async()=>{
  const {db,input}=await setup();
  const result=await createV3OrderRecords(db,input);
  assert.equal(result.recovered,false);
  const count=t=>db.sqlite.prepare('SELECT COUNT(*) AS n FROM '+t).get().n;
  assert.equal(count('v2_orders'),1);
  assert.equal(count('v3_order_services'),2);
  assert.equal(count('v2_order_items'),2);
  assert.equal(count('v2_order_pricing'),1);
  assert.equal(count('v2_order_terms_acceptances'),1);
  assert.equal(count('v2_briefings'),1);
  const price=db.sqlite.prepare('SELECT * FROM v2_order_pricing').get();
  assert.equal(price.total_cents,19400);
  assert.equal(price.deposit_percent,100);
  assert.equal(price.deposit_cents,price.total_cents);
  assert.equal(price.balance_cents,0);
  const lines=db.sqlite.prepare('SELECT * FROM v3_order_services ORDER BY family').all();
  assert.deepEqual(lines.map(x=>x.family),['convite','identidade_visual']);
  assert.deepEqual(lines.map(x=>x.points_units),[100,300]);
  assert.equal(JSON.parse(lines[1].commercial_snapshot_json).variant.config.atelie.includedMascotPoses,3);
  assert.ok(lines.every(x=>x.briefing_status==='locked'));
  assert.equal(count('v2_payments'),0);
  assert.equal(count('v2_checkout_holds'),0);
  const retry=await createV3OrderRecords(db,{...input,orderCode:'LIBRI-9001',publicToken:'ord_'+crypto.randomUUID(),body:{...input.body,items:[...input.body.items].reverse()}});
  assert.equal(retry.recovered,true);
  assert.equal(retry.orderId,result.orderId);
  assert.equal(count('v2_orders'),1);
  await assert.rejects(createV3OrderRecords(db,{...input,body:{...input.body,honoreeName:'Outro'}}),/outro conjunto/);
});
test('V3 rejects missing terms, changed prices, duplicate service and failed batch without partial order',async()=>{
  const {db,input}=await setup();
  await assert.rejects(createV3OrderRecords(db,{...input,body:{...input.body,atelieTermsAccepted:false}}),/condições do Ateliê/);
  await assert.rejects(createV3OrderRecords(db,{...input,body:{...input.body,expectedTotalCents:1}}),/total mudou/);
  await assert.rejects(createV3OrderRecords(db,{...input,body:{...input.body,items:[input.body.items[0],input.body.items[0]]}}),/no máximo um produto/);
  db.sqlite.exec("CREATE TRIGGER test_service_failure BEFORE INSERT ON v3_order_services WHEN NEW.family='identidade_visual' BEGIN SELECT RAISE(ABORT,'forced test failure'); END;");
  await assert.rejects(createV3OrderRecords(db,input),/forced test failure/);
  for(const table of ['v2_orders','v2_order_items','v2_order_pricing','v3_order_services','v3_order_checkout_snapshots','v2_payments']){
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0);
  }
});
test('public preview never returns private internal commercial snapshots',async()=>{
  const {db,input}=await setup();
  const preview=await quoteV3Cart(db,{...input.body,includeSnapshots:true});
  assert.ok(preview.items.every(x=>!('commercialSnapshot' in x)));
});
