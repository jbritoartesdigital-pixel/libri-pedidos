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
  const input={customerId,orderCode:'LIBRI-9000',publicToken:'ord_'+crypto.randomUUID().replace(/-/g,'')+'abcd',body};
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

import worker from '../src/index.js';
test('V3 customer routes isolate order tokens, require payment, and block legacy briefing writes',async t=>{
  const {db,order}=await paid(t);
  const env={DB:db},ctx={waitUntil(){}};
  const api='/api/v2/customer-area/'+order.publicToken;
  const call=(path,method='GET',body)=>worker.fetch(new Request('https://test'+path,{
    method,headers:body?{'content-type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})
  }),env,ctx);
  const get=await call(api+'/v3/briefing');
  assert.equal(get.status,200);
  assert.equal(get.headers.get('cache-control'),'no-store');
  assert.equal((await get.json()).briefing.modules.length,3);
  const saved=await call(api+'/v3/briefing/shared','PATCH',{revision:0,data:{theme_or_style:'Jardim'}});
  assert.equal(saved.status,200);
  const wrong=await call('/api/v2/customer-area/ord_'+ 'f'.repeat(36)+'/v3/briefing');
  assert.equal(wrong.status,404);
  const forbidden=await call(api+'/v3/briefing/retrospectiva','PATCH',{revision:0,data:{}});
  assert.equal(forbidden.status,409);
  const legacy=await call(api+'/briefing/submit','POST',{});
  assert.equal(legacy.status,409);
  const admin=await call('/api/admin/v2/orders/'+order.orderCode+'/v3/briefing/retro-materials','POST',{photoCount:1,videoCount:0});
  assert.equal(admin.status,401);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v3_retro_material_receipts').get().n,0);
});

test('private V3 images require contracted family and saved authorization; cross-service and wrong token are blocked',async t=>{
 const {db,order}=await paid(t);
 const objects=new Map();
 const FILES={async put(key,stream){objects.set(key,await new Response(stream).arrayBuffer());},async get(key){return objects.has(key)?{body:objects.get(key)}:null;},async delete(key){objects.delete(key);}};
 const env={DB:db,FILES},ctx={waitUntil(){}};
 const prefix='/api/v2/customer-area/'+order.publicToken+'/v3/briefing/';
 const call=(path,method='GET',body)=>worker.fetch(new Request('https://test'+path,{method,...(body?{body}:{})}),env,ctx);
 const form=field=>{const f=new FormData();f.set('fieldKey',field);f.set('file',new Blob([new Uint8Array([255,216,255,224,0,0,0,0,0,0,0,0,0,0,0,0])],{type:'image/jpeg'}),'foto.jpg');return f;};
 assert.equal((await call(prefix+'identidade_visual/uploads','POST',form('childPhotos'))).status,403);
 await saveV3ModuleDraft(db,order.publicToken,'identidade_visual',{revision:0,data:{mascotMode:'criança ilustrada',childPhotoPermission:'sim',guardianAuthorization:'sim'}});
 const upload=await call(prefix+'identidade_visual/uploads','POST',form('childPhotos'));
 assert.equal(upload.status,201);
 const id=(await upload.json()).result.id;
 assert.equal(objects.size,1);
 const result=await call(prefix+'identidade_visual/uploads/'+id+'/content');
 assert.equal(result.status,200);
 assert.match(result.headers.get('cache-control'),/no-store/);
 assert.equal((await call(prefix+'convite/uploads/'+id+'/content')).status,404);
 assert.equal((await call(prefix.replace(order.publicToken,'ord_'+'f'.repeat(36))+'identidade_visual/uploads/'+id+'/content')).status,404);
 assert.equal((await call(prefix+'identidade_visual/uploads/'+id,'DELETE')).status,200);
 assert.equal(objects.size,0);
});
test('service submission validates required fields and locks shared responses without releasing production',async t=>{
 const {db,order}=await paid(t);
 const prefix='/api/v2/customer-area/'+order.publicToken+'/v3/briefing/';
 const submit=(family,revision,sharedRevision)=>worker.fetch(new Request('https://test'+prefix+family+'/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision,sharedRevision})}),{DB:db},{waitUntil(){}});
 assert.equal((await submit('identidade_visual',0,0)).status,422);
 await saveV3ModuleDraft(db,order.publicToken,'shared',{revision:0,data:{theme_or_style:'Jardim',joint_celebration:'no',age:3,event_time:'14:00',venue_name:'Salão',venue_address:'Rua 1'}});
 await saveV3ModuleDraft(db,order.publicToken,'identidade_visual',{revision:0,data:{mascotMode:'ilustração temática',additionalSubjects:'não',styleFreedom:'a Libri pode decidir',exactTexts:'Ana 3 anos'}});
 assert.equal((await submit('identidade_visual',1,0)).status,409);
 const response=await submit('identidade_visual',1,1);
 assert.equal(response.status,200);
 const brief=(await response.json()).briefing;
 assert.equal(brief.services.find(x=>x.family==='identidade_visual').briefingStatus,'completed');
 assert.equal(brief.services.find(x=>x.family==='identidade_visual').productionStatus,'pending');
 assert.equal(brief.modules.find(x=>x.module==='shared').editable,false);
 assert.equal(brief.modules.find(x=>x.module==='convite').editable,true);
 await assert.rejects(saveV3ModuleDraft(db,order.publicToken,'shared',{revision:1,data:{theme_or_style:'Outro'}}),/compartilhados/);
 assert.equal((await submit('identidade_visual',1,1)).status,200);
});

import {getV3AdminBriefing,reviewV3ServiceBriefing} from '../src/lib/v3-admin-briefing.js';
import {submitV3ServiceBriefing} from '../src/lib/v3-modular-briefing.js';
test('Admin reviews or reopens one submitted service without releasing production',async t=>{
 const {db,order}=await paid(t);
 await saveV3ModuleDraft(db,order.publicToken,'shared',{revision:0,data:{theme_or_style:'Jardim',joint_celebration:'no',age:3,event_time:'14:00',venue_name:'Salão',venue_address:'Rua 1'}});
 await saveV3ModuleDraft(db,order.publicToken,'identidade_visual',{revision:0,data:{mascotMode:'ilustração temática',additionalSubjects:'não',styleFreedom:'a Libri pode decidir',exactTexts:'Ana 3 anos'}});
 await submitV3ServiceBriefing(db,order.publicToken,'identidade_visual',{revision:1,sharedRevision:1});
 await assert.rejects(reviewV3ServiceBriefing(db,order.publicToken,'identidade_visual',{action:'confirm',revision:0,sharedRevision:1}),/mudou/);
 const reviewed=await reviewV3ServiceBriefing(db,order.publicToken,'identidade_visual',{action:'confirm',revision:1,sharedRevision:1});
 assert.ok(reviewed.services.find(s=>s.family==='identidade_visual').reviewedAt);
 assert.equal(reviewed.services.find(s=>s.family==='identidade_visual').productionStatus,'pending');
 const reopened=await reviewV3ServiceBriefing(db,order.publicToken,'identidade_visual',{action:'reopen',revision:1,sharedRevision:1,note:'Informe as cores das artes.'});
 assert.equal(reopened.services.find(s=>s.family==='identidade_visual').briefingStatus,'in_progress');
 assert.equal(reopened.services.find(s=>s.family==='identidade_visual').reviewedAt,null);
 assert.equal(reopened.services.find(s=>s.family==='convite').briefingStatus,'available');
 assert.equal(reopened.modules.find(m=>m.module==='identidade_visual').revision,2);
 assert.equal((await getV3ModularBriefing(db,order.publicToken)).services.find(s=>s.family==='identidade_visual').complementNote,'Informe as cores das artes.');
 assert.ok(!JSON.stringify(await getV3AdminBriefing(db,order.publicToken)).includes(order.publicToken));
 const resp=await worker.fetch(new Request('https://test/api/admin/v2/orders/'+order.orderCode+'/v3/briefing/identidade_visual/review',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),{DB:db},{waitUntil(){}});
 assert.equal(resp.status,401);
});
test('Retro receipt completion is explicit, not implied by counts, and review requires it',async t=>{
 const {db,order}=await paid(t);
 const snap={product:{name:'Retrospectiva teste'},variant:{config:{retrospective:{maxPhotos:70,maxVideos:3,captionsIncluded:false}}}};
 db.sqlite.prepare(`INSERT INTO v3_order_services(order_id,family,product_code,variant_code,gross_cents,discount_cents,total_cents,points_units,production_days,commercial_snapshot_json,briefing_status)
 VALUES(?,'retrospectiva','retrospectiva_070','retrospectiva_070_default',10000,0,10000,100,15,?,'completed')`).run(order.orderId,JSON.stringify(snap));
 await recordV3RetroMaterialReceipt(db,order.orderId,{photoCount:60,videoCount:2});
 await assert.rejects(reviewV3ServiceBriefing(db,order.publicToken,'retrospectiva',{action:'confirm',revision:0,sharedRevision:0}),/recebimento completo/);
 await recordV3RetroMaterialReceipt(db,order.orderId,{photoCount:60,videoCount:2,complete:true});
 const reviewed=await reviewV3ServiceBriefing(db,order.publicToken,'retrospectiva',{action:'confirm',revision:0,sharedRevision:0});
 assert.ok(reviewed.services.find(s=>s.family==='retrospectiva').reviewedAt);
 assert.ok(reviewed.modules.find(m=>m.module==='retrospectiva').receipt.completeAt);
 assert.equal(reviewed.services.find(s=>s.family==='retrospectiva').productionStatus,'pending');
});

import {partitionV3Allocations,previewV3ServiceAgenda,scheduleV3Service} from '../src/lib/v3-service-agenda.js';
test('service agenda partitions original points and rejects inconsistent reservations',()=>{
 const services=[{family:'convite',points_units:100},{family:'identidade_visual',points_units:300}];
 const rows=[{id:1,day:'2027-01-05',points_units:250,allocation_type:'confirmed'},{id:2,day:'2027-01-06',points_units:150,allocation_type:'confirmed'}];
 const p=partitionV3Allocations(services,rows);
 assert.equal(p.reduce((n,x)=>n+x.points_units,0),400);
 assert.equal(p.filter(x=>x.service_family==='identidade_visual').reduce((n,x)=>n+x.points_units,0),300);
 assert.throws(()=>partitionV3Allocations(services,rows.slice(0,1)),/reserva original/);
});
test('service agenda requires reviewed briefing, keeps points once and enforces identity dependency',async t=>{
 const {db,order}=await paid(t);
 await assert.rejects(previewV3ServiceAgenda(db,order.publicToken,'identidade_visual',{}),/Confira o briefing/);
 db.sqlite.prepare("UPDATE v3_order_services SET briefing_status='completed',reviewed_at=datetime('now') WHERE order_id=?").run(order.orderId);
 const before=db.sqlite.prepare('SELECT SUM(points_units) AS n FROM v2_agenda_allocations WHERE order_id=?').get(order.orderId).n;
 assert.equal(before,400);
 await assert.rejects(previewV3ServiceAgenda(db,order.publicToken,'convite',{}),/depende/);
 await assert.rejects(previewV3ServiceAgenda(db,order.publicToken,'convite',{dependsOnIdentity:true}),/Aguarde a aprovação/);
 const preview=await previewV3ServiceAgenda(db,order.publicToken,'identidade_visual',{});
 assert.ok(preview.options.length);
 assert.equal(preview.pointsUnits,300);
 const window=preview.options[0];
 assert.ok(window.allocation.every(r=>![0,6].includes(new Date(r.day+'T12:00:00Z').getUTCDay())));
 assert.ok(window.start>=day(14));
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_agenda_allocations WHERE service_family IS NOT NULL').get().n,0);
 await assert.rejects(scheduleV3Service(db,order.publicToken,'identidade_visual',{...window,confirmed:false}),/Confirme/);
 await scheduleV3Service(db,order.publicToken,'identidade_visual',{...window,confirmed:true});
 assert.equal(db.sqlite.prepare('SELECT SUM(points_units) AS n FROM v2_agenda_allocations WHERE order_id=?').get(order.orderId).n,before);
 assert.equal(db.sqlite.prepare("SELECT SUM(points_units) AS n FROM v2_agenda_allocations WHERE order_id=? AND service_family='identidade_visual'").get(order.orderId).n,300);
 const next=await previewV3ServiceAgenda(db,order.publicToken,'convite',{dependsOnIdentity:false});
 assert.ok(next.options.length);
 await scheduleV3Service(db,order.publicToken,'convite',{...next.options[0],confirmed:true,dependsOnIdentity:false});
 assert.equal(db.sqlite.prepare('SELECT SUM(points_units) AS n FROM v2_agenda_allocations WHERE order_id=?').get(order.orderId).n,400);
 const brief=await getV3ModularBriefing(db,order.publicToken);
 assert.ok(brief.services.every(s=>s.deliveryWindow&&s.productionStatus==='ready'));
 assert.equal(brief.services.find(s=>s.family==='convite').dependsOnIdentity,false);
 const {getV2AgendaRange,anticipateV2Production,releaseV2CascadeSurplus}=await import('../src/lib/v2-agenda-admin.js');
 const range=await getV2AgendaRange(db,{start:day(0),end:day(85)});
 const allocations=range.days.flatMap(d=>d.orders.filter(x=>x.code===order.orderCode));
 assert.equal(allocations.reduce((n,x)=>n+x.pointsUnits,0),400);
 assert.ok(allocations.every(x=>x.serviceFamily&&!x.provisional));
 const deliveries=range.days.flatMap(d=>d.deliveries.filter(x=>x.code===order.orderCode));
 assert.ok(deliveries.length>=6);
 assert.ok(deliveries.every(x=>x.serviceFamily&&x.modular));
 assert.equal(range.days.flatMap(d=>d.events).filter(x=>x.code===order.orderCode).length,1);
 db.sqlite.prepare("UPDATE v3_order_services SET production_status='delivered' WHERE order_id=? AND family='identidade_visual'").run(order.orderId);
 const after=await getV2AgendaRange(db,{start:day(0),end:day(85)});
 assert.ok(after.days.flatMap(d=>d.deliveries).filter(x=>x.code===order.orderCode).every(x=>x.serviceFamily==='convite'));
 assert.equal(after.days.flatMap(d=>d.orders.filter(x=>x.code===order.orderCode)).reduce((n,x)=>n+x.pointsUnits,0),400);

});

import {changeV3Production,publishV3ServicePreview,streamV3ServicePreview} from '../src/lib/v3-service-production.js';
test('independent production requires agenda, tracks previews and revision rounds without auto approval',async t=>{
 const {db,order}=await paid(t),family='identidade_visual',token=order.publicToken;
 const files=new Map(),env={DB:db,FILES:{async put(k,body){files.set(k,await new Response(body).arrayBuffer())},async get(k){return files.has(k)?{body:files.get(k)}:null},async delete(k){files.delete(k)}}};
 await assert.rejects(changeV3Production(db,token,family,{action:'start',version:0}),/Confirme o briefing/);
 db.sqlite.prepare("UPDATE v3_order_services SET briefing_status='completed',reviewed_at=datetime('now') WHERE order_id=? AND family=?").run(order.orderId,family);
 const options=await previewV3ServiceAgenda(db,token,family,{});
 await scheduleV3Service(db,token,family,{...options.options[0],confirmed:true});
 let p=await changeV3Production(db,token,family,{action:'start',version:0});
 assert.equal(p.version,1);assert.equal(p.revisionsIncluded,1);
 const publish=async(v,watermark=true)=>{const form=new FormData();form.append('file',new Blob(['%PDF-1.7'],{type:'application/pdf'}),'previa.pdf');form.append('version',String(v));form.append('watermarkConfirmed',String(watermark));return publishV3ServicePreview(new Request('https://test/preview',{method:'POST',body:form}),env,token,family);};
 await assert.rejects(publish(p.version,false),/marca d/);
 p=await publish(p.version);const first=p.preview.id;
 assert.equal(p.preview.version,1);assert.equal(Date.parse(p.preview.adjustmentDeadline)-Date.parse(p.preview.publishedAt),7*86400000);
 assert.equal((await streamV3ServicePreview(env,token,family,first,new Request('https://test'))).status,200);
 assert.equal((await streamV3ServicePreview(env,'ord_unknown',family,first,new Request('https://test'))).status,404);
 await assert.rejects(changeV3Production(db,token,family,{action:'approve',version:p.version,previewId:first,confirmed:false},'customer'),/Confirme/);
 p=await changeV3Production(db,token,family,{action:'request_adjustments',version:p.version,previewId:first,note:'Alterar as cores'},'customer');
 p=await changeV3Production(db,token,family,{action:'included_revision',version:p.version,note:'Rodada de cores'});
 assert.equal(p.revisionsUsed,1);
 p=await publish(p.version);assert.equal(p.preview.version,2);
 assert.equal((await streamV3ServicePreview(env,token,family,first,new Request('https://test'))).status,404);
 p=await changeV3Production(db,token,family,{action:'request_adjustments',version:p.version,previewId:p.preview.id,note:'Corrigir grafia do nome'},'customer');
 await assert.rejects(changeV3Production(db,token,family,{action:'included_revision',version:p.version,note:'Outro ajuste'}),/esgotadas/);
 p=await changeV3Production(db,token,family,{action:'libri_correction',version:p.version,note:'Erro de grafia'});
 assert.equal(p.revisionsUsed,1);
 p=await publish(p.version);
 db.sqlite.prepare("UPDATE v3_service_previews SET adjustment_deadline='2000-01-01T00:00:00Z' WHERE id=?").run(p.preview.id);
 await assert.rejects(changeV3Production(db,token,family,{action:'request_adjustments',version:p.version,previewId:p.preview.id,note:'Outro ajuste'},'customer'),/prazo/);
 const before=await getV3ModularBriefing(db,token);
 assert.equal(before.services.find(x=>x.family===family).productionStatus,'waiting_customer');
 p=await changeV3Production(db,token,family,{action:'approve',version:p.version,previewId:p.preview.id,confirmed:true},'customer');
 assert.equal(p.preview.status,'approved');assert.equal(p.revisionsUsed,1);
 const after=await getV3ModularBriefing(db,token);
 assert.equal(after.services.find(x=>x.family===family).productionStatus,'approved');
 assert.equal(after.services.find(x=>x.family==='convite').productionStatus,'pending');
 const denied=await worker.fetch(new Request('https://test/api/admin/v2/orders/'+order.orderCode+'/v3/production/'+family,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),env,{waitUntil(){}});
 assert.equal(denied.status,401);
});

import {stageV3FinalFile,deliverV3Service,downloadV3FinalFile,removeV3FinalFile} from '../src/lib/v3-service-delivery.js';
import {runV3DeliveryRetention} from '../src/lib/v3-delivery-retention.js';
test('final delivery requires explicit approval and exposes only delivered service files',async t=>{
 const {db,order}=await paid(t),token=order.publicToken,family='identidade_visual';
 const files=new Map(),env={DB:db,FILES:{async put(k,body){files.set(k,await new Response(body).arrayBuffer())},async get(k){return files.has(k)?{body:files.get(k)}:null},async head(k){return files.has(k)?{size:files.get(k).byteLength}:null},async delete(k){files.delete(k)}}};
 const service=db.sqlite.prepare('SELECT id FROM v3_order_services WHERE order_id=? AND family=?').get(order.orderId,family);
 const stage=(version)=>{const form=new FormData();form.append('file',new Blob(['%PDF-1.7'],{type:'application/pdf'}),'identidade.pdf');form.append('version',String(version));return stageV3FinalFile(new Request('https://test/final',{method:'POST',body:form}),env,token,family);};
 await assert.rejects(stage(0),/aprovada/);
 db.sqlite.prepare("UPDATE v3_order_services SET production_status='approved' WHERE id=?").run(service.id);
 db.sqlite.prepare("INSERT INTO v3_service_previews(service_id,version,r2_key,mime_type,size_bytes,status,published_at,adjustment_deadline,approved_at) VALUES(?,1,'v3_test_preview','application/pdf',8,'approved',datetime('now'),datetime('now','+7 days'),datetime('now'))").run(service.id);
 files.set('v3_test_preview',new ArrayBuffer(8));
 await assert.rejects(deliverV3Service(env,token,family,{version:0,confirmed:true}),/arquivos finais/);
 const staged=await stage(0);const id=staged.files[0].id;
 assert.equal((await getV3ModularBriefing(db,token)).services.find(s=>s.family===family).delivery.files.length,0);
 assert.equal((await downloadV3FinalFile(env,token,family,id)).status,403);
 await assert.rejects(deliverV3Service(env,token,family,{version:0,confirmed:true}),/Atualize/);
 const done=await deliverV3Service(env,token,family,{version:1,confirmed:true});
 assert.equal(done.delivered,true);
 assert.equal(Date.parse(done.downloadUntil)-Date.parse(done.deliveredAt),90*86400000);
 assert.equal(Date.parse(done.originalsUntil)-Date.parse(done.deliveredAt),30*86400000);
 assert.equal((await downloadV3FinalFile(env,token,family,id)).status,200);
 assert.equal((await downloadV3FinalFile(env,token,'convite',id)).status,403);
 assert.equal((await downloadV3FinalFile(env,'ord_unknown',family,id)).status,404);
 const brief=await getV3ModularBriefing(db,token);
 assert.equal(brief.services.find(s=>s.family===family).productionStatus,'delivered');
 assert.equal(brief.services.find(s=>s.family==='convite').productionStatus,'pending');
 await assert.rejects(removeV3FinalFile(env,token,family,id,2),/aprovada/);
 const upload=db.sqlite.prepare("INSERT INTO v3_service_uploads(order_id,family,field_key,original_filename,mime_type,size_bytes,r2_key) VALUES(?,?,'childPhotos','original.jpg','image/jpeg',8,'v3_test_original')").run(order.orderId,family);
 files.set('v3_test_original',new ArrayBuffer(8));
 const soon=new Date(Date.parse(done.downloadUntil)-6*86400000);
 const clean=await runV3DeliveryRetention(env,{now:soon});
 assert.equal(clean.originals,1);assert.equal(clean.previews,1);assert.equal(clean.finals,0);
 assert.equal(files.has('v3_test_original'),false);
 assert.equal(files.has('v3_test_preview'),false);
 assert.equal((await runV3DeliveryRetention(env,{now:soon})).notices,0);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v3_delivery_notices WHERE service_id=?').get(service.id).n,1);
 db.sqlite.prepare("UPDATE v3_order_services SET download_until='2000-01-01T00:00:00Z' WHERE id=?").run(service.id);
 assert.equal((await downloadV3FinalFile(env,token,family,id)).status,410);
 const expired=await runV3DeliveryRetention(env);
 assert.equal(expired.finals,1);
 assert.equal(files.size,0);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments WHERE order_id=?').get(order.orderId).n,1);
 assert.ok(db.sqlite.prepare('SELECT purged_at FROM v3_service_final_files WHERE id=?').get(id).purged_at);
});
test('interactive link survives file download deadline and is restricted to Libri domain',async t=>{
 const {db,order}=await paid(t),token=order.publicToken,family='convite',env={DB:db};
 const s=db.sqlite.prepare('SELECT id FROM v3_order_services WHERE order_id=? AND family=?').get(order.orderId,family);
 db.sqlite.prepare("UPDATE v3_order_services SET production_status='approved' WHERE id=?").run(s.id);
 db.sqlite.prepare("INSERT INTO v3_service_previews(service_id,version,r2_key,mime_type,size_bytes,status,published_at,adjustment_deadline,approved_at) VALUES(?,1,'interactive_test_preview','image/png',8,'approved',datetime('now'),datetime('now','+7 days'),datetime('now'))").run(s.id);
 await assert.rejects(deliverV3Service(env,token,family,{version:0,confirmed:true,interactiveUrl:'https://libriconvites.com.br.example.com/foo'}),/domínio/);
 const d=await deliverV3Service(env,token,family,{version:0,confirmed:true,interactiveUrl:'https://libriconvites.com.br/festa-teste'});
 assert.equal(d.interactiveUrl,'https://libriconvites.com.br/festa-teste');
 db.sqlite.prepare("UPDATE v3_order_services SET download_until='2000-01-01T00:00:00Z' WHERE id=?").run(s.id);
 const b=await getV3ModularBriefing(db,token);
 assert.equal(b.services.find(x=>x.family===family).delivery.interactiveUrl,d.interactiveUrl);
});

import {summarizeV3Order,listV3Production} from '../src/lib/v3-order-overview.js';
import {guardV3LegacyAdmin,guardV3LegacyCustomer} from '../src/lib/v3-legacy-guard.js';
import {listV2Production} from '../src/lib/v2-admin-core.js';
test('V3 production queue derives mixed state without changing payment or parent status',async t=>{
 const {db,order}=await paid(t);
 const parent=()=>db.sqlite.prepare('SELECT status FROM v2_orders WHERE id=?').get(order.orderId).status;
 const before=parent();
 db.sqlite.prepare("UPDATE v3_order_services SET production_status='delivered' WHERE order_id=? AND family='identidade_visual'").run(order.orderId);
 db.sqlite.prepare("UPDATE v3_order_services SET production_status='in_production' WHERE order_id=? AND family='convite'").run(order.orderId);
 const queue=await listV3Production(db,{});
 assert.equal(queue.length,1);assert.equal(queue[0].aggregate.totalServices,2);
 assert.equal(queue[0].aggregate.deliveredServices,1);
 assert.equal(queue[0].aggregate.status,'in_production');
 assert.equal(queue[0].aggregate.mixed,true);
 assert.equal((await listV3Production(db,{service:'retrospectivas'})).length,0);
 assert.equal((await listV3Production(db,{service:'atelie'})).length,0);
 assert.equal((await listV3Production(db,{service:'atelie',status:'finalized'})).length,1);
 assert.equal((await listV3Production(db,{status:'finalized'})).length,0);
 assert.equal((await listV2Production(db,{})).some(x=>x.code===order.orderCode),false);
 assert.equal((await getV3ModularBriefing(db,order.publicToken)).aggregate.status,'in_production');
 db.sqlite.prepare("UPDATE v3_order_services SET production_status='delivered' WHERE order_id=?").run(order.orderId);
 assert.equal((await listV3Production(db,{status:'finalized'}))[0].aggregate.status,'finalized');
 assert.equal((await listV3Production(db,{})).length,0);
 assert.equal(parent(),before);
 assert.equal(summarizeV3Order([{productionStatus:'delivered'}],{locked:true}).status,'awaiting_payment');
});
test('legacy guard blocks V3 edits, payment mutations and cascade, but permits V2 paths',async t=>{
 const {db,order}=await paid(t),code=order.orderCode,token=order.publicToken;
 const admin=async(path,method='POST',body)=>{const url=new URL('https://test'+path);return guardV3LegacyAdmin(new Request(url,{method,...(body?{body:JSON.stringify(body)}:{})}),db,url);};
 for(const suffix of ['edit','cancel','action','capacity-review','briefing/submit','contracts']){
   assert.equal((await admin('/api/admin/v2/orders/'+code+'/'+suffix)).status,409);
 }
 assert.equal(await admin('/api/admin/v2/orders/'+code,'GET'),null);
 assert.equal((await admin('/api/admin/v2/orders/'+code+'/download-folder','GET')).status,409);
 assert.equal(await admin('/api/admin/v2/orders/'+code+'/notes'),null);
 assert.equal((await admin('/api/admin/v2/finance/payments','POST',{orderCode:code})).status,409);
 const payment=db.sqlite.prepare('SELECT id FROM v2_payments WHERE order_id=?').get(order.orderId);
 assert.equal((await admin('/api/admin/v2/finance/payments/'+payment.id+'/void')).status,409);
 assert.equal((await admin('/api/admin/v2/agenda/cascade/anticipate','POST',{sourceOrderCode:'LIBRI-123',targetOrderCode:code})).status,409);
 assert.equal(await admin('/api/admin/v2/orders/LIBRI-123/edit'),null);
 for(const path of ['/api/v2/customer-area/'+token+'/previews/1/approve','/api/v2/manual-order/'+token+'/start-payment','/api/v2/urgency/'+token+'/checkout']){
   const url=new URL('https://test'+path);assert.equal((await guardV3LegacyCustomer(new Request(url,{method:'POST'}),db,url)).status,409);
 }
 const safe=new URL('https://test/api/v2/customer-area/ord_'+'a'.repeat(36)+'/briefing');
 assert.equal(await guardV3LegacyCustomer(new Request(safe),db,safe),null);
});

import {previewV3Supplement,createV3Supplement,decideV3Supplement,supplementCatalog} from '../src/lib/v3-service-supplements.js';
test('supplemental offer is independently priced, accepted once and does not alter paid scope or capacity',async t=>{
 const {db,order}=await paid(t),token=order.publicToken,family='identidade_visual';
 const before=()=>({
  pricing:db.sqlite.prepare('SELECT * FROM v2_order_pricing WHERE order_id=?').get(order.orderId),
  services:db.sqlite.prepare('SELECT * FROM v3_order_services WHERE order_id=? ORDER BY id').all(order.orderId),
  agenda:db.sqlite.prepare('SELECT * FROM v2_agenda_allocations WHERE order_id=? ORDER BY id').all(order.orderId),
  payments:db.sqlite.prepare('SELECT * FROM v2_payments WHERE order_id=? ORDER BY id').all(order.orderId)
 });
 const original=before();
 const input={items:[{code:'atelie_pose',quantity:2}],paymentMethod:'pix',note:'Duas poses extras'};
 const q=await previewV3Supplement(db,token,family,input);
 assert.equal(q.totalCents,4000);assert.equal(q.pointsUnits,100);
 const payload={...input,expectedTotalCents:4000,requestKey:'a'.repeat(36)};
 await assert.rejects(createV3Supplement(db,token,family,{...payload,expectedTotalCents:1}),/valor mudou/);
 const offered=await createV3Supplement(db,token,family,payload);
 assert.equal(offered.status,'offered');assert.equal(offered.paymentAvailable,false);
 assert.equal((await createV3Supplement(db,token,family,payload)).id,offered.id);
 await assert.rejects(createV3Supplement(db,token,family,{...payload,requestKey:'b'.repeat(36)}),/já existe/i);
 assert.deepEqual(before(),original);
 await assert.rejects(decideV3Supplement(db,token,'convite',offered.id,{action:'accept',confirmed:true,expectedTotalCents:4000}),/não encontrada/);
 await assert.rejects(decideV3Supplement(db,token,family,offered.id,{action:'accept',confirmed:true,expectedTotalCents:1}),/Confirme/);
 const accepted=await decideV3Supplement(db,token,family,offered.id,{action:'accept',confirmed:true,expectedTotalCents:4000});
 assert.equal(accepted.status,'accepted');
 assert.equal((await decideV3Supplement(db,token,family,offered.id,{action:'accept',confirmed:true,expectedTotalCents:4000})).status,'accepted');
 assert.deepEqual(before(),original);
 assert.equal((await getV3ModularBriefing(db,token)).supplements[0].status,'accepted');
 await assert.rejects(decideV3Supplement(db,token,family,offered.id,{action:'cancel'}),/Ação inválida/);
 const cancelled=await decideV3Supplement(db,token,family,offered.id,{action:'cancel'},'admin');
 assert.equal(cancelled.status,'cancelled');
 const next=await createV3Supplement(db,token,family,{...payload,requestKey:'c'.repeat(36)});
 db.sqlite.prepare('UPDATE v3_order_services SET production_version=production_version+1 WHERE order_id=? AND family=?').run(order.orderId,family);
 await assert.rejects(decideV3Supplement(db,token,family,next.id,{action:'accept',confirmed:true,expectedTotalCents:4000}),/produção mudou/);
 assert.equal((await decideV3Supplement(db,token,family,next.id,{action:'decline'})).status,'declined');
});
test('supplement quotes reject invalid quantity, stage and duplicate scope',async t=>{
 const {db,order}=await paid(t),token=order.publicToken;
 const q=(family,items)=>previewV3Supplement(db,token,family,{items,paymentMethod:'pix'});
 await assert.rejects(q('identidade_visual',[{code:'atelie_pose',quantity:21}]),/Quantidade/);
 await assert.rejects(q('identidade_visual',[{code:'retro_more_photos',quantity:1}]),/indisponível/);
 const invite=await q('convite',[{code:'save_static',quantity:1}]);
 assert.equal(invite.totalCents,2000);assert.equal(invite.pointsUnits,50);
 db.sqlite.prepare("UPDATE v3_order_services SET production_status='delivered' WHERE order_id=? AND family='identidade_visual'").run(order.orderId);
 await assert.rejects(q('identidade_visual',[{code:'atelie_pose',quantity:1}]),/indisponível/);
});

import {previewV3SupplementCapacity,startV3SupplementPayment,syncV3SupplementPayment} from '../src/lib/v3-supplement-payment.js';
async function preparedSupplement(t){
 const {db,input}=await setup(),mp=providerMock(t);
 const order=await createV3OrderRecords(db,input),env={DB:db,MERCADO_PAGO_ACCESS_TOKEN:'TEST-token',LIBRI_V3_SUPPLEMENT_PAYMENT_ENABLED:'true'};
 const request=new Request('https://test/internal-v3');
 const payment=await prepareV3Payment(request,env,order.orderId);mp.approve(payment.providerOrderId);await syncMercadoPagoOrder(env,payment.providerOrderId);
 const token=order.publicToken,family='identidade_visual';
 db.sqlite.prepare("UPDATE v3_order_services SET briefing_status='completed',reviewed_at=datetime('now') WHERE order_id=? AND family=?").run(order.orderId,family);
 const options=await previewV3ServiceAgenda(db,token,family,{});
 await scheduleV3Service(db,token,family,{...options.options[0],confirmed:true});
 const offer=await createV3Supplement(db,token,family,{items:[{code:'atelie_pose',quantity:2}],paymentMethod:'pix',note:'Duas poses',requestKey:'a'.repeat(36),expectedTotalCents:4000});
 await decideV3Supplement(db,token,family,offer.id,{action:'accept',confirmed:true,expectedTotalCents:4000});
 return {db,order,env,request,token,family,offer,mp};
}
test('independent supplement charge reserves shared capacity and applies paid scope only once',async t=>{
 const {db,order,env,request,token,family,offer,mp}=await preparedSupplement(t);
 const original=db.sqlite.prepare('SELECT * FROM v2_order_pricing WHERE order_id=?').get(order.orderId);
 const service=()=>db.sqlite.prepare("SELECT * FROM v3_order_services WHERE order_id=? AND family=?").get(order.orderId,family);
 const before=service(),points=before.points_units;
 const capacity=await previewV3SupplementCapacity(db,token,family,offer.id);
 assert.equal(capacity.pointsUnits,100);assert.equal(capacity.allocation.reduce((n,x)=>n+x.units,0),100);
 await assert.rejects(startV3SupplementPayment(request,{...env,LIBRI_V3_SUPPLEMENT_PAYMENT_ENABLED:'false'},token,family,offer.id),/indisponível/);
 const pay=await startV3SupplementPayment(request,env,token,family,offer.id);
 assert.equal(pay.status,'pending');assert.equal(mp.posts,2);
 assert.equal((await startV3SupplementPayment(request,env,token,family,offer.id)).checkoutUrl,pay.checkoutUrl);
 assert.equal(mp.posts,2);
 const attempt=db.sqlite.prepare('SELECT * FROM v3_supplement_payments').get();
 assert.match(attempt.external_reference,/^SUP-/);
 const hold=db.sqlite.prepare('SELECT * FROM v2_checkout_holds WHERE id=?').get(attempt.hold_id);
 assert.equal(hold.order_id,null);assert.equal(hold.status,'active');
 assert.equal(service().points_units,points);
 await syncMercadoPagoOrder(env,'ORD1');
 assert.equal(db.sqlite.prepare('SELECT status FROM v2_checkout_holds WHERE id=?').get(hold.id).status,'active');
 mp.approve(attempt.provider_order_id);
 assert.equal((await syncV3SupplementPayment(env,attempt.provider_order_id)).applied,true);
 assert.equal((await syncV3SupplementPayment(env,attempt.provider_order_id)).alreadyApplied,true);
 assert.equal(service().points_units,points+100);
 assert.equal(service().commercial_snapshot_json,before.commercial_snapshot_json);
 assert.equal(service().production_status,'pending');
 assert.equal(service().briefing_status,'in_progress');
 assert.equal(service().reviewed_at,null);
 assert.equal(service().delivery_end,before.delivery_end);
 const scope=JSON.parse(service().effective_snapshot_json);
 assert.equal(scope.v3Extras.find(x=>x.code==='atelie_pose').quantity,2);
 assert.equal(db.sqlite.prepare('SELECT SUM(points_units) AS n FROM v2_agenda_allocations WHERE order_id=? AND service_family=?').get(order.orderId,family).n,points+100);
 assert.deepEqual(db.sqlite.prepare('SELECT * FROM v2_order_pricing WHERE order_id=?').get(order.orderId),original);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments WHERE order_id=?').get(order.orderId).n,1);
 assert.equal((await getV3ModularBriefing(db,token)).supplements[0].status,'paid');
});
test('supplement expiry releases only verified terminal charge and supports explicit renewal',async t=>{
 const {db,env,request,token,family,offer,mp}=await preparedSupplement(t);
 await startV3SupplementPayment(request,env,token,family,offer.id);
 const old=db.sqlite.prepare('SELECT * FROM v3_supplement_payments').get();
 db.sqlite.prepare("UPDATE v3_supplement_payments SET expires_at='2000-01-01T00:00:00Z'").run();
 assert.equal(db.sqlite.prepare('SELECT status FROM v2_checkout_holds WHERE id=?').get(old.hold_id).status,'active');
 assert.equal((await syncV3SupplementPayment(env,old.provider_order_id)).status,'cancelled');
 assert.equal(db.sqlite.prepare('SELECT status FROM v2_checkout_holds WHERE id=?').get(old.hold_id).status,'cancelled');
 await assert.rejects(startV3SupplementPayment(request,env,token,family,offer.id),/renovação/);
 assert.equal((await startV3SupplementPayment(request,env,token,family,offer.id,{renew:true})).status,'pending');
 assert.equal(mp.posts,3);
 await syncV3SupplementPayment(env,old.provider_order_id);
 assert.equal(db.sqlite.prepare('SELECT status FROM v3_service_supplements WHERE id=?').get(offer.id).status,'payment_pending');
});

test('private supplemental payment routes expose separate totals and require explicit confirmation',async t=>{
 const {db,order,env,token,family,offer,mp}=await preparedSupplement(t);
 const base='/api/v2/customer-area/'+token+'/v3/';
 const path='supplements/'+family+'/'+offer.id+'/';
 const call=(suffix,method='GET',body,settings=env)=>worker.fetch(new Request('https://test'+base+suffix,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})}),settings,{waitUntil(){}});
 const b=await (await call('briefing')).json();
 assert.equal(b.briefing.supplementPaymentsEnabled,true);
 assert.equal(b.briefing.supplements[0].paymentAvailable,true);
 assert.equal(b.briefing.financial.pendingSupplementCents,4000);
 assert.equal(b.briefing.financial.confirmedTotalCents,b.briefing.payment.totalCents);
 assert.equal((await call(path+'pay','POST',{})).status,422);
 assert.equal((await call(path+'pay','POST',{confirmed:true},{...env,LIBRI_V3_SUPPLEMENT_PAYMENT_ENABLED:'false'})).status,503);
 assert.equal(mp.posts,1);
 assert.equal((await call('supplements/convite/'+offer.id+'/pay','POST',{confirmed:true})).status,404);
 const p=await call(path+'pay','POST',{confirmed:true});assert.equal(p.status,200);
 const checkout=await p.json();assert.equal(checkout.result.status,'pending');
 assert.equal(checkout.briefing.supplements[0].canVerify,true);
 assert.ok(checkout.briefing.supplements[0].payment.checkoutUrl.startsWith('https://www.mercadopago.com.br/'));
 assert.equal(mp.posts,2);
 const attempt=db.sqlite.prepare('SELECT provider_order_id FROM v3_supplement_payments').get();
 mp.approve(attempt.provider_order_id);
 const response=await call(path+'verify','POST',{});assert.equal(response.status,200);
 const paid=await response.json();
 assert.equal(paid.briefing.financial.paidSupplementCents,4000);
 assert.equal(paid.briefing.financial.pendingSupplementCents,0);
 assert.equal(paid.briefing.financial.confirmedTotalCents,b.briefing.payment.totalCents+4000);
 assert.equal(paid.briefing.supplements[0].payment.checkoutUrl,null);
 assert.equal((await call(path+'verify','POST',{})).status,200);
 const old=await prepareV3Payment(new Request('https://test/internal-v3'),env,order.orderId);
 assert.equal(old.alreadyPaid,true);assert.equal(mp.posts,2);
});

test('paid upgrade absorbs covered extras, retains historical checkout and changes only effective scope',async t=>{
 const {db,order,env,request,token,family,offer,mp}=await preparedSupplement(t);
 await decideV3Supplement(db,token,family,offer.id,{action:'cancel'},'admin');
 await setAtelieSaleStatus(db,'encanto',true);
 const input={kind:'upgrade',productCode:'atelie_encanto',variantCode:'atelie_encanto_default',paymentMethod:'pix',note:'Upgrade',items:[]};
 const quote=await previewV3Supplement(db,token,family,input);
 assert.equal(quote.subtotalCents,14000);assert.equal(quote.pointsUnits,200);
 const next=await createV3Supplement(db,token,family,{...input,requestKey:'b'.repeat(36),expectedTotalCents:quote.totalCents});
 await assert.rejects(decideV3Supplement(db,token,family,next.id,{action:'accept',confirmed:true,expectedTotalCents:quote.totalCents}),/condições/);
 await decideV3Supplement(db,token,family,next.id,{action:'accept',confirmed:true,termsAccepted:true,expectedTotalCents:quote.totalCents});
 const original=db.sqlite.prepare('SELECT * FROM v2_order_pricing WHERE order_id=?').get(order.orderId);
 const serviceBefore=db.sqlite.prepare('SELECT * FROM v3_order_services WHERE order_id=? AND family=?').get(order.orderId,family);
 await startV3SupplementPayment(request,env,token,family,next.id);
 const charge=db.sqlite.prepare('SELECT provider_order_id FROM v3_supplement_payments WHERE supplement_id=?').get(next.id);
 mp.approve(charge.provider_order_id);
 assert.equal((await syncV3SupplementPayment(env,charge.provider_order_id)).applied,true);
 const after=db.sqlite.prepare('SELECT * FROM v3_order_services WHERE id=?').get(serviceBefore.id);
 assert.equal(after.product_code,'atelie_encanto');
 assert.equal(after.commercial_snapshot_json,serviceBefore.commercial_snapshot_json);
 assert.equal(after.total_cents,serviceBefore.total_cents);
 assert.equal(after.points_units,500);
 assert.deepEqual(db.sqlite.prepare('SELECT * FROM v2_order_pricing WHERE order_id=?').get(order.orderId),original);
 assert.equal((await prepareV3Payment(request,env,order.orderId)).alreadyPaid,true);
 assert.equal((await getV3ModularBriefing(db,token)).financial.paidSupplementCents,14000);
});
test('new service is created only after verified payment, preserves original service and original checkout',async t=>{
 const {db,order,env,request,token,family,offer,mp}=await preparedSupplement(t);
 await decideV3Supplement(db,token,family,offer.id,{action:'cancel'},'admin');
 db.sqlite.exec("UPDATE v3_retrospective_packages SET sale_enabled=1 WHERE code='RETRO_070'");
 const input={kind:'new_service',productCode:'retrospectiva_070',variantCode:'retrospectiva_070_default',paymentMethod:'pix',note:'Retrospectiva',items:[]};
 const first=await previewV3Supplement(db,token,family,input);
 assert.equal(first.requiresWindow,true);assert.ok(first.options.length);
 const selected={...input,deliveryWindow:first.options[0]};
 const q=await previewV3Supplement(db,token,family,selected);
 assert.equal(q.totalCents,14900);assert.equal(q.pointsUnits,200);
 const next=await createV3Supplement(db,token,family,{...selected,requestKey:'c'.repeat(36),expectedTotalCents:q.totalCents});
 await decideV3Supplement(db,token,family,next.id,{action:'accept',confirmed:true,termsAccepted:true,expectedTotalCents:q.totalCents});
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM v3_order_services WHERE order_id=?").get(order.orderId).n,2);
 const serviceBefore=db.sqlite.prepare('SELECT * FROM v3_order_services WHERE order_id=? AND family=?').get(order.orderId,family);
 await startV3SupplementPayment(request,env,token,family,next.id);
 const charge=db.sqlite.prepare('SELECT provider_order_id FROM v3_supplement_payments WHERE supplement_id=?').get(next.id);
 mp.approve(charge.provider_order_id);
 assert.equal((await syncV3SupplementPayment(env,charge.provider_order_id)).applied,true);
 assert.equal((await syncV3SupplementPayment(env,charge.provider_order_id)).alreadyApplied,true);
 const added=db.sqlite.prepare("SELECT * FROM v3_order_services WHERE order_id=? AND family='retrospectiva'").get(order.orderId);
 assert.equal(added.origin_supplement_id,next.id);assert.equal(added.briefing_status,'available');assert.equal(added.production_status,'pending');assert.equal(added.points_units,200);
 assert.deepEqual(db.sqlite.prepare('SELECT * FROM v3_order_services WHERE id=?').get(serviceBefore.id),serviceBefore);
 const b=await getV3ModularBriefing(db,token);
 assert.equal(b.financial.paidSupplementCents,14900);assert.ok(b.modules.some(m=>m.module==='retrospectiva'&&m.editable));
 assert.equal((await prepareV3Payment(request,env,order.orderId)).alreadyPaid,true);
 await syncMercadoPagoOrder(env,'ORD1');
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v3_order_services WHERE order_id=?').get(order.orderId).n,3);
});

import {changeV3AdminDeposit,recordV3AdminBalance,cancelV3UnpaidOrder,originalV3FinancialState} from '../src/lib/v3-admin-payment-policy.js';
test('administrator alone can authorize 50 percent after closing the earlier full Pix charge; balance is recorded once',async t=>{
 const {db,input}=await setup(),mp=providerMock(t),order=await createV3OrderRecords(db,input);
 const env={DB:db,MERCADO_PAGO_ACCESS_TOKEN:'TEST-token',LIBRI_V3_ADMIN_PAYMENT_ENABLED:'true'};
 const request=new Request('https://test/internal-v3');
 const first=await prepareV3Payment(request,env,order.orderId),total=first.totalCents;
 assert.equal(first.amountDueNowCents,total);
 await assert.rejects(changeV3AdminDeposit(env,order.orderCode,{depositPercent:50,reason:'Condição especial'}),/Confirme/);
 const changed=await changeV3AdminDeposit(env,order.orderCode,{depositPercent:50,reason:'Condição especial',confirmed:true});
 assert.equal(changed.depositCents,Math.ceil(total/2));
 assert.equal((await getV3ModularBriefing(db,order.publicToken)).locked,true);
 const second=await prepareV3Payment(request,env,order.orderId,{renew:true});
 assert.equal(second.amountDueNowCents,changed.depositCents);
 assert.notEqual(second.providerOrderId,first.providerOrderId);
 mp.approve(second.providerOrderId);
 await syncMercadoPagoOrder(env,second.providerOrderId);
 let brief=await getV3ModularBriefing(db,order.publicToken);
 assert.equal(brief.locked,false);assert.equal(brief.payment.remainingCents,changed.balanceCents);assert.equal(brief.payment.fullyPaid,false);
 assert.equal((await reconcileV3Payment(env,order.orderId)).alreadyPaid,true);
 await assert.rejects(changeV3AdminDeposit(env,order.orderCode,{depositPercent:100,reason:'Não permitido',confirmed:true}),/não pagos/);
 const paidDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const payload={confirmed:true,requestKey:'d'.repeat(36),amountCents:changed.balanceCents,paidDate,note:'Comprovante conferido'};
 await recordV3AdminBalance(env,order.orderCode,payload);
 assert.equal((await recordV3AdminBalance(env,order.orderCode,payload)).alreadyRecorded,true);
 brief=await getV3ModularBriefing(db,order.publicToken);
 assert.equal(brief.payment.fullyPaid,true);assert.equal(brief.payment.remainingCents,0);
 assert.equal((await originalV3FinancialState(db,order.orderId)).paidCents,total);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_payments WHERE order_id=? AND provider='direct_pix'").get(order.orderId).n,1);
});
test('verified unpaid cancellation ends remote charge and prevents renewal',async t=>{
 const {db,input}=await setup(),mp=providerMock(t),order=await createV3OrderRecords(db,input);
 const env={DB:db,MERCADO_PAGO_ACCESS_TOKEN:'TEST-token'},request=new Request('https://test/internal-v3');
 const first=await prepareV3Payment(request,env,order.orderId);
 await cancelV3UnpaidOrder(env,order.orderCode,{confirmed:true,reason:'Cliente desistiu'});
 assert.equal(db.sqlite.prepare('SELECT status FROM v2_orders WHERE id=?').get(order.orderId).status,'cancelled');
 assert.equal(db.sqlite.prepare('SELECT status FROM v2_payments WHERE provider_order_id=?').get(first.providerOrderId).status,'cancelled');
 assert.equal((await getV3ModularBriefing(db,order.publicToken)).locked,true);
 await assert.rejects(prepareV3Payment(request,env,order.orderId,{renew:true}),/disponível/);
 assert.equal(mp.posts,1);
});
import {getV2FinanceDashboard} from '../src/lib/v2-finance.js';
test('central financial dashboard counts the paid supplement separately and only once',async t=>{
 const {db,order,env,request,token,family,offer,mp}=await preparedSupplement(t);
 const before=await getV2FinanceDashboard(db,{preset:'year'});
 assert.equal(before.supplemental.pendingCents,4000);
 await startV3SupplementPayment(request,env,token,family,offer.id);
 const charge=db.sqlite.prepare('SELECT provider_order_id FROM v3_supplement_payments WHERE supplement_id=?').get(offer.id);
 mp.approve(charge.provider_order_id);await syncV3SupplementPayment(env,charge.provider_order_id);await syncV3SupplementPayment(env,charge.provider_order_id);
 const after=await getV2FinanceDashboard(db,{preset:'year'});
 assert.equal(after.supplemental.paidCents,4000);
 assert.equal(after.supplemental.paidCount,1);
 assert.equal(after.supplemental.pendingCents,0);
 assert.equal(after.summary.salesCents,before.summary.salesCents+4000);
 assert.equal(after.summary.cashInCents,before.summary.cashInCents+4000);
 assert.equal(after.summary.netCashMovementComplete,false);
 const paidAt='2026-10-03T12:00:00.000Z',refundAt='2026-11-03T12:00:00.000Z';
 const payment=db.sqlite.prepare('SELECT id,external_reference FROM v3_supplement_payments WHERE supplement_id=?').get(offer.id);
 db.sqlite.prepare("UPDATE v3_supplement_payments SET paid_at=?,status='review' WHERE id=?").run(paidAt,payment.id);
 db.sqlite.prepare("UPDATE v3_service_supplements SET status='review',applied_at=? WHERE id=?").run('2026-11-01T12:00:00.000Z',offer.id);
 const {getV3SupplementFinance,getV3RefundFinance}=await import('../src/lib/v3-finance-report.js');
 const oct={start:'2026-10-01T00:00:00.000Z',endExclusive:'2026-11-01T00:00:00.000Z'},nov={start:oct.endExclusive,endExclusive:'2026-12-01T00:00:00.000Z'};
 assert.equal((await getV3SupplementFinance(db,oct)).cashCents,4000);
 db.sqlite.prepare("INSERT INTO v3_paid_cancellations(order_id,status,reason,created_at) VALUES(?,'review','Teste',?)").run(order.orderId,refundAt);
 db.sqlite.prepare("INSERT INTO v3_cancellation_charges(order_id,charge_key,provider,provider_order_id,reference,amount_cents,original_paid_at,status,refund_key,refund_confirmed_at,updated_at) VALUES(?,?,?,?,?,?,?,'refunded',?,?,?)").run(order.orderId,'supplement:'+payment.id,'mercado_pago',charge.provider_order_id,payment.external_reference,4000,paidAt,'supp-test-refund',refundAt,refundAt);
 db.sqlite.prepare("UPDATE v3_supplement_payments SET status='refunded' WHERE id=?").run(payment.id);
 assert.equal((await getV3SupplementFinance(db,oct)).cashCents,4000);
 assert.equal((await getV3SupplementFinance(db,oct)).paidCents,0);
 assert.equal((await getV3SupplementFinance(db,nov)).paidCents,4000);
 assert.equal((await getV3SupplementFinance(db,nov)).cashCents,0);
 assert.equal((await getV3RefundFinance(db,nov)).refundCents,4000);
});

import {previewV3Revision,createV3Revision,acceptV3Revision} from '../src/lib/v3-order-revisions.js';
test('unpaid revision closes the previous charge, blocks renewal until customer acceptance and keeps order identity',async t=>{
 const {db,input}=await setup(),mp=providerMock(t),order=await createV3OrderRecords(db,input);
 const env={DB:db,MERCADO_PAGO_ACCESS_TOKEN:'TEST-token'},request=new Request('https://test/internal-v3');
 const first=await prepareV3Payment(request,env,order.orderId);
 const items=input.body.items.map(x=>x.productCode==='atelie_essencia'?{...x,extras:[{code:'atelie_pose',quantity:2}]}:x);
 const quote=await previewV3Revision(db,order.orderCode,{items});
 assert.equal(quote.totalCents,first.totalCents+4000);
 const r=await createV3Revision(env,order.orderCode,{items,deliveryWindow:quote.options[0],expectedTotalCents:quote.totalCents,requestKey:'f'.repeat(36),confirmed:true,reason:'Duas poses extras'});
 assert.equal(db.sqlite.prepare('SELECT total_cents FROM v2_order_pricing WHERE order_id=?').get(order.orderId).total_cents,first.totalCents);
 await assert.rejects(prepareV3Payment(request,env,order.orderId,{renew:true}),/Aceite/);
 assert.equal((await reconcileV3Payment(env,order.orderId)).revisionRequired,true);
 await assert.rejects(acceptV3Revision(db,order.publicToken,{id:r.id,confirmed:true,expectedTotalCents:quote.totalCents}),/aceite/);
 await acceptV3Revision(db,order.publicToken,{id:r.id,confirmed:true,termsAccepted:true,expectedTotalCents:quote.totalCents});
 const next=await prepareV3Payment(request,env,order.orderId,{renew:true});
 assert.equal(next.totalCents,quote.totalCents);assert.equal(mp.posts,2);assert.equal(next.orderCode,order.orderCode);
 mp.approve(next.providerOrderId);await syncMercadoPagoOrder(env,next.providerOrderId);
 assert.equal((await getV3ModularBriefing(db,order.publicToken)).locked,false);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n,1);
});

import {previewV3ManualOrder,createV3ManualOrder} from '../src/lib/v3-order-revisions.js';
test('manual V3 prepares a private order with optional authorized Pix deposit, never invents customer acceptance',async t=>{
 const {db}=await setup(),mp=providerMock(t),env={DB:db,MERCADO_PAGO_ACCESS_TOKEN:'TEST-token'};
 const input={customer:{name:'Cliente manual',whatsapp:'5561888888888',email:''},event:{type:'birthday',honoreeName:'Teste manual',date:day(65)},items:[{productCode:'atelie_essencia',variantCode:'atelie_essencia_default',addonCodes:[]}],paymentMethod:'pix',depositPercent:50,reason:'Condição especial autorizada'};
 const q=await previewV3ManualOrder(db,input);assert.equal(q.totalCents,15900);assert.equal(q.depositCents,7950);
 const payload={...input,deliveryWindow:q.options[0],expectedTotalCents:q.totalCents,requestKey:'9'.repeat(36),confirmed:true};
 const created=await createV3ManualOrder(env,payload),token=created.customerAreaPath.split('/').pop();
 assert.equal((await createV3ManualOrder(env,payload)).orderCode,created.orderCode);
 await assert.rejects(createV3ManualOrder(env,{...payload,reason:'Condição diferente'}),/já utilizado/);
 const o=db.sqlite.prepare('SELECT * FROM v2_orders WHERE public_token=?').get(token);assert.equal(o.source,'manual_whatsapp');
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_order_terms_acceptances WHERE order_id=?').get(o.id).n,0);
 assert.equal(mp.posts,0);
 const brief=await getV3ModularBriefing(db,token);assert.equal(brief.revision.kind,'manual');assert.equal(brief.revision.depositCents,7950);
 await assert.rejects(prepareV3Payment(new Request('https://test/manual'),env,o.id),/Aceite/);
 await acceptV3Revision(db,token,{id:brief.revision.id,confirmed:true,termsAccepted:true,expectedTotalCents:q.totalCents});
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_order_terms_acceptances WHERE order_id=?').get(o.id).n,1);
 const payment=await prepareV3Payment(new Request('https://test/manual'),env,o.id);
 assert.equal(payment.amountDueNowCents,7950);mp.approve(payment.providerOrderId);await syncMercadoPagoOrder(env,payment.providerOrderId);
 assert.equal((await getV3ModularBriefing(db,token)).locked,false);
});

import {openV3PaidCancellation,refreshV3Cancellation,refundV3CancellationCharge,finalizeV3PaidCancellation} from '../src/lib/v3-paid-cancellation.js';
test('paid cancellation suspends access, reconciles original and supplementary refunds once and releases only future capacity',async t=>{
 const {db,order,env,request,token,family,offer,mp}=await preparedSupplement(t);
 await startV3SupplementPayment(request,env,token,family,offer.id);
 const charge=db.sqlite.prepare('SELECT provider_order_id FROM v3_supplement_payments WHERE supplement_id=?').get(offer.id);
 mp.approve(charge.provider_order_id);await syncV3SupplementPayment(env,charge.provider_order_id);
 const allocations=()=>db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_agenda_allocations WHERE order_id=?').get(order.orderId).n;
 const before=allocations();
 await openV3PaidCancellation(env,order.orderCode,{confirmed:true,reason:'Cancelamento solicitado pela cliente'});
 assert.equal((await getV3ModularBriefing(db,token)).locked,true);
 assert.equal(allocations(),before);
 await assert.rejects(finalizeV3PaidCancellation(env,order.orderCode,{confirmed:true}),/sem devolução/);
 let state=await refreshV3Cancellation(env,order.orderCode);assert.equal(state.charges.length,2);assert.ok(state.charges.every(x=>x.status==='paid'));
 for(const x of state.charges){
  await assert.rejects(refundV3CancellationCharge(env,order.orderCode,{confirmed:true,chargeKey:x.key,amountCents:1}),/valor integral/);
  const payload={confirmed:true,chargeKey:x.key,amountCents:x.amountCents};
  await refundV3CancellationCharge(env,order.orderCode,payload);
  await refundV3CancellationCharge(env,order.orderCode,payload);
 }
 assert.equal(mp.refundKeys.size,2);
 state=await finalizeV3PaidCancellation(env,order.orderCode,{confirmed:true});
 assert.equal(state.status,'completed');assert.equal(state.refundCents,state.charges.reduce((n,x)=>n+x.amountCents,0));
 assert.equal(db.sqlite.prepare('SELECT status FROM v2_orders WHERE id=?').get(order.orderId).status,'cancelled');
 assert.equal(allocations(),0);
 assert.equal((await finalizeV3PaidCancellation(env,order.orderCode,{confirmed:true})).status,'completed');
 assert.equal((await getV3ModularBriefing(db,token)).cancellation.status,'completed');
});
test('partial refund or chargeback remains in review and prevents release',async t=>{
 const {db,order,env,mp}=await preparedSupplement(t);
 await openV3PaidCancellation(env,order.orderCode,{confirmed:true,reason:'Conferência de devolução'});
 Object.assign(mp.orders.get('ORD1'),{status:'processed',status_detail:'partially_refunded'});
 const s=await refreshV3Cancellation(env,order.orderCode);
 assert.equal(s.charges[0].status,'review');
 await assert.rejects(refundV3CancellationCharge(env,order.orderCode,{confirmed:true,chargeKey:s.charges[0].key,amountCents:s.charges[0].amountCents}),/não está elegível/);
 await assert.rejects(finalizeV3PaidCancellation(env,order.orderCode,{confirmed:true}),/sem devolução/);
 assert.equal(mp.refundKeys.size,0);
});

import {runV3ApprovalReminders,v3ServiceWhatsappActions} from '../src/lib/v3-service-reminders.js';
test('V3 approval reminders are per preview, deduplicated, stop after approval and never approve on silence',async t=>{
 const {db,order}=await paid(t),env={DB:db},family='identidade_visual';
 const s=db.sqlite.prepare('SELECT id FROM v3_order_services WHERE order_id=? AND family=?').get(order.orderId,family);
 const published='2026-10-01T12:00:00.000Z',deadline='2026-10-08T12:00:00.000Z';
 db.sqlite.prepare("UPDATE v3_order_services SET production_status='waiting_customer' WHERE id=?").run(s.id);
 const preview=db.sqlite.prepare("INSERT INTO v3_service_previews(service_id,version,r2_key,mime_type,size_bytes,published_at,adjustment_deadline) VALUES(?,1,'test-reminder-preview','image/png',8,?,?)").run(s.id,published,deadline);
 const run=(date)=>runV3ApprovalReminders(env,{now:new Date(date+'T12:00:00.000Z')});
 assert.equal((await run('2026-10-02')).created,0);
 assert.equal((await run('2026-10-04')).created,1);
 assert.equal((await run('2026-10-04')).created,0);
 assert.equal((await run('2026-10-07')).created,1);
 assert.equal((await run('2026-10-08')).created,1);
 assert.equal((await run('2026-10-09')).created,0);
 assert.equal(db.sqlite.prepare('SELECT production_status FROM v3_order_services WHERE id=?').get(s.id).production_status,'waiting_customer');
 assert.equal(db.sqlite.prepare('SELECT status FROM v3_service_previews WHERE id=?').get(Number(preview.lastInsertRowid)).status,'active');
 const client=await getV3ModularBriefing(db,order.publicToken);
 assert.equal(client.services.find(x=>x.family===family).whatsappActions,undefined);
 const {getV3AdminBriefing}=await import('../src/lib/v3-admin-briefing.js');
 const admin=await getV3AdminBriefing(db,order.publicToken);
 const action=admin.services.find(x=>x.family===family).whatsappActions[0];
 assert.equal(action.kind,'approval');
 assert.match(action.url,/^https:\/\/wa\.me\/5561999999999\?text=/);
 assert.ok(decodeURIComponent(action.url).includes(order.publicToken));
 assert.equal(v3ServiceWhatsappActions({service:{family,productionStatus:'waiting_customer',progress:{preview:{status:'active',adjustmentDeadline:deadline}}},customer:{whatsapp:'invalid'},order:{public_token:order.publicToken}}).length,0);
 db.sqlite.prepare("UPDATE v3_service_previews SET status='approved' WHERE id=?").run(Number(preview.lastInsertRowid));
 db.sqlite.prepare("UPDATE v3_order_services SET production_status='approved' WHERE id=?").run(s.id);
 assert.equal((await run('2026-10-09')).resolved,3);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_notifications WHERE event_code='V3_APPROVAL_REMINDER' AND resolved_at IS NULL").get().n,0);
});

test('V3 individual delivery reminders use confirmed service date and resolve after delivery',async t=>{
 const {db,order}=await paid(t);
 const s=db.sqlite.prepare("SELECT id FROM v3_order_services WHERE order_id=? AND family='identidade_visual'").get(order.orderId);
 db.sqlite.prepare("UPDATE v3_order_services SET production_status='ready',scheduled_at=?,delivery_start=?,delivery_end=? WHERE id=?").run('2026-10-01T12:00:00.000Z','2026-10-07','2026-10-08',s.id);
 const {runV3DeliveryDeadlineReminders}=await import('../src/lib/v3-service-reminders.js');
 const run=()=>runV3DeliveryDeadlineReminders({DB:db},{now:new Date('2026-10-07T12:00:00.000Z')});
 assert.equal((await run()).created,1);
 assert.equal((await run()).created,0);
 db.sqlite.prepare("UPDATE v3_order_services SET production_status='delivered' WHERE id=?").run(s.id);
 assert.equal((await run()).resolved,1);
});

test('unified Admin search finds all modular services without duplicate orders',async t=>{
 const {db,order}=await paid(t);
 const {searchV2AdminOrders}=await import('../src/lib/v2-admin-search.js');
 const all=await searchV2AdminOrders(db,{q:order.orderCode});
 assert.equal(all.length,1);assert.equal(all[0].modular,true);
 assert.equal(all[0].services.length,2);
 assert.equal((await searchV2AdminOrders(db,{family:'identidade_visual',product:'atelie_essencia'})).length,1);
 assert.equal((await searchV2AdminOrders(db,{family:'retrospectiva'})).length,0);
 assert.equal((await searchV2AdminOrders(db,{family:'convite',product:'atelie_essencia'})).length,0);
 assert.equal((await searchV2AdminOrders(db,{eventDate:'2000-01-01'})).length,0);
 const id=db.sqlite.prepare("SELECT id FROM v3_order_services WHERE family='identidade_visual'").get().id;
 db.sqlite.prepare("UPDATE v3_order_services SET production_status='waiting_customer' WHERE id=?").run(id);
 assert.equal((await searchV2AdminOrders(db,{status:'waiting_customer'}))[0].status,'waiting_customer');
 assert.equal((await searchV2AdminOrders(db,{family:'identidade_visual',status:'waiting_customer'})).length,1);
 assert.equal((await searchV2AdminOrders(db,{family:'convite',status:'waiting_customer'})).length,0);
 assert.equal((await searchV2AdminOrders(db,{family:'convite',status:'briefing_pending'})).length,1);
 const {getV2Central}=await import('../src/lib/v2-admin-core.js');
 const central=await getV2Central(db);
 assert.equal(central.modularOrders.length,1);
 assert.equal(central.attention.some(x=>x.code===order.orderCode),false);
 assert.equal(central.newOrders.some(x=>x.code===order.orderCode),false);
});

test('funnel counts payment only from verified order and deduplicates linked checkout',async t=>{
 const {db,input}=await setup(),mp=providerMock(t),order=await createV3OrderRecords(db,input),env={DB:db,MERCADO_PAGO_ACCESS_TOKEN:'TEST-token'};
 const {recordStoreStage,linkStoreOrder,getStoreFunnel}=await import('../src/lib/v3-store-funnel.js');
 const id='c'.repeat(32);await recordStoreStage(db,id,'pagamento');await linkStoreOrder(db,id,order.orderId);await linkStoreOrder(db,id,order.orderId);
 let funnel=await getStoreFunnel(db);assert.equal(funnel.total,1);assert.equal(funnel.outcomes.order_pending,1);assert.equal(funnel.outcomes.paid,0);
 const payment=await prepareV3Payment(new Request('https://test/internal-v3'),env,order.orderId);
 funnel=await getStoreFunnel(db);assert.equal(funnel.outcomes.order_pending,1);
 mp.approve(payment.providerOrderId);await syncMercadoPagoOrder(env,payment.providerOrderId);
 funnel=await getStoreFunnel(db);assert.equal(funnel.total,1);assert.equal(funnel.outcomes.paid,1);assert.equal(funnel.outcomes.order_pending,0);
 assert.equal(funnel.stages.find(x=>x.stage==='pagamento').reached,1);
});

test('finance allocates original multi-service revenue exactly once',async t=>{
 const {db,order}=await paid(t);
 const {getV2FinanceDashboard,allocateFinanceCents}=await import('../src/lib/v2-finance.js');
 assert.deepEqual(allocateFinanceCents(101,[1,1,1]),[34,34,33]);
 const f=await getV2FinanceDashboard(db,{preset:'year'});
 assert.equal(f.breakdown.byProduct.length,2);
 assert.equal(f.breakdown.byProduct.reduce((n,x)=>n+x.salesCents,0),f.summary.originalSalesCents);
 assert.equal(f.breakdown.byProduct.reduce((n,x)=>n+x.receivedGrossCents,0),f.summary.originalCashInCents);
 assert.equal(f.summary.salesCount,1);
});

test('released future capacity preserves other services and permits dependent scheduling',async t=>{
 const {db,order}=await paid(t);
 const family='identidade_visual',token=order.publicToken;
 const {releaseV3ServiceCapacity,getV3CapacityRelease}=await import('../src/lib/v3-service-agenda.js');
 db.sqlite.prepare("UPDATE v3_order_services SET briefing_status='completed',reviewed_at=datetime('now') WHERE order_id=?").run(order.orderId);
 const preview=await previewV3ServiceAgenda(db,token,family,{});
 await scheduleV3Service(db,token,family,{...preview.options[0],confirmed:true});
 const other=()=>db.sqlite.prepare("SELECT day,points_units FROM v2_agenda_allocations WHERE order_id=? AND service_family='convite' ORDER BY day,id").all(order.orderId);
 const previous=other();
 const identity=()=>db.sqlite.prepare("SELECT * FROM v3_order_services WHERE order_id=? AND family=?").get(order.orderId,family);
 await assert.rejects(releaseV3ServiceCapacity(db,token,family,{confirmed:true,expectedUnits:300}),/entregues/);
 db.sqlite.prepare("UPDATE v3_order_services SET production_status='delivered',delivered_at=datetime('now') WHERE id=?").run(identity().id);
 assert.equal((await getV3CapacityRelease(db,identity())).availableUnits,300);
 await assert.rejects(releaseV3ServiceCapacity(db,token,family,{confirmed:true,expectedUnits:299}),/mudou/);
 const released=await releaseV3ServiceCapacity(db,token,family,{confirmed:true,expectedUnits:300});
 assert.equal(released.releasedUnits,300);
 assert.deepEqual(other(),previous);
 assert.equal(identity().points_units,300);
 assert.equal(identity().released_points_units,300);
 assert.equal(db.sqlite.prepare('SELECT SUM(points_units) AS n FROM v3_service_capacity_releases WHERE service_id=?').get(identity().id).n,300);
 await assert.rejects(releaseV3ServiceCapacity(db,token,family,{confirmed:true,expectedUnits:300}),/mudou/);
 const next=await previewV3ServiceAgenda(db,token,'convite',{dependsOnIdentity:true});
 assert.ok(next.options.length);
 await scheduleV3Service(db,token,'convite',{...next.options[0],dependsOnIdentity:true,confirmed:true});
 assert.equal(db.sqlite.prepare('SELECT SUM(points_units) AS n FROM v2_agenda_allocations WHERE order_id=?').get(order.orderId).n,100);
 assert.equal(identity().released_points_units,300);
});

test('central shows new modular work and distinguishes pending payment from reviewed exceptions',async t=>{
 const {db,order}=await paid(t);
 const {getV2Central}=await import('../src/lib/v2-admin-core.js');
 let c=await getV2Central(db);
 assert.equal(c.modularQueues.newOrders.filter(x=>x.code===order.orderCode).length,1);
 assert.equal(c.newOrders.some(x=>x.code===order.orderCode),false);
 assert.equal(c.modularQueues.pendingPayments.length,0);
 db.sqlite.prepare("UPDATE v3_order_services SET production_status='in_production' WHERE order_id=?").run(order.orderId);
 c=await getV2Central(db);assert.equal(c.modularQueues.newOrders.length,0);
 db.sqlite.prepare("INSERT INTO v3_paid_cancellations(order_id,status,reason,created_at) VALUES(?,'review','Teste',datetime('now'))").run(order.orderId);
 c=await getV2Central(db);assert.equal(c.modularQueues.exceptions[0].status,'cancellation_review');
 assert.equal(c.modularQueues.pendingPayments.length,0);
});
test('V3 notification preferences are visible and bell suppression does not delete history',async()=>{
 const db=database();
 const {getV2NotificationPreferences,updateV2NotificationPreference,createV2AdminNotification,listV2AdminNotifications}=await import('../src/lib/v2-notifications.js');
 const code='V3_APPROVAL_REMINDER';
 assert.ok((await getV2NotificationPreferences(db)).some(p=>p.eventCode===code&&p.bellEnabled&&p.pushEnabled));
 await updateV2NotificationPreference(db,code,{bellEnabled:false,pushEnabled:true});
 const result=await createV2AdminNotification({DB:db},{eventCode:code,title:'Prévia',body:'Teste',dedupeKey:'v3-pref-test'});
 assert.equal(result.created,true);
 assert.equal((await listV2AdminNotifications(db)).unreadCount,0);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_notifications WHERE event_code=?").get(code).n,1);
 await updateV2NotificationPreference(db,code,{bellEnabled:true,pushEnabled:false});
 assert.equal((await listV2AdminNotifications(db)).unreadCount,1);
});

test('late V3 payment preserves production minimum and permits capacity recovery without charging again',async t=>{
 const {db,input}=await setup(),mp=providerMock(t),order=await createV3OrderRecords(db,input),env={DB:db,MERCADO_PAGO_ACCESS_TOKEN:'TEST-token'};
 const payment=await prepareV3Payment(new Request('https://test/internal-v3'),env,order.orderId);
 db.sqlite.prepare("UPDATE v2_checkout_holds SET expires_at='2000-01-01T00:00:00Z',status='expired' WHERE order_id=?").run(order.orderId);
 db.sqlite.prepare('UPDATE v2_orders SET delivery_start=?,delivery_end=? WHERE id=?').run(day(2),day(4),order.orderId);
 mp.approve(payment.providerOrderId);const sync=await syncMercadoPagoOrder(env,payment.providerOrderId);assert.equal(sync.capacityReview,true);
 const b=await getV3ModularBriefing(db,order.publicToken);assert.equal(b.locked,false);assert.equal(b.capacityReview,true);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_agenda_allocations WHERE order_id=?').get(order.orderId).n,0);
 const {recoverV3PaidCapacity}=await import('../src/lib/v3-admin-briefing.js');
 await assert.rejects(recoverV3PaidCapacity(db,order.publicToken,{confirmed:true}),/capacidade/);
 const window=input.body.deliveryWindow;
 await assert.rejects(recoverV3PaidCapacity(db,order.publicToken,{confirmed:true,deliveryWindow:window}),/acordo/);
 await recoverV3PaidCapacity(db,order.publicToken,{confirmed:true,deliveryWindow:window,note:'Cliente aceitou a nova previsão.'});
 const after=await getV3ModularBriefing(db,order.publicToken);assert.equal(after.capacityReview,false);assert.equal(after.deliveryWindow.start,window.start);
 assert.equal(db.sqlite.prepare('SELECT SUM(points_units) AS n FROM v2_agenda_allocations WHERE order_id=?').get(order.orderId).n,400);
 assert.equal(mp.posts,1);
 await assert.rejects(recoverV3PaidCapacity(db,order.publicToken,{confirmed:true}),/disponível/);
});
