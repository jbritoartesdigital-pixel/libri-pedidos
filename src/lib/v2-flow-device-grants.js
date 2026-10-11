import { fail, json, nowIso, randomToken } from './http.js';

const ORIGIN='https://pedidos.libriconvites.com.br';
const HEX=/^[a-f0-9]{64}$/;
const te=new TextEncoder();
async function digest(value){
 const b=new Uint8Array(await crypto.subtle.digest('SHA-256',te.encode(value)));
 return Array.from(b,n=>n.toString(16).padStart(2,'0')).join('');
}
async function limitedJson(request){
 const reader=request.body?.getReader();
 if(!reader)throw new SyntaxError('Corpo ausente.');
 let size=0,parts=[];
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;
   if(size>1024){await reader.cancel().catch(()=>{});throw new RangeError('Solicitação muito grande.');}
   parts.push(value);
  }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;
 for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 return JSON.parse(new TextDecoder().decode(bytes));
}
function label(value){
 if(typeof value!=='string'||!value.trim()||value.length>50||/[<>\x00-\x1f\x7f]/.test(value))
  throw Error('Nome do aparelho inválido.');
 return value.trim();
}
export async function issueFlowDeviceGrant(request,env){
 if(request.headers.get('origin')!==ORIGIN)return fail('Origem não autorizada.',403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return fail('Envie JSON.',415);
 const length=Number(request.headers.get('content-length')||0);
 if(length>1024)return fail('Solicitação muito grande.',413);
 const body=await limitedJson(request);
 if(!body||!HEX.test(body.nonce||''))return fail('Solicitação do aparelho inválida.',400);
 let deviceLabel;
 try{deviceLabel=label(body.label);}catch{return fail('Nome do aparelho inválido.',400);}
 const token=randomToken('flg_');
 const expiresAt=new Date(Date.now()+90*1000).toISOString();
 await env.DB.prepare(`
  INSERT INTO v2_flow_device_grants
  (token_hash,nonce_hash,device_label,created_at,expires_at,used_at)
  VALUES(?,?,?,?,?,NULL)
 `).bind(await digest(token),await digest(body.nonce),deviceLabel,nowIso(),expiresAt).run();
 return json({ok:true,grant:token,expiresAt},201);
}
// Introspection accepts a 144-bit random grant and the native app's 256-bit nonce.
// It never accepts a browser cookie, financial record, or a user-selected order ID.
export async function redeemFlowDeviceGrant(request,env){
 if(request.headers.get('content-type')!=='application/json')return fail('Solicitação inválida.',415);
 if(Number(request.headers.get('content-length')||0)>1024)return fail('Solicitação inválida.',413);
 const body=await limitedJson(request);
 if(!/^flg_[a-f0-9]{36}$/.test(body?.grant||'')||!HEX.test(body?.nonce||''))
  return fail('Autorização inválida.',401);
 const stamp=nowIso();
 const claimed=await env.DB.prepare(`
  UPDATE v2_flow_device_grants SET used_at=?
  WHERE token_hash=? AND nonce_hash=? AND used_at IS NULL AND expires_at>?
 `).bind(stamp,await digest(body.grant),await digest(body.nonce),stamp).run();
 if(claimed.meta?.changes!==1)return fail('Autorização expirada ou já utilizada.',401);
 return json({ok:true,authorized:true},200);
}
