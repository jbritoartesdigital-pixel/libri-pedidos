import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  prepareMercadoPagoTab, sendToMercadoPago,
  closeMercadoPagoTab, waitingCustomerAreaPath,
} from '../public/js/client-v2-mercadopago-tab.js';

const fakeTab = () => {
  const routes = [];
  let closed = false;
  return {
    routes,
    document: { title: '', body: { style: {}, textContent: '' } },
    location: { replace: url => routes.push(url) },
    get closed() { return closed; },
    close() { closed = true; },
  };
};

test('new payment tab opens synchronously and receives one secure checkout URL', () => {
  const tab = fakeTab();
  const calls = [];
  const browser = { open: (...args) => { calls.push(args); return tab; } };
  const opened = prepareMercadoPagoTab(browser);
  assert.strictEqual(opened, tab);
  assert.deepEqual(calls, [['about:blank', '_blank']]);
  assert.equal(tab.opener, null);
  assert.match(tab.document.body.textContent, /Preparando seu pagamento/);
  assert.equal(sendToMercadoPago(opened, 'https://www.mercadopago.com.br/checkout/123'), true);
  assert.deepEqual(tab.routes, ['https://www.mercadopago.com.br/checkout/123']);
  closeMercadoPagoTab(opened);
  assert.equal(tab.closed, true);
});

test('blocked popup stays in Libri and checkout never accepts non-HTTPS URL', () => {
  const browser = { open: () => null, location: { origin: 'https://pedidos.libriconvites.com.br' } };
  assert.equal(prepareMercadoPagoTab(browser), null);
  assert.equal(sendToMercadoPago(null, 'https://www.mercadopago.com.br/checkout/123'), false);
  assert.throws(() => sendToMercadoPago(fakeTab(), 'http://fake.invalid/checkout'), /HTTPS/);
  assert.equal(waitingCustomerAreaPath('/meu-pedido/teste', browser), '/meu-pedido/teste?payment=waiting');
  assert.throws(() => waitingCustomerAreaPath('https://site-externo.test/path', browser), /inválido/);
});

test('Mercado Pago returns directly to briefing after approval without a second charge', () => {
  const provider = readFileSync('src/lib/v2-mercadopago.js', 'utf8');
  const area = readFileSync('public/js/client-v2-area.js', 'utf8');
  const store = readFileSync('public/js/client-v2-store.js', 'utf8');
  const entry = readFileSync('public/js/client-v2.js', 'utf8');
  const html = readFileSync('public/client-v2.html', 'utf8');

  assert.match(provider, /\?payment=success&tab=briefing/);
  assert.match(provider, /auto_return:[\s\S]*?'approved'/);
  assert.match(area, /const checkExistingPayment = async/);
  assert.match(area, /await loadArea\(\)/);
  assert.match(area, /window\.addEventListener\('focus'/);
  assert.match(area, /document\.addEventListener\('visibilitychange'/);
  assert.match(area, /activeTab = 'briefing'/);
  assert.match(area, /paymentReturn === 'waiting'/);
  const returnHandler = area.slice(area.indexOf("if (['success', 'pending', 'failure', 'waiting']"), area.indexOf('  setHelp(', area.indexOf("if (['success', 'pending', 'failure', 'waiting']")));
  assert.doesNotMatch(returnHandler, /method:\s*'POST'|randomId\(\)|checkoutUrl/,
    'provider return can only reconcile existing checkout');
  assert.match(store, /prepareMercadoPagoTab\(\)/);
  assert.match(store, /sendToMercadoPago\(checkoutTab, result\.payment\.checkoutUrl\)/);
  assert.match(store, /sendToMercadoPago\(checkoutTab, checkoutUrl\)/);
  assert.match(store, /manualPendingPay/);
  assert.match(html, /client-v2\.js\?v=20261030-safari-retry-1/);
  assert.match(entry, /client-v2-store\.js\?v=20261030-safari-retry-1/);
  assert.match(entry, /client-v2-area\.js\?v=20261030-safari-retry-1/);
});
