import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, day, providerMock } from './helpers.mjs';
import { calculateCommercialV2Quote } from '../src/lib/v2-commercial-pricing.js';
import { previewV2ManualOrder, createV2ManualOrder } from '../src/lib/v2-orders-manual.js';
import { resumeV2Payment, startV2Checkout } from '../src/lib/v2-checkout.js';

const request = new Request('https://pedidos.libriconvites.com.br/api/v2/checkout/start');
const env = DB => ({DB, MERCADO_PAGO_ACCESS_TOKEN:'TEST-token'});
const manual = (pixDepositPercent, pixSplitReason='Cliente solicitou entrada de 50% pelo WhatsApp') => ({
  customer: { name:'Cliente Teste', whatsapp:'5511999999999',email:'teste@example.com' },
  event: { type:'birthday',honoreeName:'Evento Fictício',date:day(50) },
  selection: {productCode:'interactive_essential',paymentMethod:'pix'},
  deliveryWindow: {start:day(10),end:day(12)},
  pixDepositPercent,pixSplitReason,
});

test('new Pix quotes charge 100% upfront after discounts, card remains integral',async()=>{
  const DB=database();
  const pix=await calculateCommercialV2Quote(DB,{
    productCode:'interactive_essential',paymentMethod:'pix'
  });
  assert.equal(pix.payment.depositPercent,100);
  assert.equal(pix.payment.depositCents,pix.totalCents);
  assert.equal(pix.payment.balanceCents,0);
  const card=await calculateCommercialV2Quote(DB,{
    productCode:'interactive_essential',paymentMethod:'card'
  });
  assert.equal(card.payment.depositPercent,100);
  assert.equal(card.payment.balanceCents,0);
  // Public selection is untrusted; a client cannot grant themselves a split.
  const forged=await calculateCommercialV2Quote(DB,{
    productCode:'interactive_essential',paymentMethod:'pix',pixDepositPercent:50,
    depositPercent:50,pixSplitReason:'forged'
  });
  assert.equal(forged.payment.depositPercent,100);
});
test('administrator can prepare a private 50% Pix exception with audited reason',async()=>{
  const DB=database();
  const draft=manual(50);
  const preview=await previewV2ManualOrder(DB,draft);
  assert.equal(preview.quote.payment.depositPercent,50);
  assert.equal(preview.quote.payment.depositCents+preview.quote.payment.balanceCents,
    preview.quote.totalCents);
  const created=await createV2ManualOrder(request,env(DB),draft);
  const rows=DB.sqlite.prepare('SELECT p.total_cents,p.deposit_percent,p.deposit_cents,p.balance_cents,p.pricing_snapshot_json FROM v2_order_pricing p').all();
  assert.equal(rows.length,1);
  assert.equal(rows[0].deposit_percent,50);
  assert.equal(rows[0].deposit_cents,preview.quote.payment.depositCents);
  assert.equal(rows[0].balance_cents,preview.quote.payment.balanceCents);
  const snapshot=JSON.parse(rows[0].pricing_snapshot_json);
  assert.equal(snapshot.adminManualPixException.approved,true);
  assert.equal(snapshot.adminManualPixException.reason,draft.pixSplitReason);
  assert.equal(snapshot.pixDepositPercent,50);
  const historical=DB.sqlite.prepare("SELECT metadata_json FROM v2_order_history WHERE action_code='manual_order_created'").get();
  assert.equal(JSON.parse(historical.metadata_json).pixDepositPercent,50);
  assert.ok(created.client.url.includes('/'));
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments').get().n,0);
});
test('admin private Pix defaults to 100%; card never allows a Pix split',async()=>{
  const DB=database();
  let quotation=await previewV2ManualOrder(DB,manual(undefined));
  assert.equal(quotation.quote.payment.depositPercent,100);
  assert.equal(quotation.quote.payment.balanceCents,0);
  await assert.rejects(previewV2ManualOrder(DB,manual(50,'')),/Explique por que autorizou/);
  await assert.rejects(previewV2ManualOrder(DB,manual(35)),/Entrada inválida/);
  const card=manual(50);
  card.selection.paymentMethod='card';
  await assert.rejects(previewV2ManualOrder(DB,card),/só pode ser liberada no Pix/);
  card.pixDepositPercent=100;
  quotation=await previewV2ManualOrder(DB,card);
  assert.equal(quotation.quote.payment.depositPercent,100);
});
test('new external checkout charges full Pix amount in Mercado Pago',async t=>{
  const DB=database(),mp=providerMock(t);
  const terms=DB.sqlite.prepare('SELECT version FROM v2_terms_versions WHERE active=1').get();
  const checkout=await startV2Checkout(request,env(DB),{
    clientRequestId:crypto.randomUUID(),
    customer:{name:'Cliente Teste',whatsapp:'5511999999999',email:'teste@example.com'},
    event:{type:'birthday',honoreeName:'Teste',date:day(50)},
    deliveryWindow:{start:day(10),end:day(12)},
    selection:{productCode:'interactive_essential',paymentMethod:'pix',pixDepositPercent:50},
    termsAccepted:true,termsVersion:terms.version,
  });
  assert.equal(checkout.payment.balanceCents,0);
  assert.equal(checkout.payment.amountDueNowCents,checkout.payment.totalCents);
  assert.equal(mp.bodies[0].total_amount,(checkout.payment.totalCents/100).toFixed(2));
});
test('old 50% Pix order preserves agreed entry on payment retries and method switches',async t=>{
  const DB=database(),mp=providerMock(t);
  const terms=DB.sqlite.prepare('SELECT version FROM v2_terms_versions WHERE active=1').get();
  const initial=await startV2Checkout(request,env(DB),{
    clientRequestId:crypto.randomUUID(),
    customer:{name:'Cliente Teste',whatsapp:'5511999999999',email:'teste@example.com'},
    event:{type:'birthday',honoreeName:'Teste',date:day(50)},
    deliveryWindow:{start:day(10),end:day(12)},
    selection:{productCode:'interactive_essential',paymentMethod:'pix'},
    termsAccepted:true,termsVersion:terms.version,
  });
  const id=DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code=?').get(initial.order.code).id;
  const half=Math.round(initial.payment.totalCents/2);
  const raw=DB.sqlite.prepare('SELECT pricing_snapshot_json FROM v2_order_pricing WHERE order_id=?').get(id);
  const snapshot=JSON.parse(raw.pricing_snapshot_json);
  snapshot.payment.depositPercent=50;snapshot.payment.depositCents=half;
  snapshot.payment.balanceCents=initial.payment.totalCents-half;
  DB.sqlite.prepare('UPDATE v2_order_pricing SET deposit_percent=50,deposit_cents=?,balance_cents=?,pricing_snapshot_json=? WHERE order_id=?')
    .run(half,initial.payment.totalCents-half,JSON.stringify(snapshot),id);
  const retry=await resumeV2Payment(request,env(DB),initial.order.publicToken,{
    clientRequestId:crypto.randomUUID(),paymentMethod:'pix',
  });
  assert.equal(retry.payment.amountDueNowCents,half);
  // Transitioning to card and back must not silently revoke an old Pix agreement.
  const card=await resumeV2Payment(request,env(DB),initial.order.publicToken,{
    clientRequestId:crypto.randomUUID(),paymentMethod:'card',
  });
  assert.equal(card.payment.amountDueNowCents,card.payment.totalCents);
  const restored=await resumeV2Payment(request,env(DB),initial.order.publicToken,{
    clientRequestId:crypto.randomUUID(),paymentMethod:'pix',
  });
  assert.equal(restored.payment.amountDueNowCents,half);
  assert.equal(restored.payment.balanceCents,initial.payment.totalCents-half);
  assert.ok(mp.bodies.length>=3);
});
test('full-Pix wording in new checkout and per-order split in customer area',()=>{
  const checkout=readFileSync('public/js/client-v2-store.js','utf8');
  const area=readFileSync('public/js/client-v2-area.js','utf8');
  const manualUi=readFileSync('public/js/admin-v2-manual.js','utf8');
  assert.match(checkout,/Pagamento integral antecipado pelo Mercado Pago/);
  assert.doesNotMatch(checkout,/50% para confirmar o pedido/);
  assert.match(area,/area\.payment\.depositCents/);
  assert.match(area,/Pix • pagamento integral/);
  assert.match(area,/pixPercent/);
  assert.match(manualUi,/manualPixHalfException/);
  assert.match(manualUi,/manualPixSplitReason/);
  assert.match(manualUi,/Pix • 100% antecipado/);
});
