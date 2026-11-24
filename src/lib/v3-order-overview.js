import {evaluateV3FinancialState} from './v3-admin-payment-policy.js';
// Operational read model. Never mutate the parent payment/briefing state
// just because one service has reached a different production stage.
export const V3_SERVICE_LABELS=Object.freeze({pending:'Aguardando briefing ou conferência',ready:'Pronto para produção',in_production:'Em produção',waiting_customer:'Aguardando aprovação',adjustments:'Ajustes solicitados',approved:'Aprovado',delivered:'Entregue',cancelled:'Cancelado'});
const statusMap={pending:'briefing_pending',ready:'ready_for_production',in_production:'in_production',waiting_customer:'waiting_customer',adjustments:'adjustments',approved:'approved',delivered:'finalized',cancelled:'cancelled'};
const labels={awaiting_urgency_decision:'Encaixe aguardando aprovação',briefing_pending:'Aguardando briefing ou conferência',ready_for_production:'Pronto para produção',in_production:'Em produção',waiting_customer:'Aguardando aprovação',adjustments:'Ajustes solicitados',approved:'Aprovado',finalized:'Todos os serviços entregues',cancelled:'Cancelado',awaiting_payment:'Aguardando pagamento',capacity_review:'Agenda precisa de conferência'};
export function summarizeV3Order(services,{locked=false,orderStatus='',capacityReview=false}={}){
 const counts=Object.fromEntries(Object.keys(V3_SERVICE_LABELS).map(k=>[k,0]));
 for(const s of services){const status=s.production_status||s.productionStatus;if(Object.hasOwn(counts,status))counts[status]++;}
 const total=services.length,delivered=counts.delivered;
 let status;
 if(orderStatus==='cancelled')status='cancelled';
 else if(orderStatus==='awaiting_urgency_decision')status='awaiting_urgency_decision';
 else if(locked)status='awaiting_payment';
 else if(total>0&&delivered===total)status='finalized';
 else if(capacityReview)status='capacity_review';
 else status=['adjustments','waiting_customer','in_production','ready','approved','pending','cancelled'].find(k=>counts[k]>0);
 status=statusMap[status]||status||'briefing_pending';
 return {status,label:labels[status]||'Em acompanhamento',totalServices:total,deliveredServices:delivered,counts,
  mixed:Object.values(counts).filter(n=>n>0).length>1};
}
export async function listV3Production(db,{status='',q='',when='',service='',artStage=''}={}){
 // Artistic stages from the old Ateliê-only tracker do not apply to V3.
 if(artStage)return [];
 const family={convites:'convite',atelie:'identidade_visual',retrospectivas:'retrospectiva'}[service];
 if(service&&!family)return [];
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const weekDate=new Date(today+'T12:00:00Z');weekDate.setUTCDate(weekDate.getUTCDate()+6);
 const clauses=["NOT EXISTS(SELECT 1 FROM v3_paid_cancellations x WHERE x.order_id=o.id)","o.archived_at IS NULL","o.status NOT IN ('cancelled','configuring','awaiting_payment')","o.briefing_status!='locked'","((p.deposit_percent=100 AND p.deposit_cents=p.total_cents AND p.balance_cents=0) OR (p.deposit_percent=50 AND p.deposit_cents=(p.total_cents+1)/2 AND p.balance_cents=p.total_cents-p.deposit_cents AND p.payment_method='pix' AND EXISTS(SELECT 1 FROM v3_admin_payment_policies a WHERE a.order_id=o.id AND a.deposit_percent=50)))",
 "(SELECT COUNT(*) FROM v2_payments pay WHERE pay.order_id=o.id AND pay.provider='mercado_pago' AND pay.status='approved' AND pay.payment_type NOT IN ('refund','balance') AND pay.amount_cents=p.deposit_cents AND pay.method=p.payment_method)=1",
 "NOT EXISTS(SELECT 1 FROM v2_payments pay WHERE pay.order_id=o.id AND (pay.status IN ('refunded','pending') OR (pay.status='approved' AND NOT ((pay.provider='mercado_pago' AND pay.payment_type NOT IN ('refund','balance') AND pay.amount_cents=p.deposit_cents AND pay.method=p.payment_method) OR (p.deposit_percent=50 AND pay.provider='direct_pix' AND pay.payment_type='balance' AND pay.method='pix')))))",
 "(SELECT COALESCE(SUM(amount_cents),0) FROM v2_payments pay WHERE pay.order_id=o.id AND pay.status='approved')<=p.total_cents"];
 const params=[];
 if(when==='today'){clauses.push('o.event_date=?');params.push(today);}
 if(when==='week'){clauses.push('o.event_date BETWEEN ? AND ?');params.push(today,weekDate.toISOString().slice(0,10));}
 if(q.trim()){const like='%'+q.trim().slice(0,120)+'%';clauses.push('(o.order_code LIKE ? OR o.honoree_display_name LIKE ? OR c.name LIKE ? OR c.whatsapp LIKE ? OR EXISTS(SELECT 1 FROM v3_order_services x WHERE x.order_id=o.id AND x.commercial_snapshot_json LIKE ?))');params.push(like,like,like,like,like);}
 const rows=(await db.prepare(`SELECT o.id,o.order_code,o.honoree_display_name,o.event_date,o.status,o.next_action,o.delivery_start AS original_start,o.delivery_end AS original_end,c.name AS customer_name,c.whatsapp,p.total_cents,p.payment_method,
 (EXISTS(SELECT 1 FROM v2_order_history h WHERE h.order_id=o.id AND h.action_code='payment_capacity_review') AND NOT EXISTS(SELECT 1 FROM v2_agenda_allocations a WHERE a.order_id=o.id)) AS capacity_pending,
 s.family,s.production_status,s.briefing_status,s.reviewed_at,s.delivery_start,s.delivery_end,s.delivered_at,s.points_units,
 json_extract(COALESCE(s.effective_snapshot_json,s.commercial_snapshot_json),'$.product.name') AS product_name
 FROM v3_order_checkout_snapshots snap JOIN v2_orders o ON o.id=snap.order_id JOIN v2_customers c ON c.id=o.customer_id
 JOIN v2_order_pricing p ON p.order_id=o.id JOIN v3_order_services s ON s.order_id=o.id
 WHERE ${clauses.join(' AND ')} ORDER BY o.event_date,o.id,s.id`).bind(...params).all()).results||[];
 const orders=new Map();
 for(const r of rows){
  if(!orders.has(r.id))orders.set(r.id,{id:r.id,code:r.order_code,honoreeName:r.honoree_display_name,eventDate:r.event_date,customerName:r.customer_name,whatsapp:r.whatsapp,totalCents:r.total_cents,paymentMethod:r.payment_method,parentStatus:r.status,capacityReview:!!r.capacity_pending,services:[]});
  orders.get(r.id).services.push({family:r.family,productName:r.product_name,productionStatus:r.production_status,statusLabel:V3_SERVICE_LABELS[r.production_status]||'Em acompanhamento',briefingStatus:r.briefing_status,reviewedAt:r.reviewed_at,deliveryWindow:r.delivery_start?{start:r.delivery_start,end:r.delivery_end}:null,deliveredAt:r.delivered_at,pointsUnits:r.points_units});
 }
 return [...orders.values()].map(o=>({...o,aggregate:summarizeV3Order(o.services,{orderStatus:o.parentStatus,capacityReview:o.capacityReview})})).filter(o=>{
  const matches=family?o.services.filter(s=>s.family===family):o.services;
  if(!matches.length)return false;
  if(when==='new'&&!matches.some(s=>s.productionStatus==='ready'))return false;
  if(when==='in_production'&&!matches.some(s=>s.productionStatus==='in_production'))return false;
  if(status==='finalized')return family?matches.some(s=>s.productionStatus==='delivered'):o.aggregate.status==='finalized';
  if(status&&status!=='all')return matches.some(s=>statusMap[s.productionStatus]===status);
  return matches.some(s=>!['delivered','cancelled'].includes(s.productionStatus));
 });
}
export async function getV3OrderHistory(db,orderId){
 const [general,production]=await Promise.all([
 db.prepare('SELECT action_code AS action,description,created_at FROM v2_order_history WHERE order_id=? ORDER BY id DESC LIMIT 100').bind(orderId).all(),
 db.prepare(`SELECT e.action,e.actor,e.note,e.created_at,s.family FROM v3_service_production_events e JOIN v3_order_services s ON s.id=e.service_id WHERE s.order_id=? ORDER BY e.id DESC LIMIT 100`).bind(orderId).all()
 ]);
 return [...(general.results||[]),...(production.results||[])].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,150);
}

export async function getV3CentralQueues(db,production){
 const newOrders=production.filter(o=>!o.capacityReview&&o.services.some(s=>s.productionStatus==='pending'||s.productionStatus==='ready')).map(o=>({...o,status:o.aggregate.status,statusLabel:o.aggregate.label,nextAction:o.services.filter(s=>['pending','ready'].includes(s.productionStatus)).map(s=>s.productName+': '+(s.productionStatus==='ready'?'Iniciar produção':s.briefingStatus==='completed'?(s.reviewedAt?'Confirmar agenda':'Conferir briefing'):'Aguardar briefing')).join(' · ')}));
 const rows=(await db.prepare(`SELECT o.id,o.order_code,o.honoree_display_name,o.status,o.briefing_status,c.name AS customer_name,p.payment_method,p.total_cents,p.deposit_cents,p.balance_cents,p.deposit_percent,
  (SELECT deposit_percent FROM v3_admin_payment_policies WHERE order_id=o.id) AS authorized_percent,
  (SELECT COUNT(*) FROM v2_checkout_holds h WHERE h.order_id=o.id AND h.status IN ('active','converted')) AS live_holds,
  (EXISTS(SELECT 1 FROM v2_order_history h WHERE h.order_id=o.id AND h.action_code='payment_capacity_review') AND NOT EXISTS(SELECT 1 FROM v2_agenda_allocations a WHERE a.order_id=o.id)) AS capacity_pending,
  (SELECT status FROM v3_paid_cancellations WHERE order_id=o.id) AS cancellation,
  EXISTS(SELECT 1 FROM v3_order_revisions WHERE order_id=o.id AND status='offered') AS revision,
  EXISTS(SELECT 1 FROM v3_service_supplements a JOIN v3_order_services s ON s.id=a.service_id WHERE s.order_id=o.id AND a.status='review') AS supplement_review
 FROM v3_order_checkout_snapshots snap JOIN v2_orders o ON o.id=snap.order_id JOIN v2_customers c ON c.id=o.customer_id JOIN v2_order_pricing p ON p.order_id=o.id
 WHERE o.archived_at IS NULL AND o.status!='cancelled'
 ORDER BY o.created_at DESC,o.id DESC`).all()).results||[];
 const payments=(await db.prepare(`SELECT p.order_id,p.id,p.provider,p.payment_type,p.status,p.amount_cents,p.method,p.paid_at,p.provider_order_id FROM v2_payments p JOIN v3_order_checkout_snapshots snap ON snap.order_id=p.order_id JOIN v2_orders o ON o.id=p.order_id WHERE o.archived_at IS NULL AND o.status!='cancelled' ORDER BY p.order_id,p.id`).all()).results||[];
 const byOrder=new Map();for(const p of payments){if(!byOrder.has(p.order_id))byOrder.set(p.order_id,[]);byOrder.get(p.order_id).push(p);}
 const exceptions=[],pendingPayments=[];
 for(const r of rows){
  const base={code:r.order_code,honoreeName:r.honoree_display_name,customerName:r.customer_name,paymentMethod:r.payment_method,totalCents:r.total_cents,modular:true};
  const add=(status,label,reason)=>exceptions.push({...base,status,statusLabel:label,attentionReason:reason});
  if(r.cancellation){if(r.cancellation==='review')add('cancellation_review','Cancelamento em revisão','Conferir cobranças e devoluções');continue;}
  if(r.status==='awaiting_urgency_decision'){add('awaiting_urgency_decision','Encaixe urgente','Conferir capacidade e decidir antes de cobrar');continue;}
  if(r.revision){add('awaiting_payment','Proposta revisada','Aguardando aceite da cliente');continue;}
  const f=evaluateV3FinancialState(r,byOrder.get(r.id)||[]);
  if(!f.valid&&f.payments.some(p=>['approved','refunded'].includes(p.status))){add('capacity_review','Financeiro em conferência','Verificar pagamentos antes de liberar produção');continue;}
  if(!f.depositConfirmed&&(f.payments.some(p=>p.provider!=='mercado_pago'||!p.provider_order_id)||r.live_holds&&!f.payments.length)){add('capacity_review','Tentativa em conferência','Verificar a tentativa anterior antes de gerar nova cobrança');continue;}
  if(!f.depositConfirmed){pendingPayments.push({...base,status:'awaiting_payment',dueCents:r.deposit_cents,statusLabel:r.status==='configuring'?'Pedido ainda não enviado ao pagamento':'Aguardando pagamento'});continue;}
  if(r.capacity_pending||r.status==='capacity_review'||r.briefing_status==='locked')add('capacity_review','Agenda em revisão','Confirmar capacidade e liberação do briefing');
  if(r.supplement_review)add('capacity_review','Complemento em conferência','Verificar cobrança complementar');
  if(f.remainingCents>0)pendingPayments.push({...base,status:'balance_pending',dueCents:f.remainingCents,statusLabel:'Saldo Pix pendente'});
 }
 return {newOrders,exceptions,pendingPayments};
}
