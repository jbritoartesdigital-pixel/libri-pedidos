import test from 'node:test';
import assert from 'node:assert/strict';
import {issueFlowDeviceGrant,redeemFlowDeviceGrant} from '../src/lib/v2-flow-device-grants.js';
import {handleAdminFlowGrantsV2Api,handleInternalFlowGrantRedeem} from '../src/routes/admin-flow-grants-v2.js';

function fakeDB(){
 const tokens=new Map();
 return {prepare(sql){
  assert.doesNotMatch(sql,/v2_orders|v2_payments|public_token|customer_id/i);
  return {bind(...params){
   return {
    async run(){
     if(sql.includes('INSERT INTO v2_flow_device_grants')){
      const [hash,nonceHash,label,created,expires]=params;
      tokens.set(hash,{nonceHash,label,created,expires,used:false});
      return {meta:{changes:1}};
     }
     if(sql.includes('UPDATE v2_flow_device_grants')){
      const [stamp,hash,nonceHash]=params,row=tokens.get(hash);
      if(!row||row.used||row.nonceHash!==nonceHash||row.expires<=stamp)
       return {meta:{changes:0}};
      row.used=true;return {meta:{changes:1}};
     }
     throw Error('Unexpected SQL');
    }
   };
  }};
 }};
}
const url='https://pedidos.libriconvites.com.br/api/admin/v2/flow/grants';
const nonce='a'.repeat(64);
function makeRequest({origin='https://pedidos.libriconvites.com.br',body={nonce,label:'Windows de Teste'}}={}){
 return new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
}
test('origin-checked passkey grant is short-lived and redeemable only once',async()=>{
 const env={DB:fakeDB()};
 const issue=await issueFlowDeviceGrant(makeRequest(),env);
 assert.equal(issue.status,201);
 const result=await issue.json();
 assert.match(result.grant,/^flg_[a-f0-9]{36}$/);
 assert.ok(new Date(result.expiresAt).getTime()<Date.now()+120000);
 const request=()=>new Request('https://pedidos.libriconvites.com.br/api/internal/flow/grant/redeem',
  {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant:result.grant,nonce})});
 const first=await redeemFlowDeviceGrant(request(),env);
 assert.equal(first.status,200);assert.equal((await first.json()).authorized,true);
 assert.equal((await redeemFlowDeviceGrant(request(),env)).status,401);
});
test('grant refuses CSRF and foreign nonce',async()=>{
 const env={DB:fakeDB()};
 assert.equal((await issueFlowDeviceGrant(makeRequest({origin:'https://evil.invalid'}),env)).status,403);
 const resp=await issueFlowDeviceGrant(makeRequest(),env);
 const {grant}=await resp.json();
 const request=new Request('https://pedidos.libriconvites.com.br/api/internal/flow/grant/redeem',
  {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant,nonce:'f'.repeat(64)})});
 assert.equal((await redeemFlowDeviceGrant(request,env)).status,401);
});
test('production route is GET/POST restricted appropriately',async()=>{
 const env={DB:fakeDB()},issueUrl=new URL(url);
 const issued=await handleAdminFlowGrantsV2Api(makeRequest(),env,issueUrl);
 assert.equal(issued.status,201);
 const wrong=await handleAdminFlowGrantsV2Api(new Request(url),env,issueUrl);
 assert.equal(wrong.status,405);
 const internalUrl=new URL('https://pedidos.libriconvites.com.br/api/internal/flow/grant/redeem');
 const unsupported=await handleInternalFlowGrantRedeem(new Request(internalUrl),env,internalUrl);
 assert.equal(unsupported.status,405);
});
