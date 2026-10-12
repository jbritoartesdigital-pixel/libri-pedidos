import {getDriveAccessToken} from './v2-google-drive-oauth.js';

const FILES='https://www.googleapis.com/drive/v3/files';
const MARKER='libri-pedidos-connection-check-v1';
async function google(url,token,options={}){
  const response=await fetch(url,{...options,headers:{authorization:'Bearer '+token,...options.headers}});
  if(!response.ok)throw Error('O Drive recusou o teste ('+response.status+').');
  return response.json();
}
/** Explicit admin test: creates only synthetic files; never accesses customer tables. */
export async function checkDriveConnection(env){
  const token=await getDriveAccessToken(env);
  const find=async(q)=>google(FILES+'?'+new URLSearchParams({q,fields:'files(id,name,mimeType,parents)',pageSize:'100'}),token);
  const folders=await find("trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='libriConnectionCheck' and value='"+MARKER+"' }");
  let folder=folders.files?.[0];
  if(!folder)folder=await google(FILES+'?fields=id,name,mimeType',token,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
      name:'Libri Pedidos · teste de conexão',mimeType:'application/vnd.google-apps.folder',
      appProperties:{libriConnectionCheck:MARKER}
    })
  });
  if(!/^[A-Za-z0-9_-]{12,128}$/.test(folder?.id||''))throw Error('Pasta de teste inválida.');
  const existing=await find("trashed = false and '"+folder.id+"' in parents and appProperties has { key='libriConnectionCheck' and value='"+MARKER+"' }");
  let file=existing.files?.[0];
  if(!file){
    const boundary='libri_'+crypto.randomUUID().replaceAll('-','');
    const metadata={name:'conexao-verificada.txt',parents:[folder.id],appProperties:{libriConnectionCheck:MARKER}};
    const body='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(metadata)+
      '\r\n--'+boundary+'\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n'+
      'Teste de conexão do Libri Pedidos. Este arquivo não contém dados de clientes.\r\n--'+boundary+'--\r\n';
    file=await google('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,parents',token,{
      method:'POST',headers:{'content-type':'multipart/related; boundary='+boundary},body
    });
  }
  if(!/^[A-Za-z0-9_-]{12,128}$/.test(file?.id||''))throw Error('Arquivo de teste inválido.');
  const verified=await google(FILES+'/'+file.id+'?fields=id,name,parents,trashed',token);
  if(verified.trashed||!verified.parents?.includes(folder.id))throw Error('O Drive não confirmou a pasta do arquivo.');
  return {folderId:folder.id,fileId:file.id,folderUrl:'https://drive.google.com/drive/folders/'+folder.id,
    message:'Conexão, pasta e envio verificados. Nenhum pedido foi alterado.'};
}
