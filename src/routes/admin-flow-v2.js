import { json,fail,readJson } from '../lib/http.js';
import { listFlowProductionOrders } from '../lib/v2-flow-orders.js';
import {bindFlowPublication} from '../lib/v2-flow-publication.js';

// Admin Passkey gate runs before this route, never accessible to guests.
export async function handleAdminFlowV2Api(request, env, url) {
 if(url.pathname==='/api/admin/v2/flow/projects'){
  if(request.method!=='GET')return fail('Método não permitido.',405);
  return json({ok:true,readOnly:true,projects:await listFlowProductionOrders(env.DB)});
 }
 const match=/^\/api\/admin\/v2\/flow\/orders\/(LIBRI-[0-9]{1,15})\/publication$/.exec(url.pathname);
 if(!match)return null;
 if(request.method!=='PUT')return fail('Método não permitido.',405);
 if(request.headers.get('origin')!=='https://pedidos.libriconvites.com.br')return fail('Origem não autorizada.',403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return fail('Envie JSON.',415);
 try{
  const body=await readJson(request);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).join(',')!=='slug')return fail('Informe apenas o slug do convite.',400);
  return json({ok:true,link:await bindFlowPublication(env.DB,match[1],body.slug)});
 }catch(e){return fail(e.message||'Não foi possível vincular este convite.',409);}
}
