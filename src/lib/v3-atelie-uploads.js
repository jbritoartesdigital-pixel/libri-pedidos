import { fail, randomToken } from './http.js';
import { getAtelieUploadAccess } from './v3-atelie-customer-briefing.js';

// Shares the V2 private R2 bucket; never uses public gallery keys.
const MAX_BYTES=15*1024*1024;
const ACCEPT=Object.freeze({
  'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp',
  'image/heic':'.heic','image/heif':'.heif'
});
const LIMITS=Object.freeze({referenceFiles:6,childPhotos:4});
function error(message,status=422) {const e=new Error(message);e.status=status;return e;}
function safeName(name) {
  return String(name||'imagem').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z0-9._-]/g,'-').slice(0,100)||'imagem';
}
function validMagic(bytes,mime) {
  if(mime==='image/jpeg')return bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
  if(mime==='image/png')return bytes.slice(0,8).every((b,i)=>b===[137,80,78,71,13,10,26,10][i]);
  if(mime==='image/webp')return String.fromCharCode(...bytes.slice(0,4))==='RIFF'
    &&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  if(mime==='image/heic'||mime==='image/heif') {
    if(String.fromCharCode(...bytes.slice(4,8))!=='ftyp')return false;
    const brand=String.fromCharCode(...bytes.slice(8,12));
    return ['heic','heix','hevc','hevx','mif1','msf1'].includes(brand);
  }
  return false;
}
async function customerAccess(env,token,write=false) {
  const access=await getAtelieUploadAccess(env.DB,token);
  if(!access)return null;
  if(!access.paid)throw error('Imagens disponíveis apenas após pagamento confirmado.',403);
  if(write&&!access.canWrite)throw error('Este pedido não permite alterar arquivos.',403);
  return access;
}
async function listRows(db,orderId) {
  const res=await db.prepare(
    'SELECT id,field_key,original_filename,mime_type,size_bytes,note,created_at FROM v3_atelie_uploads WHERE order_id=? ORDER BY id'
  ).bind(orderId).all();
  return res.results||[];
}
function present(row,prefix) {
  return {
    id:row.id,fieldKey:row.field_key,originalFilename:row.original_filename,
    mimeType:row.mime_type,sizeBytes:row.size_bytes,note:row.note||'',
    createdAt:row.created_at,contentPath:prefix+'/'+row.id+'/content'
  };
}
export async function listAtelieCustomerUploads(env,token) {
  const access=await customerAccess(env,token);
  if(!access)return null;
  const prefix='/api/v2/customer-area/'+token+'/atelie/briefing/uploads';
  return (await listRows(env.DB,access.orderId)).map(r=>present(r,prefix));
}
async function uploadedFile(env,orderId,uploadId) {
  if(!Number.isSafeInteger(uploadId)||uploadId<=0)return null;
  return env.DB.prepare('SELECT * FROM v3_atelie_uploads WHERE id=? AND order_id=? LIMIT 1')
    .bind(uploadId,orderId).first();
}
async function streamPrivateFile(env,row) {
  if(!env.FILES)return fail('Armazenamento indisponível.',503);
  const object=await env.FILES.get(row.r2_key);
  if(!object)return fail('Arquivo não encontrado.',404);
  return new Response(object.body,{
    headers:{
      'content-type':row.mime_type,
      'content-disposition':'inline; filename="'+safeName(row.original_filename)+'"',
      'cache-control':'private, no-store, max-age=0',
      'x-content-type-options':'nosniff',
      'x-robots-tag':'noindex, nofollow',
      'referrer-policy':'no-referrer'
    }
  });
}
export async function uploadAtelieCustomerImage(request,env,token) {
  if(!env.FILES)throw error('Armazenamento de imagens indisponível.',503);
  const access=await customerAccess(env,token,true);
  if(!access)return null;
  const length=Number(request.headers.get('content-length')||0);
  if(length>MAX_BYTES+100000)throw error('Imagem muito grande. O limite é 15 MB.',413);
  const form=await request.formData();
  const fieldKey=String(form.get('fieldKey')||'');
  if(!Object.hasOwn(LIMITS,fieldKey))throw error('Tipo de imagem não permitido.');
  if(fieldKey==='childPhotos'&&!access.allowsChildPhotos)
    throw error('Fotos da criança exigem serviço compatível e autorização para uso privado no briefing.',403);
  const file=form.get('file');
  if(!file||typeof file.slice!=='function'||typeof file.stream!=='function')
    throw error('Escolha uma imagem válida.');
  const size=Number(file.size||0),mime=String(file.type||'').toLowerCase();
  if(size<=0||size>MAX_BYTES)throw error('Cada imagem deve ter no máximo 15 MB.',413);
  if(!Object.hasOwn(ACCEPT,mime))throw error('Envie JPG, PNG, WebP, HEIC ou HEIF.');
  const head=new Uint8Array(await file.slice(0,16).arrayBuffer());
  if(!validMagic(head,mime))throw error('O conteúdo da imagem não corresponde ao formato informado.');
  const originalFilename=String(file.name||'imagem').slice(0,200);
  const note=String(form.get('note')||'').trim();
  if(note.length>500)throw error('Observação muito longa.');
  const limit=LIMITS[fieldKey];
  const count=await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM v3_atelie_uploads WHERE order_id=? AND field_key=?'
  ).bind(access.orderId,fieldKey).first();
  if(Number(count?.n||0)>=limit)throw error('Limite de '+limit+' imagens neste campo.',409);
  // Revalidar consentimento e pagamento imediatamente antes da gravação.
  const check=await customerAccess(env,token,true);
  if(!check||check.orderId!==access.orderId||(fieldKey==='childPhotos'&&!check.allowsChildPhotos))
    throw error('A autorização deste envio mudou. Atualize o briefing.',409);
  const key='orders/'+access.orderId+'/atelie/'+fieldKey+'/'+randomToken('file_')+ACCEPT[mime];
  await env.FILES.put(key,file.stream(),{
    httpMetadata:{contentType:mime,contentDisposition:'inline',cacheControl:'private, no-store'},
    customMetadata:{fieldKey,orderCode:access.orderCode}
  });
  let inserted;
  try{
    // Atomic field limit to prevent two parallel uploads from exceeding the cap.
    const result=await env.DB.prepare(
      "INSERT INTO v3_atelie_uploads(order_id,field_key,original_filename,mime_type,size_bytes,r2_key,note) "+
      "SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM v3_atelie_uploads WHERE order_id=? AND field_key=?) < ? "+
      "AND EXISTS (SELECT 1 FROM v2_payments WHERE order_id=? AND status='approved') "+
      "AND EXISTS (SELECT 1 FROM v2_orders WHERE id=? AND status NOT IN ('cancelled','finalized')) "+
      "AND (?='referenceFiles' OR EXISTS (SELECT 1 FROM v3_atelie_briefings WHERE order_id=? AND json_extract(data_json,'$.childPhotoPermission')='sim' AND json_extract(data_json,'$.guardianAuthorization')='sim'))"
    ).bind(access.orderId,fieldKey,originalFilename,mime,size,key,note,
      access.orderId,fieldKey,limit,access.orderId,access.orderId,fieldKey,access.orderId).run();
    if(Number(result?.meta?.changes||0)!==1)
      throw error('O limite ou a autorização mudou. Atualize e tente novamente.',409);
    inserted=Number(result.meta.last_row_id);
  }catch(err){
    await env.FILES.delete(key).catch(()=>{});
    throw err;
  }
  return {upload:{
    id:inserted,fieldKey,originalFilename,mimeType:mime,sizeBytes:size,note,
    contentPath:'/api/v2/customer-area/'+token+'/atelie/briefing/uploads/'+inserted+'/content'
  }};
}
export async function streamAtelieCustomerImage(env,token,uploadId) {
  const access=await customerAccess(env,token);
  if(!access)return fail('Pedido não encontrado.',404);
  const row=await uploadedFile(env,access.orderId,uploadId);
  return row?streamPrivateFile(env,row):fail('Arquivo não encontrado.',404);
}
export async function deleteAtelieCustomerImage(env,token,uploadId) {
  if(!env.FILES)throw error('Armazenamento indisponível.',503);
  // A pessoa pode retirar as próprias imagens mesmo após finalizar o pedido.
  const access=await customerAccess(env,token);
  if(!access)return null;
  const row=await uploadedFile(env,access.orderId,uploadId);
  if(!row)return false;
  // R2 first: failure does not make the original object untracked/invisible.
  await env.FILES.delete(row.r2_key);
  await env.DB.prepare(
    'DELETE FROM v3_atelie_uploads WHERE id=? AND order_id=?'
  ).bind(uploadId,access.orderId).run();
  return {deleted:true};
}
async function adminFile(env,orderCode,id) {
  if(!/^LIBRI-\d{1,12}$/.test(orderCode||''))return null;
  return env.DB.prepare(
    "SELECT u.* FROM v3_atelie_uploads u "+
    "JOIN v2_orders o ON o.id=u.order_id "+
    "JOIN v2_order_items i ON i.order_id=o.id AND i.item_type='product' "+
    "JOIN v2_product_variants pv ON pv.code=i.item_code "+
    "JOIN v2_products p ON p.id=pv.product_id "+
    "WHERE o.order_code=? AND u.id=? AND p.code IN ('atelie_essencia','atelie_encanto','atelie_universo') LIMIT 1"
  ).bind(orderCode,id).first();
}
export async function streamAtelieAdminImage(env,orderCode,uploadId) {
  const row=await adminFile(env,orderCode,uploadId);
  return row?streamPrivateFile(env,row):fail('Arquivo não encontrado.',404);
}
