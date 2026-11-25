import {convertHoldToAgenda} from './v2-mercadopago.js';
import {pendingPaidCapacityReview} from './v2-capacity-review.js';
import {getV3CapacityRelease} from './v3-service-agenda.js';
import {v3ServiceWhatsappActions} from './v3-service-reminders.js';
import {getV3Cancellation} from './v3-paid-cancellation.js';
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
 const order=financialCtx.order;
 const [contactRow,customer,history,acceptances]=await Promise.all([
 db.prepare('SELECT quote_json FROM v3_order_checkout_snapshots WHERE order_id=?').bind(order.id).first(),
 db.prepare('SELECT name,whatsapp,email FROM v2_customers WHERE id=?').bind(order.customer_id).first(),
 getV3OrderHistory(db,order.id),
 db.prepare('SELECT terms_version,accepted_at FROM v2_order_terms_acceptances WHERE order_id=? ORDER BY accepted_at DESC LIMIT 20').bind(order.id).all()]);
 const quote=JSON.parse(contactRow?.quote_json||'{}'),contact=quote.contactSnapshot||{};
 if(contact.instagram&&/^[A-Za-z0-9._]{1,30}$/.test(contact.instagram))brief.instagram=contact.instagram;
 brief.customer={name:contact.name||customer?.name||'',whatsapp:contact.whatsapp||customer?.whatsapp||'',email:contact.email||customer?.email||''};
 brief.orderMeta={createdAt:order.created_at,updatedAt:order.updated_at,source:order.source,nextAction:order.next_action,eventSubtype:order.event_subtype};
 brief.history=history;
 brief.termsAcceptances=acceptances.results||[];
 brief.paymentAttempts=(financialCtx.finance?.payments||[]).map(p=>({provider:p.provider,type:p.payment_type,status:p.status,amountCents:p.amount_cents,method:p.method,paidAt:p.paid_at}));
 brief.priceBreakdown={grossCents:quote.grossCents,discountCents:quote.discountCents,cardFeeCents:quote.cardFeeCents,couponCode:quote.coupon?.code||''};
 for(const s of financialCtx.services){const line=brief.services.find(x=>x.family===s.family);if(!line)continue;line.sceneCount=s.snapshot.variant?.sceneCount||null;line.addons=(s.snapshot.addons||[]).filter(a=>!a.config?.blackLibriGift).map(a=>({name:a.name,priceCents:a.priceCents}));}

 brief.cancellation=await getV3Cancellation(db,financialCtx.order.id,{admin:true});
 brief.adminPayment={canCancelPaid:!brief.cancellation&&!financialCtx.order.archived_at&&brief.orderStatus!=='cancelled'&&financialCtx.finance?.payments.some(p=>p.paid_at||['approved','refunded'].includes(p.status)),canChangeDeposit:brief.locked&&brief.payment.method==='pix'&&['configuring','awaiting_payment'].includes(brief.orderStatus)&&!financialCtx.order.archived_at,canCancelUnpaid:brief.locked&&['configuring','awaiting_payment'].includes(brief.orderStatus)&&!financialCtx.order.archived_at,canRecordBalance:!brief.locked&&brief.payment.depositPercent===50&&brief.payment.remainingCents>0};
 brief.adminPayment.canEditManual=brief.revision?.kind==='manual'&&brief.adminPayment.canCancelUnpaid&&!await db.prepare('SELECT 1 FROM v2_payments WHERE order_id=? UNION ALL SELECT 1 FROM v2_checkout_holds WHERE order_id=? UNION ALL SELECT 1 FROM v2_contracts WHERE order_id=? UNION ALL SELECT 1 FROM v2_order_terms_acceptances WHERE order_id=?').bind(financialCtx.order.id,financialCtx.order.id,financialCtx.order.id,financialCtx.order.id).first();
 if(brief.cancellation){brief.adminPayment={};}
 if(!brief.locked){const ctx=financialCtx;const customer=await db.prepare('SELECT name,whatsapp FROM v2_customers WHERE id=?').bind(ctx.order.customer_id).first();for(const s of ctx.services){const line=brief.services.find(x=>x.family===s.family);line.delivery=await getV3Delivery(db,s,{admin:true});line.capacityRelease=await getV3CapacityRelease(db,s,{eligible:!ctx.order.archived_at&&ctx.finance?.fullyPaid===true});line.supplementCatalog=await supplementCatalog(db,s);line.changeCatalog=await changeCatalog(db,ctx,s);line.whatsappActions=ctx.order.archived_at?[]:v3ServiceWhatsappActions({service:line,customer,order:ctx.order});}}
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

// Explicit administrative recovery; no repricing, no new payment, no silent date change.
export async function recoverV3PaidCapacity(db,token,input={}){
 const initial=await contextV3Briefing(db,token);if(!initial)return null;
 return withV2PaymentLock(db,initial.order.id,async()=>{
 const ctx=await contextV3Briefing(db,token);
 if(!ctx||ctx.locked||ctx.cancellation||ctx.order.archived_at||!ctx.finance?.depositConfirmed||!await pendingPaidCapacityReview(db,ctx.order.id)||ctx.services.some(s=>s.production_status!=='pending'||s.scheduled_at))fail('Pedido não está disponível para recuperação da agenda.',409);
 if(input.confirmed!==true)fail('Confirme a recuperação da agenda.',422);
 const original={start:ctx.order.delivery_start,end:ctx.order.delivery_end};
 const replacementWindow=input.deliveryWindow||null;
 const note=typeof input.note==='string'?input.note.trim():'';
 if(replacementWindow&&(!/^\d{4}-\d{2}-\d{2}$/.test(replacementWindow.start||'')||!/^\d{4}-\d{2}-\d{2}$/.test(replacementWindow.end||'')||note.length<10||note.length>500))fail('Informe uma nova janela e registre o acordo com a cliente (10 a 500 caracteres).',422);
 const result=await convertHoldToAgenda(db,ctx.order.id,{replacementWindow});
 if(!result.converted)fail('Não há capacidade válida nesta janela. Confira o prazo mínimo e combine outra previsão com a cliente.',409);
 await db.batch([db.prepare("UPDATE v2_orders SET next_action='Conferir briefing e programar serviços',updated_at=datetime('now') WHERE id=?").bind(ctx.order.id),db.prepare("INSERT INTO v2_order_history(order_id,action_code,description,metadata_json,created_at) VALUES(?,'delivery_capacity_confirmed','Capacidade V3 confirmada após pagamento.',?,datetime('now'))").bind(ctx.order.id,JSON.stringify({original,deliveryWindow:replacementWindow||original,note}))]);
 return {confirmed:true,deliveryWindow:replacementWindow||original};
 });
}
