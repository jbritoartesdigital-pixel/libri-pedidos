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
