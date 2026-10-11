import {getDriveAccessToken,driveConnectionStatus} from './v2-google-drive-oauth.js';
import {readOrderDriveFolder} from './v2-drive-folder.js';
import {createOrderDriveFolder} from './v2-google-drive-upload.js';
const CODE=/^LIBRI-[0-9]{1,15}$/;
const HASH=/^[a-f0-9]{64}$/;
const MD5=/^[a-f0-9]{32}$/;
const FILE=/^[a-z0-9][a-z0-9_ .()-]{0,94}\.(png|jpg|jpeg|webp|mp4|mp3)$/i;
const MIME={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',mp4:'video/mp4',mp3:'audio/mpeg'};
const GOOGLE='https://www.googleapis.com/drive/v3/files';
const MAX=512*1024*1024,CHUNK=4*1024*1024;
function validFile(f){
 if(!f||!CODE.test(f.orderCode)||!FILE.test(f.filename)||!HASH.test(f.sha256)||!MD5.test(f.md5)||!Number.isSafeInteger(f.size)||f.size<1||f.size>MAX)
  throw Error('Arquivo final, tamanho ou pedido inválido.');
 return {...f,mime:MIME[f.filename.split('.').at(-1).toLowerCase()]};
}
async function parseGoogle(response,msg){
 if(!response.ok)throw Error(msg+' ('+response.status+').');
 return response.json();
}
function checkLocation(location){
 let url;
 try{url=new URL(location);}catch{throw Error('Sessão de upload inválida.');}
 if(url.protocol!=='https:'||!['www.googleapis.com','upload.googleapis.com','content.googleapis.com'].includes(url.hostname))
  throw Error('O Google Drive retornou um destino inesperado.');
 return url.href;
}
export async function startFlowDriveUpload(env,input,fetchImpl=fetch){
 const file=validFile(input);
 const existing=await env.DB.prepare('SELECT 1 AS ok FROM v2_orders WHERE order_code=? AND archived_at IS NULL AND status<>\'cancelled\'').bind(file.orderCode).first();
 if(!existing)throw Error('Pedido não existe ou está indisponível.');
 const status=await driveConnectionStatus(env);
 if(!status.configured||!status.connected)throw Error('O Google Drive precisa ser conectado uma única vez no Libri Pedidos.');
 const token=await getDriveAccessToken(env);
 let folder=await readOrderDriveFolder(env.DB,file.orderCode);
 if(!folder?.folderId){
  await createOrderDriveFolder(env,file.orderCode);
  folder=await readOrderDriveFolder(env.DB,file.orderCode);
 }
 if(!folder?.folderId)throw Error('Não foi possível localizar a pasta exclusiva deste pedido.');
 const filter="'"+folder.folderId+"' in parents and trashed = false and name = '"+file.filename.replace(/\\/g,'\\\\').replace(/'/g,"\\'")+"'";
 const list=await parseGoogle(await fetchImpl(GOOGLE+'?'+new URLSearchParams({
  q:filter,fields:'files(id,name,size,appProperties),nextPageToken',pageSize:'100'
 }).toString(),{headers:{authorization:'Bearer '+token}}),'Não consegui consultar a pasta no Drive');
 const found=(list.files||[]).find(f=>f.name===file.filename);
 if(found){
  if(found.appProperties?.libriFlowSha256===file.sha256&&Number(found.size)===file.size)
   return {alreadyUploaded:true,fileId:found.id,folderId:folder.folderId,filename:file.filename};
  throw Error('Já existe um arquivo com esse nome no Google Drive. Nenhuma versão foi substituída.');
 }
 const init=await fetchImpl('https://www.googleapis.com/upload/drive/v3/files?'+
  'uploadType=resumable&fields=id,name,size,md5Checksum,parents,appProperties',{
  method:'POST',
  headers:{authorization:'Bearer '+token,'content-type':'application/json; charset=UTF-8',
   'x-upload-content-type':file.mime,'x-upload-content-length':String(file.size)},
  body:JSON.stringify({name:file.filename,parents:[folder.folderId],
   appProperties:{libriOrderCode:file.orderCode,libriFlowSha256:file.sha256,libriSource:'libri-flow'}})
 });
 if(!init.ok)throw Error('Não foi possível iniciar upload autenticado no Drive ('+init.status+').');
 const sessionUrl=checkLocation(init.headers.get('location'));
 const id=crypto.randomUUID();
 await env.DB.prepare(`INSERT INTO v2_flow_drive_uploads
 (id,order_code,folder_id,filename,mime_type,size_bytes,sha256,md5,session_url,offset_bytes,state)
 VALUES (?,?,?,?,?,?,?,?,?,0,'ready')`).bind(id,file.orderCode,folder.folderId,file.filename,file.mime,
  file.size,file.sha256,file.md5,sessionUrl).run();
 return {id,offset:0,total:file.size,filename:file.filename,folderId:folder.folderId};
}
async function readChunk(request,limit=CHUNK){
 const reader=request.body?.getReader();if(!reader)throw Error('Arquivo vazio.');
 const chunks=[];let length=0;
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;
   length+=value.byteLength;if(length>limit){await reader.cancel().catch(()=>{});throw Error('Bloco acima do limite de 4 MB.');}
   chunks.push(value);
  }
 }finally{reader.releaseLock();}
 if(length<1)throw Error('Bloco vazio.');
 const bytes=new Uint8Array(length);let offset=0;
 for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
 return bytes;
}
export async function forwardFlowDriveChunk(env,id,offset,request,fetchImpl=fetch){
 if(!/^[a-f0-9-]{36}$/.test(id)||!Number.isSafeInteger(offset)||offset<0)throw Error('Sessão inválida.');
 const row=await env.DB.prepare('SELECT * FROM v2_flow_drive_uploads WHERE id=? LIMIT 1').bind(id).first();
 if(!row)throw Error('Upload não encontrado.');
 if(row.state==='done')return {done:true,fileId:row.google_file_id,offset:row.size_bytes,total:row.size_bytes};
 if(row.state!=='ready'||row.offset_bytes!==offset)throw Error('Upload em andamento ou posição diferente. Atualize o estado antes de reenviar.');
 if(Date.now()-Date.parse(row.created_at)>24*3600*1000)throw Error('Sessão vencida. Comece novamente.');
 const bytes=await readChunk(request);
 if(offset+bytes.length>row.size_bytes)throw Error('Bloco excede o tamanho final.');
 const acquired=await env.DB.prepare(`UPDATE v2_flow_drive_uploads SET state='uploading',updated_at=datetime('now')
 WHERE id=? AND state='ready' AND offset_bytes=?`).bind(id,offset).run();
 if(acquired.meta?.changes!==1)throw Error('Outro envio já está em andamento.');
 const expected=offset+bytes.length;
 let response;
 try{
  response=await fetchImpl(checkLocation(row.session_url),{
   method:'PUT',headers:{'content-type':row.mime_type,
    'content-length':String(bytes.length),
    'content-range':'bytes '+offset+'-'+(expected-1)+'/'+row.size_bytes},body:bytes
  });
  if(response.status===308){
   const range=response.headers.get('range');
   if(!range)throw Error('Google Drive não confirmou os bytes recebidos.');
   let next=expected;
   if(range){
    const match=/^bytes=0-([0-9]+)$/.exec(range);
    if(!match||Number(match[1])+1!==expected)throw Error('Google Drive confirmou tamanho inesperado.');
    next=Number(match[1])+1;
   }
   await env.DB.prepare(`UPDATE v2_flow_drive_uploads SET offset_bytes=?,state='ready',updated_at=datetime('now')
    WHERE id=? AND state='uploading'`).bind(next,id).run();
   return {offset:next,total:row.size_bytes,done:false};
  }
  if(response.status!==200&&response.status!==201)throw Error('Drive não confirmou o bloco ('+response.status+').');
  const data=await response.json();
  if(!/^[A-Za-z0-9_-]{12,128}$/.test(data?.id||'')||Number(data.size)!==row.size_bytes||
   data.name!==row.filename||String(data.md5Checksum||'').toLowerCase()!==row.md5)throw Error('Drive não confirmou integridade de nome, tamanho e conteúdo.');
  await env.DB.prepare(`UPDATE v2_flow_drive_uploads SET offset_bytes=?,state='done',
   google_file_id=?,updated_at=datetime('now') WHERE id=? AND state='uploading'`)
   .bind(row.size_bytes,data.id,id).run();
  return {done:true,fileId:data.id,offset:row.size_bytes,total:row.size_bytes,filename:row.filename};
 }catch(e){
  // Fail closed. The next request MUST reconcile the Google resumable session;
  // never resend bytes with an unknown remote offset automatically.
  await env.DB.prepare(`UPDATE v2_flow_drive_uploads SET state='failed',updated_at=datetime('now')
   WHERE id=? AND state='uploading'`).bind(id).run();
  throw e;
 }
}
export async function getFlowDriveUploadStatus(env,id){
 if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Sessão inválida.');
 const row=await env.DB.prepare('SELECT order_code,filename,size_bytes,offset_bytes,state,google_file_id FROM v2_flow_drive_uploads WHERE id=?').bind(id).first();
 if(!row)throw Error('Sessão não encontrada.');
 return {orderCode:row.order_code,filename:row.filename,total:row.size_bytes,
  offset:row.offset_bytes,done:row.state==='done',failed:row.state==='failed',fileId:row.google_file_id||null};
}
