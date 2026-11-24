import {contextV3Briefing,buildV3ModuleSchema} from './v3-modular-briefing.js';
import {withV2PaymentLock} from './v2-payment-lock.js';
import {randomToken,fail} from './http.js';
const MAX=15*1024*1024;
const ext={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/heic':'.heic','image/heif':'.heif'};
const error=(message,status=422)=>{const e=new Error(message);e.status=status;throw e;};
const ascii=b=>String.fromCharCode(...b);
export function validV3ImageHeader(b,mime){
 if(b.length<12)return false;
 if(mime==='image/jpeg')return b[0]===255&&b[1]===216&&b[2]===255;
 if(mime==='image/png')return [137,80,78,71,13,10,26,10].every((x,i)=>b[i]===x);
 if(mime==='image/webp')return ascii(b.slice(0,4))==='RIFF'&&ascii(b.slice(8,12))==='WEBP';
 return ['image/heic','image/heif'].includes(mime)&&ascii(b.slice(4,8))==='ftyp'&&['heic','heix','hevc','hevx','mif1','msf1'].includes(ascii(b.slice(8,12)));
}
async function access(db,token,family,write=false){
 if(!['convite','identidade_visual'].includes(family))error('Serviço não permite envio de imagens.',404);
 const ctx=await contextV3Briefing(db,token);
 if(!ctx)return null;
 const service=ctx.services.find(s=>s.family===family);
 if(!service)error('Serviço não contratado.',404);
 if(ctx.locked)error('Arquivos disponíveis após confirmação do pagamento.',403);
 if(service.originals_until&&Date.now()>=Date.parse(service.originals_until))error('Prazo de armazenamento encerrado.',410);
 if(write&&(!['available','in_progress'].includes(service.briefing_status)||!['briefing_pending','waiting_customer'].includes(ctx.order.status)))error('Este briefing não permite alterar arquivos.',409);
 return ctx;
}
export async function uploadV3ServiceImage(request,env,token,family){
 if(!env.FILES)error('Armazenamento indisponível.',503);
 const initial=await access(env.DB,token,family,true);if(!initial)return null;
 if(Number(request.headers.get('content-length')||0)>MAX+100000)error('Imagem muito grande.',413);
 if(!(request.headers.get('content-type')||'').startsWith('multipart/form-data'))error('Envie uma imagem.');
 const form=await request.formData(),fieldKey=String(form.get('fieldKey')||''),file=form.get('file');
 if(!file||typeof file.slice!=='function'||typeof file.stream!=='function')error('Escolha uma imagem válida.');
 const mime=String(file.type||'').toLowerCase();
 if(!Object.hasOwn(ext,mime))error('Envie JPG, PNG, WebP, HEIC ou HEIF.');
 if(file.size<=0||file.size>MAX)error('Cada imagem deve ter até 15 MB.',413);
 if(!validV3ImageHeader(new Uint8Array(await file.slice(0,16).arrayBuffer()),mime))error('Formato de imagem inválido.');
 return withV2PaymentLock(env.DB,initial.order.id,async()=>{
   const ctx=await access(env.DB,token,family,true);
   const schema=buildV3ModuleSchema(ctx.order,ctx.services,family,ctx.drafts);
   const rule=schema.uploadRules.find(r=>r.fieldKey===fieldKey);
   if(!rule||!rule.authorized)error('Salve as respostas e autorizações necessárias antes do envio.',403);
   const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM v3_service_uploads WHERE order_id=? AND family=? AND field_key=?').bind(ctx.order.id,family,fieldKey).first();
   if(count.n>=rule.max)error('Limite de imagens atingido.',409);
   const key='orders/'+ctx.order.id+'/v3/'+family+'/'+fieldKey+'/'+randomToken('file_')+ext[mime];
   await env.FILES.put(key,file.stream(),{httpMetadata:{contentType:mime,cacheControl:'private, no-store'}});
   try{
     const r=await env.DB.prepare('INSERT INTO v3_service_uploads(order_id,family,field_key,original_filename,mime_type,size_bytes,r2_key) VALUES(?,?,?,?,?,?,?)').bind(ctx.order.id,family,fieldKey,String(file.name||'imagem').slice(0,200),mime,file.size,key).run();
     return {id:Number(r.meta.last_row_id)};
   }catch(e){await env.FILES.delete(key).catch(()=>{});throw e;}
 });
}
export async function getV3ServiceImage(env,token,family,id){
 const ctx=await access(env.DB,token,family);if(!ctx)return fail('Pedido não encontrado.',404);
 const row=await env.DB.prepare('SELECT * FROM v3_service_uploads WHERE order_id=? AND family=? AND id=?').bind(ctx.order.id,family,id).first();
 if(!row)return fail('Arquivo não encontrado.',404);
 const rule=buildV3ModuleSchema(ctx.order,ctx.services,family,ctx.drafts).uploadRules.find(r=>r.fieldKey===row.field_key);
 if(!rule?.authorized)return fail('Autorização de imagem indisponível.',403);
 if(!env.FILES)return fail('Armazenamento indisponível.',503);
 const o=await env.FILES.get(row.r2_key);if(!o)return fail('Arquivo não encontrado.',404);
 return new Response(o.body,{headers:{'content-type':row.mime_type,'content-disposition':'inline','cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow','referrer-policy':'no-referrer'}});
}
export async function deleteV3ServiceImage(env,token,family,id){
 const initial=await access(env.DB,token,family);if(!initial)return null;
 if(!env.FILES)error('Armazenamento indisponível.',503);
 return withV2PaymentLock(env.DB,initial.order.id,async()=>{
   const ctx=await access(env.DB,token,family,true);
   const row=await env.DB.prepare('SELECT r2_key FROM v3_service_uploads WHERE order_id=? AND family=? AND id=?').bind(ctx.order.id,family,id).first();
   if(!row)return false;
   await env.FILES.delete(row.r2_key);
   await env.DB.prepare('DELETE FROM v3_service_uploads WHERE order_id=? AND family=? AND id=?').bind(ctx.order.id,family,id).run();
   return true;
 });
}
