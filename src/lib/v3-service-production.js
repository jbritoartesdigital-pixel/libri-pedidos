import {contextV3Briefing} from './v3-modular-briefing.js';
import {withV2PaymentLock} from './v2-payment-lock.js';
import {randomToken,fail as httpFail} from './http.js';
const fail=(message,status=409)=>{const e=new Error(message);e.status=status;throw e;};
const mimeExt={'video/mp4':'.mp4','video/webm':'.webm','image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','application/pdf':'.pdf'};
const MAX=60*1024*1024;
const noteOf=(v,min=0)=>{const n=typeof v==='string'?v.trim():'';if(n.length<min||n.length>2000)fail('Descreva a solicitação em '+min+' a 2000 caracteres.',422);return n;};
export function v3RevisionLimit(s){
 const config=s.snapshot.variant?.config||{};
 const spec=config.atelie||config.retrospective||config;
 const base=spec.revisionLimit;
 if(!Number.isSafeInteger(base)||base<0)return null;
 const code=s.family==='identidade_visual'?'atelie_revision':s.family==='retrospectiva'?'retro_revision':null;
 return base+(s.snapshot.v3Extras||[]).filter(x=>x.code===code).reduce((n,x)=>n+x.quantity,0);
}
async function current(db,token,family){
 const ctx=await contextV3Briefing(db,token);
 if(!ctx)return null;
 if(ctx.locked||ctx.order.archived_at||ctx.order.status==='cancelled')fail('Serviço indisponível.',403);
 const s=ctx.services.find(x=>x.family===family);if(!s)fail('Serviço não contratado.',404);
 const preview=await db.prepare('SELECT * FROM v3_service_previews WHERE service_id=? ORDER BY version DESC LIMIT 1').bind(s.id).first();
 return {ctx,s,preview};
}
export async function getV3ServiceProgress(db,s){
 const p=await db.prepare('SELECT id,version,mime_type,status,published_at,adjustment_deadline,approved_at FROM v3_service_previews WHERE service_id=? ORDER BY version DESC LIMIT 1').bind(s.id).first();
 const events=(await db.prepare('SELECT action,actor,note,preview_id,created_at FROM v3_service_production_events WHERE service_id=? ORDER BY id DESC LIMIT 50').bind(s.id).all()).results||[];
 return {version:s.production_version,revisionsUsed:s.revisions_used,revisionsIncluded:v3RevisionLimit(s),
 preview:p?{id:p.id,version:p.version,mimeType:p.mime_type,status:p.status,publishedAt:p.published_at,adjustmentDeadline:p.adjustment_deadline,approvedAt:p.approved_at}:null,events};
}
function event(db,s,actor,action,note='',previewId=null){
 return db.prepare('INSERT INTO v3_service_production_events(service_id,actor,action,note,preview_id) VALUES(?,?,?,?,?)').bind(s.id,actor,action,note,previewId);
}
function change(db,s,status,increment=0){
 return db.prepare("UPDATE v3_order_services SET production_status=?,production_version=production_version+1,revisions_used=revisions_used+?,updated_at=datetime('now') WHERE id=? AND production_version=?").bind(status,increment,s.id,s.production_version);
}
function checkVersion(s,input){
 if(!Number.isSafeInteger(input.version)||input.version!==s.production_version)fail('A etapa mudou. Atualize antes de continuar.');
}
export async function changeV3Production(db,token,family,input={},actor='admin'){
 const initial=await current(db,token,family);if(!initial)return null;
 return withV2PaymentLock(db,initial.ctx.order.id,async()=>{
 const {s,preview}=await current(db,token,family);checkVersion(s,input);
 const action=input.action;let statements=[];
 if(actor==='admin'&&action==='start'){
   if(s.production_status!=='ready'||!s.scheduled_at||!s.reviewed_at||s.briefing_status!=='completed')fail('Confirme o briefing e a agenda antes de iniciar.');
   statements=[change(db,s,'in_production'),event(db,s,actor,'started')];
 }else if(actor==='customer'&&['approve','request_adjustments'].includes(action)){
   if(s.production_status!=='waiting_customer'||preview?.status!=='active'||input.previewId!==preview.id)fail('Confira a prévia mais recente.');
   if(action==='approve'){
     if(input.confirmed!==true)fail('Confirme a aprovação da prévia.',422);
     statements=[db.prepare("UPDATE v3_service_previews SET status='approved',approved_at=? WHERE id=?").bind(new Date().toISOString(),preview.id),change(db,s,'approved'),event(db,s,actor,'approved','',preview.id)];
   }else{
     if(Date.now()>Date.parse(preview.adjustment_deadline))fail('O prazo de 7 dias para solicitar ajustes terminou. Fale com a Libri.');
     const note=noteOf(input.note,5);
     statements=[db.prepare("UPDATE v3_service_previews SET status='adjustments' WHERE id=?").bind(preview.id),change(db,s,'adjustments'),event(db,s,actor,'adjustments_requested',note,preview.id)];
   }
 }else if(actor==='admin'&&['included_revision','libri_correction','extra_quote','return_preview'].includes(action)){
   if(s.production_status!=='adjustments'||preview?.status!=='adjustments')fail('Não há solicitação de ajustes pendente.');
   const latest=await db.prepare('SELECT action FROM v3_service_production_events WHERE service_id=? ORDER BY id DESC LIMIT 1').bind(s.id).first();
   if(!['adjustments_requested','extra_quote'].includes(latest?.action))fail('A solicitação já foi tratada.');
   const note=noteOf(input.note,5);
   if(action==='included_revision'){
     const limit=v3RevisionLimit(s);
     if(limit===null)fail('Confira o limite de revisões do contrato antes de registrar uma rodada.');
     if(s.revisions_used>=limit)fail('Rodadas incluídas esgotadas. Solicite orçamento complementar.');
     statements=[change(db,s,'in_production',1),event(db,s,actor,action,note,preview.id)];
   }else if(action==='libri_correction'){
     statements=[change(db,s,'in_production'),event(db,s,actor,action,note,preview.id)];
   }else if(action==='extra_quote'){
     // Record need for a quote only; no payment, extra scope or automatic approval.
     statements=[change(db,s,'adjustments'),event(db,s,actor,action,note,preview.id)];
   }else{
     statements=[db.prepare("UPDATE v3_service_previews SET status='active' WHERE id=?").bind(preview.id),change(db,s,'waiting_customer'),event(db,s,actor,action,note,preview.id)];
   }
 }else fail('Ação indisponível.',422);
 await db.batch(statements);
 const next=await current(db,token,family);return getV3ServiceProgress(db,next.s);
 });
}
export async function publishV3ServicePreview(request,env,token,family){
 if(!env.FILES)fail('Armazenamento indisponível.',503);
 const initial=await current(env.DB,token,family);if(!initial)return null;
 if(Number(request.headers.get('content-length')||0)>MAX+100000)fail('A prévia deve ter até 60 MB.',413);
 const form=await request.formData(),file=form.get('file'),version=Number(form.get('version'));
 if(!file||typeof file.stream!=='function'||!Object.hasOwn(mimeExt,file.type)||file.size<=0||file.size>MAX)fail('Envie uma prévia MP4, WebM, JPG, PNG, WebP ou PDF de até 60 MB.',422);
 if(form.get('watermarkConfirmed')!=='true')fail('Confirme que a prévia foi preparada com marca d’água.',422);
 return withV2PaymentLock(env.DB,initial.ctx.order.id,async()=>{
   const {s,preview}=await current(env.DB,token,family);checkVersion(s,{version});
   if(s.production_status!=='in_production')fail('Inicie a produção ou classifique os ajustes antes de publicar.');
   const v=(preview?.version||0)+1,key='orders/'+s.order_id+'/v3/'+family+'/previews/'+randomToken('preview_')+mimeExt[file.type];
   const published=new Date(),deadline=new Date(published.getTime()+7*86400000).toISOString();
   await env.FILES.put(key,file.stream(),{httpMetadata:{contentType:file.type,cacheControl:'private, no-store'}});
   try{
     await env.DB.batch([
       env.DB.prepare("UPDATE v3_service_previews SET status='replaced' WHERE service_id=? AND status IN ('active','adjustments')").bind(s.id),
       env.DB.prepare("INSERT INTO v3_service_previews(service_id,version,r2_key,mime_type,size_bytes,published_at,adjustment_deadline) VALUES(?,?,?,?,?,?,?)").bind(s.id,v,key,file.type,file.size,published.toISOString(),deadline),
       change(env.DB,s,'waiting_customer'),
       env.DB.prepare("INSERT INTO v3_service_production_events(service_id,actor,action,preview_id) SELECT ?,'admin','preview_published',id FROM v3_service_previews WHERE service_id=? AND version=?").bind(s.id,s.id,v)
     ]);
   }catch(e){await env.FILES.delete(key).catch(()=>{});throw e;}
   return getV3ServiceProgress(env.DB,(await current(env.DB,token,family)).s);
 });
}
export async function streamV3ServicePreview(env,token,family,id,request){
 const c=await current(env.DB,token,family);if(!c||c.preview?.id!==id||c.preview.status==='replaced')return httpFail('Prévia não encontrada.',404);
 if(!env.FILES)return httpFail('Armazenamento indisponível.',503);
 const p=c.preview;
 // R2 range reads permit video playback and avoid loading the whole file.
 const range=request?.headers.get('range');
 let opt,contentRange;
 if(range){
   const m=range.match(/^bytes=(\d+)-(\d*)$/);
   if(!m)return new Response(null,{status:416,headers:{'content-range':'bytes */'+p.size_bytes}});
   const start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),p.size_bytes-1):p.size_bytes-1;
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=p.size_bytes)return new Response(null,{status:416,headers:{'content-range':'bytes */'+p.size_bytes}});
   opt={range:{offset:start,length:end-start+1}};contentRange='bytes '+start+'-'+end+'/'+p.size_bytes;
 }
 const o=await env.FILES.get(p.r2_key,opt);if(!o)return httpFail('Prévia não encontrada.',404);
 return new Response(o.body,{status:contentRange?206:200,headers:{'content-type':p.mime_type,'content-disposition':'inline','cache-control':'private, no-store','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow','referrer-policy':'no-referrer','accept-ranges':'bytes',...(contentRange?{'content-range':contentRange,'content-length':String(opt.range.length)}:{'content-length':String(p.size_bytes)})}});
}
