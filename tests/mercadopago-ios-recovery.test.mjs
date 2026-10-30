import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, day, providerMock } from './helpers.mjs';
import { startV2Checkout } from '../src/lib/v2-checkout.js';
import { getV2CustomerArea } from '../src/lib/v2-customer-area.js';
import { prepareMercadoPagoTab, sendToMercadoPago } from '../public/js/client-v2-mercadopago-tab.js';

const env = DB => ({ DB, MERCADO_PAGO_ACCESS_TOKEN: 'TEST-token' });
const request = new Request('https://pedidos.libriconvites.com.br/api/v2/checkout/start');
async function terms(DB) {
  const t = await DB.prepare('SELECT version FROM v2_terms_versions WHERE active=1').first();
  return { termsAccepted: true, termsVersion: t.version };
}
async function newCheckout(DB) {
  return startV2Checkout(request, env(DB), {
    clientRequestId: crypto.randomUUID(),
    customer: { name:'Cliente de Teste', whatsapp:'5511999999999', email:'test@example.com' },
    event: { honoreeName:'Festa Exemplo', type:'birthday', date:day(60) },
    selection: { productCode:'interactive_essential', paymentMethod:'pix' },
    deliveryWindow: { start:day(15), end:day(17) },
    ...await terms(DB),
  });
}

test('Safari iOS não abre aba vazia antes de receber checkout', () => {
  let opens = 0;
  const safari = { navigator: { userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Safari' },
    open: () => { opens++; return {}; } };
  assert.equal(prepareMercadoPagoTab(safari), null);
  assert.equal(opens, 0, 'não abrir aba em branco no iOS');
  assert.equal(sendToMercadoPago(null, 'https://www.mercadopago.com.br/checkout/123'), false);
});

test('falha de navegação do popup não bloqueia link manual do checkout', () => {
  const tab = { closed: false, location: { replace: () => { throw new Error('popup bloqueado'); } } };
  assert.equal(sendToMercadoPago(tab, 'https://www.mercadopago.com.br/checkout/123'), false);
});

test('pedido pendente usa checkout Mercado Pago existente sem nova cobrança', async t => {
  const DB = database(); const mp = providerMock(t);
  const created = await newCheckout(DB);
  const area = await getV2CustomerArea(env(DB), created.order.publicToken);
  assert.equal(area.payment.checkoutUrl, created.payment.checkoutUrl);
  assert.equal(mp.posts, 1, 'consultar pedido não cria segunda transação');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments').get().n, 1);

  DB.sqlite.prepare("UPDATE v2_checkout_holds SET expires_at='2000-01-01T00:00:00.000Z'")
    .run();
  const expired = await getV2CustomerArea(env(DB), created.order.publicToken);
  assert.equal(expired.payment.checkoutUrl, null, 'não sugerir link com reserva expirada');
  assert.equal(mp.posts, 1);
});

test('a tela de pagamento dá alternativa direta e mostra erro específico', () => {
  const area = readFileSync('public/js/client-v2-area.js','utf8');
  const helper = readFileSync('public/js/client-v2-mercadopago-tab.js','utf8');
  assert.match(area, /id="openExistingCheckout"/);
  assert.match(area, /target="_blank"/);
  assert.match(area, /activeCheckoutUrl/);
  assert.match(area, /retryNotice\.textContent/);
  assert.match(area, /existingCheckout\.classList\.toggle\('hidden'/);
  assert.match(helper, /iPhone\|iPad\|iPod/);
});
