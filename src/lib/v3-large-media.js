import {contextV3Briefing} from './v3-modular-briefing.js';
import {withV2PaymentLock} from './v2-payment-lock.js';
import {randomToken} from './http.js';

export const V3_MEDIA_PART_BYTES=8*1024*1024;
export const V3_MEDIA_MAX_BYTES=512*1024*1024;
const DAY=86400000;
const types={'video/mp4':'.mp4','video/webm':'.webm'};
const fail=(message,status=409)=>{const e=new Error(message);e.status=status;throw e;};
async function context(db,token){
 const ctx=await contextV3Briefing(db,token);
 if(!ctx||ctx.locked||ctx.order.status==='cancelled'||ctx.order.archived_at)fail('Pedido indisponível.',403);
 const s=ctx.services.find(x=>x.family==='retrospectiva');
 if(!s)fail('Retrospectiva não contratada.',404);
 return {ctx,s};
}
function assertStage(s,kind,version){
 if(!['preview','final'].includes(kind)||!Number.isSafeInteger(version))fail('Etapa inválida.',422);
 if(s.production_version!==version)fail('A etapa mudou. Atualize a ficha.');
 if(s.production_status!==(kind==='preview'?'in_production':'approved'))fail('A etapa de produção não permite este envio.');
}
async function countFinal(db,s){
 const r=await db.prepare('SELECT COUNT(*) AS n FROM v3_service_final_files WHERE service_id=? AND purged_at IS NULL').bind(s.id).first();
 if(r.n>=30)fail('Limite de 30 arquivos por serviço.');
}
function storage(env){if(!env.FILES?.createMultipartUpload||!env.FILES?.resumeMultipartUpload)fail('Envio em partes indisponível.',503);}
export async function startV3LargeMedia(env,token,input={}){
 storage(env);
 const initial=await context(env.DB,token);
 const {kind,version,mimeType,sizeBytes}=input;
 if(!Object.hasOwn(types,mimeType)||!Number.isSafeInteger(sizeBytes)||sizeBytes<=(kind==='preview'?60:80)*1024*1024||sizeBytes>V3_MEDIA_MAX_BYTES)fail('Envie vídeo MP4 ou WebM acima do limite comum e até 512 MiB.',422);
 if(kind==='preview'&&input.watermarkConfirmed!==true)fail('Confirme a marca d’água da prévia.',422);
 const filename=(String(input.filename||'video').replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,160)||'video');
 return withV2PaymentLock(env.DB,initial.s.order_id,async()=>{
  const {s}=await context(env.DB,token);assertStage(s,kind,version);
  if(kind==='final')await countFinal(env.DB,s);
  if(await env.DB.prepare("SELECT 1 FROM v3_large_media_uploads WHERE service_id=? AND status='open'").bind(s.id).first())fail('Há um envio em aberto. Cancele-o antes de iniciar outro.');
  const id=randomToken('media_'),key='orders/'+s.order_id+'/v3/retrospectiva/'+(kind==='preview'?'previews':'final')+'/'+id+types[mimeType];
  const upload=await env.FILES.createMultipartUpload(key,{httpMetadata:{contentType:mimeType,cacheControl:'private, no-store'}});
  try{await env.DB.prepare("INSERT INTO v3_large_media_uploads(id,service_id,kind,production_version,filename,mime_type,size_bytes,r2_key,upload_id,status,expires_at) VALUES(?,?,?,?,?,?,?,?,?,'open',?)").bind(id,s.id,kind,version,filename,mimeType,sizeBytes,key,upload.uploadId,new Date(Date.now()+DAY).toISOString()).run();}
  catch(e){await upload.abort().catch(()=>{});throw e;}
  return {id,partBytes:V3_MEDIA_PART_BYTES,partCount:Math.ceil(sizeBytes/V3_MEDIA_PART_BYTES)};
 });
}
async function session(db,s,id){
 const row=await db.prepare('SELECT * FROM v3_large_media_uploads WHERE id=? AND service_id=?').bind(id,s.id).first();
 if(!row)fail('Envio não encontrado.',404);
 return row;
}
function active(row,s){
 if(row.status!=='open'||Date.now()>=Date.parse(row.expires_at))fail('Envio expirado ou encerrado.');
 assertStage(s,row.kind,row.production_version);
}
export async function uploadV3LargePart(request,env,token,id,partNumber){
 storage(env);const initial=await context(env.DB,token);
 if(Number(request.headers.get('content-length')||0)>V3_MEDIA_PART_BYTES+100000)fail('Parte muito grande.',413);
 const form=await request.formData(),part=form.get('part');
 if(!part||typeof part.arrayBuffer!=='function'||part.size>V3_MEDIA_PART_BYTES)fail('Parte inválida.',422);
 return withV2PaymentLock(env.DB,initial.s.order_id,async()=>{
  const {s}=await context(env.DB,token),r=await session(env.DB,s,id);active(r,s);
  const n=Math.ceil(r.size_bytes/V3_MEDIA_PART_BYTES);
  if(!Number.isSafeInteger(partNumber)||partNumber<1||partNumber>n||part.size!==Math.min(V3_MEDIA_PART_BYTES,r.size_bytes-(partNumber-1)*V3_MEDIA_PART_BYTES))fail('Tamanho ou número da parte inválido.',422);
  const parts=JSON.parse(r.parts_json);
  if(partNumber>parts.length+1)fail('Envie as partes na ordem.');
  const result=await env.FILES.resumeMultipartUpload(r.r2_key,r.upload_id).uploadPart(partNumber,await part.arrayBuffer());
  parts[partNumber-1]={partNumber,etag:result.etag};
  await env.DB.prepare('UPDATE v3_large_media_uploads SET parts_json=? WHERE id=?').bind(JSON.stringify(parts),id).run();
  return {received:parts.length,total:n};
 });
}
export async function completeV3LargeMedia(env,token,id){
 storage(env);const initial=await context(env.DB,token);
 return withV2PaymentLock(env.DB,initial.s.order_id,async()=>{
  const {s}=await context(env.DB,token),r=await session(env.DB,s,id);
  if(r.status==='completed')return {completed:true};
  active(r,s);
  if(r.kind==='final')await countFinal(env.DB,s);
  const parts=JSON.parse(r.parts_json),n=Math.ceil(r.size_bytes/V3_MEDIA_PART_BYTES);
  if(parts.length!==n||parts.some((p,i)=>p.partNumber!==i+1||!p.etag))fail('O envio ainda está incompleto.');
  // Recover an object completed remotely before a lost response/DB write.
  let object=await env.FILES.head(r.r2_key);
  if(!object){try{object=await env.FILES.resumeMultipartUpload(r.r2_key,r.upload_id).complete(parts);}catch(e){object=await env.FILES.head(r.r2_key);if(!object)throw e;}}
  if(Number(object.size)!==r.size_bytes)fail('O tamanho do vídeo recebido diverge do original. Cancele e envie novamente.');
  const db=env.DB,statements=[];
  if(r.kind==='preview'){
   const latest=await db.prepare('SELECT MAX(version) AS version FROM v3_service_previews WHERE service_id=?').bind(s.id).first();
   const v=Number(latest.version||0)+1,now=new Date();
   statements.push(db.prepare("UPDATE v3_service_previews SET status='replaced' WHERE service_id=? AND status IN ('active','adjustments')").bind(s.id),
    db.prepare('INSERT INTO v3_service_previews(service_id,version,r2_key,mime_type,size_bytes,published_at,adjustment_deadline) VALUES(?,?,?,?,?,?,?)').bind(s.id,v,r.r2_key,r.mime_type,r.size_bytes,now.toISOString(),new Date(now.getTime()+7*DAY).toISOString()),
    db.prepare("UPDATE v3_order_services SET production_status='waiting_customer',production_version=production_version+1,updated_at=datetime('now') WHERE id=?").bind(s.id),
    db.prepare("INSERT INTO v3_service_production_events(service_id,actor,action,preview_id) SELECT ?,'admin','preview_published',id FROM v3_service_previews WHERE service_id=? AND version=?").bind(s.id,s.id,v));
  }else{
   statements.push(db.prepare('INSERT INTO v3_service_final_files(service_id,filename,mime_type,size_bytes,r2_key) VALUES(?,?,?,?,?)').bind(s.id,r.filename,r.mime_type,r.size_bytes,r.r2_key),
    db.prepare('UPDATE v3_order_services SET production_version=production_version+1 WHERE id=?').bind(s.id));
  }
  statements.push(db.prepare("UPDATE v3_large_media_uploads SET status='completed' WHERE id=?").bind(id));
  await db.batch(statements);
  return {completed:true};
 });
}
async function discard(env,r){
 if(r.status==='open'){
  const object=await env.FILES.head(r.r2_key);
  if(object)await env.FILES.delete(r.r2_key);
  else await env.FILES.resumeMultipartUpload(r.r2_key,r.upload_id).abort();
 }
 await env.DB.prepare('DELETE FROM v3_large_media_uploads WHERE id=?').bind(r.id).run();
}
export async function abortV3LargeMedia(env,token,id){
 storage(env);const initial=await context(env.DB,token);
 return withV2PaymentLock(env.DB,initial.s.order_id,async()=>{
  const {s}=await context(env.DB,token),r=await session(env.DB,s,id);
  if(r.status==='completed')return {completed:true};
  await discard(env,r);return {aborted:true};
 });
}
export async function cleanV3LargeMedia(env,{now=new Date(),limit=20}={}){
 if(!env.FILES?.resumeMultipartUpload)return {cleaned:0,failed:0};
 const rows=(await env.DB.prepare("SELECT u.id,s.order_id FROM v3_large_media_uploads u JOIN v3_order_services s ON s.id=u.service_id WHERE u.expires_at<=? ORDER BY u.expires_at LIMIT ?").bind(now.toISOString(),limit).all()).results||[];
 const result={cleaned:0,failed:0};
 for(const row of rows){try{await withV2PaymentLock(env.DB,row.order_id,async()=>{
  const r=await env.DB.prepare('SELECT * FROM v3_large_media_uploads WHERE id=? AND expires_at<=?').bind(row.id,now.toISOString()).first();
  if(r){await discard(env,r);result.cleaned++;}
 });}catch{result.failed++;}}
 return result;
}
