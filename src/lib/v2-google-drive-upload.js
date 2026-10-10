import {getDriveAccessToken} from './v2-google-drive-oauth.js';
import {readOrderDriveFolder,saveOrderDriveFolder} from './v2-drive-folder.js';

const CODE=/^LIBRI-\d{1,15}$/;
const SAFE_MIME=new Map([
  ['image/png','.png'],['image/jpeg','.jpg'],['image/webp','.webp'],
  ['video/mp4','.mp4'],['video/webm','.webm']
]);
const FILE_BASE='https://www.googleapis.com/drive/v3/files';
async function googleJson(url,token,options={}){
  const response=await fetch(url,{
    ...options,headers:{authorization:'Bearer '+token,...options.headers}
  });
  if(!response.ok)throw Error('O Google Drive recusou a operação ('+response.status+'). Confira a autorização e a pasta.');
  return response.json();
}
function needOrder(orderCode){
  if(!CODE.test(String(orderCode||'')))throw Error('Pedido inválido.');
  return orderCode;
}
async function folderStatus(id,token){
  const info=await googleJson(FILE_BASE+'/'+encodeURIComponent(id)+
    '?fields=id,name,mimeType,trashed',token);
  if(info.trashed||info.mimeType!=='application/vnd.google-apps.folder')
    throw Error('A pasta vinculada não existe ou foi removida.');
  return info;
}
/**
 * Called only by an authenticated admin who explicitly pressed Create Folder.
 * Creates app-owned folder in My Drive, using only order code, never customer PII.
 */
export async function createOrderDriveFolder(env,orderCode){
  needOrder(orderCode);
  const current=await readOrderDriveFolder(env.DB,orderCode);
  if(!current)throw Error('Pedido não encontrado.');
  const token=await getDriveAccessToken(env);
  if(current.folderId){
    await folderStatus(current.folderId,token);
    return {folderId:current.folderId,alreadyLinked:true};
  }
  const q="mimeType = 'application/vnd.google-apps.folder' and trashed = false"+
    " and appProperties has { key='libriOrderCode' and value='"+orderCode+"' }";
  const search=await googleJson(FILE_BASE+'?'+new URLSearchParams({
    q,fields:'files(id,name,mimeType,trashed),nextPageToken',page_size:'100'
  }).toString(),token);
  let id=search.files?.find(f=>f.mimeType==='application/vnd.google-apps.folder')?.id;
  if(!id){
    const created=await googleJson(FILE_BASE+'?fields=id,name,mimeType',token,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({name:orderCode,
        mimeType:'application/vnd.google-apps.folder',
        appProperties:{libriOrderCode:orderCode,libriApp:'libri-pedidos'}})
    });
    id=created.id;
  }
  if(!/^[A-Za-z0-9_-]{15,128}$/.test(String(id||'')))
    throw Error('O Google Drive não retornou o identificador da pasta.');
  // Two different orders can never share a folder in the local mapping.
  await saveOrderDriveFolder(env.DB,orderCode,id);
  return {folderId:id,alreadyLinked:false};
}
export async function uploadApprovedPreview(env,orderCode,previewId){
  needOrder(orderCode);
  const id=Number(previewId);
  if(!Number.isSafeInteger(id)||id<1)throw Error('Selecione uma prévia válida.');
  const approved=await env.DB.prepare(
    'SELECT p.id,p.version_number,p.media_type,p.original_r2_key '+
    'FROM v2_previews p '+
    'JOIN v2_orders o ON o.id=p.order_id '+
    'JOIN v2_preview_approvals a ON a.preview_id=p.id AND a.order_id=p.order_id '+
    "WHERE o.order_code=? AND p.id=? AND p.status='approved' LIMIT 1"
  ).bind(orderCode,id).first();
  if(!approved)throw Error('Esta prévia não foi aprovada ou não pertence ao pedido.');
  if(!approved.original_r2_key)throw Error('Arquivo original aprovado indisponível no R2.');
  const folder=await readOrderDriveFolder(env.DB,orderCode);
  if(!folder?.folderId)throw Error('Vincule ou crie a pasta exclusiva do pedido primeiro.');
  const previous=await env.DB.prepare(
    'SELECT drive_file_id,folder_id FROM v2_drive_uploaded_previews WHERE preview_id=? LIMIT 1'
  ).bind(id).first();
  if(previous){
    if(previous.folder_id!==folder.folderId)
      throw Error('Prévia já enviada a outra pasta. Reveja o vínculo antes de reenviar.');
    return {fileId:previous.drive_file_id,folderId:previous.folder_id,alreadyUploaded:true};
  }
  const token=await getDriveAccessToken(env);
  await folderStatus(folder.folderId,token);
  // First reconcile remote success without a local receipt, avoiding double uploads.
  const query="'"+folder.folderId+"' in parents and trashed = false and "+
    "appProperties has { key='libriPreviewId' and value='"+id+"' }";
  const exists=await googleJson(FILE_BASE+'?'+new URLSearchParams({
    q:query,fields:'files(id,name,parents),nextPageToken',page_size:'100'
  }).toString(),token);
  let fileId=exists.files?.[0]?.id;
  if(!fileId){
    const blob=await env.FILES.get(approved.original_r2_key);
    if(!blob||!blob.body)throw Error('A mídia aprovada não existe mais no armazenamento.');
    if(blob.size<=0||blob.size>40*1024*1024)
      throw Error('Prévia acima de 40 MB. Use uma versão otimizada antes do envio.');
    const mime=blob.httpMetadata?.contentType?.split(';')[0]||'';
    if(!SAFE_MIME.has(mime))throw Error('Formato de mídia não suportado para envio.');
    const filename='Preview_v'+String(approved.version_number).padStart(2,'0')+SAFE_MIME.get(mime);
    const init=await fetch('https://www.googleapis.com/upload/drive/v3/files?'+
      'uploadType=resumable&fields=id,name,parents,appProperties',{
      method:'POST',headers:{
        authorization:'Bearer '+token,
        'content-type':'application/json; charset=UTF-8',
        'x-upload-content-type':mime,
        'x-upload-content-length':String(blob.size)
      },body:JSON.stringify({
        name:filename,parents:[folder.folderId],
        appProperties:{libriPreviewId:String(id),libriOrderCode:orderCode}
      })
    });
    if(!init.ok)throw Error('Não foi possível preparar o envio ao Drive ('+init.status+').');
    const location=init.headers.get('location');
    let uri;
    try{uri=new URL(location);}catch{throw Error('Google Drive não retornou sessão de upload válida.');}
    if(uri.protocol!=='https:'||
      !['www.googleapis.com','upload.googleapis.com','content.googleapis.com'].includes(uri.hostname))
      throw Error('Sessão de upload não confiável.');
    const upload=await fetch(uri.href,{method:'PUT',
      headers:{'content-type':mime,'content-length':String(blob.size)},
      body:blob.body,duplex:'half'});
    if(!upload.ok)throw Error('Google Drive não confirmou o envio ('+upload.status+').');
    const outcome=await upload.json();
    fileId=outcome.id;
    if(!/^[A-Za-z0-9_-]{12,128}$/.test(String(fileId||'')))
      throw Error('Google Drive não retornou o identificador do arquivo.');
  }
  await env.DB.prepare(
    'INSERT OR IGNORE INTO v2_drive_uploaded_previews(preview_id,order_code,folder_id,drive_file_id) VALUES (?,?,?,?)'
  ).bind(id,orderCode,folder.folderId,fileId).run();
  return {fileId,folderId:folder.folderId,alreadyUploaded:false,
    filename:'Preview_v'+String(approved.version_number).padStart(2,'0'),
    message:'Arquivo aprovado enviado à pasta do pedido.'};
}
