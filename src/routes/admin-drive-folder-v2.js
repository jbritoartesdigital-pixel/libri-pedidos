import {fail,json,readJson} from '../lib/http.js';
import {readOrderDriveFolder,saveOrderDriveFolder} from '../lib/v2-drive-folder.js';

/** Admin-only. Called after requireAdminPasskeyAuth in src/index.js. */
export async function handleAdminDriveFolderV2Api(request,env,url){
  const match=/^\/api\/admin\/v2\/orders\/(LIBRI-\d{1,15})\/drive-folder$/.exec(url.pathname);
  if(!match)return null;
  const method=request.method.toUpperCase();
  if(method!=='GET'&&method!=='PUT')return fail('Método não permitido.',405);
  try{
    if(method==='GET'){
      const result=await readOrderDriveFolder(env.DB,match[1]);
      return result?json({ok:true,drive:result}):fail('Pedido não encontrado.',404);
    }
    const body=await readJson(request);
    if(!body||typeof body!=='object'||Array.isArray(body)||
      Object.keys(body).some(key=>key!=='folderId')){
      return fail('Envie somente o identificador da pasta.',422);
    }
    const result=await saveOrderDriveFolder(env.DB,match[1],body.folderId);
    return result?json({ok:true,drive:result}):fail('Pedido não encontrado.',404);
  }catch(error){
    return fail(error?.message||'Não foi possível vincular a pasta.',409);
  }
}
