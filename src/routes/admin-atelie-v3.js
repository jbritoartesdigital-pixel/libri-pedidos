import { fail, json, readJson } from '../lib/http.js';
import { listAteliePackages, updateAtelieDraft } from '../lib/v3-atelie-catalog.js';

// As rotas são chamadas SOMENTE depois da autenticação Passkey comum do Admin V2.
export async function handleAdminAtelieV3Api(request, env, url) {
  const path=url.pathname;
  if (path==='/api/admin/v2/atelie/packages' && request.method==='GET') {
    return json({ok:true,packages:await listAteliePackages(env.DB,{admin:true}),
      salesStatus:'blocked_pending_catalog_v4_1_checkout_and_capacity'});
  }
  const match=path.match(/^\/api\/admin\/v2\/atelie\/packages\/(essencia|encanto|universo)$/);
  if (match && request.method==='PATCH') {
    try {
      const body=await readJson(request);
      if (JSON.stringify(body).length>16000) return fail('Configuração muito grande.',413);
      return json({ok:true,package:await updateAtelieDraft(env.DB,match[1],body)});
    } catch(error) {
      return fail(error.message||'Não foi possível salvar o pacote.',422);
    }
  }
  return null;
}
