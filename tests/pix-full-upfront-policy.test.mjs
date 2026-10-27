import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, day, providerMock } from './helpers.mjs';
import { calculateCommercialV2Quote } from '../src/lib/v2-commercial-pricing.js';
import { createV2ManualOrder, previewV2ManualOrder, startV2ManualOrderPayment } from '../src/lib/v2-orders-manual.js';
import { startV2Checkout, resumeV2Payment } from '../src/lib/v2-checkout.js';
import { getV2StoreConfig } from '../src/lib/v2-store-config.js';

const request = new Request('https://pedidos.libriconvites.com.br/api/v2/checkout/start');
const env = DB => ({DB,MERCADO_PAGO_ACCESS_TOKEN:'TEST-token'});
const selection = {productCode:'interactive_essential',paymentMethod:'pix'};
const customer = {name:'Cliente Fictícia',whatsapp:'5561999999999',email:'example@test.invalid'};
const event = {type:'birthday',honoreeName:'Teste Pix',date:day(65)};
const deliveryWindow = {start:day(10),end:day(12)};
async function acceptedTerms(DB){
  const row=DB.sqlite.prepare('SELECT version FROM v2_terms_versions WHERE active=1').get();
  return {termsAccepted:true,termsVersion:row.version};
}

test('Pix quote always collects 100% by default, including untrusted client 50% field',async()=>{
  const DB=database();
  const q=await calculateCommercialV2Quote(DB,{...selection,paymentDepositPercent:50,adminDepositPercent:50});
  assert.equal(q.payment.method,'pix');
  assert.equal(q.payment.depositPercent,100);
  assert.equal(q.payment.depositCents,q.totalCents);
  assert.equal(q.payment.balanceCents,0);
  assert.equal(q.payment.adminDepositException,false);
  const config=await getV2StoreConfig({DB});
  assert.equal(config.settings.checkout.pixDepositPercent,100);
  const card=await calculateCommercialV2Quote(DB,{...selection,paymentMethod:'card'},{adminDepositPercent:50});
  assert.equal(card.payment.depositPercent,100);
  assert.equal(card.payment.balanceCents,0);
});

test('new public Pix checkout charges all up front in provider and pricing',async t=>{
  const DB=database(),provider=providerMock(t);
  const result=await startV2Checkout(request,env(DB),{
    clientRequestId:crypto.randomUUID(),customer,event,deliveryWindow,
    selection:{...selection,paymentDepositPercent:50,adminDepositException:true},
    ...await acceptedTerms(DB),
  });
  const pricing=DB.sqlite.prepare('SELECT * FROM v2_order_pricing WHERE order_id=(SELECT id FROM v2_orders WHERE order_code=?)').get(result.order.code);
  assert.equal(pricing.deposit_percent,100);
  assert.equal(pricing.deposit_cents,pricing.total_cents);
  assert.equal(pricing.balance_cents,0);
  assert.equal(result.payment.amountDueNowCents,result.payment.totalCents);
  assert.equal(provider.bodies.at(-1).total_amount,(pricing.total_cents/100).toFixed(2));
});

test('admin manual-order previews default 100%, explicit 50% exception and refuses card 50%',async()=>{
  const DB=database(),body={customer,event,selection};
  const full=await previewV2ManualOrder(DB,body);
  assert.equal(full.quote.payment.depositPercent,100);
  assert.equal(full.quote.payment.balanceCents,0);
  const half=await previewV2ManualOrder(DB,{...body,paymentDepositPercent:50});
  assert.equal(half.quote.payment.depositPercent,50);
  assert.equal(half.quote.payment.depositCents,Math.round(half.quote.totalCents*.5));
  assert.equal(half.quote.payment.balanceCents,half.quote.totalCents-half.quote.payment.depositCents);
  assert.equal(half.quote.payment.adminDepositException,true);
  await assert.rejects(previewV2ManualOrder(DB,{...body,paymentDepositPercent:70}),/Condição de pagamento inválida/);
  await assert.rejects(previewV2ManualOrder(DB,{...body,selection:{...selection,paymentMethod:'card'},paymentDepositPercent:50}),/somente no Pix/);
});

test('admin manual order 50% authorization persists and payment link collects precisely half',async t=>{
  const DB=database(),provider=providerMock(t);
  const created=await createV2ManualOrder(request,env(DB),{
    customer,event,deliveryWindow,selection,paymentDepositPercent:50,
  });
  const order=DB.sqlite.prepare('SELECT * FROM v2_order_pricing WHERE order_id=?').get(created.order.id);
  assert.equal(order.deposit_percent,50);
  assert.equal(order.deposit_cents,Math.round(order.total_cents*.5));
  assert.equal(order.balance_cents,order.total_cents-order.deposit_cents);
  assert.equal(JSON.parse(order.pricing_snapshot_json).payment.adminDepositException,true);
  const history=DB.sqlite.prepare("SELECT metadata_json FROM v2_order_history WHERE order_id=? AND action_code='manual_order_created'").get(created.order.id);
  assert.equal(JSON.parse(history.metadata_json).depositPercent,50);
  const started=await startV2ManualOrderPayment(request,env(DB),created.order.publicToken,{
    clientRequestId:crypto.randomUUID(),...await acceptedTerms(DB)
  });
  assert.equal(started.payment.amountDueNowCents,order.deposit_cents);
  assert.equal(provider.bodies.at(-1).total_amount,(order.deposit_cents/100).toFixed(2));
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments WHERE order_id=?').get(created.order.id).n,1);
});

test('existing 50% Pix orders are not repriced on resume while new orders remain 100%',async t=>{
  const DB=database(),provider=providerMock(t);
  const initial=await startV2Checkout(request,env(DB),{
    clientRequestId:crypto.randomUUID(),customer,event,deliveryWindow,selection,
    ...await acceptedTerms(DB),
  });
  const id=DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code=?').get(initial.order.code).id;
  DB.sqlite.prepare("UPDATE v2_order_pricing SET deposit_percent=50, deposit_cents=ROUND(total_cents/2), balance_cents=total_cents-ROUND(total_cents/2) WHERE order_id=?").run(id);
  DB.sqlite.prepare("UPDATE v2_payments SET status='cancelled' WHERE order_id=?").run(id);
  DB.sqlite.prepare("UPDATE v2_checkout_holds SET status='cancelled' WHERE order_id=?").run(id);
  const p=DB.sqlite.prepare('SELECT pricing_snapshot_json FROM v2_order_pricing WHERE order_id=?').get(id);
  const snapshot=JSON.parse(p.pricing_snapshot_json);
  snapshot.payment={...snapshot.payment,depositPercent:50,depositCents:Math.round(snapshot.totalCents/2),balanceCents:snapshot.totalCents-Math.round(snapshot.totalCents/2)};
  DB.sqlite.prepare('UPDATE v2_order_pricing SET pricing_snapshot_json=? WHERE order_id=?').run(JSON.stringify(snapshot),id);
  const resumed=await resumeV2Payment(request,env(DB),initial.order.publicToken,{
    paymentMethod:'pix',...await acceptedTerms(DB)
  });
  assert.equal(resumed.payment.amountDueNowCents,Math.round(resumed.payment.totalCents*.5));
  assert.equal(provider.bodies.at(-1).total_amount,(resumed.payment.amountDueNowCents/100).toFixed(2));
  const saved=DB.sqlite.prepare('SELECT deposit_percent FROM v2_order_pricing WHERE order_id=?').get(id);
  assert.equal(saved.deposit_percent,50);
  const card=await resumeV2Payment(request,env(DB),initial.order.publicToken,{
    paymentMethod:'card',...await acceptedTerms(DB)
  });
  assert.equal(card.payment.amountDueNowCents,card.payment.totalCents);
  const backToPix=await resumeV2Payment(request,env(DB),initial.order.publicToken,{
    paymentMethod:'pix',...await acceptedTerms(DB)
  });
  assert.equal(backToPix.payment.amountDueNowCents,
    Math.round(backToPix.payment.totalCents*.5),'older 50% deal must survive checking another method');
  const snapshotAfter=JSON.parse(DB.sqlite.prepare('SELECT pricing_snapshot_json FROM v2_order_pricing WHERE order_id=?').get(id).pricing_snapshot_json);
  assert.equal(snapshotAfter.legacyPixDepositPercent,50);
});
test('payment wording and admin exception are visible with cache refreshed',()=>{
  const client=readFileSync('public/js/client-v2-store.js','utf8');
  const admin=readFileSync('public/js/admin-v2-manual.js','utf8');
  const checkout=readFileSync('src/lib/v2-checkout.js','utf8');
  assert.match(client,/Pagamento integral antecipado no Pix/);
  assert.match(client,/Entrada excepcional autorizada pela Libri/);
  assert.match(admin,/manualHalfDeposit/);
  assert.match(admin,/Pix • 100% antecipado/);
  assert.match(checkout,/originalPercent === 50/);
  assert.match(checkout,/adminDepositException/);
});
