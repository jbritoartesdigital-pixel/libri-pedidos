import {analyticsAllowed,namedAnalyticsAllowed} from './store-privacy.js';
const KEY='libriStoreJourneyV1';
let current=null,last='',chain=Promise.resolve(),preferred='',observedStage='',sentIdentity='';
function enqueue(payload,guard=()=>true){chain=chain.catch(()=>{}).then(()=>guard()?fetch('/api/v3/store/stage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),keepalive:true}):undefined);return chain;}
export function setJourneyName(name){preferred=String(name||'').trim().slice(0,60);if(observedStage)trackStoreStage(observedStage);}
function recordIdentity(id){if(!namedAnalyticsAllowed()||!preferred||sentIdentity===id+':'+preferred)return;const key=id+':'+preferred;sentIdentity=key;enqueue({id,action:'identify',name:preferred,consent:'named-v1'},()=>namedAnalyticsAllowed()).then(r=>{if(!r?.ok&&sentIdentity===key)sentIdentity='';}).catch(()=>{if(sentIdentity===key)sentIdentity='';});}
export function storeJourneyId(){
 try{
  if(!analyticsAllowed()||new URLSearchParams(location.search).get('simular')==='1')return null;
  const now=Date.now();if(!current){try{current=JSON.parse(sessionStorage.getItem(KEY)||'null');}catch{}}
  if(!current||!(/^[a-f0-9]{32}$/.test(current.id||''))||now-current.at>86400000){current={id:Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join(''),at:now};last='';}
  current.at=now;try{sessionStorage.setItem(KEY,JSON.stringify(current));}catch{}return current.id;
 }catch{return null;}
}
export function trackStoreStage(stage){
 observedStage=stage;const id=storeJourneyId();if(!id)return;
 if(last!==id+':'+stage){last=id+':'+stage;enqueue({id,stage},()=>analyticsAllowed()).catch(()=>{});}
 recordIdentity(id);
}
export function finishStoreJourney(){current=null;last='';sentIdentity='';preferred='';observedStage='';try{sessionStorage.removeItem(KEY);}catch{}}

if(typeof window!=='undefined')window.addEventListener('libri-privacy-change',e=>{if(e.detail?.previous==='allow_named'&&!namedAnalyticsAllowed()){let id=current?.id;try{id=id||JSON.parse(sessionStorage.getItem(KEY)||'null')?.id;}catch{}if(/^[a-f0-9]{32}$/.test(id||''))enqueue({id,action:'forget_name'}).catch(()=>{});sentIdentity='';}if(!analyticsAllowed()){current=null;last='';sentIdentity='';try{sessionStorage.removeItem(KEY);}catch{}}else if(observedStage)trackStoreStage(observedStage);});
