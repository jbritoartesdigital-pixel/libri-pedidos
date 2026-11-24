// Pseudonymous first-party analytics. No form contents or recovery credentials.
export const FUNNEL_STAGES=Object.freeze(['evento','servico','modelo','configuracao','carrinho','dados','agenda','adicionais','revisao','pagamento','tentativa','surpresa','redirecionamento']);
const valid=id=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id);
const DAY=86400000;
export async function recordStoreStage(db,id,stage,now=new Date()){
 const i=FUNNEL_STAGES.indexOf(stage);if(!valid(id)||i<0)return false;
 const stamp=now.toISOString();
 await db.prepare(`INSERT INTO v3_store_journeys(id,started_at,last_seen_at,stage,stage_mask) VALUES(?,?,?,?,?)
 ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at,stage=excluded.stage,stage_mask=v3_store_journeys.stage_mask|excluded.stage_mask
 WHERE (v3_store_journeys.had_order=0 OR (excluded.stage='redirecionamento' AND v3_store_journeys.order_id IS NOT NULL)) AND (v3_store_journeys.stage!=excluded.stage OR v3_store_journeys.last_seen_at<=?)`).bind(id,stamp,stamp,stage,1<<i,new Date(now.getTime()-60000).toISOString()).run();
 return true;
}
export async function linkStoreOrder(db,id,orderId){
 if(!valid(id)||!Number.isSafeInteger(Number(orderId))||Number(orderId)<=0)return;
 const stamp=new Date().toISOString(),bit=1<<FUNNEL_STAGES.indexOf('tentativa');
 await db.prepare(`INSERT OR IGNORE INTO v3_store_journeys(id,started_at,last_seen_at,stage,stage_mask,order_id,had_order) VALUES(?,?,?,'tentativa',?,?,1)`).bind(id,stamp,stamp,bit,orderId).run();
 await db.prepare(`UPDATE OR IGNORE v3_store_journeys SET order_id=?,had_order=1,last_seen_at=?,stage='tentativa',stage_mask=stage_mask|? WHERE id=? AND had_order=0`).bind(orderId,stamp,bit,id).run();
}
export async function safeLinkStoreOrder(db,id,orderId){try{await linkStoreOrder(db,id,orderId);}catch{}}
export async function handleStoreFunnel(request,env,url){
 if(url.pathname!=='/api/v3/store/stage')return null;
 if(request.method!=='POST')return new Response(null,{status:405});
 const origin=request.headers.get('origin');if((origin&&origin!==url.origin)||['cross-site','same-site'].includes(request.headers.get('sec-fetch-site')))return new Response(null,{status:403});
 if(Number(request.headers.get('content-length')||0)>512||!(request.headers.get('content-type')||'').includes('application/json'))return new Response(null,{status:400});
 try{
  // Bound body reads even when Content-Length is absent. The limiter only affects telemetry.
  if(env.FUNNEL_RATE_LIMIT){const result=await env.FUNNEL_RATE_LIMIT.limit({key:'libri-pedidos-funnel'});if(!result.success)return new Response(null,{status:429,headers:{'retry-after':'60'}});}
  else if(env.ENVIRONMENT==='production')return new Response(null,{status:503});
  const reader=request.body?.getReader();if(!reader)return new Response(null,{status:400});
  let size=0,raw='';const decoder=new TextDecoder();
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>512){await reader.cancel();return new Response(null,{status:413});}raw+=decoder.decode(value,{stream:true});}
  raw+=decoder.decode();
  const body=JSON.parse(raw);
  if(!body||typeof body!=='object'||Array.isArray(body)||!valid(body.id))return new Response(null,{status:422});
  if(body.action==='forget_name'&&Object.keys(body).every(k=>['id','action'].includes(k))){await env.DB.prepare('DELETE FROM v3_store_journey_names WHERE journey_id=?').bind(body.id).run();return new Response(null,{status:204,headers:{'cache-control':'no-store'}});}
  if(body.action==='identify'&&Object.keys(body).every(k=>['id','action','name','consent'].includes(k))&&body.consent==='named-v1'&&typeof body.name==='string'&&body.name.trim().length>0&&body.name.trim().length<=60&&!/[\u0000-\u001f\u007f]/.test(body.name)){
    const stamp=new Date().toISOString();await env.DB.prepare(`INSERT INTO v3_store_journey_names(journey_id,preferred_name,consent_version,consented_at) SELECT id,?,'named-v1',? FROM v3_store_journeys WHERE id=? AND had_order=0 ON CONFLICT(journey_id) DO UPDATE SET preferred_name=excluded.preferred_name,consent_version=excluded.consent_version,consented_at=excluded.consented_at`).bind(body.name.trim(),stamp,body.id).run();return new Response(null,{status:204,headers:{'cache-control':'no-store'}});
  }
  if(Object.keys(body).some(k=>!['id','stage'].includes(k))||!FUNNEL_STAGES.includes(body.stage))return new Response(null,{status:422});
  await recordStoreStage(env.DB,body.id,body.stage);return new Response(null,{status:204,headers:{'cache-control':'no-store'}});
 }catch{return new Response(null,{status:400});}
}
export async function getStoreFunnel(db,{now=new Date()}={}){
 const since=new Date(now.getTime()-30*DAY).toISOString(),idle=new Date(now.getTime()-DAY).toISOString();
 const visits=FUNNEL_STAGES.map((_,i)=>`SUM(CASE WHEN (j.stage_mask & ${1<<i})!=0 THEN 1 ELSE 0 END) AS s${i}`).join(',');
 const rows=await db.prepare(`WITH classified AS (
 SELECT j.*,CASE WHEN EXISTS(SELECT 1 FROM v2_payments p WHERE p.order_id=j.order_id AND p.payment_type!='refund' AND (p.status='approved' OR (p.status='refunded' AND p.paid_at IS NOT NULL))) THEN 'paid'
 WHEN o.status='cancelled' OR (j.had_order=1 AND j.order_id IS NULL) THEN 'cancelled' WHEN j.order_id IS NOT NULL THEN 'order_pending'
 WHEN j.last_seen_at<=? THEN 'inactive' ELSE 'active' END AS outcome
 FROM v3_store_journeys j LEFT JOIN v2_orders o ON o.id=j.order_id WHERE j.started_at>=?
 ) SELECT j.stage,j.outcome,COUNT(*) AS n,${visits} FROM classified j GROUP BY j.stage,j.outcome`).bind(idle,since).all();
 const stages=FUNNEL_STAGES.map(stage=>({stage,reached:0,inactive:0,last:0,active:0})),outcomes={paid:0,cancelled:0,order_pending:0,inactive:0,active:0};let total=0;
 for(const row of rows.results||[]){total+=Number(row.n);outcomes[row.outcome]+=Number(row.n);for(let i=0;i<stages.length;i++)stages[i].reached+=Number(row['s'+i]||0);{const stage=stages.find(x=>x.stage===row.stage);if(stage){stage.last+=Number(row.n);if(row.outcome==='inactive')stage.inactive+=Number(row.n);if(row.outcome==='active')stage.active+=Number(row.n);}}}
 const named=(await db.prepare(`SELECT n.preferred_name AS name,j.stage,j.last_seen_at AS lastSeenAt,CASE WHEN EXISTS(SELECT 1 FROM v2_payments p WHERE p.order_id=j.order_id AND p.payment_type!='refund' AND (p.status='approved' OR (p.status='refunded' AND p.paid_at IS NOT NULL))) THEN 'paid' WHEN o.status='cancelled' OR (j.had_order=1 AND j.order_id IS NULL) THEN 'cancelled' WHEN j.order_id IS NOT NULL THEN 'order_pending' WHEN j.last_seen_at<=? THEN 'inactive' ELSE 'active' END AS outcome FROM v3_store_journey_names n JOIN v3_store_journeys j ON j.id=n.journey_id LEFT JOIN v2_orders o ON o.id=j.order_id WHERE j.started_at>=? ORDER BY j.last_seen_at DESC LIMIT 100`).bind(idle,since).all()).results||[];
 return {since,total,outcomes,stages,named,idleHours:24,windowDays:30};
}
export async function purgeStoreFunnel(db,now=new Date()){
 await db.prepare('DELETE FROM v3_store_journeys WHERE id IN (SELECT id FROM v3_store_journeys WHERE last_seen_at<? ORDER BY last_seen_at LIMIT 500)').bind(new Date(now.getTime()-90*DAY).toISOString()).run();
}
