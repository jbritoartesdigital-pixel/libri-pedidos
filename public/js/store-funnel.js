const KEY='libriStoreJourneyV1';
let current=null,last='',chain=Promise.resolve();
export function storeJourneyId(){
 try{
  if(new URLSearchParams(location.search).get('simular')==='1')return null;
  const now=Date.now();if(!current){try{current=JSON.parse(sessionStorage.getItem(KEY)||'null');}catch{}}
  if(!current||!(/^[a-f0-9]{32}$/.test(current.id||''))||now-current.at>86400000){current={id:Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join(''),at:now};last='';}
  current.at=now;try{sessionStorage.setItem(KEY,JSON.stringify(current));}catch{}return current.id;
 }catch{return null;}
}
export function trackStoreStage(stage){
 const id=storeJourneyId();if(!id||last===id+':'+stage)return;last=id+':'+stage;
 chain=chain.catch(()=>{}).then(()=>fetch('/api/v3/store/stage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,stage}),keepalive:true}).catch(()=>{}));
}
export function finishStoreJourney(){current=null;last='';try{sessionStorage.removeItem(KEY);}catch{}}
