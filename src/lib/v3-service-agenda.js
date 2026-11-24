import {contextV3Briefing} from './v3-modular-briefing.js';
import {withV2PaymentLock} from './v2-payment-lock.js';
import {loadV2Settings,v2IntSetting} from './v2-catalog.js';
const fail=(message,status=409)=>{const e=new Error(message);e.status=status;throw e;};
const sum=rows=>rows.reduce((n,r)=>n+Number(r.points_units),0);
const day=(d,n=0)=>{const date=new Date(d+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+n);return date.toISOString().slice(0,10);};
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const valid=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&day(d)===d;
const priority=['identidade_visual','convite','retrospectiva'];
export function partitionV3Allocations(services,rows){
 if(rows.some(r=>r.allocation_type!=='confirmed'))fail('A reserva antecipada precisa de revisão antes do planejamento.');
 if(rows.some(r=>r.service_family)){
   if(rows.some(r=>!r.service_family)||services.some(s=>sum(rows.filter(r=>r.service_family===s.family))!==s.points_units)||rows.some(r=>!services.some(s=>s.family===r.service_family)))fail('A distribuição da agenda precisa de revisão.');
   return rows;
 }
 if(sum(rows)!==sum(services))fail('A reserva original precisa de revisão. Nenhum ponto será duplicado.');
 const result=[],ordered=[...services].sort((a,b)=>priority.indexOf(a.family)-priority.indexOf(b.family));
 let i=0,remaining=ordered[0]?.points_units||0;
 for(const row of [...rows].sort((a,b)=>a.day.localeCompare(b.day)||a.id-b.id)){
   let units=row.points_units;
   while(units>0){
     while(remaining===0&&i<ordered.length-1){i++;remaining=ordered[i].points_units;}
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
 const settings=await loadV2Settings(db);
 const capacity=v2IntSetting(settings,'default_sellable_points_per_day_units',400);
 const now=today(),days=Math.max(s.production_days,family==='convite'?0:15);
 const first=day(now,Math.max(1,days)),last=day(ctx.order.event_date,-v2IntSetting(settings,'minimum_delivery_days_before_event',3));
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
 const keep=p.partition.filter(r=>r.service_family!==family);
 const next=[...keep,...selected.allocation.map(r=>({...r,service_family:family}))];
 if(sum(next)!==sum(p.ctx.services))fail('A distribuição dos pontos está inconsistente.');
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
