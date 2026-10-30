import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, day, providerMock } from './helpers.mjs';
import { startV2Checkout, resumeV2Payment } from '../src/lib/v2-checkout.js';
import { getV2CustomerArea } from '../src/lib/v2-customer-area.js';
import { syncMercadoPagoOrder } from '../src/lib/v2-mercadopago.js';

const request = new Request('https://pedidos.libriconvites.com.br/api/v2/checkout/start');
const env = DB => ({ DB, MERCADO_PAGO_ACCESS_TOKEN: 'TEST-token' });

test('Safari retry exposes existing pending checkout without creating another payment', async t => {
  const DB = database();
  const mp = providerMock(t);
  const terms = DB.sqlite.prepare('SELECT version FROM v2_terms_versions WHERE active=1').get();
  const order = await startV2Checkout(request, env(DB), {
    clientRequestId: crypto.randomUUID(),
    customer: { name:'Cliente Teste', whatsapp:'5511999999999', email:'test@example.com' },
    event: { type:'birthday', honoreeName:'Criança Teste', date:day(65) },
    selection: { productCode:'interactive_essential', paymentMethod:'pix' },
    deliveryWindow: { start:day(15), end:day(17) },
    termsAccepted:true, termsVersion:terms.version,
  });
  const { publicToken } = order.order;
  const before = mp.posts;
  const waiting = await getV2CustomerArea(env(DB), publicToken);
  assert.equal(waiting.order.status, 'awaiting_payment');
  assert.equal(waiting.payment.activeCheckoutUrl, order.payment.checkoutUrl);
  assert.equal(waiting.payment.activeCheckoutMethod, 'pix');
  assert.equal(mp.posts, before, 'reading checkout link must never create another provider order');

  const resumed = await resumeV2Payment(request,env(DB),publicToken,{
    paymentMethod:'pix',clientRequestId:crypto.randomUUID(),
  });
  assert.equal(resumed.payment.checkoutUrl, order.payment.checkoutUrl);
  assert.equal(mp.posts, before, 'resuming same method reuses existing checkout');

  mp.approve(order.payment.providerOrderId);
  await syncMercadoPagoOrder(env(DB), order.payment.providerOrderId);
  const paid = await getV2CustomerArea(env(DB), publicToken);
  assert.equal(paid.payment.activeCheckoutUrl, null);
  assert.equal(paid.briefing.locked, false);
});

test('expired temporary hold does not expose stale provider checkout link', async t => {
  const DB=database(); providerMock(t);
  const version=DB.sqlite.prepare('SELECT version FROM v2_terms_versions WHERE active=1').get().version;
  const started=await startV2Checkout(request,env(DB),{
    clientRequestId:crypto.randomUUID(),
    customer:{name:'Cliente Teste',whatsapp:'5511999999999',email:'test@example.com'},
    event:{type:'birthday',honoreeName:'Criança',date:day(60)},
    selection:{productCode:'interactive_essential',paymentMethod:'pix'},
    deliveryWindow:{start:day(12),end:day(14)},
    termsAccepted:true,termsVersion:version,
  });
  DB.sqlite.prepare("UPDATE v2_checkout_holds SET expires_at='2000-01-01' WHERE order_id=(SELECT id FROM v2_orders WHERE order_code=?)")
    .run(started.order.code);
  const area=await getV2CustomerArea(env(DB),started.order.publicToken);
  assert.equal(area.payment.activeCheckoutUrl,null);
});

test('payment retry UI has user initiated Safari link, method switch and visible error reasons', () => {
  const source=readFileSync('public/js/client-v2-area.js','utf8');
  assert.match(source, /id="openExistingCheckout"/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.match(source, /area\.payment\.activeCheckoutMethod/);
  assert.match(source, /syncExistingCheckoutAction/);
  assert.match(source, /paymentRetryNotice/);
  assert.match(source, /Não foi possível continuar o pagamento:/);
  assert.match(source, /role="alert"/);
  assert.match(source, /getElementById\('openExistingCheckout'\)/);
});
