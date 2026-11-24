import {json,fail,readJson} from '../lib/http.js';
import {getV3ModularBriefing,saveV3ModuleDraft,recordV3RetroMaterialReceipt} from '../lib/v3-modular-briefing.js';
const errorResponse=e=>fail(e?.status?e.message:'Não foi possível atualizar o briefing.',Number(e?.status)||422);
async function boundedJson(request){
  const size=Number(request.headers.get('content-length')||0);
  if(size>100000){const e=new Error('Dados muito grandes.');e.status=413;throw e;}
  const body=await readJson(request);
  if(!body||typeof body!=='object'||Array.isArray(body)||JSON.stringify(body).length>100000){const e=new Error('Dados inválidos ou muito grandes.');e.status=422;throw e;}
  return body;
}
export async function handleCustomerBriefingV3Api(request,env,url){
  const match=url.pathname.match(/^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/v3\/briefing(?:\/(shared|convite|identidade_visual|retrospectiva))?$/);
  if(!match)return null;
  try{
    const [,token,module]=match;
    const result=request.method==='GET'&&!module
      ?await getV3ModularBriefing(env.DB,token)
      :request.method==='PATCH'&&module
        ?await saveV3ModuleDraft(env.DB,token,module,await boundedJson(request))
        :undefined;
    if(result===undefined)return fail('Método não permitido.',405);
    return result?json({ok:true,briefing:result}):fail('Pedido não encontrado.',404);
  }catch(e){return errorResponse(e);}
}
// This handler must remain exclusively inside the existing authenticated
// Admin dispatcher. No customer token or public API can confirm receipt.
export async function handleAdminBriefingV3Api(request,env,url){
  const match=url.pathname.match(/^\/api\/admin\/v2\/orders\/(LIBRI-\d{1,12})\/v3\/briefing(?:\/(retro-materials))?$/);
  if(!match)return null;
  try{
    const row=await env.DB.prepare(`SELECT o.id,o.public_token FROM v2_orders o JOIN v3_order_checkout_snapshots s ON s.order_id=o.id WHERE o.order_code=?`).bind(match[1]).first();
    if(!row)return fail('Pedido combinado não encontrado.',404);
    if(request.method==='GET'&&!match[2])return json({ok:true,briefing:await getV3ModularBriefing(env.DB,row.public_token)});
    if(request.method==='POST'&&match[2]){
      const receipt=await recordV3RetroMaterialReceipt(env.DB,row.id,await boundedJson(request));
      return json({ok:true,receipt,briefing:await getV3ModularBriefing(env.DB,row.public_token)});
    }
    return fail('Método não permitido.',405);
  }catch(e){return errorResponse(e);}
}
