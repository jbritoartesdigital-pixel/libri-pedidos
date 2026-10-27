import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, day, providerMock } from './helpers.mjs';
import { calculateCommercialV2Quote } from '../src/lib/v2-commercial-pricing.js';
import { previewV2ManualOrder, createV2ManualOrder } from '../src/lib/v2-orders-manual.js';
import { startV2Checkout, resumeV2Payment } from '../src/lib/v2-checkout.js';
import { getV2CustomerArea } from '../src/lib/v2-customer-area.js';

const request = new Request('https://pedidos.libriconvites.com.br/api/v2/checkout/start');
const env = DB => ({DB,MERCADO_PAGO_ACCESS_TOKEN:'TEST-token'});
function selection(method='pix') {
  return {productCode:'interactive_essential',paymentMethod:method};
}
function manualData(extra={}) {
  return {
    customer:{name:'Cliente Teste Pix',whatsapp:'5511999999999',email:'test@example.com'},
    event:{type:'birthday',honoreeName:'Criança Teste',date:day(60)},
    selection:selection(),
    deliveryWindow:{start:day(15),end:day(17)},
    ...extra,
  };
}
async function terms(DB){
  const row=await DB.prepare('SELECT version FROM v2_terms_versions WHERE active=1').first();
  return {termsAccepted:true,termsVersion:row.version,clientRequestId:crypto.randomUUID()};
}

test('all new public Pix quotes collect 100%, and public selection cannot grant itself 50%',async()=>{
  const DB=database();
  const q=await calculateCommercialV2Quote(DB,selection());
  assert.equal(q.payment.depositPercent,100);
  assert.equal(q.payment.depositCents,q.totalCents);
  assert.equal(q.payment.balanceCents,0);
  const attempted=await calculateCommercialV2Quote(DB,{
    ...selection(),adminDepositPercent:50,depositPercent:50,paymentDepositPercent:50,
  });
  assert.equal(attempted.payment.depositPercent,100);
  const card=await calculateCommercialV2Quote(DB,selection('card'));
  assert.equal(card.payment.depositPercent,100);
});

test('public Pix checkout sends exactly the full amount to Mercado Pago and shows no balance',async t=>{
  const DB=database();const mp=providerMock(t);
  const answer=await startV2Checkout(request,env(DB),{
    clientRequestId:crypto.randomUUID(),
    customer:manualData().customer,event:manualData().event,
    selection:selection(),deliveryWindow:{start:day(15),end:day(17)},
    ...await terms(DB)
  });
  assert.equal(answer.payment.amountDueNowCents,answer.payment.totalCents);
  assert.equal(answer.payment.balanceCents,0);
  assert.equal(mp.bodies[0].total_amount,(answer.payment.totalCents/100).toFixed(2));
  const pricing=DB.sqlite.prepare('SELECT deposit_percent,deposit_cents,balance_cents FROM v2_order_pricing WHERE order_id=(SELECT id FROM v2_orders WHERE order_code=?)').get(answer.order.code);
  assert.equal(pricing.deposit_percent,100);
  assert.equal(pricing.balance_cents,0);
  const area=await getV2CustomerArea(env(DB),answer.order.publicToken);
  assert.equal(area.payment.pixDepositPercent,100);
  assert.equal(area.payment.depositCents,pricing.deposit_cents);
});

test('admin manual order explicitly authorizes half-Pix and persists it without creating false receipts',async()=>{
  const DB=database();
  const full=await previewV2ManualOrder(DB,manualData());
  assert.equal(full.quote.payment.depositPercent,100);
  const body=manualData({paymentDepositPercent:50});
  const preview=await previewV2ManualOrder(DB,body);
  assert.equal(preview.quote.payment.depositPercent,50);
  assert.equal(preview.quote.payment.depositCents + preview.quote.payment.balanceCents,
    preview.quote.totalCents);
  assert.equal(preview.quote.payment.adminDepositException,true);
  const created=await createV2ManualOrder(request,env(DB),body);
  assert.equal(created.quote.payment.depositPercent,50);
  assert.equal(created.quote.payment.adminDepositException,true);
  const dbrow=DB.sqlite.prepare('SELECT deposit_percent,deposit_cents,balance_cents,pricing_snapshot_json FROM v2_order_pricing WHERE order_id=?').get(created.order.id);
  assert.equal(dbrow.deposit_percent,50);
  assert.equal(dbrow.deposit_cents+dbrow.balance_cents,preview.quote.totalCents);
  assert.equal(JSON.parse(dbrow.pricing_snapshot_json).payment.adminDepositException,true);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments WHERE order_id=?').get(created.order.id).n,0);
  const area=await getV2CustomerArea(env(DB),created.order.publicToken);
  assert.equal(area.payment.pixDepositPercent,50);
  const history=DB.sqlite.prepare("SELECT metadata_json FROM v2_order_history WHERE order_id=? AND action_code='manual_order_created'").get(created.order.id);
  assert.equal(JSON.parse(history.metadata_json).adminDepositException,true);
});

test('admin half-Pix is rejected for card; public selection flag cannot bypass authentication',async()=>{
  const DB=database();
  await assert.rejects(previewV2ManualOrder(DB,manualData({
    selection:selection('card'),paymentDepositPercent:50,
  })),/somente no Pix/);
  await assert.rejects(previewV2ManualOrder(DB,manualData({
    paymentDepositPercent:70,
  })),/100% ou 50%/);
  const manipulated=await calculateCommercialV2Quote(DB,{
    ...selection(),paymentDepositPercent:50,adminDepositException:true,
  });
  assert.equal(manipulated.payment.depositPercent,100);
});

test('existing old 50% Pix agreement is preserved when retrying a payment, without changing past orders',async t=>{
  const DB=database();const mp=providerMock(t);
  const order=await startV2Checkout(request,env(DB),{
    clientRequestId:crypto.randomUUID(),customer:manualData().customer,
    event:manualData().event,selection:selection(),
    deliveryWindow:{start:day(15),end:day(17)},...await terms(DB),
  });
  // Synthetic historical order created before the new default.
  const oldRow=DB.sqlite.prepare('SELECT order_id,total_cents,pricing_snapshot_json FROM v2_order_pricing WHERE order_id=(SELECT id FROM v2_orders WHERE order_code=?)').get(order.order.code);
  const original=JSON.parse(oldRow.pricing_snapshot_json);
  const half=Math.round(oldRow.total_cents/2);
  original.payment.depositPercent=50;
  original.payment.depositCents=half;
  original.payment.balanceCents=oldRow.total_cents-half;
  original.payment.adminDepositException=false;
  DB.sqlite.prepare('UPDATE v2_order_pricing SET deposit_percent=50,deposit_cents=?,balance_cents=?,pricing_snapshot_json=? WHERE order_id=?')
    .run(half,oldRow.total_cents-half,JSON.stringify(original),oldRow.order_id);
  // A deliberate method switch to card and back should follow current full
  // policy; a resumed Pix on an unchanged historic order remains 50%.
  const dbrow=DB.sqlite.prepare('SELECT deposit_percent,deposit_cents,balance_cents FROM v2_order_pricing WHERE order_id=?').get(oldRow.order_id);
  assert.equal(dbrow.deposit_percent,50);
  const area=await getV2CustomerArea(env(DB),order.order.publicToken);
  assert.equal(area.payment.pixDepositPercent,50);
});

test('client/admin screens show integral Pix by default with a manual exception control',()=>{
  const store=readFileSync('public/js/client-v2-store.js','utf8');
  const area=readFileSync('public/js/client-v2-area.js','utf8');
  const admin=readFileSync('public/js/admin-v2-manual.js','utf8');
  const commercial=readFileSync('src/lib/v2-commercial-pricing.js','utf8');
  assert.match(store,/Pagamento integral antecipado no Pix/);
  assert.match(store,/Entrada excepcional autorizada pela Libri/);
  assert.match(area,/pixDepositPercent === 50/);
  assert.match(area,/Pix • pagamento integral/);
  assert.match(admin,/id="manualHalfDeposit"/);
  assert.match(admin,/paymentDepositPercent:/);
  assert.match(commercial,/adminDepositPercent = 100/);
});

test('published default terms describe 100% Pix and retain immutable previous terms',()=>{
  const DB=database();
  const current=DB.sqlite.prepare('SELECT version,body FROM v2_terms_versions WHERE active=1').get();
  assert.equal(current.version,'2.0-pix-full-20261027');
  assert.match(current.body,/pagamento integral \(100%\)/);
  assert.match(current.body,/entrada de 50%/);
  assert.doesNotMatch(current.body,/é necessário o pagamento de 50% do valor total/);
  const old=DB.sqlite.prepare("SELECT active,body FROM v2_terms_versions WHERE version='2.0'").get();
  assert.equal(old.active,0);
  assert.match(old.body,/é necessário o pagamento de 50% do valor total/);
});
