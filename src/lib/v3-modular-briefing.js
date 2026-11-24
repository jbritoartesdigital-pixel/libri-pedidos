// Internal modular briefing model. Public routes, authenticated Admin receipt
// action, invite/Ateliê private upload integration and final submission follow.
// Retrospectiva never creates R2 objects; only receipt metadata is persisted.
import {buildV2BriefingSimulationSchema} from './v2-customer-area.js';
import {buildAtelieBriefingBlueprint} from './v3-atelie-briefing.js';
import {summarizeV3Order} from './v3-order-overview.js';
import {getV3Delivery} from './v3-service-delivery.js';
import {getV3ServiceProgress} from './v3-service-production.js';
import {withV2PaymentLock} from './v2-payment-lock.js';
const fail=(message,status=422)=>{const e=new Error(message);e.status=status;throw e;};
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
const parse=v=>JSON.parse(v||'{}');
const field=(key,label,type='text',options={})=>({key,label,type,...options});
const section=(id,title,fields)=>({id,title,fields});
const sharedKeys=new Set(['theme_or_style','joint_celebration','joint_honorees','age','special_info','event_time','venue_name','venue_address']);
const filled=v=>Array.isArray(v)?v.length>0:v!==null&&v!==undefined&&String(v).trim()!=='';
function retroSpec(snapshot){
  const r=snapshot.variant?.config?.retrospective;
  if(!r||!Number.isSafeInteger(r.maxPhotos)||r.maxPhotos<1||!Number.isSafeInteger(r.maxVideos)||r.maxVideos<0)
    fail('Os limites contratados da retrospectiva ainda precisam ser definidos.',409);
  const quantity=code=>(snapshot.v3Extras||[]).filter(x=>x.code===code).reduce((n,x)=>n+x.quantity,0);
  return {...r,maxPhotos:r.maxPhotos+25*quantity('retro_more_photos'),maxVideos:r.maxVideos+5*quantity('retro_more_videos'),
    maxTotalVideoSeconds:Number.isSafeInteger(r.maxTotalVideoSeconds)?r.maxTotalVideoSeconds+300*quantity('retro_more_videos'):null,
    captionsIncluded:r.captionsIncluded||quantity('retro_captions')>0,
    rawVideoSeconds:600*quantity('retro_long_video')};
}
export function buildV3ModuleSchema(order,services,module,drafts={}){
  const shared=drafts.shared||{};
  const data=drafts[module]||{};
  const invitation=services.find(s=>s.family==='convite');
  const inviteSchema=invitation?buildV2BriefingSimulationSchema({
    product:invitation.snapshot.product,eventType:order.event_type,addons:invitation.snapshot.addons||[],
    data:{...drafts.convite,...shared}
  }):null;
  if(module==='shared'){
    if(inviteSchema)return {sections:inviteSchema.sections.filter(s=>s.id==='event'),uploadRules:[]};
    const fields=[field('theme_or_style','Tema ou estilo da comemoração','text',{required:true})];
    if(order.event_type==='birthday'){
      fields.push(field('joint_celebration','A festa tem mais de um aniversariante?','choice',{required:true,options:[{value:'no',label:'Não'},{value:'yes',label:'Sim'}]}));
      fields.push(shared.joint_celebration==='yes'
        ?field('joint_honorees','Nomes e idades','textarea',{required:true})
        :field('age','Idade','number',{required:true,min:1,max:120}));
    }
    fields.push(field('special_info','Informações gerais adicionais','textarea'));
    return {sections:[section('event','Sobre a comemoração',fields)],uploadRules:[]};
  }
  const service=services.find(s=>s.family===module);
  if(!service)fail('Este serviço não faz parte do pedido.',404);
  if(module==='convite'){
    const sections=inviteSchema.sections.filter(s=>s.id!=='event');
    const personal=inviteSchema.uploadRules.some(r=>r.fieldKey==='person_photos');
    if(personal)sections.push(section('private_permission','Autorização de imagens',[
      field('private_photo_authorization','Você possui autorização da pessoa retratada ou de seu responsável legal para usar as fotos nesta criação?','choice',{required:true,options:['sim','não']})
    ]));
    const gift=service.snapshot.blackLibri?.gift;
    if(gift?.config?.giftOnly){
      const prize=gift.config.blackLibriPrizeCode;
      const fields=[field('black_gift_notes','Preferências para o presente '+gift.name,'textarea',{required:true,help:'Informe o texto, tema, cores, personagem ou mensagem desejada; se preferir, escreva que a Libri pode decidir.'})];
      if(['mini_retrospective','child_birthday'].includes(prize)){
        fields.push(field('black_gift_media_authorization','Possui autorização do responsável para utilizar as fotos neste presente?','choice',{required:true,options:['sim','não']}),
          field('black_gift_media_sent','Envie as fotos pelo WhatsApp da Libri, como documentos, identificando seu pedido e o presente. Já enviou?', 'choice',{required:true,options:['sim','não']}));
      }
      sections.push(section('black_gift','Seu presente Black Libri',fields));
    }
    return {...inviteSchema,sections,uploadRules:inviteSchema.uploadRules.map(r=>({...r,authorized:!['person_photos','outfit_photos'].includes(r.fieldKey)||data.private_photo_authorization==='sim'}))};
  }
  if(module==='identidade_visual'){
    const config=service.snapshot.variant?.config?.atelie||{};
    const pkg=service.product_code.replace(/^atelie_/,'');
    const atelie=buildAtelieBriefingBlueprint({event:{honoreeName:order.honoree_display_name,type:order.event_type,date:order.event_date},
      packageCode:pkg,contractedApplications:config.contractedApplications||[],requiresChildPhoto:true,
      data:{...data,theme:shared.theme_or_style,age:shared.age,multipleHonorees:shared.joint_celebration==='yes'?'sim':'não',honoreesNamesAges:shared.joint_honorees}});
    const sections=atelie.sections.filter(s=>s.id!=='celebracao').map(s=>({...s,fields:s.fields.filter(f=>f.key!=='theme').map(f=>
      f.key==='includedPosesInfo'&&config.includedMascotPoses?{...f,label:'Poses incluídas no pacote: '+config.includedMascotPoses}:f)}));
    const uploadRules=sections.flatMap(s=>s.fields.filter(f=>f.type==='upload').map(f=>({fieldKey:f.key,label:f.label,min:f.key==='childPhotos'?1:0,max:f.key==='childPhotos'?4:6,maxBytes:15*1024*1024,authorized:true})));
    return {sections:sections.map(s=>({...s,fields:s.fields.filter(f=>f.type!=='upload')})),uploadRules};
  }
  if(module==='retrospectiva'){
    const r=retroSpec(service.snapshot);
    return {sections:[section('story','A história que vamos contar',[
      field('story','Conte um pouco da história e dos momentos importantes','textarea',{required:true}),
      field('music_mode','Como vamos escolher a música?','choice',{required:true,options:['Libri escolhe','quero sugerir']}),
      ...(data.music_mode==='quero sugerir'?[field('music_reference','Música ou referência','text',{required:true})]:[]),
      field('dedication','Mensagem, homenagem ou dedicatória','textarea'),
      field('sequence_notes','Ordem das fotos, períodos ou pessoas importantes','textarea'),
      ...(r.captionsIncluded?[field('caption_notes','Legendas desejadas','textarea')]:[]),
      field('media_authorization','Possui autorização para usar os materiais enviados na criação contratada?','choice',{required:true,options:['sim','não']})
    ])],uploadRules:[],materials:{channel:'whatsapp',maxPhotos:r.maxPhotos,maxVideos:r.maxVideos,maxVideoSeconds:r.maxVideoSeconds||null,maxTotalVideoSeconds:r.maxTotalVideoSeconds,rawVideoSeconds:r.rawVideoSeconds,requiresAdminReceipt:true,storesFilesInR2:false}};
  }
  fail('Módulo inválido.');
}
export async function contextV3Briefing(db,token){
  const order=await db.prepare(`SELECT o.*,p.total_cents,p.payment_method,p.deposit_percent,p.balance_cents
    FROM v2_orders o JOIN v3_order_checkout_snapshots s ON s.order_id=o.id
    JOIN v2_order_pricing p ON p.order_id=o.id WHERE o.public_token=?`).bind(token).first();
  if(!order)return null;
  const services=(await db.prepare('SELECT * FROM v3_order_services WHERE order_id=? ORDER BY id').bind(order.id).all()).results.map(s=>({...s,snapshot:parse(s.commercial_snapshot_json)}));
  const paid=order.deposit_percent===100&&order.balance_cents===0&&!!await db.prepare(`SELECT 1 AS paid FROM v2_payments
    WHERE order_id=? AND provider='mercado_pago' AND status='approved' AND payment_type!='refund'
      AND amount_cents=? AND method=? LIMIT 1`).bind(order.id,order.total_cents,order.payment_method).first();
  const locked=!paid||order.briefing_status==='locked'||['configuring','awaiting_payment','cancelled'].includes(order.status);
  const drafts=Object.create(null),revisions=Object.create(null);
  if(!locked){
    for(const r of (await db.prepare('SELECT module,data_json,revision FROM v3_order_briefing_drafts WHERE order_id=?').bind(order.id).all()).results){
      drafts[r.module]=parse(r.data_json);revisions[r.module]=r.revision;
    }
  }
  return {order,services,locked,drafts,revisions};
}
export async function getV3ModularBriefing(db,token){
  const ctx=await contextV3Briefing(db,token);
  if(!ctx)return null;
  const {order,services,locked,drafts,revisions}=ctx;
  const purchased=services.map(s=>({family:s.family,briefingStatus:s.briefing_status,productionStatus:s.production_status,productName:s.snapshot.product.name,
    variantName:s.snapshot.variant?.label||'',submittedAt:s.briefing_submitted_at,complementNote:s.complement_note,reviewedAt:s.reviewed_at,deliveryWindow:s.delivery_start?{start:s.delivery_start,end:s.delivery_end}:null,scheduledAt:s.scheduled_at,dependsOnIdentity:s.depends_on_identity===null?null:Boolean(s.depends_on_identity),totalCents:s.total_cents,productionDays:s.production_days,
    extras:(s.snapshot.v3Extras||[]).map(x=>({name:x.name,quantity:x.quantity,totalCents:x.totalCents}))}));
  const base={orderCode:order.order_code,locked,orderStatus:order.status,aggregate:summarizeV3Order(services,{locked,orderStatus:order.status}),payment:{totalCents:order.total_cents,method:order.payment_method},
    deliveryWindow:{start:order.delivery_start,end:order.delivery_end,provisional:services.some(s=>s.production_days>0)},event:{honoreeName:order.honoree_display_name,date:order.event_date,type:order.event_type},services:purchased};
  if(locked)return {...base,modules:[]};
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
  const retro=modules.find(m=>m.module==='retrospectiva');
  if(retro){
    const setting=await db.prepare("SELECT value FROM v2_settings WHERE key='libri_whatsapp'").first();
    const phone=String(setting?.value||'').replace(/\D/g,'');
    const text='Olá! Vou enviar os materiais da retrospectiva do pedido '+order.order_code+'.';
    retro.schema.materials.whatsappUrl=/^\d{10,15}$/.test(phone)?'https://wa.me/'+phone+'?text='+encodeURIComponent(text):null;
    retro.receipt=await db.prepare('SELECT photo_count AS photoCount,video_count AS videoCount,video_durations_json AS videoDurationsJson,raw_video_seconds AS rawVideoSeconds,received_at AS receivedAt,complete_at AS completeAt FROM v3_retro_material_receipts WHERE order_id=?').bind(order.id).first();
  }
  return {...base,modules};
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
export async function saveV3ModuleDraft(db,token,module,payload={}){
  const initial=await contextV3Briefing(db,token);
  if(!initial)return null;
  return withV2PaymentLock(db,initial.order.id,async()=>{
    const ctx=await contextV3Briefing(db,token);
    if(!ctx||ctx.locked)fail('O briefing será liberado após o pagamento.',403);
    if(!['available','in_progress'].includes(ctx.order.briefing_status)||!['briefing_pending','waiting_customer'].includes(ctx.order.status))
      fail('O briefing não está disponível para edição.',409);
    if(module==='shared'&&ctx.services.some(s=>s.briefing_status==='completed'))fail('Os dados compartilhados já foram usados em um briefing enviado. Solicite uma alteração à Libri.',409);
    if(module!=='shared'&&!ctx.services.some(s=>s.family===module&&['available','in_progress'].includes(s.briefing_status)))
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
    const result=await db.prepare(`INSERT INTO v3_order_briefing_drafts(order_id,module,data_json,revision,updated_at)
      VALUES(?,?,?,1,datetime('now')) ON CONFLICT(order_id,module) DO UPDATE SET data_json=excluded.data_json,
      revision=revision+1,updated_at=datetime('now') WHERE revision=?`).bind(ctx.order.id,module,JSON.stringify(data),payload.revision).run();
    if(Number(result.meta?.changes)!==1)fail('O briefing mudou. Atualize antes de salvar.',409);
    if(module!=='shared')await db.prepare("UPDATE v3_order_services SET briefing_status='in_progress' WHERE order_id=? AND family=? AND briefing_status='available'").bind(ctx.order.id,module).run();
    return getV3ModularBriefing(db,token);
  });
}
// Called only from authenticated Admin in the future. A WhatsApp click or
// customer assertion is not receipt confirmation, and does not start production.
export async function recordV3RetroMaterialReceipt(db,orderId,{photoCount,videoCount,videoDurations,rawVideoSeconds=0,note='',complete=false}={}){
  if(!Number.isSafeInteger(orderId)||!Number.isSafeInteger(photoCount)||!Number.isSafeInteger(videoCount)||photoCount<0||videoCount<0||photoCount+videoCount===0||
    typeof complete!=='boolean'||typeof note!=='string'||note.length>500)fail('Informe os materiais efetivamente recebidos.');
  return withV2PaymentLock(db,orderId,async()=>{
    const row=await db.prepare(`SELECT s.commercial_snapshot_json,s.production_status,s.briefing_status AS service_briefing_status,o.status,o.briefing_status,o.public_token
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

export async function submitV3ServiceBriefing(db,token,family,payload={}){
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
    const missing=[];
    for(const module of ['shared',family]){
      const schema=buildV3ModuleSchema(ctx.order,ctx.services,module,ctx.drafts);
      const data=ctx.drafts[module]||{};
      for(const f of schema.sections.flatMap(s=>s.fields)){
        if(f.required&&!['info','upload'].includes(f.type)&&!filled(data[f.key]))missing.push(f.label);
      }
      for(const rule of schema.uploadRules||[]){
        if(rule.min>0){
          const row=await db.prepare('SELECT COUNT(*) AS n FROM v3_service_uploads WHERE order_id=? AND family=? AND field_key=?').bind(ctx.order.id,module,rule.fieldKey).first();
          if(!rule.authorized||Number(row.n)<rule.min)missing.push(rule.label+': envie pelo menos '+rule.min+' imagem(ns).');
        }
      }
    }
    const data=ctx.drafts[family]||{};
    const prize=service.snapshot.blackLibri?.gift?.config?.blackLibriPrizeCode;
    if(['mini_retrospective','child_birthday'].includes(prize)){
      if(data.black_gift_media_authorization!=='sim')missing.push('Autorização para as fotos do presente Black Libri.');
      if(data.black_gift_media_sent!=='sim')missing.push('Envio das fotos do presente pelo WhatsApp.');
    }
    if(family==='retrospectiva'&&data.media_authorization!=='sim')missing.push('Autorização para uso das fotos e vídeos.');
    if(family==='identidade_visual'&&data.mascotMode==='criança ilustrada'&&(data.childPhotoPermission!=='sim'||data.guardianAuthorization!=='sim'))missing.push('Autorização do responsável para a ilustração da criança.');
    if(missing.length){const e=new Error('Ainda faltam informações: '+missing.join('; '));e.status=422;throw e;}
    // Completing the artistic briefing is not a production release. Materials,
    // dependencies and the independent agenda still require confirmation.
    const result=await db.prepare("UPDATE v3_order_services SET briefing_status='completed',briefing_submitted_at=datetime('now'),reviewed_at=NULL,complement_note=NULL,updated_at=datetime('now') WHERE id=? AND briefing_status IN ('available','in_progress')").bind(service.id).run();
    if(Number(result.meta?.changes)!==1)fail('O briefing mudou. Atualize a página.',409);
    return getV3ModularBriefing(db,token);
  });
}
