import { fail } from '../lib/http.js';
import {issueFlowDeviceGrant,redeemFlowDeviceGrant} from '../lib/v2-flow-device-grants.js';
export async function handleAdminFlowGrantsV2Api(request,env,url){
 if(url.pathname!=='/api/admin/v2/flow/grants')return null;
 if(request.method!=='POST')return fail('Método não permitido.',405);
 try{return await issueFlowDeviceGrant(request,env);}
 catch(e){
  if(e instanceof SyntaxError)return fail('JSON inválido.',400);
  if(e instanceof RangeError)return fail('Solicitação muito grande.',413);
  console.error('Flow grant issue error',e?.name||'Error');
  return fail('Não foi possível autorizar este aparelho.',500);
 }
}
export async function handleInternalFlowGrantRedeem(request,env,url){
 if(url.pathname!=='/api/internal/flow/grant/redeem')return null;
 if(request.method!=='POST')return fail('Método não permitido.',405);
 try{return await redeemFlowDeviceGrant(request,env);}
 catch(e){
  if(e instanceof SyntaxError)return fail('JSON inválido.',400);
  if(e instanceof RangeError)return fail('Solicitação muito grande.',413);
  console.error('Flow grant redemption error',e?.name||'Error');
  return fail('Não foi possível verificar a autorização.',500);
 }
}
