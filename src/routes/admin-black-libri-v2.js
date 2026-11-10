import { fail, json, readJson } from '../lib/http.js';
import {
  getBlackLibriAdmin,
  saveBlackLibriCampaign,
  saveBlackLibriPrize,
} from '../lib/v2-black-libri-admin.js';

function adminError(error) {
  const status=[404,409,422,503].includes(Number(error?.status))
    ? Number(error.status) : 500;
  return fail(
    status===500 ? 'Não foi possível atualizar a Black Libri.' : error.message,
    status, {code: error?.code || 'black_libri_admin_error'}
  );
}

// Chamado APENAS após a autenticação Passkey global do Admin V2.
export async function handleAdminBlackLibriV2Api(request,env,url) {
  const method=request.method.toUpperCase();
  const path=url.pathname;
  if(method==='GET' && path==='/api/admin/v2/black-libri') {
    try { return json(await getBlackLibriAdmin(env)); }
    catch(error) { return adminError(error); }
  }
  if(method==='PATCH' && path==='/api/admin/v2/black-libri/campaign') {
    try { return json(await saveBlackLibriCampaign(env,await readJson(request))); }
    catch(error) { return adminError(error); }
  }
  const prizeMatch=path.match(/^\/api\/admin\/v2\/black-libri\/prizes\/([a-z0-9_]+)$/);
  if(method==='PATCH' && prizeMatch) {
    try { return json(await saveBlackLibriPrize(env,prizeMatch[1],await readJson(request))); }
    catch(error) { return adminError(error); }
  }
  return null;
}
