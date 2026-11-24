import {contextV3Briefing} from './v3-modular-briefing.js';
import {withV2PaymentLock} from './v2-payment-lock.js';
import {randomToken,fail as httpFail} from './http.js';
const MAX=80*1024*1024, DAY=86400000;
const mimeExt={'video/mp4':'.mp4','video/webm':'.webm','image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','application/pdf':'.pdf','application/zip':'.zip','application/x-zip-compressed':'.zip'};
const fail=(message,status=409)=>{const e=new Error(message);e.status=status;throw e;};
async function access(db,token,family){
 const ctx=await contextV3Briefing(db,token);if(!ctx)return null;
 if(ctx.locked||ctx.order.status==='cancelled'||ctx.order.archived_at)fail('Serviço indisponível.',403);
 const s=ctx.services.find(x=>x.family===family);if(!s)fail('Serviço não contratado.',404);
 return {ctx,s};
}
function check(s,version){
 if(s.production_status!=='approved')fail('A prévia precisa estar aprovada pela cliente.');
 if(!Number.isSafeInteger(version)||version!==s.production_version)fail('Atualize a ficha antes de continuar.');
}
function interactive(s){return s.family==='convite'&&/^interactive_/.test(s.product_code);}
function link(value){
 try{const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password&&u.port===''&&(u.hostname==='libriconvites.com.br'||u.hostname.endsWith('.libriconvites.com.br')))return u.href;}catch{}
 fail('Informe o link HTTPS publicado no domínio da Libri.',422);
}
export async function getV3Delivery(db,s,{admin=false}={}){
 const delivered=s.production_status==='delivered'&&!!s.delivered_at;
 const available=delivered&&Date.now()<Date.parse(s.download_until);
 const rows=(await db.prepare('SELECT id,filename,mime_type,size_bytes,purged_at FROM v3_service_final_files WHERE service_id=? ORDER BY id').bind(s.id).all()).results||[];
 return {delivered,deliveredAt:s.delivered_at,downloadUntil:s.download_until,originalsUntil:s.originals_until,downloadAvailable:available,
 interactiveRequired:interactive(s),interactiveUrl:delivered?s.interactive_url:null,
 files:(admin||delivered?rows:[]).map(r=>({id:r.id,filename:r.filename,mimeType:r.mime_type,sizeBytes:r.size_bytes,available:!r.purged_at&&(available||admin&&!delivered)})),
 warning:available&&Date.parse(s.download_until)-Date.now()<=7*DAY?'Baixe seus arquivos antes do vencimento.':null};
}
export async function stageV3FinalFile(request,env,token,family){
 if(!env.FILES)fail('Armazenamento indisponível.',503);
 const initial=await access(env.DB,token,family);if(!initial)return null;
 if(Number(request.headers.get('content-length')||0)>MAX+100000)fail('Arquivo acima de 80 MB.',413);
 const form=await request.formData(),file=form.get('file'),version=Number(form.get('version'));
 if(!file||typeof file.stream!=='function'||!Object.hasOwn(mimeExt,file.type)||file.size<=0||file.size>MAX)fail('Envie MP4, WebM, JPG, PNG, WebP, PDF ou ZIP de até 80 MB.',422);
 return withV2PaymentLock(env.DB,initial.ctx.order.id,async()=>{
 const {s}=await access(env.DB,token,family);check(s,version);
 const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_service_final_files WHERE service_id=? AND purged_at IS NULL').bind(s.id).first();
 if(count.n>=30)fail('Limite de 30 arquivos por serviço.');
 const filename=(String(file.name||'arquivo').replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,160)||'arquivo') ;
 const key='orders/'+s.order_id+'/v3/'+family+'/final/'+randomToken('final_')+mimeExt[file.type];
 await env.FILES.put(key,file.stream(),{httpMetadata:{contentType:file.type,cacheControl:'private, no-store'}});
 try{await env.DB.batch([
 env.DB.prepare('INSERT INTO v3_service_final_files(service_id,filename,mime_type,size_bytes,r2_key) VALUES(?,?,?,?,?)').bind(s.id,filename,file.type,file.size,key),
 env.DB.prepare('UPDATE v3_order_services SET production_version=production_version+1 WHERE id=?').bind(s.id)
 ]);}catch(e){await env.FILES.delete(key).catch(()=>{});throw e;}
 return getV3Delivery(env.DB,s,{admin:true});
 });
}
export async function removeV3FinalFile(env,token,family,id,version){
 const initial=await access(env.DB,token,family);if(!initial)return null;
 if(!env.FILES)fail('Armazenamento indisponível.',503);
 return withV2PaymentLock(env.DB,initial.ctx.order.id,async()=>{
 const {s}=await access(env.DB,token,family);check(s,version);
 const row=await env.DB.prepare('SELECT r2_key FROM v3_service_final_files WHERE service_id=? AND id=? AND purged_at IS NULL').bind(s.id,id).first();
 if(!row)fail('Arquivo não encontrado.',404);
 await env.FILES.delete(row.r2_key);
 await env.DB.batch([env.DB.prepare('DELETE FROM v3_service_final_files WHERE service_id=? AND id=?').bind(s.id,id),env.DB.prepare('UPDATE v3_order_services SET production_version=production_version+1 WHERE id=?').bind(s.id)]);
 return true;
 });
}
export async function deliverV3Service(env,token,family,input={}){
 const initial=await access(env.DB,token,family);if(!initial)return null;
 return withV2PaymentLock(env.DB,initial.ctx.order.id,async()=>{
 const {s}=await access(env.DB,token,family);check(s,input.version);
 if(input.confirmed!==true)fail('Confirme a entrega completa.',422);
 const approved=await env.DB.prepare("SELECT id,status FROM v3_service_previews WHERE service_id=? ORDER BY version DESC LIMIT 1").bind(s.id).first();
 if(approved?.status!=='approved')fail('A última prévia precisa estar aprovada.');
 const files=(await env.DB.prepare('SELECT r2_key FROM v3_service_final_files WHERE service_id=? AND purged_at IS NULL').bind(s.id).all()).results||[];
 const url=interactive(s)?link(input.interactiveUrl):null;
 if(!url&&!files.length)fail('Adicione os arquivos finais antes da entrega.',422);
 if(files.length&&!env.FILES)fail('Armazenamento indisponível.',503);
 for(const f of files){if(!await env.FILES.head(f.r2_key))fail('Um arquivo final está indisponível. Confira antes de entregar.');}
 const now=new Date(),stamp=now.toISOString(),until=n=>new Date(now.getTime()+n*DAY).toISOString();
 await env.DB.batch([
 env.DB.prepare("UPDATE v3_order_services SET production_status='delivered',delivered_at=?,download_until=?,originals_until=?,interactive_url=?,production_version=production_version+1,updated_at=datetime('now') WHERE id=?").bind(stamp,until(90),until(30),url,s.id),
 env.DB.prepare("INSERT INTO v3_service_production_events(service_id,actor,action,preview_id) VALUES(?,'admin','delivered',?)").bind(s.id,approved.id)
 ]);
 return getV3Delivery(env.DB,{...s,production_status:'delivered',delivered_at:stamp,download_until:until(90),originals_until:until(30),interactive_url:url},{admin:true});
 });
}
export async function downloadV3FinalFile(env,token,family,id,{admin=false}={}){
 const c=await access(env.DB,token,family);if(!c)return httpFail('Pedido não encontrado.',404);
 const s=c.s,delivered=s.production_status==='delivered';
 if(!delivered&&!(admin&&s.production_status==='approved'))return httpFail('Arquivo ainda não entregue.',403);
 if(delivered&&(!s.download_until||Date.now()>=Date.parse(s.download_until)))return httpFail('Prazo de download encerrado.',410);
 const row=await env.DB.prepare('SELECT * FROM v3_service_final_files WHERE service_id=? AND id=? AND purged_at IS NULL').bind(s.id,id).first();
 if(!row)return httpFail('Arquivo não encontrado.',404);
 if(!env.FILES)return httpFail('Armazenamento indisponível.',503);
 const o=await env.FILES.get(row.r2_key);if(!o)return httpFail('Arquivo não encontrado.',404);
 return new Response(o.body,{headers:{'content-type':'application/octet-stream','content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(row.filename),'content-length':String(row.size_bytes),'cache-control':'private, no-store','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow','referrer-policy':'no-referrer'}});
}
