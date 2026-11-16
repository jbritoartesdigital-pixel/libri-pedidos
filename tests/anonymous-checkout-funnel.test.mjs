import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {handleAnonymousFunnel} from "../src/routes/public-funnel.js";
const url="https://pedidos.libriconvites.com.br/api/v2/analytics/funnel";
function req(body,origin="https://pedidos.libriconvites.com.br"){
  return new Request(url,{method:"POST",headers:{"content-type":"application/json","origin":origin},body:JSON.stringify(body)});
}
const valid={sessionId:"a9f3af31-19aa-4404-8bdf-3bc9b9086cc1",step:5};
test("Funnel accepts anonymous checkout step, never persists customer fields",async()=>{
  let saved=null;
  const env={DB:{prepare:sql=>{saved={sql};return {bind:(...args)=>{saved.args=args;return {run:async()=>({success:true})}}}}}};
  const r=await handleAnonymousFunnel(req({...valid,customer:{phone:"private",email:"secret"}}),env);
  assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
  assert.equal(saved.args.length,3);assert.deepEqual(saved.args,[valid.sessionId,5,0]);
  assert.match(saved.sql,/ON CONFLICT\(id\) DO UPDATE SET/);
  assert.doesNotMatch(saved.sql,/phone|email|customer|cart|address/i);
});
test("Blocks cross-origin requests and forged sessions",async()=>{
  const env={DB:{prepare:()=>{throw Error("Not expected")}}};
  assert.equal((await handleAnonymousFunnel(req(valid,"https://other.example"),env)).status,403);
  assert.equal((await handleAnonymousFunnel(req({...valid,sessionId:"person@site.com"}),env)).status,422);
  assert.equal((await handleAnonymousFunnel(req({...valid,step:42}),env)).status,422);
});
test("Failed analytics never blocks checkout or exposes internal SQL",async()=>{
  const env={DB:{prepare:()=>{throw Error("no such table: sensitive_private_details")}}};
  const r=await handleAnonymousFunnel(req(valid),env);
  assert.equal(r.status,202);
  assert.equal((await r.json()).analyticsUnavailable,true);
});
test("No simulated sales or personal data collection in client telemetry",()=>{
  const tracker=readFileSync(new URL("../public/js/client-v2-funnel.js",import.meta.url),"utf8");
  const store=readFileSync(new URL("../public/js/client-v2-store.js",import.meta.url),"utf8");
  const worker=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
  const migration=readFileSync(new URL("../migrations/0033_v2_anonymous_checkout_funnel.sql",import.meta.url),"utf8");
  assert.match(tracker,/crypto\.randomUUID\(\)/);
  assert.match(tracker,/sessionStorage/);
  assert.match(tracker,/keepalive:true/);
  assert.match(store,/if\(!state\.simulationMode\) void recordCheckoutStep\(state\.step\)/);
  assert.match(store,/recordCheckoutStep\(10,\{checkoutCreated:true\}\)/);
  assert.match(worker,/url\.pathname === '\/api\/v2\/analytics\/funnel'/);
  assert.match(migration,/checkout_created INTEGER/);
  assert.doesNotMatch(migration,/ip_address|customer|email|whatsapp|name TEXT|product TEXT/i);
});
