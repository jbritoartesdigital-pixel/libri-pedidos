import { fail, json, readJson } from '../lib/http.js';
import { listAteliePackages, updateAtelieDraft } from '../lib/v3-atelie-catalog.js';
import { setAtelieSaleStatus } from '../lib/v3-atelie-release.js';
import { getAtelieArtProgress, updateAtelieArtProgress } from '../lib/v3-atelie-art-production.js';
import { getAtelieAdminBriefing } from '../lib/v3-atelie-customer-briefing.js';
import { reopenAtelieCreativeBriefing } from '../lib/v3-atelie-briefing-submission.js';
import { streamAtelieAdminImage } from '../lib/v3-atelie-uploads.js';

// As rotas são chamadas SOMENTE depois da autenticação Passkey comum do Admin V2.
export async function handleAdminAtelieV3Api(request, env, url) {
  const path=url.pathname;
  if (path==='/api/admin/v2/atelie/packages' && request.method==='GET') {
    return json({ok:true,packages:await listAteliePackages(env.DB,{admin:true}),
      salesStatus:'blocked_pending_catalog_v4_1_checkout_and_capacity'});
  }
  const saleMatch=path.match(/^\/api\/admin\/v2\/atelie\/packages\/(essencia|encanto|universo)\/sales$/);
  if(saleMatch && request.method==='POST'){
    try{
      const body=await readJson(request);
      if(typeof body?.enabled!=='boolean')return fail('Informe se deseja ativar ou pausar as vendas.',422);
      const status=await setAtelieSaleStatus(env.DB,saleMatch[1],body.enabled);
      return json({ok:true,status,packages:await listAteliePackages(env.DB,{admin:true})});
    }catch(e){return fail(e.message||'Não foi possível atualizar a venda.',422);}
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
  const imageMatch=path.match(
    /^\/api\/admin\/v2\/atelie\/orders\/(LIBRI-\d{1,12})\/briefing\/uploads\/(\d+)\/content$/
  );
  if(imageMatch && request.method==='GET')
    return streamAtelieAdminImage(env,imageMatch[1],Number(imageMatch[2]));

  const reopenMatch=path.match(
    /^\/api\/admin\/v2\/atelie\/orders\/(LIBRI-\d{1,12})\/briefing\/reopen$/
  );
  if(reopenMatch && request.method==='POST') {
    try {
      const briefing=await reopenAtelieCreativeBriefing(env.DB,reopenMatch[1],await readJson(request));
      return briefing?json({ok:true,briefing}):fail('Pedido do Ateliê não encontrado.',404);
    }catch(e){return fail(e.message||'Não foi possível reabrir.',e.status||422);}
  }
  const briefingMatch=path.match(/^\/api\/admin\/v2\/atelie\/orders\/(LIBRI-\d{1,12})\/briefing$/);
  if(briefingMatch && request.method==='GET') {
    const briefing=await getAtelieAdminBriefing(env.DB,briefingMatch[1]);
    return briefing?json({ok:true,briefing}):fail('Pedido de identidade visual não encontrado.',404);
  }
  const artMatch=path.match(/^\/api\/admin\/v2\/atelie\/orders\/(LIBRI-\d{1,12})\/production$/);
  if (artMatch && request.method==='GET') {
    const item=await getAtelieArtProgress(env.DB,artMatch[1]);
    if(!item)return fail('Pedido de identidade visual não encontrado.',404);
    return json({ok:true,progress:item});
  }
  if (artMatch && request.method==='PATCH') {
    try {
      const body=await readJson(request);
      if(JSON.stringify(body).length>4000)return fail('Dados de produção muito grandes.',413);
      const progress=await updateAtelieArtProgress(env.DB,artMatch[1],body);
      return json({ok:true,progress});
    }catch(e){return fail(e.message||'Não foi possível atualizar a etapa artística.',422);}
  }
  return null;
}
