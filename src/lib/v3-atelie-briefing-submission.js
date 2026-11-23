import {
  getAtelieCustomerBriefing, getAtelieAdminBriefing, getAtelieUploadAccess
} from './v3-atelie-customer-briefing.js';
import { createV2AdminNotification } from './v2-notifications.js';

function invalid(message,status=422,details) {
  const e=new Error(message);e.status=status;
  if(details)e.details=details;
  return e;
}
function changeCount(result) {return Number(result?.meta?.changes||0);}
async function submission(db,orderId) {
  return db.prepare(
    'SELECT status,submitted_revision,submitted_at,reopened_at,version FROM v3_atelie_briefing_submissions WHERE order_id=?'
  ).bind(orderId).first();
}
export async function submitAtelieCreativeBriefing(env,token,payload={}) {
  const access=await getAtelieUploadAccess(env.DB,token);
  if(!access)return null;
  if(!access.paid || !access.canWrite)
    throw invalid('Este pedido não está disponível para envio do briefing.',403);
  const brief=await getAtelieCustomerBriefing(env.DB,token);
  if(!brief||brief.locked)return null;
  if(brief.submitted)
    return {alreadySubmitted:true,briefing:brief};
  if(!Number.isSafeInteger(payload.revision)||payload.revision<0||payload.revision!==brief.revision)
    throw invalid('As respostas mudaram. Confira o briefing atualizado antes de enviar.',409);
  if(brief.missing.length)
    throw invalid('Ainda faltam informações obrigatórias para enviar o briefing.',422,
      {fields:brief.missing});
  const row=await submission(env.DB,access.orderId);
  let result;
  if(row?.status==='submitted')
    return {alreadySubmitted:true,briefing:await getAtelieCustomerBriefing(env.DB,token)};
  if(row?.status==='reopened') {
    result=await env.DB.prepare(
      "UPDATE v3_atelie_briefing_submissions SET status='submitted',submitted_revision=?,submitted_at=datetime('now'),version=version+1 "+
      "WHERE order_id=? AND status='reopened' "+
      "AND EXISTS(SELECT 1 FROM v3_atelie_briefings WHERE order_id=? AND revision=?) "+
      "AND EXISTS(SELECT 1 FROM v2_orders WHERE id=? AND status NOT IN ('cancelled','finalized')) "+
      "AND EXISTS(SELECT 1 FROM v2_payments WHERE order_id=? AND status='approved')"
    ).bind(brief.revision,access.orderId,access.orderId,brief.revision,access.orderId,access.orderId).run();
  } else {
    result=await env.DB.prepare(
      "INSERT OR IGNORE INTO v3_atelie_briefing_submissions(order_id,status,submitted_revision) "+
      "SELECT ?, 'submitted', b.revision FROM v3_atelie_briefings b WHERE b.order_id=? AND b.revision=? "+
      "AND EXISTS(SELECT 1 FROM v2_orders WHERE id=? AND status NOT IN ('cancelled','finalized')) "+
      "AND EXISTS(SELECT 1 FROM v2_payments WHERE order_id=? AND status='approved')"
    ).bind(access.orderId,access.orderId,brief.revision,access.orderId,access.orderId).run();
  }
  if(changeCount(result)!==1) {
    const current=await submission(env.DB,access.orderId);
    if(current?.status==='submitted')
      return {alreadySubmitted:true,briefing:await getAtelieCustomerBriefing(env.DB,token)};
    throw invalid('O pedido ou as respostas mudaram durante o envio. Atualize a página.',409);
  }
  await env.DB.prepare(
    "INSERT INTO v3_atelie_briefing_events(order_id,action,revision) VALUES(?,'submitted',?)"
  ).bind(access.orderId,brief.revision).run();
  // A notificação falhar não desfaz o envio. A ficha do Admin é a fonte da verdade.
  try {
    await createV2AdminNotification(env,{
      eventCode:'BRIEFING_COMPLETED',orderId:access.orderId,
      title:'Briefing criativo do Ateliê recebido ✓',
      body:access.orderCode+' • respostas artísticas enviadas para conferência.',
      actionUrl:'/admin-v2?order='+encodeURIComponent(access.orderCode),
      priority:'high',pushEligible:true,
      dedupeKey:'atelie_briefing:'+access.orderId+':'+brief.revision
    });
  } catch { /* A consulta no Admin continua funcionando. */ }
  return {alreadySubmitted:false,briefing:await getAtelieCustomerBriefing(env.DB,token)};
}
export async function reopenAtelieCreativeBriefing(db,orderCode,input={}) {
  const brief=await getAtelieAdminBriefing(db,orderCode);
  if(!brief)return null;
  if(!brief.submitted)throw invalid('Não há briefing enviado para reabrir.',409);
  const note=typeof input.note==='string'?input.note.trim():'';
  if(note.length<10||note.length>500)
    throw invalid('Descreva o complemento solicitado em 10 a 500 caracteres.');
  const row=await db.prepare(
    "SELECT o.id,o.status FROM v2_orders o WHERE o.order_code=? LIMIT 1"
  ).bind(orderCode).first();
  if(!row||['cancelled','finalized'].includes(row.status))
    throw invalid('Este pedido não permite reabrir o briefing.',409);
  const art=await db.prepare(
    'SELECT stage FROM v3_atelie_art_production WHERE order_id=?'
  ).bind(row.id).first();
  if(art?.stage && art.stage!=='briefing')
    throw invalid('Retorne a etapa artística para Briefing antes de solicitar complementos.',409);
  const r=await db.prepare(
    "UPDATE v3_atelie_briefing_submissions SET status='reopened',reopened_at=datetime('now'),reopened_note=?,version=version+1 "+
    "WHERE order_id=? AND status='submitted'"
  ).bind(note,row.id).run();
  if(changeCount(r)!==1)throw invalid('O briefing já foi reaberto por outra pessoa.',409);
  await db.prepare(
    "INSERT INTO v3_atelie_briefing_events(order_id,action,revision,note) VALUES(?,'reopened',?,?)"
  ).bind(row.id,brief.revision,note).run();
  return getAtelieAdminBriefing(db,orderCode);
}
