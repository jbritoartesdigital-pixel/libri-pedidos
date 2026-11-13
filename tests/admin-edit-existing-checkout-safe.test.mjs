import test from 'node:test';
import assert from 'node:assert/strict';
import { database, day, providerMock } from './helpers.mjs';
import { createV2ManualOrder, getV2ManualOrderForCustomer, startV2ManualOrderPayment }
  from '../src/lib/v2-orders-manual.js';
import { getV2OrderEditOptions, saveV2AdminOrderEdit } from '../src/lib/v2-admin-order-edit.js';
import { releaseV2PendingCheckoutForAdminDeposit }
  from '../src/lib/v2-admin-deposit-checkout.js';

const req=new Request('https://pedidos.libriconvites.com.br/api/v2/manual-order');
const env=DB=>({DB,MERCADO_PAGO_ACCESS_TOKEN:'TEST-token'});
async function checkout(t) {
  const DB=database(), mp=providerMock(t), e=env(DB);
  const created=await createV2ManualOrder(req,e,{
    customer:{name:'Cliente do convite',whatsapp:'5511999000011',email:'cliente@example.com'},
    event:{type:'birthday',honoreeName:'Festa',date:day(75)},
    selection:{productCode:'interactive_essential',paymentMethod:'pix',addonCodes:[]},
    deliveryWindow:{start:day(20),end:day(22)},paymentDepositPercent:100,
  });
  const manual=await getV2ManualOrderForCustomer(DB,created.order.publicToken);
  const beforePayment=await startV2ManualOrderPayment(req,e,manual.token,{
    termsAccepted:true,termsVersion:manual.terms.version,
    expectedTotalCents:manual.pricing.totalCents,
  });
  assert.equal(mp.posts,1);
  const orderId=DB.sqlite.prepare('SELECT id FROM v2_orders WHERE public_token=?').get(manual.token).id;
  return {DB,mp,e,manual,created,beforePayment,orderId};
}
function editInput(current) {
  return {productCode:'',variantCode:'',
    addonCodes:current.items.filter(x=>x.type==='addon').map(x=>x.code),
    manualDiscountCents:current.manualDiscountCents,
    priceAdjustmentCents:current.priceAdjustmentCents,
    paymentDepositPercent:50,
    expectedRevision:current.revision,expectedTotalCents:current.totalCents,
    note:'Autorização expressa de metade via WhatsApp sem alterar brinde e convite',
  };
}
test('checkout Pix 100% criado: cancela só cobrança antiga, mantém pedido, brinde, briefing, novo Pix 50%',async t=>{
  const {DB,mp,e,manual,beforePayment,orderId}=await checkout(t);
  const original=DB.sqlite.prepare('SELECT * FROM v2_orders WHERE id=?').get(orderId);
  const originalItems=DB.sqlite.prepare('SELECT * FROM v2_order_items WHERE order_id=? ORDER BY id')
    .all(orderId);
  const originalSnapshot=JSON.parse(DB.sqlite.prepare('SELECT pricing_snapshot_json FROM v2_order_pricing WHERE order_id=?').get(orderId).pricing_snapshot_json);
  const optsBefore=await getV2OrderEditOptions(DB,original.order_code);
  assert.equal(optsBefore.current.canEditDeposit,false);
  assert.equal(optsBefore.current.canReleaseOldCheckout,true);
  // A gift is promotional order data, not a second checkout. Preserve
  // unknown fields in the pricing snapshot and original item row IDs.
  const snapWithGift={...originalSnapshot,blackLibriGift:{
    code:'BRINDE_TESTE',available:true,wasAwarded:true}};
  DB.sqlite.prepare('UPDATE v2_order_pricing SET pricing_snapshot_json=? WHERE order_id=?')
    .run(JSON.stringify(snapWithGift),orderId);
  const briefing=DB.sqlite.prepare('SELECT data_json FROM v2_briefings WHERE order_id=?').get(orderId);
  const result=await releaseV2PendingCheckoutForAdminDeposit(e,original.order_code);
  assert.equal(result.cancelled,1);
  assert.equal(result.sameOrder,true);
  assert.equal(result.customerAreaPath,`/meu-pedido/${manual.token}`);
  assert.equal(mp.orders.get(beforePayment.payment.providerOrderId).status,'cancelled');
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_payments WHERE provider_order_id=?')
    .get(beforePayment.payment.providerOrderId).status,'cancelled');
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM v2_checkout_holds WHERE order_id=? AND status='active'")
    .get(orderId).n,0);
  const opts=await getV2OrderEditOptions(DB,original.order_code);
  assert.equal(opts.current.canEditDeposit,true);
  assert.equal(opts.current.customerAreaPath,`/meu-pedido/${manual.token}`);
  const saved=await saveV2AdminOrderEdit(DB,original.order_code,editInput(opts.current));
  assert.equal(saved.depositPercent,50);
  const updated=DB.sqlite.prepare('SELECT * FROM v2_orders WHERE id=?').get(orderId);
  assert.equal(updated.public_token,original.public_token);
  assert.equal(updated.event_date,original.event_date);
  assert.equal(updated.briefing_status,original.briefing_status);
  const newItems=DB.sqlite.prepare('SELECT * FROM v2_order_items WHERE order_id=? ORDER BY id').all(orderId);
  assert.deepEqual(newItems,originalItems,'todos os itens e IDs do brinde permanecem iguais');
  const newBriefing=DB.sqlite.prepare('SELECT data_json FROM v2_briefings WHERE order_id=?').get(orderId);
  assert.deepEqual(newBriefing,briefing,'dados de briefing não alterados');
  const pricing=DB.sqlite.prepare('SELECT * FROM v2_order_pricing WHERE order_id=?').get(orderId);
  assert.equal(pricing.deposit_cents,Math.round(pricing.total_cents/2));
  assert.equal(pricing.balance_cents,pricing.total_cents-pricing.deposit_cents);
  const snapshot=JSON.parse(pricing.pricing_snapshot_json);
  assert.deepEqual(snapshot.blackLibriGift,snapWithGift.blackLibriGift);
  assert.equal(snapshot.payment.adminDepositException,true);
  const nextManual=await getV2ManualOrderForCustomer(DB,manual.token);
  const after=await startV2ManualOrderPayment(req,e,manual.token,{
    termsAccepted:true,termsVersion:nextManual.terms.version,
    expectedTotalCents:nextManual.pricing.totalCents,
  });
  assert.equal(mp.posts,2,'nova preferência, mesmo pedido');
  assert.equal(after.payment.amountDueNowCents,pricing.deposit_cents);
  assert.equal(mp.bodies[1].total_amount,(pricing.deposit_cents/100).toFixed(2));
  const stillSame=DB.sqlite.prepare('SELECT COUNT(*) n FROM v2_orders WHERE id=?').get(orderId).n;
  assert.equal(stillSame,1);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM v2_order_history WHERE action_code='admin_deposit_exception_changed'").get().n,1);
});
test('MP já pago na tentativa antiga: proibido cancelar e reemitir 50%',async t=>{
  const {DB,mp,e,manual,beforePayment,orderId}=await checkout(t);
  const id=beforePayment.payment.providerOrderId;
  mp.approve(id);
  await assert.rejects(releaseV2PendingCheckoutForAdminDeposit(e,manual.code),
    /Pagamento aprovado|pagamento aprovado|Pagamento recebido/);
  assert.equal(mp.orders.get(id).status,'processed');
  const options=await getV2OrderEditOptions(DB,manual.code);
  assert.equal(options.current.canEditDeposit,false);
  assert.equal(mp.posts,1);
  assert.equal(DB.sqlite.prepare('SELECT deposit_percent FROM v2_order_pricing WHERE order_id=?')
    .get(orderId).deposit_percent,100);
});
test('repetir liberação não reabre checkout ou altera o pedido',async t=>{
  const {DB,mp,e,manual}=await checkout(t);
  const first=await releaseV2PendingCheckoutForAdminDeposit(e,manual.code);
  const second=await releaseV2PendingCheckoutForAdminDeposit(e,manual.code);
  assert.equal(first.cancelled,1);
  assert.equal(second.cancelled,0);
  assert.equal(mp.posts,1);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM v2_order_history WHERE action_code='admin_checkout_released_for_deposit'").get().n,1);
});
