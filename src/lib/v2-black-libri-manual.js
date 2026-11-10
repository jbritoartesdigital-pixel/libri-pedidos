import { nowIso } from './http.js';
import { getV2ManualOrderForCustomer } from './v2-orders-manual.js';
import { quoteManualClientAddons, applyManualClientAddons } from './v2-manual-client-addons.js';
import {
  blackLibriOperational, blackLibriStatus, revealBlackLibri,
  findBlackLibriClaim, applyBlackLibriToQuote
} from './v2-black-libri.js';

function conflict(message, status=409) {
  throw Object.assign(new Error(message),{status,code:'manual_black_libri_unavailable'});
}

async function context(env, token) {
  const manual=await getV2ManualOrderForCustomer(env.DB,token);
  if (!manual) conflict('Pedido não encontrado.',404);
  const identity=await env.DB.prepare(`
    SELECT c.whatsapp FROM v2_orders o INNER JOIN v2_customers c
      ON c.id=o.customer_id
    WHERE o.id=? AND o.public_token=? AND o.source='manual_whatsapp' LIMIT 1
  `).bind(manual.id,token).first();
  if (!identity?.whatsapp) conflict('Não foi possível identificar este pedido.');
  return {manual,customer:{whatsapp:identity.whatsapp}};
}

function eligible(manual) {
  return ['awaiting_payment','configuring'].includes(manual.status)
    && !manual.alreadyPaid && !manual.payment?.checkoutUrl;
}

async function canOffer(env,manual) {
  if (!eligible(manual)) return false;
  const row=await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM v2_payments WHERE order_id=?) AS payments,
      (SELECT COUNT(*) FROM v2_checkout_holds WHERE order_id=?) AS holds
  `).bind(manual.id,manual.id).first();
  return Number(row?.payments||0)===0 && Number(row?.holds||0)===0;
}

export async function statusManualBlackLibri(env,token) {
  if (!(await blackLibriOperational(env))) return {ok:true,enabled:false};
  const {manual,customer}=await context(env,token);
  if (!(await canOffer(env,manual)) || manual.pricing.snapshot?.blackLibri) {
    return {ok:true,enabled:false};
  }
  const status=await blackLibriStatus(env,customer);
  if (status.claim && status.claim.status!=='reserved') {
    return {ok:true,enabled:false};
  }
  return status;
}

export async function revealManualBlackLibri(env,token) {
  if (!(await blackLibriOperational(env))) conflict('A surpresa ainda não está disponível.');
  const {manual,customer}=await context(env,token);
  if (!(await canOffer(env,manual))) conflict('O pagamento deste pedido já começou.');
  // O número vem da cliente do pedido salvo no banco, nunca do navegador.
  return revealBlackLibri(env,customer,'manual_order_'+manual.id+'_black_libri');
}

function projectedManualQuote(manual,delta=null) {
  const original=manual.pricing.snapshot||{};
  const extraBase=Number(delta?.extraBaseCents||0);
  const subtotalIncrease=Number(delta?.extrasCents||0)+Number(delta?.productDeltaCents||0);
  const actualTotal=Number(delta?.totalCents ?? manual.pricing.totalCents);
  // O valor contratado armazenado no pedido prevalece sobre preços antigos do snapshot.
  const snapshotTotal=Number(original.totalCents||0);
  const cardFee=manual.pricing.paymentMethod==='card'?Number(original.cardFeeCents||0):0;
  const actualBase=Math.max(0,Number(manual.pricing.totalCents)-Math.max(0,cardFee));
  return {
    ...original,
    // Apenas adicionais contratados/pagos podem ser convertidos em crédito.
    blackLibriOwnedAddons:[
      ...manual.items.filter(item=>item.item_type==='addon').map(item=>({
        code:item.item_code,priceCents:Number(item.unit_price_cents||0)
      })),
      ...(delta?.addons||[]).map(a=>({
        code:a.code,priceCents:Number(a.priceCents||0)
      }))
    ],
    subtotalCents:Number(original.subtotalCents||0)+subtotalIncrease
      +(Number(manual.pricing.totalCents)-snapshotTotal),
    baseTotalCents:actualBase+extraBase,
    totalCents:actualTotal,
    payment:{
      ...(original.payment||{}),
      method:manual.pricing.paymentMethod,
      depositPercent:manual.pricing.depositPercent,
      depositCents:delta?.depositCents ?? manual.pricing.depositCents,
      balanceCents:delta?.balanceCents ?? manual.pricing.balanceCents
    }
  };
}

export async function previewManualBlackLibri(env,token,body={}) {
  const {manual,customer}=await context(env,token);
  if (!(await canOffer(env,manual)) || !(await blackLibriOperational(env))) {
    conflict('A surpresa não está disponível para este pagamento.');
  }
  const claim=await findBlackLibriClaim(env,customer);
  const existing=manual.pricing.snapshot?.blackLibri;
  if (existing) return {ok:true,quote:manual.pricing.snapshot};
  if (!claim || claim.status!=='reserved') {
    return {ok:true,quote:projectedManualQuote(manual)};
  }
  const codes=Array.isArray(body.addonCodes)?body.addonCodes:[];
  const productCode=String(body.productCode||'');
  const variantCode=String(body.variantCode||'');
  const changed=codes.length>0
    || productCode!==String(manual.pricing.snapshot?.product?.code||'')
    || variantCode!==String(manual.pricing.snapshot?.variant?.code||'');
  const delta=changed?await quoteManualClientAddons(env.DB,manual,codes,{productCode,variantCode}):null;
  const quote=projectedManualQuote(manual,delta);
  return {ok:true,quote:applyBlackLibriToQuote(quote,claim)};
}

async function restoreExpiredManualPrize(env,manual,claim) {
  const snapshot=manual.pricing.snapshot||{};
  const original=snapshot.blackLibriOriginal;
  if (!original || claim?.order_id!==manual.id || claim.status!=='expired') return manual;
  const stamp=nowIso();
  const oldJson=JSON.stringify(snapshot);
  const originalJson=JSON.stringify(original);
  const result=await env.DB.batch([
    env.DB.prepare(`
      UPDATE v2_order_pricing SET subtotal_cents=?,coupon_discount_cents=?,
        total_cents=?,deposit_cents=?,balance_cents=?,pricing_snapshot_json=?,updated_at=?
      WHERE order_id=? AND pricing_snapshot_json=? AND
        NOT EXISTS(SELECT 1 FROM v2_payments WHERE order_id=?)
    `).bind(original.subtotalCents,Number(original.couponDiscountCents||0),
      original.totalCents,original.payment.depositCents,original.payment.balanceCents,
      originalJson,stamp,manual.id,oldJson,manual.id),
    env.DB.prepare(`
      DELETE FROM v2_order_items WHERE order_id=? AND
        item_type IN ('addon','combo_adjustment') AND item_code=? AND
        NOT EXISTS(SELECT 1 FROM v2_payments WHERE order_id=?)
    `).bind(manual.id,'black_libri:'+snapshot.blackLibri.code,manual.id)
  ]);
  if (Number(result[0]?.meta?.changes||0)!==1) conflict('O valor deste pedido mudou. Atualize a página.');
  return getV2ManualOrderForCustomer(env.DB,manual.token);
}

// Aplica o prêmio exatamente uma vez antes de solicitar o checkout Mercado Pago.
// A atualização de valor e o vínculo são condicionais à ausência de pagamento.
export async function prepareManualBlackLibriPayment(env,token,manual) {
  const {customer}=await context(env,token);
  const claim=await findBlackLibriClaim(env,customer);
  if (!claim) return manual;
  if (manual.pricing.snapshot?.blackLibri) {
    if (claim.status==='expired') return restoreExpiredManualPrize(env,manual,claim);
    if (claim.order_id===manual.id && ['attached','redeemed'].includes(claim.status)) return manual;
    conflict('O valor do pedido precisa ser conferido. Recarregue a página.');
  }
  if (claim.status!=='reserved' || claim.order_id || Date.parse(claim.expires_at)<=Date.now()) {
    return manual;
  }
  if (!(await canOffer(env,manual))) return manual;
  const original=projectedManualQuote(manual);
  const awarded=applyBlackLibriToQuote(original,claim);
  const discountCents=Number(awarded.blackLibriDiscountCents||0);
  const augmented={
    ...awarded,
    // Desconto promocional separado na tela; contabilizado junto às reduções.
    couponDiscountCents:awarded.couponDiscountCents,
    blackLibriOriginal:original
  };
  const stamp=nowIso();
  const oldJson=JSON.stringify(manual.pricing.snapshot);
  const newJson=JSON.stringify(augmented);
  const changed=await env.DB.batch([
    env.DB.prepare(`
      UPDATE v2_order_pricing SET subtotal_cents=?,coupon_discount_cents=?,
        total_cents=?,deposit_cents=?,balance_cents=?,pricing_snapshot_json=?,updated_at=?
      WHERE order_id=? AND total_cents=? AND pricing_snapshot_json=?
      AND EXISTS(SELECT 1 FROM v2_orders WHERE id=? AND source='manual_whatsapp'
         AND status IN ('awaiting_payment','configuring') AND briefing_status='locked')
      AND NOT EXISTS(SELECT 1 FROM v2_payments WHERE order_id=?)
      AND NOT EXISTS(SELECT 1 FROM v2_checkout_holds WHERE order_id=?)
      AND EXISTS(SELECT 1 FROM v2_black_libri_claims WHERE id=?
         AND status='reserved' AND order_id IS NULL AND expires_at>?)
    `).bind(augmented.subtotalCents,augmented.couponDiscountCents,
      augmented.totalCents,augmented.payment.depositCents,
      augmented.payment.balanceCents,newJson,stamp,manual.id,manual.pricing.totalCents,
      oldJson,manual.id,manual.id,manual.id,claim.id,stamp),
    env.DB.prepare(`
      UPDATE v2_black_libri_claims SET order_id=?,status='attached',updated_at=?
      WHERE id=? AND status='reserved' AND order_id IS NULL AND expires_at>?
      AND EXISTS(SELECT 1 FROM v2_order_pricing WHERE order_id=? AND pricing_snapshot_json=?)
    `).bind(manual.id,stamp,claim.id,stamp,manual.id,newJson),
    // Toda premiação vira item do pedido. Descontos usam ajuste negativo,
    // presentes viram adicional digital gratuito.
    env.DB.prepare(`
      INSERT INTO v2_order_items(order_id,item_type,item_code,name_snapshot,
        quantity,unit_price_cents,points_units,configuration_json,created_at)
      SELECT ?,?,?,?,1,?,0,'{}',?
      WHERE EXISTS(
        SELECT 1 FROM v2_black_libri_claims WHERE id=? AND order_id=?
          AND status='attached')
      AND NOT EXISTS(
        SELECT 1 FROM v2_order_items WHERE order_id=? AND item_code=?)
    `).bind(
      manual.id,discountCents>0?'combo_adjustment':'addon',
      'black_libri:'+claim.prize_code,
      discountCents>0?'Desconto Black Libri: '+claim.label:
        'Brinde Black Libri: '+claim.label,
      discountCents>0?-discountCents:0,
      stamp,claim.id,manual.id,manual.id,'black_libri:'+claim.prize_code
    ),
    env.DB.prepare(`
      INSERT INTO v2_order_history(order_id,action_code,description,metadata_json,created_at)
      SELECT ?,'manual_black_libri_awarded','Presente Black Libri incluído no pedido.',?,?
      WHERE EXISTS(SELECT 1 FROM v2_black_libri_claims
        WHERE id=? AND order_id=? AND status='attached')
    `).bind(manual.id,JSON.stringify({
      claimId:claim.id,code:claim.prize_code,discountCents:awarded.blackLibriDiscountCents,
      originalTotalCents:original.totalCents,newTotalCents:awarded.totalCents
    }),stamp,claim.id,manual.id)
  ]);
  if (Number(changed[0]?.meta?.changes||0)!==1
    || Number(changed[1]?.meta?.changes||0)!==1) {
    // Compensação defensiva em caso de alteração concorrente da reserva.
    if (Number(changed[0]?.meta?.changes||0)===1
      && Number(changed[1]?.meta?.changes||0)!==1) {
      await env.DB.prepare(`
        UPDATE v2_order_pricing SET subtotal_cents=?,coupon_discount_cents=?,
          total_cents=?,deposit_cents=?,balance_cents=?,pricing_snapshot_json=?,updated_at=?
        WHERE order_id=? AND pricing_snapshot_json=?
        AND NOT EXISTS(SELECT 1 FROM v2_payments WHERE order_id=?)
      `).bind(original.subtotalCents,Number(original.couponDiscountCents||0),
        original.totalCents,original.payment.depositCents,
        original.payment.balanceCents,oldJson,nowIso(),manual.id,newJson,manual.id).run();
    }
    conflict('Seu pedido foi atualizado. Recarregue antes de pagar.');
  }
  return getV2ManualOrderForCustomer(env.DB,token);
}


// Finalização da surpresa ANTES da tela de total e dos termos de pagamento.
// Reaproveita o mesmo pedido manual, sem criar pedido ou checkout adicionais.
export async function applyManualBlackLibriBeforePayment(env,token,body={}) {
  let {manual,customer}=await context(env,token);
  if (manual.pricing.snapshot?.blackLibri) {
    return {ok:true,order:manual,alreadyApplied:true};
  }
  if (!(await canOffer(env,manual))) {
    conflict('Este pedido já iniciou pagamento. Reabra seu link para conferir.');
  }
  const claim=await findBlackLibriClaim(env,customer);
  if (!claim || claim.status!=='reserved' || claim.order_id) {
    conflict('Este presente não está disponível para este pedido.');
  }
  if (Date.parse(claim.expires_at)<=Date.now()) {
    conflict('O prazo deste presente terminou.');
  }
  const productCode=String(body.productCode||'');
  const variantCode=String(body.variantCode||'');
  const addonCodes=Array.isArray(body.addonCodes)?body.addonCodes:[];
  const changed=addonCodes.length>0 ||
    productCode!==String(manual.pricing.snapshot?.product?.code||'') ||
    variantCode!==String(manual.pricing.snapshot?.variant?.code||'');
  if (changed) {
    await applyManualClientAddons(
      env.DB,manual,addonCodes,body.expectedTotalCents,
      {productCode,variantCode}
    );
    manual=await getV2ManualOrderForCustomer(env.DB,token);
  } else if (Number(body.expectedTotalCents)!==manual.pricing.totalCents) {
    conflict('O valor do pedido mudou. Atualize a página e confira o total.');
  }
  const updated=await prepareManualBlackLibriPayment(env,token,manual);
  if (updated.pricing.snapshot?.blackLibri?.claimId!==claim.id) {
    conflict('Não foi possível aplicar a surpresa ao pedido. Atualize a página.');
  }
  return {ok:true,order:updated,alreadyApplied:false};
}
