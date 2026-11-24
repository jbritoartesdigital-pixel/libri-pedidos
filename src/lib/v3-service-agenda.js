import {contextV3Briefing} from './v3-modular-briefing.js';
import {withV2PaymentLock} from './v2-payment-lock.js';
import {loadV2Settings,v2IntSetting} from './v2-catalog.js';
const fail=(message,status=409)=>{const e=new Error(message);e.status=status;throw e;};
const sum=rows=>rows.reduce((n,r)=>n+Number(r.points_units),0);
const day=(d,n=0)=>{const date=new Date(d+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+n);return date.toISOString().slice(0,10);};
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const valid=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&day(d)===d;
const priority=['identidade_visual','convite','retrospectiva'];
export const remainingV3Capacity=s=>Number(s.points_units)-Number(s.released_points_units||0);
const expectedCapacity=services=>services.reduce((n,s)=>n+remainingV3Capacity(s),0);
export function partitionV3Allocations(services,rows){
 if(rows.some(r=>r.allocation_type!=='confirmed'))fail('A reserva antecipada precisa de revisão antes do planejamento.');
 if(rows.some(r=>r.service_family)){
   if(rows.some(r=>!r.service_family)||services.some(s=>sum(rows.filter(r=>r.service_family===s.family))!==remainingV3Capacity(s))||rows.some(r=>!services.some(s=>s.family===r.service_family)))fail('A distribuição da agenda precisa de revisão.');
   return rows;
 }
 if(sum(rows)!==expectedCapacity(services))fail('A reserva original precisa de revisão. Nenhum ponto será duplicado.');
 const result=[],ordered=[...services].sort((a,b)=>priority.indexOf(a.family)-priority.indexOf(b.family));
 let i=0,remaining=ordered.length?remainingV3Capacity(ordered[0]):0;
 for(const row of [...rows].sort((a,b)=>a.day.localeCompare(b.day)||a.id-b.id)){
   let units=row.points_units;
   while(units>0){
     while(remaining===0&&i<ordered.length-1){i++;remaining=remainingV3Capacity(ordered[i]);}
     if(!remaining)fail('Distribuição inconsistente.');
     const take=Math.min(units,remaining);
     result.push({...row,service_family:ordered[i].family,points_units:take});
     remaining-=take;units-=take;
   }
 }
 return result;
}
function planForWindow(free,start,end,days,units,now){
 const first=days?day(start,-days):start,last=days?day(start,-1):end;
 const eligible=[];
 for(let d=first;d<=last;d=day(d,1)){
   if(d<=now||[0,6].includes(new Date(d+'T12:00:00Z').getUTCDay()))continue;
   const room=free[d]||0;if(room>0)eligible.push({day:d,room});
 }
 const total=eligible.reduce((n,r)=>n+r.room,0);if(total<units)return null;
 let left=units;
 const alloc=[];
 if(days){
   for(const r of eligible){const points=Math.floor(units*r.room/total);alloc.push({day:r.day,points_units:points,room:r.room,fraction:units*r.room%total});left-=points;}
   for(const r of [...alloc].sort((a,b)=>b.fraction-a.fraction||a.day.localeCompare(b.day))){if(left&&r.points_units<r.room){r.points_units++;left--;}}
 }else{
   for(const r of eligible){const points=Math.min(left,r.room);alloc.push({day:r.day,points_units:points});left-=points;if(!left)break;}
 }
 return left?null:alloc.filter(r=>r.points_units>0).map(({day,points_units})=>({day,points_units}));
}
async function compute(db,token,family,input={}){
 const ctx=await contextV3Briefing(db,token);if(!ctx||ctx.locked)fail('Pagamento e briefing precisam estar disponíveis.',403);
 const s=ctx.services.find(x=>x.family===family);if(!s)fail('Serviço não contratado.',404);
 if(s.briefing_status!=='completed'||!s.reviewed_at||s.production_status!=='pending')fail('Confira o briefing antes de planejar a produção.');
 if(family==='retrospectiva'&&!((await db.prepare('SELECT complete_at FROM v3_retro_material_receipts WHERE order_id=?').bind(ctx.order.id).first())?.complete_at))fail('Confirme todos os materiais recebidos.');
 const identity=ctx.services.find(x=>x.family==='identidade_visual');
 let depends=null;
 if(family==='convite'&&identity){
   if(typeof input.dependsOnIdentity!=='boolean')fail('Informe se o convite depende da identidade visual do Ateliê.',422);
   depends=input.dependsOnIdentity;
   if(depends&&!['approved','delivered'].includes(identity.production_status))fail('Aguarde a aprovação da identidade visual antes de programar o convite dependente.');
 }
 const rows=(await db.prepare('SELECT * FROM v2_agenda_allocations WHERE order_id=? ORDER BY day,id').bind(ctx.order.id).all()).results||[];
 const partition=partitionV3Allocations(ctx.services,rows);
 if(ctx.order.urgency_enabled&&ctx.services.length===1&&family==='convite'){
  const u=await db.prepare('SELECT status,requested_delivery_start,requested_delivery_end FROM v2_urgency_requests WHERE order_id=?').bind(ctx.order.id).first();
  const start=ctx.order.delivery_start,end=ctx.order.delivery_end;
  if(u?.status!=='approved'||u.requested_delivery_start!==start||u.requested_delivery_end!==end||!valid(start)||!valid(end)||end<today()||partition.some(r=>r.day<start||r.day>end))fail('O encaixe aprovado precisa de revisão de agenda.');
  return {ctx,s,partition,rows,options:[{start,end,allocation:partition}],depends,urgency:true};
 }
 const settings=await loadV2Settings(db);
 const capacity=v2IntSetting(settings,'default_sellable_points_per_day_units',400);
 const now=today(),days=Math.max(s.production_days,family==='convite'?0:15);
 const first=day(now,Math.max(1,days)),eventLimit=day(ctx.order.event_date,-v2IntSetting(settings,'minimum_delivery_days_before_event',3)),last=s.delivery_end&&s.delivery_end<eventLimit?s.delivery_end:eventLimit;
 if(first>last||day(first,2)>last)return {ctx,s,partition,rows,options:[],depends,capacity};
 // Limit planning horizon to avoid unbounded queries for malformed event dates.
 if(last>day(now,730))fail('Data fora do horizonte de planejamento.');
 const [config,used,holds]=await Promise.all([
 db.prepare('SELECT day,blocked,sellable_capacity_units FROM v2_agenda_days WHERE day>=? AND day<=?').bind(now,last).all(),
 db.prepare('SELECT day,SUM(points_units) AS n FROM v2_agenda_allocations WHERE order_id!=? AND day>=? AND day<=? GROUP BY day').bind(ctx.order.id,now,last).all(),
 db.prepare("SELECT a.day,SUM(a.points_units) AS n FROM v2_checkout_hold_allocations a JOIN v2_checkout_holds h ON h.id=a.hold_id WHERE h.status='active' AND julianday(h.expires_at)>julianday('now') AND a.day>=? AND a.day<=? GROUP BY a.day").bind(now,last).all()
 ]);
 const by=(rows)=>Object.fromEntries((rows.results||[]).map(r=>[r.day,r]));
 const conf=by(config),u=by(used),h=by(holds),free={};
 for(let d=day(now,1);d<=last;d=day(d,1)){
   free[d]=conf[d]?.blocked?0:Math.max(0,(conf[d]?.sellable_capacity_units??capacity)-(u[d]?.n||0)-(h[d]?.n||0)-sum(partition.filter(r=>r.service_family!==family&&r.day===d)));
 }
 const options=[];
 for(let start=first;day(start,2)<=last;start=day(start,1)){
   const end=day(start,2),allocation=planForWindow(free,start,end,days,s.points_units,now);
   if(allocation)options.push({start,end,allocation});
 }
 const original=ctx.order.delivery_start;
 options.sort((a,b)=>Number(b.start===original)-Number(a.start===original)||a.start.localeCompare(b.start));
 return {ctx,s,partition,rows,options,depends,capacity};
}
export async function previewV3ServiceAgenda(db,token,family,input){
 const p=await compute(db,token,family,input);
 return {family,options:p.options.slice(0,8),pointsUnits:p.s.points_units,original:{start:p.ctx.order.delivery_start,end:p.ctx.order.delivery_end}};
}
export async function scheduleV3Service(db,token,family,input={}){
 const initial=await contextV3Briefing(db,token);if(!initial)return null;
 if(!valid(input.start)||!valid(input.end)||input.confirmed!==true)fail('Confirme uma janela de entrega válida.',422);
 return withV2PaymentLock(db,initial.order.id,async()=>{
 const p=await compute(db,token,family,input);
 const selected=p.options.find(o=>o.start===input.start&&o.end===input.end);
 if(!selected)fail('A janela perdeu disponibilidade. Consulte novamente.');
 if(p.urgency){await db.batch([db.prepare('UPDATE v2_agenda_allocations SET service_family=? WHERE order_id=? AND service_family IS NULL').bind(family,p.ctx.order.id),db.prepare("UPDATE v3_order_services SET delivery_start=?,delivery_end=?,scheduled_at=datetime('now'),production_status='ready',updated_at=datetime('now') WHERE id=?").bind(selected.start,selected.end,p.s.id)]);return {family,deliveryWindow:{start:selected.start,end:selected.end},pointsUnits:p.s.points_units,productionStatus:'ready'};}
 const keep=p.partition.filter(r=>r.service_family!==family);
 const next=[...keep,...selected.allocation.map(r=>({...r,service_family:family}))];
 if(sum(next)!==expectedCapacity(p.ctx.services))fail('A distribuição dos pontos está inconsistente.');
 const dbOrder=p.ctx.order.id,statements=[db.prepare('DELETE FROM v2_agenda_allocations WHERE order_id=?').bind(dbOrder)];
 for(const r of next){
  statements.push(db.prepare('INSERT OR IGNORE INTO v2_agenda_days(day,sellable_capacity_units) VALUES(?,?)').bind(r.day,p.capacity));
  statements.push(db.prepare("INSERT INTO v2_agenda_allocations(order_id,day,points_units,allocation_type,service_family) VALUES(?,?,?,'confirmed',?)").bind(dbOrder,r.day,r.points_units,r.service_family));
 }
 statements.push(db.prepare("UPDATE v3_order_services SET delivery_start=?,delivery_end=?,scheduled_at=datetime('now'),depends_on_identity=?,production_status='ready',updated_at=datetime('now') WHERE id=?").bind(selected.start,selected.end,p.depends==null?null:Number(p.depends),p.s.id));
 try{await db.batch(statements);}catch(e){if(String(e.message).includes('v3_capacity_changed'))fail('A capacidade mudou. Consulte a agenda novamente.');throw e;}
 return {family,deliveryWindow:{start:selected.start,end:selected.end},pointsUnits:p.s.points_units,productionStatus:'ready'};
 });
}

export async function getV3CapacityRelease(db,s,{eligible=true}={}){
 const released=Number(s.released_points_units||0);
 const row=eligible&&s.production_status==='delivered'&&s.delivered_at?await db.prepare("SELECT COALESCE(SUM(points_units),0) AS n FROM v2_agenda_allocations WHERE order_id=? AND service_family=? AND allocation_type='confirmed' AND day>?").bind(s.order_id,s.family,today()).first():null;
 return {releasedUnits:released,availableUnits:Number(row?.n||0)};
}
export async function releaseV3ServiceCapacity(db,token,family,input={}){
 const initial=await contextV3Briefing(db,token);if(!initial)return null;
 if(input.confirmed!==true||!Number.isInteger(input.expectedUnits)||input.expectedUnits<=0)fail('Confirme os pontos a liberar.',422);
 return withV2PaymentLock(db,initial.order.id,async()=>{
  const ctx=await contextV3Briefing(db,token);
  if(!ctx||ctx.locked||ctx.order.archived_at||!ctx.finance?.fullyPaid)fail('Pedido indisponível para liberação.');
  const s=ctx.services.find(x=>x.family===family);
  if(!s||s.production_status!=='delivered'||!s.delivered_at)fail('Somente serviços entregues podem liberar pontos.');
  const rows=(await db.prepare('SELECT * FROM v2_agenda_allocations WHERE order_id=? ORDER BY day,id').bind(ctx.order.id).all()).results||[];
  // Never repartition on release: only remove explicitly assigned future rows.
  if(rows.some(r=>!r.service_family))fail('Distribua a agenda por serviço antes de liberar.');
  partitionV3Allocations(ctx.services,rows);
  const now=today(),future=rows.filter(r=>r.service_family===family&&r.day>now),units=sum(future);
  if(units!==input.expectedUnits)fail('A capacidade mudou. Atualize a ficha antes de liberar.');
  const grouped=new Map();for(const r of future)grouped.set(r.day,(grouped.get(r.day)||0)+r.points_units);
  const at=new Date().toISOString();
  await db.batch([
   ...[...grouped].map(([day,n])=>db.prepare('INSERT INTO v3_service_capacity_releases(service_id,day,points_units,released_at) VALUES(?,?,?,?)').bind(s.id,day,n,at)),
   db.prepare("DELETE FROM v2_agenda_allocations WHERE order_id=? AND service_family=? AND day>? AND allocation_type='confirmed'").bind(s.order_id,family,now),
   db.prepare('UPDATE v3_order_services SET released_points_units=released_points_units+?,updated_at=? WHERE id=?').bind(units,at,s.id),
   db.prepare("INSERT INTO v3_service_production_events(service_id,actor,action,note) VALUES(?,'admin','capacity_released',?)").bind(s.id,JSON.stringify({units,days:[...grouped].map(([day,pointsUnits])=>({day,pointsUnits}))}))
  ]);
  return {releasedUnits:units,totalReleasedUnits:Number(s.released_points_units||0)+units};
 });
}
