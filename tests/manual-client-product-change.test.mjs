import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, day, providerMock } from './helpers.mjs';
import {
  createV2ManualOrder, getV2ManualOrderForCustomer, startV2ManualOrderPayment,
} from '../src/lib/v2-orders-manual.js';
import {
  getManualClientAddonOffer, quoteManualClientAddons,
} from '../src/lib/v2-manual-client-addons.js';
import { handlePublicManualOrderV2Api } from '../src/routes/public-manual-order-v2.js';

const request = new Request('https://pedidos.libriconvites.com.br/api/v2/manual-order');
const env = DB => ({ DB, MERCADO_PAGO_ACCESS_TOKEN: 'TEST-token' });
async function prepared(DB, { percent = 50, method = 'pix', productCode = 'cinematic_interactive',
  variantCode = 'cinematic_interactive_3', addonCodes = [] } = {}) {
  const created = await createV2ManualOrder(request, env(DB), {
    customer: { name: 'Cliente Exemplo', whatsapp: '5511988776655', email: 'client@example.com' },
    event: { type: 'birthday', honoreeName: 'Aniversário Teste', date: day(85) },
    deliveryWindow: { start: day(20), end: day(22) },
    selection: { productCode, variantCode, paymentMethod: method, addonCodes },
    paymentDepositPercent: percent,
  });
  return getV2ManualOrderForCustomer(DB, created.order.publicToken);
}
const changed = { productCode: 'cinematic_interactive', variantCode: 'cinematic_interactive_5' };

test('alterar cenas mantém contrato original e exceção 50%, sem modificar nada na prévia', async t => {
  const DB = database();
  const manual = await prepared(DB);
  const offer = await getManualClientAddonOffer(DB, manual);
  assert.equal(offer.editable, true);
  assert.equal(offer.currentVariantCode, 'cinematic_interactive_3');
  assert.ok(offer.products.some(p => p.code === 'cinematic_interactive'
    && p.variants.some(v => v.code === 'cinematic_interactive_5')));
  const oldTotal = manual.pricing.totalCents;
  const quote = await quoteManualClientAddons(DB, manual, [], changed);
  assert.equal(quote.productChanged, true);
  assert.equal(quote.variant.sceneCount, 5);
  assert.equal(quote.productDeltaCents, 5500);
  assert.equal(quote.totalCents, oldTotal + 5500);
  assert.equal(quote.depositCents, Math.round(quote.totalCents / 2));
  assert.equal(quote.depositCents + quote.balanceCents, quote.totalCents);
  assert.equal((await getV2ManualOrderForCustomer(DB, manual.token)).pricing.totalCents, oldTotal);

  const mp = providerMock(t);
  const payment = await startV2ManualOrderPayment(request, env(DB), manual.token, {
    termsAccepted: true, termsVersion: manual.terms.version,
    addonCodes: [], ...changed, expectedTotalCents: quote.totalCents,
    paymentDepositPercent: 100, // intento público não revoga exceção da administradora
  });
  assert.equal(mp.posts, 1);
  assert.equal(payment.payment.amountDueNowCents, quote.depositCents);
  assert.equal(mp.bodies[0].total_amount, (quote.depositCents / 100).toFixed(2));
  const after = await getV2ManualOrderForCustomer(DB, manual.token);
  assert.equal(after.pricing.depositPercent, 50);
  assert.equal(after.pricing.totalCents, quote.totalCents);
  assert.equal(after.pricing.snapshot.variant.code, changed.variantCode);
  assert.equal(after.items.find(i => i.item_type === 'product').item_code, changed.variantCode);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_order_history WHERE action_code='manual_customer_product_changed'").get().n, 1);
  assert.equal((await getManualClientAddonOffer(DB, after)).editable, false);
  const again = await startV2ManualOrderPayment(request, env(DB), manual.token, {
    termsAccepted: true, termsVersion: manual.terms.version, addonCodes: [],
    ...changed, expectedTotalCents: quote.totalCents,
  });
  assert.equal(again.payment.checkoutUrl, payment.payment.checkoutUrl);
  assert.equal(mp.posts, 1);
});

test('troca de formato e cenas no cartão preserva pagamento 100% e taxa vigente', async () => {
  const DB = database();
  const manual = await prepared(DB, { percent: 100, method: 'card', productCode: 'cinematic_video',
    variantCode: 'cinematic_video_3' });
  const next = { productCode: 'cinematic_interactive', variantCode: 'cinematic_interactive_3' };
  const quote = await quoteManualClientAddons(DB, manual, [], next);
  assert.equal(quote.productChanged, true);
  assert.equal(quote.product.code, next.productCode);
  assert.equal(quote.depositPercent, 100);
  assert.equal(quote.balanceCents, 0);
  assert.ok(quote.increaseCents > quote.productDeltaCents);
});

test('troca de formato com adicionais mantém extras compatíveis e impede perdas silenciosas', async () => {
  const DB = database();
  const manual = await prepared(DB, { productCode: 'cinematic_interactive',
    variantCode: 'cinematic_interactive_3', addonCodes: ['confirmation_libri'] });
  await assert.rejects(
    quoteManualClientAddons(DB, manual, [], { productCode: 'cinematic_video',
      variantCode: 'cinematic_video_3' }),
    /Confirmação Libri|compatível/
  );
  assert.equal((await getV2ManualOrderForCustomer(DB, manual.token)).pricing.totalCents,
    manual.pricing.totalCents);
});

test('formato e variante devem pertencer ao catálogo, sem poder falsificar método ou entrada', async () => {
  const DB = database(); const manual = await prepared(DB);
  await assert.rejects(quoteManualClientAddons(DB, manual, [], {
    productCode: 'cinematic_video', variantCode: 'cinematic_interactive_5',
  }), /Configuração|não encontrada/);
  const path = '/api/v2/manual-order/' + manual.token + '/addons/quote';
  const response = await handlePublicManualOrderV2Api(
    new Request('https://pedidos.libriconvites.com.br' + path, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        addonCodes: [], ...changed,
        paymentDepositPercent: 100, paymentMethod: 'card', totalCents: 1,
      }),
    }), env(DB), new URL('https://pedidos.libriconvites.com.br' + path)
  );
  assert.equal(response.status, 200);
  const { result } = await response.json();
  assert.equal(result.depositPercent, 50);
  assert.equal(result.depositCents + result.balanceCents, result.totalCents);
  assert.equal(result._additions, undefined);
  assert.equal(result.product.code, changed.productCode);
});

test('agenda sem capacidade impede upgrade e não altera D1', async () => {
  const DB = database(); const manual = await prepared(DB);
  for (let offset = 20; offset <= 22; offset++) {
    DB.sqlite.prepare("INSERT INTO v2_agenda_days(day,sellable_capacity_units,blocked,created_at,updated_at) VALUES (?,0,1,datetime('now'),datetime('now'))").run(day(offset));
  }
  await assert.rejects(quoteManualClientAddons(DB, manual, [], changed), /capacidade/);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments').get().n, 0);
  assert.equal((await getV2ManualOrderForCustomer(DB, manual.token)).pricing.totalCents, manual.pricing.totalCents);
});

test('botão Alterar aparece ao lado da descrição e atualiza prévia antes do Pix', () => {
  const ui = readFileSync('public/js/client-v2-store.js', 'utf8');
  const api = readFileSync('src/routes/public-manual-order-v2.js', 'utf8');
  assert.match(ui, /id="manualChangeProduct"/);
  assert.match(ui, /id="manualUpdatedItems"/);
  assert.match(ui, /Alterar formato e cenas/);
  assert.match(ui, /id="manualProductSelect"/);
  assert.match(ui, /id="manualVariantSelect"/);
  assert.match(ui, /manualProductChanged\(\)/);
  assert.match(ui, /expectedTotalCents: manualAddonQuote\?\.totalCents/);
  assert.match(api, /productCode: body\.productCode/);
});
