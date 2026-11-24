import {validV3PaymentPlan,originalV3FinancialState} from './v3-admin-payment-policy.js';
// INTERNAL ONLY: no HTTP entry point until modular briefing, admin and
// promotions are compatible. Reuses V2 capacity and provider idempotency.
import {createCapacityHold,V2CheckoutError} from './v2-checkout.js';
import {createMercadoPagoCheckout,syncMercadoPagoOrder,cancelMercadoPagoOrder} from './v2-mercadopago.js';
import {withV2PaymentLock} from './v2-payment-lock.js';
import {loadV2Settings,v2IntSetting} from './v2-catalog.js';
import {validateV2DeliveryWindow,planV2AllocationForWindow,validateV2UrgencyWindow,validateV3ManualDeliveryWindow} from './v2-agenda.js';
import {nowIso} from './http.js';

const terminalStatuses=new Set(['expired','cancelled','rejected']);
const fail=(message,code)=>{throw new V2CheckoutError(message,{status:409,code});};
export async function prepareV3Payment(request,env,orderId,{renew=false}={}){
  if(!Number.isSafeInteger(orderId)||orderId<=0)fail('Pedido inválido.','v3_order_invalid');
  const db=env.DB;
  return withV2PaymentLock(db,orderId,async()=>{
    const row=await db.prepare(`SELECT o.id,o.order_code,o.public_token,o.status,o.briefing_status,
       o.source,o.event_date,o.delivery_start,o.delivery_end,o.archived_at,o.urgency_enabled,c.email,p.total_cents,p.deposit_cents,p.deposit_percent,
       p.balance_cents,p.payment_method,s.quote_json,a.deposit_percent AS authorized_percent
       FROM v2_orders o JOIN v3_order_checkout_snapshots s ON s.order_id=o.id
       JOIN v2_order_pricing p ON p.order_id=o.id JOIN v2_customers c ON c.id=o.customer_id LEFT JOIN v3_admin_payment_policies a ON a.order_id=o.id
       WHERE o.id=?`).bind(orderId).first();
    if(!row)fail('Pedido combinado não encontrado.','v3_order_missing');
    if(await db.prepare('SELECT 1 FROM v3_paid_cancellations WHERE order_id=?').bind(orderId).first())fail('Pedido em cancelamento.','v3_payment_unavailable');
    if(await db.prepare("SELECT 1 FROM v3_order_revisions WHERE order_id=? AND status='offered'").bind(orderId).first())fail('Aceite a proposta revisada antes de pagar.','v3_revision_required');
    const quote=JSON.parse(row.quote_json);
    const lines=(await db.prepare(`SELECT s.total_cents,s.points_units-COALESCE((SELECT SUM(a.points_units) FROM v3_service_supplements a WHERE a.service_id=s.id AND a.applied_at IS NOT NULL AND COALESCE(json_extract(a.offer_json,'$.kind'),'extras')!='new_service'),0) AS points_units FROM v3_order_services s WHERE s.order_id=? AND s.origin_supplement_id IS NULL`).bind(orderId).all()).results||[];
    const sum=key=>lines.reduce((n,x)=>n+Number(x[key]),0);
    if(lines.length<1||lines.length>3||lines.length!==quote.items?.length||sum('points_units')!==quote.pointsUnits||
      sum('total_cents')+quote.cardFeeCents!==quote.totalCents||row.total_cents!==quote.totalCents||
      !validV3PaymentPlan(row)||
      row.payment_method!==quote.paymentMethod||!['pix','card'].includes(row.payment_method))
      fail('O pedido precisa de revisão antes do pagamento.','v3_order_inconsistent');
    const existing=(await db.prepare('SELECT provider,provider_order_id,checkout_url,status,amount_cents,method FROM v2_payments WHERE order_id=? ORDER BY id DESC').bind(orderId).all()).results||[];
    if(existing.some(x=>x.status==='approved')){const state=await originalV3FinancialState(db,orderId);if(!state.valid)fail('O histórico financeiro precisa de revisão.','v3_payment_reconciliation_required');return {ok:true,alreadyPaid:true,orderCode:row.order_code,depositPercent:row.deposit_percent,balanceCents:state.remainingCents};}
    if(row.archived_at||!['configuring','awaiting_payment','urgency_approved'].includes(row.status)||row.briefing_status!=='locked')
      fail('O pedido não está disponível para cobrança.','v3_payment_unavailable');
    const hold=await db.prepare(`SELECT h.id,h.token,h.status,h.expires_at,
      COALESCE((SELECT SUM(points_units) FROM v2_checkout_hold_allocations WHERE hold_id=h.id),0) AS points
      FROM v2_checkout_holds h WHERE h.order_id=? ORDER BY h.id DESC LIMIT 1`).bind(orderId).first();
    let liveHold=hold?.status==='active'&&hold.expires_at>nowIso()&&hold.points===quote.pointsUnits;
    const holdCount=Number((await db.prepare('SELECT COUNT(*) AS n FROM v2_checkout_holds WHERE order_id=?').bind(orderId).first()).n);
    if(existing.some(x=>x.provider!=='mercado_pago'||!x.provider_order_id||(!terminalStatuses.has(x.status)&&x.amount_cents!==row.deposit_cents)||x.method!==row.payment_method))
      fail('O histórico financeiro precisa de revisão.','v3_payment_reconciliation_required');
    if(existing.length){
      const pending=existing.filter(x=>x.status==='pending');
      if(pending.length===1&&existing[0]===pending[0]&&existing.slice(1).every(x=>terminalStatuses.has(x.status))&&
        holdCount===existing.length&&liveHold&&pending[0].checkout_url)
        return {ok:true,recovered:true,orderCode:row.order_code,providerOrderId:pending[0].provider_order_id,
          checkoutUrl:pending[0].checkout_url,totalCents:row.total_cents,amountDueNowCents:row.deposit_cents,depositPercent:row.deposit_percent,balanceCents:row.balance_cents};
      if(!renew||holdCount!==existing.length)
        fail('A tentativa anterior precisa ser conciliada antes de uma nova cobrança.','v3_payment_reconciliation_required');
      // Only an explicit renewal may create a new hold after ALL previous
      // provider orders are confirmed terminal under the same payment lock.
      for(const p of [...existing].reverse()){
        const remote=await syncMercadoPagoOrder(env,p.provider_order_id,{lock:false});
        if(remote.approved)return {ok:true,alreadyPaid:true,orderCode:row.order_code,capacityReview:!!remote.capacityReview};
        if(!terminalStatuses.has(remote.paymentStatus))
          fail('O pagamento anterior ainda não foi encerrado.','v3_payment_reconciliation_required');
      }
      liveHold=false;
      await db.prepare("UPDATE v2_checkout_holds SET status='cancelled',updated_at=? WHERE order_id=? AND status='active'").bind(nowIso(),orderId).run();
    }else if(hold){
      // Unknown response: do not create another provider order, even if a
      // payload/configuration change could generate a new idempotency key.
      fail('A reserva anterior precisa ser conciliada antes de tentar novamente.','v3_hold_reconciliation_required');
    }
    if(!liveHold){
      const capacity={eventDate:row.event_date,start:row.delivery_start,end:row.delivery_end,
        pointsUnits:quote.pointsUnits,productionDays:quote.productionDays};
      if(quote.urgency?.requested){const u=await db.prepare("SELECT status,requested_delivery_start,requested_delivery_end,urgency_percent FROM v2_urgency_requests WHERE order_id=?").bind(orderId).first();if(!row.urgency_enabled||u?.status!=='approved'||u.requested_delivery_start!==capacity.start||u.requested_delivery_end!==capacity.end||u.urgency_percent!==quote.urgency.percent||quote.productionDays!==0||quote.items.length!==1||quote.items[0].family!=='convite')fail('O encaixe precisa de aprovação e conferência.','v3_urgency_unapproved');validateV2UrgencyWindow(capacity.start,capacity.end,capacity.eventDate);}
      else if(row.source==='manual_whatsapp'&&quote.manualFlexibleDelivery===true)validateV3ManualDeliveryWindow(capacity);
      else await validateV2DeliveryWindow(db,capacity);
      const plan=await planV2AllocationForWindow(db,capacity);
      if(!plan.fits)fail('A agenda não tem mais capacidade para o conjunto.','delivery_window_unavailable');
      const settings=await loadV2Settings(db);
      const minutes=Math.max(v2IntSetting(settings,'checkout_hold_minutes',30),
        Math.min(180,Math.max(5,v2IntSetting(settings,'mercado_pago_order_expiry_minutes',25)))+5);
      await createCapacityHold(db,{orderId,allocation:plan.allocation,
        expiresAt:new Date(Date.now()+minutes*60000).toISOString(),
        defaultCapacityUnits:v2IntSetting(settings,'default_sellable_points_per_day_units',400)});
    }
    // Keep the hold for uncertain provider failures. Repeating with the same
    // hold token and payload reuses the existing Mercado Pago idempotency key.
    await db.prepare("UPDATE v2_orders SET status='awaiting_payment',next_action='Aguardando pagamento',updated_at=? WHERE id=? AND status IN ('configuring','urgency_approved')").bind(nowIso(),orderId).run();
    const checkout=await createMercadoPagoCheckout(request,env,{orderId,orderCode:row.order_code,publicToken:row.public_token,
      paymentMethod:row.payment_method,amountDueNowCents:row.deposit_cents,customerEmail:quote.contactSnapshot?quote.contactSnapshot.email:row.email});
    return {ok:true,recovered:!!liveHold,orderCode:row.order_code,providerOrderId:checkout.providerOrderId,
      checkoutUrl:checkout.checkoutUrl,totalCents:row.total_cents,amountDueNowCents:row.deposit_cents,depositPercent:row.deposit_percent,balanceCents:row.balance_cents};
  });
}

// Internal reconciliation only: a replacement charge is NOT issued here.
// Unknown provider responses and orphaned holds stay blocked for manual review.
export async function reconcileV3Payment(env,orderId){
  if(!Number.isSafeInteger(orderId)||orderId<=0)fail('Pedido inválido.','v3_order_invalid');
  const db=env.DB;
  return withV2PaymentLock(db,orderId,async()=>{
    const order=await db.prepare(`SELECT o.status FROM v2_orders o JOIN v3_order_checkout_snapshots s ON s.order_id=o.id
      WHERE o.id=?`).bind(orderId).first();
    if(!order)fail('Pedido combinado não encontrado.','v3_order_missing');
    if(await db.prepare('SELECT 1 FROM v3_paid_cancellations WHERE order_id=?').bind(orderId).first())return {ok:false,needsReview:true,canRetry:false};
    if(await db.prepare("SELECT 1 FROM v3_order_revisions WHERE order_id=? AND status='offered'").bind(orderId).first())return {ok:true,revisionRequired:true,canRetry:false};
    const state=await originalV3FinancialState(db,orderId);
    if(state?.valid&&state.row.deposit_percent===50){
      const initial=state.payments.find(p=>p.provider==='mercado_pago'&&p.status==='approved'&&p.amount_cents===state.row.deposit_cents);
      const remote=await syncMercadoPagoOrder(env,initial.provider_order_id,{lock:false});
      const verified=await originalV3FinancialState(db,orderId);
      if(remote.approved&&verified?.valid)return {ok:true,alreadyPaid:true,canRetry:false,balanceCents:verified.remainingCents,capacityReview:!!remote.capacityReview};
      return {ok:false,needsReview:true,canRetry:false};
    }
    const rows=(await db.prepare(`SELECT provider_order_id,status,provider,checkout_url,amount_cents,method FROM v2_payments
      WHERE order_id=? ORDER BY id DESC`).bind(orderId).all()).results||[];
    const hold=await db.prepare('SELECT status,expires_at FROM v2_checkout_holds WHERE order_id=? ORDER BY id DESC LIMIT 1').bind(orderId).first();
    const holdCount=Number((await db.prepare('SELECT COUNT(*) AS n FROM v2_checkout_holds WHERE order_id=?').bind(orderId).first()).n);
    if(!rows.length&&!hold&&['configuring','urgency_approved'].includes(order.status))return {ok:true,notStarted:true,canRetry:true};
    if(!rows.length||holdCount!==rows.length||rows.some(p=>p.provider!=='mercado_pago'||!p.provider_order_id))
      return {ok:false,needsReview:true,reason:'provider_payment_unknown',canRetry:false};
    // Inspect oldest first. Old terminal callbacks cannot release a newer
    // live hold; the V2 synchronizer already guards superseded payments.
    for(const p of rows.slice(1).reverse()){
      const remote=await syncMercadoPagoOrder(env,p.provider_order_id,{lock:false});
      if(remote.approved)return {ok:true,alreadyPaid:true,capacityReview:!!remote.capacityReview,canRetry:false};
      if(!terminalStatuses.has(remote.paymentStatus))return {ok:false,needsReview:true,reason:'ambiguous_payment',canRetry:false};
    }
    const providerId=rows[0].provider_order_id;
    let remote=await syncMercadoPagoOrder(env,providerId,{lock:false});
    if(remote.approved)return {ok:true,alreadyPaid:true,capacityReview:!!remote.capacityReview,canRetry:false};
    if(remote.paymentStatus==='pending'){
      if(hold?.status==='active'&&hold.expires_at>nowIso()&&order.status!=='cancelled')
        return {ok:true,pending:true,checkoutUrl:rows[0].checkout_url,canRetry:false};
      // A cancellation can race a payment approval. Always query again.
      try{await cancelMercadoPagoOrder(env,providerId);}catch{}
      remote=await syncMercadoPagoOrder(env,providerId,{lock:false});
      if(remote.approved)return {ok:true,alreadyPaid:true,capacityReview:!!remote.capacityReview,canRetry:false};
    }
    const terminal=terminalStatuses.has(remote.paymentStatus);
    return {ok:terminal,needsReview:!terminal,terminal,paymentStatus:remote.paymentStatus,canRetry:false};
  });
}
