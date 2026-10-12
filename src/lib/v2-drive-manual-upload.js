import {getDriveAccessToken} from './v2-google-drive-oauth.js';
import {readOrderDriveFolder,parseDriveFolderId} from './v2-drive-folder.js';
const BASE='https://www.googleapis.com/drive/v3/files';
const MIME=new Set(['image/png','image/jpeg','image/webp','video/mp4','video/webm','application/pdf']);
export async function verifyDriveFolder(env,raw){
  const id=parseDriveFolderId(raw),token=await getDriveAccessToken(env);
  const response=await fetch(BASE+'/'+id+'?fields=id,mimeType,trashed',{headers:{authorization:'Bearer '+token}});
  if(!response.ok)throw Error('Esta pasta não está autorizada para o aplicativo. Crie uma pasta pelo Pedidos ou use uma já autorizada.');
  const info=await response.json();
  if(info.trashed||info.mimeType!=='application/vnd.google-apps.folder')throw Error('Escolha uma pasta válida.');
  return {id,token};
}
export async function uploadOrderFile(env,code,file){
  if(!file||typeof file.stream!=='function'||file.size<=0||file.size>40*1024*1024)throw Error('Escolha um arquivo de até 40 MB.');
  if(!MIME.has(file.type))throw Error('Use PNG, JPEG, WebP, MP4, WebM ou PDF.');
  const folder=await readOrderDriveFolder(env.DB,code);
  if(!folder?.folderId)throw Error('Crie ou vincule a pasta do pedido primeiro.');
  const {id,token}=await verifyDriveFolder(env,folder.folderId);
  const name=String(file.name||'arquivo').replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,180);
  const init=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,parents',{
    method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',
      'x-upload-content-type':file.type,'x-upload-content-length':String(file.size)},
    body:JSON.stringify({name,parents:[id],appProperties:{libriOrderCode:code}})
  });
  if(!init.ok)throw Error('O Drive não preparou o envio.');
  let location;
  try{location=new URL(init.headers.get('location'));}catch{throw Error('Sessão de envio inválida.');}
  if(location.protocol!=='https:'||!['www.googleapis.com','upload.googleapis.com','content.googleapis.com'].includes(location.hostname))throw Error('Sessão de envio não confiável.');
  const response=await fetch(location.href,{method:'PUT',headers:{'content-type':file.type,'content-length':String(file.size)},body:file.stream(),duplex:'half'});
  if(!response.ok)throw Error('O Drive não confirmou o envio.');
  const result=await response.json();
  if(!/^[A-Za-z0-9_-]{12,128}$/.test(result.id||''))throw Error('O Drive não confirmou o arquivo.');
  return {fileId:result.id,folderId:id,filename:name};
}
