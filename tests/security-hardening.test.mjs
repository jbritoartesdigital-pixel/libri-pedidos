import test from 'node:test';
import assert from 'node:assert/strict';
import {securityBucket,securityGate,secureResponse} from '../src/lib/security-boundary.js';
import {validImageStructure} from '../src/lib/image-validation.js';
const req=(path,method='POST',headers={})=>new Request('https://pedidos.example'+path,{method,headers});
test('SEC checkout, recovery and quote rate limits are separated; webhooks untouched',async()=>{
 const observed=[],limiter={limit:async x=>{observed.push(x.key);return {success:false};}};
 assert.equal(securityBucket('/api/v3/cart/checkout','POST'),'CHECKOUT_RATE_LIMIT');
 assert.equal(securityBucket('/api/admin/v2/auth/registration/options','POST'),'RECOVERY_RATE_LIMIT');
 assert.equal(securityBucket('/api/v2/payments/mercado-pago/webhook','POST'),null);
 const denied=await securityGate(req('/api/v3/cart/checkout','POST',{'cf-connecting-ip':'203.0.113.7','x-forwarded-for':'attacker'}),{CHECKOUT_RATE_LIMIT:limiter});
 assert.equal(denied.status,429);assert.equal(denied.headers.get('retry-after'),'60');assert.deepEqual(observed,['203.0.113.7']);
 assert.equal((await securityGate(req('/api/v3/cart/checkout'),{ENVIRONMENT:'production'})).status,503);
 assert.equal(await securityGate(req('/api/v2/payments/mercado-pago/webhook'),{ENVIRONMENT:'production'}),null);
 assert.equal(await securityGate(req('/api/v3/cart/checkout'),{CHECKOUT_RATE_LIMIT:{limit:async()=>({success:true})}}),null);
});
test('SEC admin rejects cross-origin changes and keeps ordinary requests',async()=>{
 const path='/api/admin/v2/orders/LIBRI-1/v3/agenda/convite/start';
 assert.equal((await securityGate(req(path,'POST',{origin:'https://other.example'}),{})).status,403);
 assert.equal((await securityGate(req(path,'POST',{'sec-fetch-site':'same-site'}),{})).status,403);
 assert.equal(await securityGate(req(path,'POST',{origin:'https://pedidos.example'}),{}),null);
});
test('SEC private links suppress caching, referrers and indexing; cookies survive',()=>{
 const res=secureResponse(req('/meu-pedido/ord_'+'a'.repeat(36),'GET'),new Response('ok',{headers:{'content-type':'text/html','set-cookie':'test=1; HttpOnly'}}));
 assert.match(res.headers.get('cache-control'),/no-store/);assert.equal(res.headers.get('referrer-policy'),'no-referrer');assert.match(res.headers.get('x-robots-tag'),/noindex/);assert.match(res.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.ok(res.headers.get('content-security-policy-report-only'));assert.equal(res.headers.get('set-cookie'),'test=1; HttpOnly');
});
test('SEC complete image containers reject truncated, disguised, altered and trailing files',()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAAF0lEQVR4nGOssAlgYGBgYGBgYoABBAsAHRABCmiGNVUAAAAASUVORK5CYII=','base64'),jpg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAMDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCPAFl//9k=','base64');
 for(const [b,m] of [[png,'image/png'],[jpg,'image/jpeg'],[Buffer.from('UklGRjQAAABXRUJQVlA4ICgAAACwAQCdASoCAAIAAUAmJZgCdLoABGaAAP7fgD+4OXLiCjL+tQjDmQgA','base64'),'image/webp']]){
  assert.equal(validImageStructure(b,m),true,m+' fixture');
  assert.equal(validImageStructure(b.subarray(0,16),m),false);
  assert.equal(validImageStructure(Buffer.concat([b,Buffer.from('<html>')]),m),false);
  assert.equal(validImageStructure(Buffer.from('<svg onload=alert(1)>'),m),false);
 }
 const corrupt=Buffer.from(png);corrupt[30]^=1;assert.equal(validImageStructure(corrupt,'image/png'),false);
 assert.equal(validImageStructure(png,'image/jpeg'),false);
});
