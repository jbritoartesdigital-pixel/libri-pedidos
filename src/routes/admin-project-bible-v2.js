import {json,fail} from '../lib/http.js';
import {getApprovedProjectBible} from '../lib/v2-project-bible.js';

// Admin Passkey gate runs in src/index.js. Retain approved-preview history
// independently from all retired Drive or Flow connections.
export async function handleAdminProjectBibleV2Api(request,env,url){
  const match=/^\/api\/admin\/v2\/orders\/(LIBRI-\d{1,15})\/project-bible$/.exec(url.pathname);
  if(!match)return null;
  if(request.method!=='GET')return fail('Método não permitido.',405);
  const data=await getApprovedProjectBible(env.DB,match[1]);
  return data?json({ok:true,projectBible:data}):fail('Pedido não encontrado.',404);
}
