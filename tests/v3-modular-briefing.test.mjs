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
import {prepareV3Payment,reconcileV3Payment} from '../src/lib/v3-order-payment.js';
import {resumeV2Payment} from '../src/lib/v2-checkout.js';


import {syncMercadoPagoOrder} from '../src/lib/v2-mercadopago.js';
import {getV3ModularBriefing,saveV3ModuleDraft,recordV3RetroMaterialReceipt,buildV3ModuleSchema} from '../src/lib/v3-modular-briefing.js';
async function paid(t){
  const {db,input}=await setup();
  const mp=providerMock(t);
  const order=await createV3OrderRecords(db,input);
  const env={DB:db,MERCADO_PAGO_ACCESS_TOKEN:'TEST-token'};
  const payment=await prepareV3Payment(new Request('https://test/internal-v3'),env,order.orderId);
  assert.equal((await getV3ModularBriefing(db,order.publicToken)).locked,true);
  await assert.rejects(saveV3ModuleDraft(db,order.publicToken,'shared',{revision:0,data:{}}),/pagamento/);
  mp.approve(payment.providerOrderId);
  await syncMercadoPagoOrder(env,payment.providerOrderId);
  return {db,order};
}
test('V3 briefing offers shared event information once and only purchased modules',async t=>{
  const {db,order}=await paid(t);
  const brief=await getV3ModularBriefing(db,order.publicToken);
  assert.equal(brief.locked,false);
  assert.deepEqual(brief.modules.map(x=>x.module).sort(),['convite','identidade_visual','shared']);
  const keys=m=>m.schema.sections.flatMap(s=>s.fields.map(f=>f.key));
  assert.ok(keys(brief.modules[0]).includes('theme_or_style'));
  assert.ok(!keys(brief.modules.find(m=>m.module==='convite')).includes('theme_or_style'));
  assert.ok(!keys(brief.modules.find(m=>m.module==='identidade_visual')).includes('theme'));
  const saved=await saveV3ModuleDraft(db,order.publicToken,'shared',{revision:0,data:{
    theme_or_style:'Jardim',joint_celebration:'no',age:3,unexpected:'not saved'
  }});
  assert.equal(saved.modules[0].revision,1);
  assert.equal(saved.modules[0].data.theme_or_style,'Jardim');
  assert.ok(!('unexpected' in saved.modules[0].data));
  await assert.rejects(saveV3ModuleDraft(db,order.publicToken,'shared',{revision:0,data:{}}),/mudou/);
  await assert.rejects(saveV3ModuleDraft(db,order.publicToken,'retrospectiva',{revision:0,data:{}}),/não permite/);
  assert.equal(await getV3ModularBriefing(db,'ord_wrong'),null);
});
test('retrospective WhatsApp materials use package limits, never an R2 upload rule',()=>{
  const order={event_type:'birthday',honoree_display_name:'Ana',event_date:day(65)};
  const service={family:'retrospectiva',product_code:'retrospectiva_070',snapshot:{variant:{config:{retrospective:{maxPhotos:70,maxVideos:3,captionsIncluded:true}}}}};
  const schema=buildV3ModuleSchema(order,[service],'retrospectiva',{retrospectiva:{music_mode:'quero sugerir'}});
  assert.deepEqual(schema.uploadRules,[]);
  assert.equal(schema.materials.channel,'whatsapp');
  assert.equal(schema.materials.storesFilesInR2,false);
  assert.equal(schema.materials.requiresAdminReceipt,true);
  assert.equal(schema.materials.maxPhotos,70);
  assert.ok(schema.sections[0].fields.some(f=>f.key==='music_reference'));
});
test('receipt confirmation rejects noncontracted service and excess materials; stores metadata only',async t=>{
  const {db,order}=await paid(t);
  await assert.rejects(recordV3RetroMaterialReceipt(db,order.orderId,{photoCount:30,videoCount:0}),/não contratada/);
  // Synthetic retrospective fixture: real retrospective product activation remains pending.
  const snap={product:{name:'Retrospectiva teste'},variant:{config:{retrospective:{maxPhotos:70,maxVideos:3,captionsIncluded:false}}}};
  db.sqlite.prepare(`INSERT INTO v3_order_services(order_id,family,product_code,variant_code,gross_cents,discount_cents,total_cents,points_units,production_days,commercial_snapshot_json,briefing_status)
    VALUES(?,'retrospectiva','retrospectiva_070','retrospectiva_070_default',10000,0,10000,100,15,?,'available')`).run(order.orderId,JSON.stringify(snap));
  await assert.rejects(recordV3RetroMaterialReceipt(db,order.orderId,{photoCount:71,videoCount:0}),/excedem/);
  const receipt=await recordV3RetroMaterialReceipt(db,order.orderId,{photoCount:60,videoCount:2});
  assert.equal(receipt.received,true);
  const brief=await getV3ModularBriefing(db,order.publicToken);
  const retro=brief.modules.find(m=>m.module==='retrospectiva');
  assert.equal(retro.receipt.photoCount,60);
  assert.equal(retro.receipt.videoCount,2);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_briefing_uploads').get().n,0);
  assert.equal(db.sqlite.prepare('SELECT status FROM v2_orders WHERE id=?').get(order.orderId).status,'briefing_pending');
});
