import {getV3Cancellation} from './v3-paid-cancellation.js';
import {pendingV3Revision} from './v3-order-revisions.js';
import {originalV3FinancialState} from './v3-admin-payment-policy.js';
// Internal modular briefing model. Public routes, authenticated Admin receipt
// action, invite/Ateliê private upload integration and final submission follow.
// Retrospectiva never creates R2 objects; only receipt metadata is persisted.
import {normalizePixPhoneKey,validPixKey} from './v2-customer-area.js';
import {buildV3ModuleSchema,retroSpec} from '../../public/js/briefing-schema-v3.v119.js';
export {buildV3ModuleSchema};
import {listV3Supplements,getV3SupplementTotals} from './v3-service-supplements.js';
import {summarizeV3Order} from './v3-order-overview.js';
import {getV3Delivery} from './v3-service-delivery.js';
import {getV3ServiceProgress} from './v3-service-production.js';
import {withV2PaymentLock} from './v2-payment-lock.js';
const fail=(message,status=422)=>{const e=new Error(message);e.status=status;throw e;};
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
const parse=v=>JSON.parse(v||'{}');
const field=(key,label,type='text',options={})=>({key,label,type,...options});
const section=(id,title,fields)=>({id,title,fields});
import {pendingPaidCapacityReview} from './v2-capacity-review.js';
const filled=v=>Array.isArray(v)?v.length>0:v!==null&&v!==undefined&&String(v).trim()!=='';
export async function contextV3Briefing(db,token){
  const order=await db.prepare(`SELECT o.*,p.total_cents,p.payment_method,p.deposit_percent,p.balance_cents
    FROM v2_orders o JOIN v3_order_checkout_snapshots s ON s.order_id=o.id
    JOIN v2_order_pricing p ON p.order_id=o.id WHERE o.public_token=?`).bind(token).first();
  if(!order)return null;
  const services=(await db.prepare('SELECT * FROM v3_order_services WHERE order_id=? ORDER BY id').bind(order.id).all()).results.map(s=>({...s,snapshot:parse(s.effective_snapshot_json||s.commercial_snapshot_json)}));
  const finance=await originalV3FinancialState(db,order.id);
  const paid=finance?.depositConfirmed===true;
  const cancellation=await getV3Cancellation(db,order.id);
  const locked=!!cancellation||!paid||order.briefing_status==='locked'||['configuring','awaiting_payment','cancelled'].includes(order.status);
  const drafts=Object.create(null),revisions=Object.create(null);
  if(!locked){
    for(const r of (await db.prepare('SELECT module,data_json,revision FROM v3_order_briefing_drafts WHERE order_id=?').bind(order.id).all()).results){
      drafts[r.module]=parse(r.data_json);revisions[r.module]=r.revision;
    }
  }
  return {order,services,locked,drafts,revisions,finance,cancellation};
}
export async function getV3ModularBriefing(db,token){
  const ctx=await contextV3Briefing(db,token);
  if(!ctx)return null;
  const {order,services,locked,drafts,revisions,finance,cancellation}=ctx;
  const purchased=services.map(s=>({family:s.family,briefingStatus:s.briefing_status,productionStatus:s.production_status,productName:s.snapshot.product.name,
    variantName:s.snapshot.variant?.label||'',submittedAt:s.briefing_submitted_at,complementNote:s.complement_note,reviewedAt:s.reviewed_at,deliveryWindow:s.delivery_start?{start:s.delivery_start,end:s.delivery_end}:null,scheduledAt:s.scheduled_at,dependsOnIdentity:s.depends_on_identity===null?null:Boolean(s.depends_on_identity),totalCents:s.effective_snapshot_json?s.snapshot.totalCents:s.total_cents,originalTotalCents:s.total_cents,productionDays:s.production_days,
    blackLibri:s.snapshot.blackLibri||null,extras:(s.snapshot.v3Extras||[]).map(x=>({name:x.name,quantity:x.quantity,totalCents:x.totalCents}))}));
  const urgency=await db.prepare('SELECT status,urgency_percent AS percent,decision_note AS note,requested_delivery_start AS start,requested_delivery_end AS end FROM v2_urgency_requests WHERE order_id=?').bind(order.id).first();
  const capacityReview=!locked&&await pendingPaidCapacityReview(db,order.id);
  const base={cancellation,urgency,capacityReview,orderCode:order.order_code,locked,orderStatus:order.status,aggregate:summarizeV3Order(services,{locked,orderStatus:order.status,capacityReview}),payment:{totalCents:order.total_cents,method:order.payment_method,depositPercent:order.deposit_percent,depositCents:finance?.row.deposit_cents,receivedCents:finance?.paidCents||0,remainingCents:finance?.remainingCents??order.total_cents,fullyPaid:!!finance?.fullyPaid},
    deliveryWindow:{start:order.delivery_start,end:order.delivery_end,provisional:services.some(s=>s.production_days>0)},event:{honoreeName:order.honoree_display_name,date:order.event_date,type:order.event_type},services:purchased};
  if(locked)return {...base,modules:[],revision:await pendingV3Revision(db,order.id)};
  for(let i=0;i<services.length;i++){purchased[i].progress=await getV3ServiceProgress(db,services[i]);purchased[i].delivery=await getV3Delivery(db,services[i]);}
  const modules=['shared',...services.map(s=>s.family)].map(module=>({
    module,revision:revisions[module]||0,data:drafts[module]||{},editable:['available','in_progress'].includes(order.briefing_status)&&['briefing_pending','waiting_customer'].includes(order.status)&&
      (module==='shared'?!services.some(s=>s.briefing_status==='completed'):services.some(s=>s.family===module&&['available','in_progress'].includes(s.briefing_status))),schema:buildV3ModuleSchema(order,services,module,drafts)
  }));
  const uploads=(await db.prepare('SELECT id,family,field_key,original_filename,mime_type,size_bytes FROM v3_service_uploads WHERE order_id=? ORDER BY id').bind(order.id).all()).results||[];
  for(const m of modules){
    m.uploads=uploads.filter(u=>u.family===m.module&&services.some(s=>s.family===m.module&&(!s.originals_until||Date.now()<Date.parse(s.originals_until)))).map(u=>({id:u.id,fieldKey:u.field_key,originalFilename:u.original_filename,mimeType:u.mime_type,sizeBytes:u.size_bytes,
      contentPath:'/api/v2/customer-area/'+token+'/v3/briefing/'+u.family+'/uploads/'+u.id+'/content'}));
  }
  const setting=await db.prepare("SELECT value FROM v2_settings WHERE key='libri_whatsapp'").first();
  const phone=String(setting?.value||'').replace(/\D/g,'');
  const allSent=services.length>0&&services.every(s=>s.briefing_status==='completed');
  const briefingWhatsappUrl=allSent&&/^\d{10,15}$/.test(phone)?'https://wa.me/'+phone+'?text='+encodeURIComponent('Oi, Ju! 💛 Finalizei o preenchimento dos dados do pedido '+order.order_code+', de '+order.honoree_display_name+'. Já enviei o briefing pelo portal da Libri.'):null;
  const retro=modules.find(m=>m.module==='retrospectiva');
  if(retro){
    const text='Olá! Vou enviar os materiais da retrospectiva do pedido '+order.order_code+'.';
    retro.schema.materials.whatsappUrl=/^\d{10,15}$/.test(phone)?'https://wa.me/'+phone+'?text='+encodeURIComponent(text):null;
    retro.receipt=await db.prepare('SELECT photo_count AS photoCount,video_count AS videoCount,video_durations_json AS videoDurationsJson,raw_video_seconds AS rawVideoSeconds,received_at AS receivedAt,complete_at AS completeAt FROM v3_retro_material_receipts WHERE order_id=?').bind(order.id).first();
  }
  const schemaContext={order:{event_type:order.event_type,honoree_display_name:order.honoree_display_name,event_date:order.event_date},services:services.map(s=>({family:s.family,product_code:s.product_code,origin_supplement_id:!!s.origin_supplement_id,snapshot:{product:{code:s.snapshot.product.code,name:s.snapshot.product.name},addons:(s.snapshot.addons||[]).map(a=>({code:a.code,name:a.name})),variant:{config:s.family==='identidade_visual'?{atelie:{contractedApplications:s.snapshot.variant?.config?.atelie?.contractedApplications||[],includedMascotPoses:s.snapshot.variant?.config?.atelie?.includedMascotPoses}}:s.family==='retrospectiva'?{retrospective:s.snapshot.variant?.config?.retrospective}:{}},v3Extras:(s.snapshot.v3Extras||[]).map(x=>({code:x.code,quantity:x.quantity})),blackLibri:s.snapshot.blackLibri?.gift?{gift:{name:s.snapshot.blackLibri.gift.name,config:{giftOnly:s.snapshot.blackLibri.gift.config?.giftOnly,blackLibriPrizeCode:s.snapshot.blackLibri.gift.config?.blackLibriPrizeCode}}}:null}}))};
  return {...base,modules,schemaContext,briefingWhatsappUrl,supplements:await listV3Supplements(db,order.id),financial:await getV3SupplementTotals(db,order.id,order.total_cents)};
}
function normalizeField(f,value){
  if(!filled(value))return f.type==='multi_choice'?[]:'';
  if(['choice','multi_choice'].includes(f.type)){
    const options=(f.options||[]).map(x=>typeof x==='string'?x:x.value);
    if(f.type==='multi_choice'){
      if(!Array.isArray(value)||value.some(x=>typeof x!=='string'||!options.includes(x))||
        (Number.isInteger(f.max)&&new Set(value).size>f.max))fail('Opção inválida: '+f.label);
      return [...new Set(value)];
    }
    if(typeof value!=='string'||!options.includes(value))fail('Opção inválida: '+f.label);
    return value;
  }
  if(f.type==='number'){
    if(typeof value!=='string'&&typeof value!=='number')fail('Número inválido: '+f.label);
    if(!/^\d+$/.test(String(value)))fail('Número inválido: '+f.label);
    const n=Number(value);
    if(!Number.isSafeInteger(n)||(f.min!=null&&n<f.min)||(f.max!=null&&n>f.max))fail('Número inválido: '+f.label);
    return n;
  }
  if(typeof value!=='string'||value.length>(f.type==='textarea'?12000:2000))fail('Resposta inválida: '+f.label);
  return value.trim();
}
export async function saveV3ModuleDraft(db,token,module,payload={}, {actor='customer'}={}){
  const initial=await contextV3Briefing(db,token);
  if(!initial)return null;
  return withV2PaymentLock(db,initial.order.id,async()=>{
    const ctx=await contextV3Briefing(db,token);
    if(!ctx||ctx.locked)fail('O briefing será liberado após o pagamento.',403);
    if(ctx.order.archived_at)fail('Restaure o pedido antes de editar.',409);
    const administrative=actor==='admin';
    const affected=module==='shared'?ctx.services:ctx.services.filter(s=>s.family===module);
    if(administrative&&(!affected.length||affected.some(s=>s.production_status!=='pending')))fail('A edição administrativa exige produção ainda pendente.',409);
    if(!['available','in_progress'].includes(ctx.order.briefing_status)||!['briefing_pending','waiting_customer'].includes(ctx.order.status))
      fail('O briefing não está disponível para edição.',409);
    if(!administrative&&module==='shared'&&ctx.services.some(s=>s.briefing_status==='completed'))fail('Os dados compartilhados já foram usados em um briefing enviado. Solicite uma alteração à Libri.',409);
    if(module!=='shared'&&!ctx.services.some(s=>s.family===module&&(['available','in_progress'].includes(s.briefing_status)||(administrative&&s.briefing_status==='completed'))))
      fail('Este serviço não permite edição.',409);
    if(!obj(payload.data)||JSON.stringify(payload.data).length>90000||!Number.isSafeInteger(payload.revision)||payload.revision<0)
      fail('Dados inválidos.');
    if(payload.revision!==(ctx.revisions[module]||0))fail('O briefing mudou. Atualize antes de salvar.',409);
    // Build conditional schema from proposed choices, then accept only visible
    // fields. Hidden branches and file objects cannot be persisted as answers.
    const proposed={...ctx.drafts,[module]:payload.data};
    const schema=buildV3ModuleSchema(ctx.order,ctx.services,module,proposed);
    const data=Object.create(null);
    for(const f of schema.sections.flatMap(s=>s.fields)){
      if(['info','upload'].includes(f.type))continue;
      if(Object.hasOwn(payload.data,f.key))data[f.key]=normalizeField(f,payload.data[f.key]);
    }
    if(module==='convite'){
      if(data.pix_key_type==='phone'&&data.pix_key)data.pix_key=normalizePixPhoneKey(data.pix_key);
      const previous=ctx.drafts.convite||{};
      // Preserve historical optional answers; no longer expose or solicit these in invitations.
      for(const key of ['additional_illustrated_subjects','additional_illustrated_subjects_details'])if(Object.hasOwn(previous,key))data[key]=previous[key];
      // Preserve server-recorded or historical permission, never accept it via draft payload.
      if(['sim','não'].includes(previous.private_photo_authorization))data.private_photo_authorization=previous.private_photo_authorization;
      if(['pix_key_type','pix_key','pix_holder'].some(k=>String(data[k]??'')!==String(previous[k]??'')))delete data.pix_confirmed;
    }
    const result=await db.prepare(`INSERT INTO v3_order_briefing_drafts(order_id,module,data_json,revision,updated_at)
      VALUES(?,?,?,1,datetime('now')) ON CONFLICT(order_id,module) DO UPDATE SET data_json=excluded.data_json,
      revision=revision+1,updated_at=datetime('now') WHERE revision=?`).bind(ctx.order.id,module,JSON.stringify(data),payload.revision).run();
    if(Number(result.meta?.changes)!==1)fail('O briefing mudou. Atualize antes de salvar.',409);
    if(administrative){
      for(const s of affected)await db.prepare("UPDATE v3_order_services SET briefing_status='in_progress',reviewed_at=NULL,updated_at=datetime('now') WHERE id=? AND briefing_status IN ('available','completed','in_progress')").bind(s.id).run();
      await db.prepare("INSERT INTO v2_order_history(order_id,action_code,description,metadata_json,created_at) VALUES(?,'v3_admin_briefing_saved','Dados do briefing preenchidos pela administração.',?,datetime('now'))").bind(ctx.order.id,JSON.stringify({module})).run();
    }else if(module!=='shared')await db.prepare("UPDATE v3_order_services SET briefing_status='in_progress' WHERE order_id=? AND family=? AND briefing_status='available'").bind(ctx.order.id,module).run();
    return getV3ModularBriefing(db,token);
  });
}
// Called only from authenticated Admin in the future. A WhatsApp click or
// customer assertion is not receipt confirmation, and does not start production.
export async function recordV3RetroMaterialReceipt(db,orderId,{photoCount,videoCount,videoDurations,rawVideoSeconds=0,note='',complete=false}={}){
  if(!Number.isSafeInteger(orderId)||!Number.isSafeInteger(photoCount)||!Number.isSafeInteger(videoCount)||photoCount<0||videoCount<0||photoCount+videoCount===0||
    typeof complete!=='boolean'||typeof note!=='string'||note.length>500)fail('Informe os materiais efetivamente recebidos.');
  return withV2PaymentLock(db,orderId,async()=>{
    const row=await db.prepare(`SELECT COALESCE(s.effective_snapshot_json,s.commercial_snapshot_json) AS commercial_snapshot_json,s.production_status,s.briefing_status AS service_briefing_status,o.status,o.briefing_status,o.public_token
      FROM v3_order_services s JOIN v2_orders o ON o.id=s.order_id WHERE s.order_id=? AND s.family='retrospectiva'`).bind(orderId).first();
    if(!row)fail('Retrospectiva não contratada.',404);
    const ctx=await contextV3Briefing(db,row.public_token);
    if(!ctx||ctx.locked||row.production_status!=='pending'||!['available','in_progress','completed'].includes(row.service_briefing_status)||!['briefing_pending','waiting_customer'].includes(row.status))
      fail('Pedido indisponível para confirmação de materiais.',409);
    const spec=retroSpec(parse(row.commercial_snapshot_json));
    if(photoCount>spec.maxPhotos||videoCount>spec.maxVideos)fail('Os materiais excedem o limite contratado. Avalie um adicional antes de confirmar.');
    if(!Number.isSafeInteger(rawVideoSeconds)||rawVideoSeconds<0||rawVideoSeconds>spec.rawVideoSeconds)fail('Material bruto excede o limite contratado.');
    if(spec.maxVideoSeconds&&(!Array.isArray(videoDurations)||videoDurations.length!==videoCount||videoDurations.some(x=>!Number.isSafeInteger(x)||x<1||x>spec.maxVideoSeconds)||videoDurations.reduce((n,x)=>n+x,0)>spec.maxTotalVideoSeconds))
      fail('Confira a duração de cada vídeo e o limite acumulado contratado.');
    const durations=spec.maxVideoSeconds?videoDurations:[];
    await db.prepare(`INSERT INTO v3_retro_material_receipts(order_id,photo_count,video_count,received_at,note,video_durations_json,raw_video_seconds,complete_at)
      VALUES(?,?,?,datetime('now'),?,?,?,CASE WHEN ?=1 THEN datetime('now') ELSE NULL END) ON CONFLICT(order_id) DO UPDATE SET photo_count=excluded.photo_count,
      video_count=excluded.video_count,received_at=excluded.received_at,note=excluded.note,video_durations_json=excluded.video_durations_json,raw_video_seconds=excluded.raw_video_seconds,complete_at=excluded.complete_at`).bind(orderId,photoCount,videoCount,note.trim(),JSON.stringify(durations),rawVideoSeconds,complete?1:0).run();
    await db.prepare("UPDATE v3_order_services SET reviewed_at=NULL WHERE order_id=? AND family='retrospectiva'").bind(orderId).run();
    return {photoCount,videoCount,videoDurations:durations,rawVideoSeconds,received:true,complete};
  });
}

export async function submitV3ServiceBriefing(db,token,family,payload={}, {actor='customer'}={}){
  const initial=await contextV3Briefing(db,token);
  if(!initial)return null;
  return withV2PaymentLock(db,initial.order.id,async()=>{
    const ctx=await contextV3Briefing(db,token);
    if(!ctx||ctx.locked)fail('O briefing será liberado após o pagamento.',403);
    const service=ctx.services.find(s=>s.family===family);
    if(!service)fail('Serviço não contratado.',404);
    if(service.briefing_status==='completed')return getV3ModularBriefing(db,token);
    if(!['available','in_progress'].includes(service.briefing_status)||!['briefing_pending','waiting_customer'].includes(ctx.order.status))
      fail('Este briefing não permite envio.',409);
    if(!Number.isSafeInteger(payload.revision)||payload.revision!==(ctx.revisions[family]||0)||
      !Number.isSafeInteger(payload.sharedRevision)||payload.sharedRevision!==(ctx.revisions.shared||0))
      fail('As respostas mudaram. Atualize o briefing antes de enviar.',409);
    const missing=[],fields=[];
    const addMissing=(module,key,label,kind='field')=>{missing.push(label);fields.push({module,key,label,kind});};
    for(const module of ['shared',family]){
      const schema=buildV3ModuleSchema(ctx.order,ctx.services,module,ctx.drafts);
      const data=ctx.drafts[module]||{};
      for(const f of schema.sections.flatMap(s=>s.fields)){
        if(f.required&&!['info','upload'].includes(f.type)&&!filled(data[f.key]))addMissing(module,f.key,f.label);
      }
      for(const rule of schema.uploadRules||[]){
        if(rule.min>0){
          const row=await db.prepare('SELECT COUNT(*) AS n FROM v3_service_uploads WHERE order_id=? AND family=? AND field_key=?').bind(ctx.order.id,module,rule.fieldKey).first();
          if(!rule.authorized||Number(row.n)<rule.min)addMissing(module,rule.fieldKey,rule.label+': envie pelo menos '+rule.min+' imagem(ns).','upload');
        }
      }
    }
    const data=ctx.drafts[family]||{};
    if(family==='convite'&&['pix','both'].includes(data.gift_mode)&&!validPixKey(data.pix_key_type,data.pix_key))addMissing(family,'pix_key','Confira o formato da chave Pix informada.');
    const prize=service.snapshot.blackLibri?.gift?.config?.blackLibriPrizeCode;
    if(['mini_retrospective','child_birthday'].includes(prize)){
      if(data.black_gift_media_authorization!=='sim')addMissing(family,'black_gift_media_authorization','Autorização para as fotos do presente Black Libri.');
      if(data.black_gift_media_sent!=='sim')addMissing(family,'black_gift_media_sent','Envio das fotos do presente pelo WhatsApp.');
    }
    if(family==='retrospectiva'&&data.media_authorization!=='sim')addMissing(family,'media_authorization','Autorização para uso das fotos e vídeos.');
    if(family==='identidade_visual'&&data.mascotMode==='criança ilustrada'&&(data.childPhotoPermission!=='sim'||data.guardianAuthorization!=='sim'))addMissing(family,data.childPhotoPermission!=='sim'?'childPhotoPermission':'guardianAuthorization','Autorização do responsável para a ilustração da criança.');
    if(missing.length){const e=new Error('Ainda faltam informações: '+missing.join('; '));e.status=422;e.details={fields};throw e;}
    if(ctx.order.archived_at)fail('Restaure o pedido antes de enviar.',409);
    if(actor==='admin'&&(payload.confirmed!==true||service.production_status!=='pending'))fail('Confirme o envio administrativo dos dados fornecidos pela cliente.',409);
    // Completing the artistic briefing is not a production release. Materials,
    // dependencies and the independent agenda still require confirmation.
    const result=await db.prepare("UPDATE v3_order_services SET briefing_status='completed',briefing_submitted_at=datetime('now'),reviewed_at=NULL,complement_note=NULL,updated_at=datetime('now') WHERE id=? AND briefing_status IN ('available','in_progress')").bind(service.id).run();
    if(Number(result.meta?.changes)!==1)fail('O briefing mudou. Atualize a página.',409);
    if(actor==='admin')await db.prepare("INSERT INTO v2_order_history(order_id,action_code,description,metadata_json,created_at) VALUES(?,'v3_admin_briefing_submitted','Briefing enviado pela administração com confirmação dos dados da cliente.',?,datetime('now'))").bind(ctx.order.id,JSON.stringify({family})).run();
    return getV3ModularBriefing(db,token);
  });
}
