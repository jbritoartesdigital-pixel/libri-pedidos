import {contextV3Briefing} from './v3-modular-briefing.js';
import {endUnpaidAttempts} from './v3-admin-payment-policy.js';
import {withV2PaymentLock} from './v2-payment-lock.js';
import {nowIso} from './http.js';
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
export function v3AdminLifecycle(ctx){
 const o=ctx.order,done=o.status==='cancelled'||(ctx.services.length>0&&ctx.services.every(s=>s.production_status==='delivered'));
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 return {archived:!!o.archived_at,canArchive:!o.archived_at&&done&&o.event_date<today,canRestore:!!o.archived_at,canDelete:o.briefing_status==='locked'&&['configuring','awaiting_payment','cancelled'].includes(o.status)&&!ctx.cancellation&&!ctx.finance?.payments.some(p=>p.paid_at||['approved','refunded'].includes(p.status))};
}
export async function changeV3AdminLifecycle(env,token,input={}){
 const initial=await contextV3Briefing(env.DB,token);if(!initial)fail('Pedido não encontrado.',404);
 return withV2PaymentLock(env.DB,initial.order.id,async()=>{
  const db=env.DB,ctx=await contextV3Briefing(db,token),o=ctx.order,flags=v3AdminLifecycle(ctx),at=nowIso();
  if(input.confirmed!==true)fail('Confirme a operação.',422);
  if(input.action==='archive'||input.action==='restore'){
   const archive=input.action==='archive';
   if(!(archive?flags.canArchive:flags.canRestore))fail('Esta ação não está disponível para o estado atual.');
   await db.batch([
    db.prepare('UPDATE v2_orders SET archived_at=?,updated_at=? WHERE id=?').bind(archive?at:null,at,o.id),
    db.prepare("INSERT INTO v2_order_history(order_id,action_code,description,metadata_json,created_at) VALUES(?,?,?,'{}',?)").bind(o.id,archive?'order_archived':'order_unarchived',archive?'Pedido arquivado no admin.':'Pedido restaurado dos arquivados.',at)
   ]);return {archived:archive};
  }
  if(input.action!=='delete'||input.orderCode!==o.order_code||!flags.canDelete)fail('Exclusão permitida apenas para pedido sem pagamento, antes do atendimento, com código confirmado.');
  if(await db.prepare("SELECT 1 FROM v2_contracts WHERE order_id=? UNION ALL SELECT 1 FROM v3_order_briefing_drafts WHERE order_id=? UNION ALL SELECT 1 FROM v3_service_uploads WHERE order_id=? UNION ALL SELECT 1 FROM v3_service_supplements a JOIN v3_order_services s ON s.id=a.service_id WHERE s.order_id=?").bind(o.id,o.id,o.id,o.id).first())fail('Há documentos, briefing ou complementos vinculados. Preserve o histórico e arquive o pedido.');
  await endUnpaidAttempts(env,o);
  await db.batch([
   db.prepare("UPDATE v2_black_libri_claims SET status='expired',updated_at=? WHERE order_id=? AND status='attached'").bind(at,o.id),
   db.prepare('DELETE FROM v3_order_revisions WHERE order_id=?').bind(o.id),
   db.prepare('DELETE FROM v3_admin_payment_policies WHERE order_id=?').bind(o.id),
   db.prepare('DELETE FROM v2_checkout_requests WHERE order_id=?').bind(o.id),
   db.prepare('DELETE FROM v2_checkout_holds WHERE order_id=?').bind(o.id),
   db.prepare('DELETE FROM v2_orders WHERE id=?').bind(o.id)
  ]);return {deleted:true,code:o.order_code};
 });
}
