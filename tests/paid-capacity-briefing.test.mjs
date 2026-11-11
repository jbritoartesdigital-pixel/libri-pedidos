import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, day, providerMock } from './helpers.mjs';
import { startV2Checkout } from '../src/lib/v2-checkout.js';
import { setV2AgendaPeriod } from '../src/lib/v2-agenda-admin.js';
import { syncMercadoPagoOrder } from '../src/lib/v2-mercadopago.js';
import { getV2CustomerArea, saveV2Briefing } from '../src/lib/v2-customer-area.js';
import { getV2AdminOrderDetail, reviewPaidV2Capacity } from '../src/lib/v2-admin-core.js';

const request = new Request('https://pedidos.libriconvites.com.br/api/v2/checkout/start');
const env = DB => ({ DB, MERCADO_PAGO_ACCESS_TOKEN: 'TEST-token' });
async function makeCheckout(DB) {
  const e = env(DB);
  const terms = await DB.prepare('SELECT version FROM v2_terms_versions WHERE active=1').first();
  return startV2Checkout(request, e, {
    clientRequestId: crypto.randomUUID(),
    customer: {name:'Cliente Exemplo',whatsapp:'5511988776655',email:'test@example.com'},
    event: {honoreeName:'Liz Teste',type:'birthday',date:day(80)},
    selection: {productCode:'interactive_essential',paymentMethod:'pix'},
    deliveryWindow: {start:day(20),end:day(22)},
    termsAccepted:true, termsVersion:terms.version,
  });
}
async function paidLateOrder(t) {
  const DB=database();
  const mp=providerMock(t);
  const e=env(DB);
  const created=await makeCheckout(DB);
  DB.sqlite.prepare("UPDATE v2_checkout_holds SET status='expired',expires_at='2000-01-01'").run();
  await setV2AgendaPeriod(DB,{start:day(20),end:day(22),blocked:true});
  mp.approve(created.payment.providerOrderId);
  return {DB,e,mp,created,payment:created};
}

test('Pix aprovado com reserva expirada libera o formulário mas NÃO a produção', async t => {
  const { DB,e,mp,created,payment } = await paidLateOrder(t);
  const area = await getV2CustomerArea(e,created.order.publicToken);
  assert.equal(area.payment.capacityReview,true);
  assert.equal(area.briefing.locked,false);
  assert.equal(area.order.status,'briefing_pending');
  assert.ok(area.payment.paidCents > 0);
  const code = created.order.code;
  const detail = await getV2AdminOrderDetail(DB, code);
  assert.equal(detail.order.capacityReview,true);
  assert.equal(detail.order.canUnlockPaidBriefing,false);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM v2_agenda_allocations').first()).n,0);
  assert.equal(mp.posts,1);
  const updated = await saveV2Briefing(e,created.order.publicToken,{
    currentSection:'event',data:{venue_name:'Festa Exemplo'},
  });
  assert.equal(updated.status,'in_progress');
  assert.equal((await DB.prepare('SELECT status FROM v2_orders').first()).status,'briefing_pending');
  const repeated=await syncMercadoPagoOrder(e,payment.payment.providerOrderId);
  assert.equal(repeated.capacityReview,true,'webhook repetido não ultrapassa capacidade');
  assert.equal((await DB.prepare("SELECT COUNT(*) n FROM v2_order_history WHERE action_code='payment_capacity_review'").first()).n,1);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM v2_payments').first()).n,1);
  assert.equal(mp.posts,1);
});

test('Central reavalia capacidade com idempotência e sem cobrar novamente', async t => {
  const { DB,e,mp,created }=await paidLateOrder(t);
  await getV2CustomerArea(e,created.order.publicToken);
  await assert.rejects(
    reviewPaidV2Capacity(DB,created.order.code,'confirm_capacity'),
    /não tem capacidade/,
  );
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM v2_agenda_allocations').first()).n,0);
  await setV2AgendaPeriod(DB,{start:day(20),end:day(22),blocked:false});
  const result=await reviewPaidV2Capacity(DB,created.order.code,'confirm_capacity');
  assert.equal(result.confirmed,true);
  assert.ok((await DB.prepare('SELECT COUNT(*) n FROM v2_agenda_allocations').first()).n>0);
  assert.equal((await getV2CustomerArea(e,created.order.publicToken)).payment.capacityReview,false);
  assert.equal((await DB.prepare('SELECT status FROM v2_orders').first()).status,'briefing_pending');
  assert.equal((await DB.prepare("SELECT COUNT(*) n FROM v2_order_history WHERE action_code='delivery_capacity_confirmed'").first()).n,1);
  assert.equal(mp.posts,1);
});

test('Central não pode liberar dados sem entrada efetivamente aprovada', async t => {
  const DB=database();
  providerMock(t);
  const created=await makeCheckout(DB);
  await assert.rejects(
    reviewPaidV2Capacity(DB,created.order.code,'unlock_briefing'),
    /Não há pagamento aprovado/,
  );
  assert.equal((await DB.prepare('SELECT briefing_status FROM v2_orders').first()).briefing_status,'locked');
});

test('Central oferece liberação manual a pedido pago antigo bloqueado', async t => {
  const { DB,e,created,payment } = await paidLateOrder(t);
  // Simula atualização financeira já recebida, mas sem reprocessar o webhook.
  DB.sqlite.prepare(
    "UPDATE v2_payments SET status='approved' WHERE provider_order_id=?"
  ).run(payment.payment.providerOrderId);
  const before = await getV2AdminOrderDetail(DB,created.order.code);
  assert.equal(before.order.capacityReview,true);
  assert.equal(before.order.canUnlockPaidBriefing,true);
  const unlocked = await reviewPaidV2Capacity(DB,created.order.code,'unlock_briefing');
  assert.equal(unlocked.unlocked,true);
  assert.equal((await DB.prepare('SELECT briefing_status FROM v2_orders').first()).briefing_status,'available');
  assert.equal((await DB.prepare('SELECT status FROM v2_orders').first()).status,'briefing_pending');
});

test('botões e retorno do cliente distinguem dados de produção', () => {
  const admin=readFileSync('public/js/admin-v2-order.js','utf8');
  const area=readFileSync('public/js/client-v2-area.js','utf8');
  const route=readFileSync('src/routes/admin-v2-core.js','utf8');
  const server=readFileSync('src/lib/v2-customer-area.js','utf8');
  assert.match(admin,/Liberar preenchimento dos dados/);
  assert.match(admin,/Conferir agenda e liberar produção/);
  assert.match(admin,/capacity-review/);
  assert.match(area,/Você já pode preencher seus dados/);
  assert.match(area,/revisando a janela de entrega/);
  assert.match(route,/capacityReviewMatch/);
  assert.match(server,/awaitingCapacity \? 'briefing_pending'/);
  assert.match(server,/pendingPaidCapacityReview/);
});
