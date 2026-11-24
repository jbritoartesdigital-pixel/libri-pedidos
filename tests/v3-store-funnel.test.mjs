import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers.mjs';
import {recordStoreStage,getStoreFunnel,handleStoreFunnel,purgeStoreFunnel} from '../src/lib/v3-store-funnel.js';
test('anonymous funnel deduplicates stages, records actual last stage and classifies only idle sessions',async()=>{
 const db=database(),a='a'.repeat(32),b='b'.repeat(32),now=new Date('2026-11-24T12:00:00Z');
 await recordStoreStage(db,a,'evento',new Date('2026-11-20T12:00:00Z'));
 await recordStoreStage(db,a,'modelo',new Date('2026-11-20T12:01:00Z'));
 await recordStoreStage(db,a,'evento',new Date('2026-11-20T12:02:00Z'));
 await recordStoreStage(db,b,'pagamento',now);
 const r=await getStoreFunnel(db,{now});
 assert.equal(r.total,2);assert.equal(r.outcomes.inactive,1);assert.equal(r.outcomes.active,1);
 assert.equal(r.stages.find(s=>s.stage==='evento').reached,1);assert.equal(r.stages.find(s=>s.stage==='evento').inactive,1);assert.equal(r.stages.find(s=>s.stage==='modelo').reached,1);assert.equal(r.stages.find(s=>s.stage==='pagamento').last,1);assert.equal(r.stages.find(s=>s.stage==='pagamento').active,1);
 const url=new URL('https://test/api/v3/store/stage');
 const bad=await handleStoreFunnel(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:a,stage:'pagamento',whatsapp:'123'})}),{DB:db},url);
 assert.equal(bad.status,422);
 await purgeStoreFunnel(db,new Date('2027-04-01T12:00:00Z'));
 assert.equal((await getStoreFunnel(db,{now})).total,0);
});

test('funnel rejects rate-limited and oversized telemetry without touching database',async()=>{
 const url=new URL('https://test/api/v3/store/stage');
 const request=body=>new Request(url,{method:'POST',headers:{'content-type':'application/json'},body});
 const body=JSON.stringify({id:'a'.repeat(32),stage:'evento'});
 assert.equal((await handleStoreFunnel(request(body),{FUNNEL_RATE_LIMIT:{async limit(){return {success:false}}}},url)).status,429);
 assert.equal((await handleStoreFunnel(request(body),{ENVIRONMENT:'production'},url)).status,503);
 assert.equal((await handleStoreFunnel(request('x'.repeat(513)),{},url)).status,413);
});

test('named analytics requires explicit separate consent and supports forgetting the name',async()=>{const db=database(),id='d'.repeat(32),url=new URL('https://test/api/v3/store/stage');const post=body=>handleStoreFunnel(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),{DB:db},url);assert.equal((await post({id,stage:'evento'})).status,204);assert.equal((await post({id,action:'identify',name:'Tereza'})).status,422);assert.equal((await getStoreFunnel(db)).named.length,0);assert.equal((await post({id,action:'identify',name:'Tereza',consent:'named-v1'})).status,204);assert.equal((await post({id,stage:'pagamento'})).status,204);const row=(await getStoreFunnel(db)).named[0];assert.equal(row.name,'Tereza');assert.equal(row.stage,'pagamento');assert.equal(Object.hasOwn(row,'id'),false);assert.equal((await post({id,action:'forget_name'})).status,204);assert.equal((await getStoreFunnel(db)).named.length,0);assert.equal((await getStoreFunnel(db)).total,1);});
