import {openV3PaidCancellation,refreshV3Cancellation,refundV3CancellationCharge,finalizeV3PaidCancellation} from '../lib/v3-paid-cancellation.js';
import {getV3RevisionEditor,previewV3Revision,createV3Revision,acceptV3Revision,withdrawV3Revision,previewV3ManualOrder,createV3ManualOrder,getV3ManualUpsell,getV3ManualCheckout} from '../lib/v3-order-revisions.js';
import {changeV3AdminDeposit,recordV3AdminBalance,cancelV3UnpaidOrder} from '../lib/v3-admin-payment-policy.js';
import {previewV3SupplementCapacity,startV3SupplementPayment,verifyV3SupplementPayment} from '../lib/v3-supplement-payment.js';
import {previewV3Supplement,createV3Supplement,decideV3Supplement} from '../lib/v3-service-supplements.js';
import {stageV3FinalFile,removeV3FinalFile,deliverV3Service,downloadV3FinalFile} from '../lib/v3-service-delivery.js';
import {changeV3Production,publishV3ServicePreview,publishV3ExternalPreview,streamV3ServicePreview} from '../lib/v3-service-production.js';
import {uploadV3ServiceImage,getV3ServiceImage,deleteV3ServiceImage} from '../lib/v3-service-uploads.js';
import {previewV3ServiceAgenda,scheduleV3Service,releaseV3ServiceCapacity,startV3ServiceFromBriefing} from '../lib/v3-service-agenda.js';
import {recoverV3PaidCapacity,getV3AdminBriefing,reviewV3ServiceBriefing} from '../lib/v3-admin-briefing.js';
import {json,fail,readJson} from '../lib/http.js';
import {decideV2Urgency} from '../lib/v2-urgency-admin.js';
import {getV3ModularBriefing,saveV3ModuleDraft,recordV3RetroMaterialReceipt,submitV3ServiceBriefing} from '../lib/v3-modular-briefing.js';
import {recoverV3Checkout} from '../lib/v3-checkout.js';
const customerBrief=async(env,token)=>{const b=await getV3ModularBriefing(env.DB,token);return b?{...b,manualUpsell:b.revision?.kind==='manual'?await getV3ManualUpsell(env.DB,token).catch(()=>null):null,supplementPaymentsEnabled:env.LIBRI_V3_SUPPLEMENT_PAYMENT_ENABLED==='true'}:null;};
const errorResponse=e=>fail(e?.status?e.message:'Não foi possível atualizar o briefing.',Number(e?.status)||422);
async function boundedJson(request){
  const size=Number(request.headers.get('content-length')||0);
  if(size>100000){const e=new Error('Dados muito grandes.');e.status=413;throw e;}
  const body=await readJson(request);
  if(!body||typeof body!=='object'||Array.isArray(body)||JSON.stringify(body).length>100000){const e=new Error('Dados inválidos ou muito grandes.');e.status=422;throw e;}
  return body;
}
export async function handleCustomerBriefingV3Api(request,env,url){
 const manualCheckout=url.pathname.match(/^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/v3\/manual-checkout\/(catalog|quote|status|reveal|preview|finish)$/);
 if(manualCheckout){
  const [,token,action]=manualCheckout;
  if(request.method!==(action==='catalog'?'GET':'POST'))return fail('Método não permitido.',405);
  try{
   if(action==='finish'){
    const input=await boundedJson(request);
    if(input.termsAccepted!==true||input.confirmed!==true)return fail('Leia e aceite os termos da contratação.',422);
    const result=await acceptV3Revision(env.DB,token,{...input,manualCheckout:true});
    if(!result)return fail('Pedido não encontrado.',404);
    const payment=await recoverV3Checkout(request,env,{publicToken:token},{renew:true});
    return json({ok:true,payment});
   }
   const result=await getV3ManualCheckout(env,token,action,action==='catalog'?{}:await boundedJson(request));
   return json({ok:true,...result});
  }catch(e){return errorResponse(e);}
 }

 const revision=url.pathname.match(/^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/v3\/revision\/accept$/);
 if(revision){
  if(request.method!=='POST')return fail('Método não permitido.',405);
  try{const result=await acceptV3Revision(env.DB,revision[1],await boundedJson(request));return result?json({ok:true,result,briefing:await customerBrief(env,revision[1])}):fail('Pedido não encontrado.',404);}catch(e){return errorResponse(e);}
 }
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
    try{const result=await submitV3ServiceBriefing(env.DB,submit[1],submit[2],await boundedJson(request));return result?json({ok:true,briefing:{...result,supplementPaymentsEnabled:env.LIBRI_V3_SUPPLEMENT_PAYMENT_ENABLED==='true'}}):fail('Pedido não encontrado.',404);}catch(e){return errorResponse(e);}
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
 const capacity=url.pathname.match(/^\/api\/admin\/v2\/orders\/(LIBRI-\d{1,12})\/v3\/paid-capacity$/);
 if(capacity){if(request.method!=='POST')return fail('Método não permitido.',405);if(env.LIBRI_V3_ADMIN_PAYMENT_ENABLED!=='true')return fail('Operação administrativa V3 indisponível.',503);try{const row=await env.DB.prepare('SELECT public_token FROM v2_orders WHERE order_code=?').bind(capacity[1]).first();if(!row)return fail('Pedido não encontrado.',404);const result=await recoverV3PaidCapacity(env.DB,row.public_token,await boundedJson(request));return result?json({ok:true,result,briefing:await getV3AdminBriefing(env.DB,row.public_token)}):fail('Pedido V3 não encontrado.',404);}catch(e){return errorResponse(e);}}

 const urgency=url.pathname.match(/^\/api\/admin\/v2\/orders\/(LIBRI-\d{1,12})\/v3\/urgency$/);
 if(urgency){
  if(request.method!=='POST')return fail('Método não permitido.',405);
  if(env.LIBRI_V3_ADMIN_PAYMENT_ENABLED!=='true')return fail('Operação administrativa V3 ainda indisponível.',503);
  try{const row=await env.DB.prepare('SELECT o.public_token FROM v2_orders o JOIN v3_order_checkout_snapshots s ON s.order_id=o.id WHERE o.order_code=?').bind(urgency[1]).first();if(!row)return fail('Pedido V3 não encontrado.',404);const result=await decideV2Urgency(env.DB,urgency[1],await boundedJson(request));return json({ok:true,result,briefing:await getV3AdminBriefing(env.DB,row.public_token)});}catch(e){return errorResponse(e);}
 }

 const manual=url.pathname.match(/^\/api\/admin\/v2\/orders\/v3\/manual\/(catalog|preview|create)$/);
 if(manual){
  if(env.LIBRI_V3_ADMIN_PAYMENT_ENABLED!=='true')return fail('Pedido manual V3 ainda indisponível.',503);
  try{
   const action=manual[1];if(action==='catalog'&&request.method==='GET')return json({ok:true,result:await getV3RevisionEditor(env.DB)});
   if(request.method!=='POST'||action==='catalog')return fail('Método não permitido.',405);
   const body=await boundedJson(request);
   return json({ok:true,result:action==='preview'?await previewV3ManualOrder(env.DB,body):await createV3ManualOrder(env,body)});
  }catch(e){return errorResponse(e);}
 }
 const revision=url.pathname.match(/^\/api\/admin\/v2\/orders\/(LIBRI-\d{1,12})\/v3\/revision\/(editor|preview|create|withdraw)$/);
 if(revision){
  if(env.LIBRI_V3_ADMIN_PAYMENT_ENABLED!=='true')return fail('Editor V3 ainda indisponível.',503);
  try{
   const [,code,action]=revision;
   if(action==='editor'&&request.method==='GET')return json({ok:true,result:await getV3RevisionEditor(env.DB,code)});
   if(request.method!=='POST')return fail('Método não permitido.',405);
   const body=await boundedJson(request);
   const result=action==='preview'?await previewV3Revision(env.DB,code,body):action==='create'?await createV3Revision(env,code,body):await withdrawV3Revision(env.DB,code,body);
   const row=await env.DB.prepare('SELECT public_token FROM v2_orders WHERE order_code=?').bind(code).first();
   return json({ok:true,result,briefing:await getV3AdminBriefing(env.DB,row.public_token)});
  }catch(e){return errorResponse(e);}
 }
  const cancellation=url.pathname.match(/^\/api\/admin\/v2\/orders\/(LIBRI-\d{1,12})\/v3\/cancellation\/(open|refresh|refund|finalize)$/);
  if(cancellation){
    if(request.method!=='POST')return fail('Método não permitido.',405);
    if(env.LIBRI_V3_ADMIN_PAYMENT_ENABLED!=='true')return fail('Operação administrativa V3 ainda indisponível.',503);
    try{
      const [,code,action]=cancellation,body=await boundedJson(request);
      const result=await ({open:openV3PaidCancellation,refresh:refreshV3Cancellation,refund:refundV3CancellationCharge,finalize:finalizeV3PaidCancellation}[action])(env,code,body);
      const row=await env.DB.prepare('SELECT public_token FROM v2_orders WHERE order_code=?').bind(code).first();
      return json({ok:true,result,briefing:await getV3AdminBriefing(env.DB,row.public_token)});
    }catch(e){return errorResponse(e);}
  }
  const finance=url.pathname.match(/^\/api\/admin\/v2\/orders\/(LIBRI-\d{1,12})\/v3\/finance\/(deposit|balance|cancel-unpaid)$/);
  if(finance){
    if(request.method!=='POST')return fail('Método não permitido.',405);
    if(env.LIBRI_V3_ADMIN_PAYMENT_ENABLED!=='true')return fail('Operação administrativa V3 ainda indisponível.',503);
    try{
      const [,code,action]=finance;
      const body=await boundedJson(request);
      const result=await ({deposit:changeV3AdminDeposit,balance:recordV3AdminBalance,'cancel-unpaid':cancelV3UnpaidOrder}[action])(env,code,body);
      const row=await env.DB.prepare('SELECT public_token FROM v2_orders WHERE order_code=?').bind(code).first();
      return json({ok:true,result,briefing:await getV3AdminBriefing(env.DB,row.public_token)});
    }catch(e){return errorResponse(e);}
  }
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
        const result=url.pathname.endsWith('/preview')?(family==='retrospectiva'?await publishV3ExternalPreview(env,row.public_token,family,await boundedJson(request)):await publishV3ServicePreview(request,env,row.public_token,family)):await changeV3Production(env.DB,row.public_token,family,await boundedJson(request),'admin');
        return json({ok:true,result,briefing:await getV3AdminBriefing(env.DB,row.public_token)});
      }
      return fail('Método não permitido.',405);
    }catch(e){return errorResponse(e);}
  }
  const agenda=url.pathname.match(/^\/api\/admin\/v2\/orders\/(LIBRI-\d{1,12})\/v3\/agenda\/(convite|identidade_visual|retrospectiva)\/(preview|schedule|release|start)$/);
  if(agenda){
    if(request.method!=='POST')return fail('Método não permitido.',405);
    try{
      const row=await env.DB.prepare('SELECT o.public_token FROM v2_orders o JOIN v3_order_checkout_snapshots s ON s.order_id=o.id WHERE o.order_code=?').bind(agenda[1]).first();
      if(!row)return fail('Pedido V3 não encontrado.',404);
      const body=await boundedJson(request);
      const result=agenda[3]==='start'?await startV3ServiceFromBriefing(env.DB,row.public_token,agenda[2],body):agenda[3]==='preview'?await previewV3ServiceAgenda(env.DB,row.public_token,agenda[2],body):agenda[3]==='release'?await releaseV3ServiceCapacity(env.DB,row.public_token,agenda[2],body):await scheduleV3Service(env.DB,row.public_token,agenda[2],body);
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
