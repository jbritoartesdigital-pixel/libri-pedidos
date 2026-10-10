import {fail,json,readJson} from '../lib/http.js';
import {readOrderDriveFolder,saveOrderDriveFolder} from '../lib/v2-drive-folder.js';
import {getApprovedProjectBible} from '../lib/v2-project-bible.js';
import {driveConnectionStatus,startDriveOAuth,finishDriveOAuth,disconnectDrive}
  from '../lib/v2-google-drive-oauth.js';
import {createOrderDriveFolder,uploadApprovedPreview} from '../lib/v2-google-drive-upload.js';

/** Admin-only. Called after requireAdminPasskeyAuth in src/index.js. */
export async function handleAdminDriveFolderV2Api(request,env,url){
  const method=request.method.toUpperCase();
  const path=url.pathname;
  if(path==='/api/admin/v2/drive/status'){
    return method==='GET'?json({ok:true,drive:await driveConnectionStatus(env)}):
      fail('Método não permitido.',405);
  }
  if(path==='/api/admin/v2/drive/oauth/start'){
    if(method!=='POST')return fail('Método não permitido.',405);
    try{
      return json({ok:true,...await startDriveOAuth(env)});
    }catch(error){return fail(error.message||'Não foi possível iniciar a conexão.',503);}
  }
  if(path==='/api/admin/v2/drive/oauth/callback'){
    if(method!=='GET')return fail('Método não permitido.',405);
    if(url.searchParams.has('error'))return Response.redirect(
      'https://pedidos.libriconvites.com.br/admin-v2?drive=cancelled',302);
    try{
      await finishDriveOAuth(env,{
        state:url.searchParams.get('state')||'',
        code:url.searchParams.get('code')||''
      });
      return Response.redirect('https://pedidos.libriconvites.com.br/admin-v2?drive=connected',302);
    }catch{
      return Response.redirect('https://pedidos.libriconvites.com.br/admin-v2?drive=error',302);
    }
  }
  if(path==='/api/admin/v2/drive/connection'){
    if(method!=='DELETE')return fail('Método não permitido.',405);
    return json({ok:true,drive:await disconnectDrive(env)});
  }
  const folderCreate=/^\/api\/admin\/v2\/orders\/(LIBRI-\d{1,15})\/drive\/create-folder$/.exec(path);
  if(folderCreate){
    if(method!=='POST')return fail('Método não permitido.',405);
    try{
      const result=await createOrderDriveFolder(env,folderCreate[1]);
      return json({ok:true,folder:result});
    }catch(error){return fail(error.message||'Não foi possível criar pasta.',409);}
  }
  const mediaUpload=/^\/api\/admin\/v2\/orders\/(LIBRI-\d{1,15})\/drive\/upload-approved-preview$/.exec(path);
  if(mediaUpload){
    if(method!=='POST')return fail('Método não permitido.',405);
    try{
      const body=await readJson(request);
      if(!body||typeof body!=='object'||Array.isArray(body)||
         Object.keys(body).some(key=>key!=='previewId'))return fail('ID de prévia inválido.',422);
      const data=await uploadApprovedPreview(env,mediaUpload[1],body.previewId);
      return json({ok:true,upload:data});
    }catch(error){return fail(error.message||'Não foi possível enviar a prévia.',409);}
  }
  const bible=/^\/api\/admin\/v2\/orders\/(LIBRI-\d{1,15})\/project-bible$/.exec(url.pathname);
  if(bible){
    if(request.method.toUpperCase()!=='GET')return fail('Método não permitido.',405);
    const data=await getApprovedProjectBible(env.DB,bible[1]);
    return data?json({ok:true,projectBible:data}):fail('Pedido não encontrado.',404);
  }
  const match=/^\/api\/admin\/v2\/orders\/(LIBRI-\d{1,15})\/drive-folder$/.exec(url.pathname);
  if(!match)return null;

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
