import {createV2AdminNotification} from './v2-notifications.js';
const labels={convite:'Convite digital',identidade_visual:'Libri Ateliê',retrospectiva:'Retrospectiva'};
const DAY=86400000;
const dateLabel=value=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(value));
export function v3ServiceWhatsappActions({service,customer,order,now=new Date()}){
 const phone=String(customer?.whatsapp||'').replace(/\D/g,'');
 if(!/^\d{10,15}$/.test(phone)||!/^ord_[a-f0-9]{36}$/.test(order.public_token||''))return [];
 const name=String(customer.name||'').trim().split(/\s+/)[0]||'';
 const hello=name?'Oi, '+name+'! 💛':'Olá! 💛';
 const title=labels[service.family];if(!title)return [];
 const area='https://pedidos.libriconvites.com.br/meu-pedido/'+order.public_token;
 const suffix='\n\nPedido '+order.order_code+': '+area;
 const action=(kind,label,message)=>({kind,label,url:'https://wa.me/'+phone+'?text='+encodeURIComponent(hello+' '+message+suffix)});
 const p=service.progress?.preview,d=service.delivery;
 if(service.productionStatus==='waiting_customer'&&p?.status==='active'){
  const expired=now.getTime()>Date.parse(p.adjustmentDeadline);
  return [action('approval','Lembrar aprovação',title+': sua prévia está aguardando aprovação. '+(expired?'O prazo regular de ajustes encerrou. Se precisar de ajuda, fale comigo.':'Se precisar de ajustes, solicite pelo pedido até '+dateLabel(p.adjustmentDeadline)+'.')+' Confira e registre sua decisão na área do pedido.')];
 }
 if(service.productionStatus==='delivered'&&d?.delivered){
  const result=[action('delivery','Avisar entrega',title+': sua entrega foi concluída! '+(d.externalChannel==='whatsapp'?'O arquivo foi enviado por aqui.':'Confira a entrega na área do pedido.'))];
  if(d.downloadAvailable&&(d.files?.some(f=>f.available)||d.externalChannel==='drive')){
   result.push(action('download','Lembrar download',title+': lembrete para baixar e guardar seus arquivos até '+dateLabel(d.downloadUntil)+'.'));
  }
  return result;
 }
 return [];
}

// Only operational notices for the administrator. No WhatsApp dispatch,
// no automatic approval, no writes to the order or service workflow.
export async function runV3ApprovalReminders(env,{now=new Date(),limit=30}={}){
 const db=env.DB,stamp=now.toISOString();
 const result={created:0,resolved:0,failed:0};
 // Resolve superseded notices even when the original notification was unread.
 const stale=await db.prepare(`UPDATE v2_notifications SET resolved_at=?,read_at=COALESCE(read_at,?)
 WHERE event_code='V3_APPROVAL_REMINDER' AND resolved_at IS NULL AND NOT EXISTS(
 SELECT 1 FROM v3_service_previews p JOIN v3_order_services s ON s.id=p.service_id JOIN v2_orders o ON o.id=s.order_id
 WHERE p.status='active' AND s.production_status='waiting_customer' AND o.archived_at IS NULL AND o.status!='cancelled'
 AND NOT EXISTS(SELECT 1 FROM v3_paid_cancellations cc WHERE cc.order_id=o.id)
 AND v2_notifications.dedupe_key IN ('v3-approval:'||p.id||':3','v3-approval:'||p.id||':6','v3-approval:'||p.id||':7'))`).bind(stamp,stamp).run();
 result.resolved=Number(stale.meta?.changes||0);
 // Select the most urgent applicable milestone, never backfill all past reminders.
 const rows=(await db.prepare(`WITH candidates AS (
 SELECT p.id AS preview_id,p.adjustment_deadline,s.family,o.id AS order_id,o.order_code,
 CASE WHEN p.adjustment_deadline<=? THEN '7' WHEN p.adjustment_deadline<=? THEN '6' ELSE '3' END AS milestone
 FROM v3_service_previews p JOIN v3_order_services s ON s.id=p.service_id JOIN v2_orders o ON o.id=s.order_id
 WHERE p.status='active' AND s.production_status='waiting_customer' AND p.adjustment_deadline<=?
 AND o.archived_at IS NULL AND o.status!='cancelled' AND o.briefing_status!='locked'
 AND NOT EXISTS(SELECT 1 FROM v3_paid_cancellations cc WHERE cc.order_id=o.id)
 )
 SELECT * FROM candidates c WHERE NOT EXISTS(SELECT 1 FROM v2_notifications n WHERE n.dedupe_key='v3-approval:'||c.preview_id||':'||c.milestone)
 ORDER BY adjustment_deadline,preview_id LIMIT ?`).bind(stamp,new Date(now.getTime()+DAY).toISOString(),new Date(now.getTime()+4*DAY).toISOString(),Math.max(1,Math.min(100,Number(limit)||30))).all()).results||[];
 for(const r of rows){try{
  const ended=r.milestone==='7';
  const notice=await createV2AdminNotification(env,{eventCode:'V3_APPROVAL_REMINDER',orderId:r.order_id,title:ended?'Prévia sem aprovação após o prazo':'Prévia aguardando aprovação',body:r.order_code+' · '+(labels[r.family]||r.family)+'. '+(ended?'Prazo de ajustes encerrado; a aprovação continua pendente.':'Lembre a cliente de conferir a prévia.'),priority:ended?'high':'normal',actionUrl:'/admin-v2?order='+encodeURIComponent(r.order_code),dedupeKey:'v3-approval:'+r.preview_id+':'+r.milestone,pushEligible:true});
  if(notice.created)result.created++;
 }catch{result.failed++;}}
 return result;
}
