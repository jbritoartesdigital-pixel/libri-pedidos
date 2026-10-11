import {fail,json,readJson} from '../lib/http.js';
import {driveConnectionStatus} from '../lib/v2-google-drive-oauth.js';
import {startFlowDriveUpload,forwardFlowDriveChunk,getFlowDriveUploadStatus} from '../lib/v2-flow-drive-delivery.js';
// Reached only after Libri Pedidos' existing administrative Passkey gate.
export async function handleAdminFlowDriveV2Api(request,env,url){
 const p=url.pathname,m=request.method;
 if(p==='/api/admin/v2/flow/drive/status')
  return m==='GET'?json({ok:true,drive:await driveConnectionStatus(env)}):fail('Método não permitido.',405);
 const start=p==='/api/admin/v2/flow/drive/start';
 const match=/^\/api\/admin\/v2\/flow\/drive\/uploads\/([a-f0-9-]{36})$/.exec(p);
 if(!start&&!match)return null;
 if(!((start&&m==='POST')||(match&&(m==='GET'||m==='PUT'))))return fail('Método não permitido.',405);
 if(m!=='GET'&&request.headers.get('origin')!=='https://pedidos.libriconvites.com.br')return fail('Origem não autorizada.',403);
 try{
  if(start){
   if(!request.headers.get('content-type')?.startsWith('application/json'))return fail('Envie JSON.',415);
   if(Number(request.headers.get('content-length')||0)>1024)return fail('Solicitação muito grande.',413);
   const body=await readJson(request);
   if(!body||typeof body!=='object'||Array.isArray(body)||
    Object.keys(body).some(k=>!['orderCode','filename','size','sha256'].includes(k)))
    return fail('Metadados de arquivo inválidos.',400);
   return json({ok:true,upload:await startFlowDriveUpload(env,body)});
  }
  if(m==='GET')return json({ok:true,upload:await getFlowDriveUploadStatus(env,match[1])});
  const offset=Number(request.headers.get('x-libri-flow-offset'));
  if(request.headers.get('content-type')!=='application/octet-stream'||
   !Number.isSafeInteger(offset)||offset<0)return fail('Bloco inválido.',400);
  if(Number(request.headers.get('content-length')||0)>4*1024*1024)return fail('Bloco excede 4 MB.',413);
  return json({ok:true,upload:await forwardFlowDriveChunk(env,match[1],offset,request)});
 }catch(e){
  if(e instanceof SyntaxError)return fail('Solicitação JSON inválida.',400);
  if(/sessão|integridade|exist|versão|andamento|posição|vencid|inválid|excede|limite|bloco|autoriza|conectad|pasta|pedido|tamanho|nome/i.test(e.message||''))
   return fail(e.message,409);
  console.error('Libri Flow Drive integration failure',e?.name||'Error');
  return fail('Não foi possível concluir o envio ao Drive.',503);
 }
}
