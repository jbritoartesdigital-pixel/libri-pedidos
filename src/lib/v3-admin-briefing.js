// These helpers are reachable only through the authenticated Admin dispatcher.
import {changeCatalog} from './v3-supplement-changes.js';
import {supplementCatalog} from './v3-service-supplements.js';
import {getV3OrderHistory} from './v3-order-overview.js';
import {getV3Delivery} from './v3-service-delivery.js';
import {contextV3Briefing,getV3ModularBriefing} from './v3-modular-briefing.js';
import {withV2PaymentLock} from './v2-payment-lock.js';
const fail=(message,status=422)=>{const e=new Error(message);e.status=status;throw e;};
export async function getV3AdminBriefing(db,token){
 const brief=await getV3ModularBriefing(db,token);
 if(!brief)return null;
 // Do not disclose the customer bearer token in the administrative view.
 const base='/api/admin/v2/orders/'+encodeURIComponent(brief.orderCode)+'/v3/briefing/';
 for(const m of brief.modules){
   for(const u of m.uploads||[])u.contentPath=base+m.module+'/uploads/'+u.id+'/content';
 }
 const financialCtx=await contextV3Briefing(db,token);
 brief.adminPayment={canChangeDeposit:brief.locked&&brief.payment.method==='pix'&&['configuring','awaiting_payment'].includes(brief.orderStatus)&&!financialCtx.order.archived_at,canCancelUnpaid:brief.locked&&['configuring','awaiting_payment'].includes(brief.orderStatus)&&!financialCtx.order.archived_at,canRecordBalance:!brief.locked&&brief.payment.depositPercent===50&&brief.payment.remainingCents>0};
 if(!brief.locked){const ctx=await contextV3Briefing(db,token);brief.history=await getV3OrderHistory(db,ctx.order.id);for(const s of ctx.services){const line=brief.services.find(x=>x.family===s.family);line.delivery=await getV3Delivery(db,s,{admin:true});line.supplementCatalog=await supplementCatalog(db,s);line.changeCatalog=await changeCatalog(db,ctx,s);}}
 return brief;
}
export async function reviewV3ServiceBriefing(db,token,family,input={}){
 const initial=await contextV3Briefing(db,token);if(!initial)return null;
 return withV2PaymentLock(db,initial.order.id,async()=>{
   const ctx=await contextV3Briefing(db,token);
   const service=ctx?.services.find(s=>s.family===family);
   if(!ctx||ctx.locked||!service)fail('Serviço indisponível.',404);
   if(service.production_status!=='pending'||service.briefing_status!=='completed')fail('O serviço precisa estar com briefing enviado e produção pendente.',409);
   if(!Number.isSafeInteger(input.revision)||input.revision!==(ctx.revisions[family]||0)||
      !Number.isSafeInteger(input.sharedRevision)||input.sharedRevision!==(ctx.revisions.shared||0))
     fail('O briefing mudou. Atualize antes de conferir.',409);
   if(input.action==='reopen'){
     const note=typeof input.note==='string'?input.note.trim():'';
     if(note.length<10||note.length>500)fail('Descreva o complemento em 10 a 500 caracteres.');
     await db.batch([
       db.prepare("UPDATE v3_order_services SET briefing_status='in_progress',reviewed_at=NULL,complement_note=?,updated_at=datetime('now') WHERE id=?").bind(note,service.id),
       db.prepare("UPDATE v3_order_briefing_drafts SET revision=revision+1,updated_at=datetime('now') WHERE order_id=? AND module=?").bind(ctx.order.id,family)
     ]);
   }else if(input.action==='confirm'){
     const prize=service.snapshot.blackLibri?.gift?.config?.blackLibriPrizeCode;
     if(['mini_retrospective','child_birthday'].includes(prize)&&input.giftMediaConfirmed!==true)fail('Confirme as fotos e a autorização do presente Black Libri antes de liberar.',409);
     if(family==='retrospectiva'){
       const r=await db.prepare('SELECT complete_at FROM v3_retro_material_receipts WHERE order_id=?').bind(ctx.order.id).first();
       if(!r?.complete_at)fail('Confirme o recebimento completo dos materiais da retrospectiva.',409);
     }
     await db.prepare("UPDATE v3_order_services SET reviewed_at=datetime('now'),updated_at=datetime('now') WHERE id=?").bind(service.id).run();
   }else fail('Ação inválida.');
   return getV3AdminBriefing(db,token);
 });
}
