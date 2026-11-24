import {previewV3SupplementCapacity,startV3SupplementPayment,verifyV3SupplementPayment} from '../lib/v3-supplement-payment.js';
import {previewV3Supplement,createV3Supplement,decideV3Supplement} from '../lib/v3-service-supplements.js';
import {stageV3FinalFile,removeV3FinalFile,deliverV3Service,downloadV3FinalFile} from '../lib/v3-service-delivery.js';
import {changeV3Production,publishV3ServicePreview,streamV3ServicePreview} from '../lib/v3-service-production.js';
import {uploadV3ServiceImage,getV3ServiceImage,deleteV3ServiceImage} from '../lib/v3-service-uploads.js';
import {previewV3ServiceAgenda,scheduleV3Service} from '../lib/v3-service-agenda.js';
import {getV3AdminBriefing,reviewV3ServiceBriefing} from '../lib/v3-admin-briefing.js';
import {json,fail,readJson} from '../lib/http.js';
import {getV3ModularBriefing,saveV3ModuleDraft,recordV3RetroMaterialReceipt,submitV3ServiceBriefing} from '../lib/v3-modular-briefing.js';
const customerBrief=async(env,token)=>{const b=await getV3ModularBriefing(env.DB,token);return b?{...b,supplementPaymentsEnabled:env.LIBRI_V3_SUPPLEMENT_PAYMENT_ENABLED==='true'}:null;};
const errorResponse=e=>fail(e?.status?e.message:'Não foi possível atualizar o briefing.',Number(e?.status)||422);
async function boundedJson(request){
  const size=Number(request.headers.get('content-length')||0);
  if(size>100000){const e=new Error('Dados muito grandes.');e.status=413;throw e;}
  const body=await readJson(request);
  if(!body||typeof body!=='object'||Array.isArray(body)||JSON.stringify(body).length>100000){const e=new Error('Dados inválidos ou muito grandes.');e.status=422;throw e;}
  return body;
}
export async function handleCustomerBriefingV3Api(request,env,url){
  const supplementalPayment=url.pathname.match(/^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/v3\/supplements\/(convite|identidade_visual|retrospectiva)\/(\d+)\/(pay|verify|renew)$/);
  if(supplementalPayment){
    if(request.method!=='POST')return fail('Método não permitido.',405);
    try{
      const [,token,family,id,action]=supplementalPayment;
      const input=await boundedJson(request);
      if(action!=='verify'&&input.confirmed!==true)return fail('Confirme o pagamento complementar.',422);
      const result=action==='verify'?await verifyV3SupplementPayment(env,token,family,Number(id)):await startV3SupplementPayment(request,env,token,family,Number(id),{renew:action==='renew'});
      return result?json({ok:true,result,briefing:await customerBrief(env,token)}):fail('Pedido não encontrado.',404);
    }catch(e){return errorResponse(e);}
  }
  const supplement=url.pathname.match(/^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/v3\/supplements\/(convite|identidade_visual|retrospectiva)\/(\d+)\/decision$/);
  if(supplement){
    if(request.method!=='POST')return fail('Método não permitido.',405);
    try{
      const [,token,family,id]=supplement;
      const result=await decideV3Supplement(env.DB,token,family,Number(id),await boundedJson(request),'customer');
      return result?json({ok:true,result,briefing:await customerBrief(env,token)}):fail('Pedido não encontrado.',404);
    }catch(e){return errorResponse(e);}
  }
  const final=url.pathname.match(/^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/v3\/delivery\/(convite|identidade_visual|retrospectiva)\/files\/(\d+)$/);
  if(final){if(request.method!=='GET')return fail('Método não permitido.',405);try{return await downloadV3FinalFile(env,final[1],final[2],Number(final[3]));}catch(e){return errorResponse(e);}}
  const production=url.pathname.match(/^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/v3\/production\/(convite|identidade_visual|retrospectiva)(?:\/preview\/(\d+))?$/);
  if(production){
    const [,token,family,id]=production;
    try{
      if(request.method==='GET'&&id)return await streamV3ServicePreview(env,token,family,Number(id),request);
      if(request.method==='POST'&&!id){const result=await changeV3Production(env.DB,token,family,await boundedJson(request),'customer');return result?json({ok:true,result,briefing:await customerBrief(env,token)}):fail('Pedido não encontrado.',404);}
      return fail('Método não permitido.',405);
    }catch(e){return errorResponse(e);}
  }
  const upload=url.pathname.match(/^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/v3\/briefing\/(convite|identidade_visual)\/uploads(?:\/(\d+)(\/content)?)?$/);
  if(upload){
    const [,token,family,id,content]=upload;
    try{
      if(request.method==='POST'&&!id){const result=await uploadV3ServiceImage(request,env,token,family);return result?json({ok:true,result},201):fail('Pedido não encontrado.',404);}
      if(request.method==='GET'&&id&&content)return await getV3ServiceImage(env,token,family,Number(id));
      if(request.method==='DELETE'&&id&&!content){const result=await deleteV3ServiceImage(env,token,family,Number(id));return result?json({ok:true}):fail('Arquivo não encontrado.',404);}
      return fail('Método não permitido.',405);
    }catch(e){return errorResponse(e);}
  }
  const submit=url.pathname.match(/^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/v3\/briefing\/(convite|identidade_visual|retrospectiva)\/submit$/);
  if(submit){
    if(request.method!=='POST')return fail('Método não permitido.',405);
    try{const result=await submitV3ServiceBriefing(env.DB,submit[1],submit[2],await boundedJson(request));return result?json({ok:true,briefing:result}):fail('Pedido não encontrado.',404);}catch(e){return errorResponse(e);}
  }
  const match=url.pathname.match(/^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/v3\/briefing(?:\/(shared|convite|identidade_visual|retrospectiva))?$/);
  if(!match)return null;
  try{
    const [,token,module]=match;
    const result=request.method==='GET'&&!module
      ?await customerBrief(env,token)
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
  const supplement=url.pathname.match(/^\/api\/admin\/v2\/orders\/(LIBRI-\d{1,12})\/v3\/supplements\/(convite|identidade_visual|retrospectiva)\/(preview|create|\d+\/(?:cancel|capacity|verify))$/);
  if(supplement){
    if(request.method!=='POST')return fail('Método não permitido.',405);
    try{
      const [,code,family,action]=supplement;
      const row=await env.DB.prepare('SELECT o.public_token FROM v2_orders o JOIN v3_order_checkout_snapshots s ON s.order_id=o.id WHERE o.order_code=?').bind(code).first();
      if(!row)return fail('Pedido V3 não encontrado.',404);
      const body=await boundedJson(request);
      const id=Number(action.split('/')[0]);
      const result=action==='preview'?await previewV3Supplement(env.DB,row.public_token,family,body):action==='create'?await createV3Supplement(env.DB,row.public_token,family,body):action.endsWith('/capacity')?await previewV3SupplementCapacity(env.DB,row.public_token,family,id):action.endsWith('/verify')?await verifyV3SupplementPayment(env,row.public_token,family,id):await decideV3Supplement(env.DB,row.public_token,family,id,{action:'cancel'},'admin');
      return json({ok:true,result,briefing:await getV3AdminBriefing(env.DB,row.public_token)});
    }catch(e){return errorResponse(e);}
  }
  const final=url.pathname.match(/^\/api\/admin\/v2\/orders\/(LIBRI-\d{1,12})\/v3\/delivery\/(convite|identidade_visual|retrospectiva)\/(publish|files)(?:\/(\d+))?$/);
  if(final){
    const [,code,family,action,id]=final;
    try{
      const row=await env.DB.prepare('SELECT o.public_token FROM v2_orders o JOIN v3_order_checkout_snapshots s ON s.order_id=o.id WHERE o.order_code=?').bind(code).first();
      if(!row)return fail('Pedido V3 não encontrado.',404);
      if(action==='files'&&id&&request.method==='GET')return await downloadV3FinalFile(env,row.public_token,family,Number(id),{admin:true});
      let result;
      if(action==='publish'&&!id&&request.method==='POST')result=await deliverV3Service(env,row.public_token,family,await boundedJson(request));
      else if(action==='files'&&!id&&request.method==='POST')result=await stageV3FinalFile(request,env,row.public_token,family);
      else if(action==='files'&&id&&request.method==='DELETE')result=await removeV3FinalFile(env,row.public_token,family,Number(id),(await boundedJson(request)).version);
      else return fail('Método não permitido.',405);
      return json({ok:true,result,briefing:await getV3AdminBriefing(env.DB,row.public_token)});
    }catch(e){return errorResponse(e);}
  }
  const production=url.pathname.match(/^\/api\/admin\/v2\/orders\/(LIBRI-\d{1,12})\/v3\/production\/(convite|identidade_visual|retrospectiva)(?:\/preview(?:\/(\d+))?)?$/);
  if(production){
    const [,code,family,id]=production;
    try{
      const row=await env.DB.prepare('SELECT o.public_token FROM v2_orders o JOIN v3_order_checkout_snapshots s ON s.order_id=o.id WHERE o.order_code=?').bind(code).first();
      if(!row)return fail('Pedido V3 não encontrado.',404);
      if(request.method==='GET'&&id)return await streamV3ServicePreview(env,row.public_token,family,Number(id),request);
      if(request.method==='POST'&&!id){
        const result=url.pathname.endsWith('/preview')?await publishV3ServicePreview(request,env,row.public_token,family):await changeV3Production(env.DB,row.public_token,family,await boundedJson(request),'admin');
        return json({ok:true,result,briefing:await getV3AdminBriefing(env.DB,row.public_token)});
      }
      return fail('Método não permitido.',405);
    }catch(e){return errorResponse(e);}
  }
  const agenda=url.pathname.match(/^\/api\/admin\/v2\/orders\/(LIBRI-\d{1,12})\/v3\/agenda\/(convite|identidade_visual|retrospectiva)\/(preview|schedule)$/);
  if(agenda){
    if(request.method!=='POST')return fail('Método não permitido.',405);
    try{
      const row=await env.DB.prepare('SELECT o.public_token FROM v2_orders o JOIN v3_order_checkout_snapshots s ON s.order_id=o.id WHERE o.order_code=?').bind(agenda[1]).first();
      if(!row)return fail('Pedido V3 não encontrado.',404);
      const body=await boundedJson(request);
      const result=agenda[3]==='preview'?await previewV3ServiceAgenda(env.DB,row.public_token,agenda[2],body):await scheduleV3Service(env.DB,row.public_token,agenda[2],body);
      return json({ok:true,result,briefing:await getV3AdminBriefing(env.DB,row.public_token)});
    }catch(e){return errorResponse(e);}
  }
  const match=url.pathname.match(/^\/api\/admin\/v2\/orders\/(LIBRI-\d{1,12})\/v3\/briefing(?:\/(retro-materials)|(\/(?:convite|identidade_visual|retrospectiva)\/review)|(\/(?:convite|identidade_visual)\/uploads\/\d+\/content))?$/);
  if(!match)return null;
  try{
    const row=await env.DB.prepare(`SELECT o.id,o.public_token FROM v2_orders o JOIN v3_order_checkout_snapshots s ON s.order_id=o.id WHERE o.order_code=?`).bind(match[1]).first();
    if(!row)return fail('Pedido V3 não encontrado.',404);
    if(request.method==='GET'&&!match[2]&&!match[3]&&!match[4])return json({ok:true,briefing:await getV3AdminBriefing(env.DB,row.public_token)});
    if(request.method==='POST'&&match[2]){
      const receipt=await recordV3RetroMaterialReceipt(env.DB,row.id,await boundedJson(request));
      return json({ok:true,receipt,briefing:await getV3AdminBriefing(env.DB,row.public_token)});
    }
    if(request.method==='POST'&&match[3]){
      const family=match[3].split('/')[1];
      return json({ok:true,briefing:await reviewV3ServiceBriefing(env.DB,row.public_token,family,await boundedJson(request))});
    }
    if(request.method==='GET'&&match[4]){
      const [,family,,id]=match[4].split('/');
      return await getV3ServiceImage(env,row.public_token,family,Number(id));
    }
    return fail('Método não permitido.',405);
  }catch(e){return errorResponse(e);}
}
