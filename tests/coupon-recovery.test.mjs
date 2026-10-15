import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCouponQuoteError, removeCouponFromCart, quoteWithCouponRecovery,
} from '../public/js/client-v2-coupon.js';

function savedCart(code = 'PROMO10') {
  return {
    customer: { name: 'Cliente Fictícia', whatsapp: '5511999999999' },
    selection: { productCode: 'interactive_essential', addonCodes: ['save_the_date'],
      couponCode: code, paymentMethod: 'pix' },
    quote: { coupon: { code }, totalCents: 8000 },
  };
}
test('removing a coupon is immediate and permanent even with no network', () => {
  const state = savedCart('EXPIRADO');
  const saves = [];
  removeCouponFromCart(state, current => saves.push(structuredClone(current)));
  assert.equal(state.selection.couponCode, '');
  assert.equal(state.quote, null, 'never show stale discounted price');
  assert.equal(saves[0].selection.couponCode, '');
  assert.equal(saves[0].selection.productCode, 'interactive_essential');
  assert.deepEqual(saves[0].selection.addonCodes, ['save_the_date']);
  assert.equal(saves[0].customer.name, 'Cliente Fictícia');
});
for (const reason of [
  'Cupom inválido ou inativo.', 'Este cupom expirou.',
  'Este cupom atingiu o limite de usos.',
  'O pedido não atingiu o valor mínimo deste cupom.',
  'Este cupom não se aplica a esta configuração.',
]) {
  test('a resumed cart survives coupon error: ' + reason, async () => {
    const state = savedCart();
    const snapshots = [];
    const calls = [];
    const result = await quoteWithCouponRecovery(state, async () => {
      calls.push(state.selection.couponCode);
      if (state.selection.couponCode) throw Error(reason);
      return { coupon: null, couponDiscountCents: 0, totalCents: 10000 };
    }, current => snapshots.push(structuredClone(current)));
    assert.deepEqual(calls, ['PROMO10', '']);
    assert.equal(result.recovered, true);
    assert.equal(state.selection.couponCode, '');
    assert.equal(state.quote.totalCents, 10000);
    assert.match(state.couponNotice, /Confira o total atualizado/);
    assert.equal(snapshots[0].selection.couponCode, '');
    assert.equal(snapshots[0].quote, null);
    assert.deepEqual(state.selection.addonCodes, ['save_the_date']);
  });
}
test('unexpected network outage never silently forfeits valid coupon', async () => {
  const state = savedCart();
  let saved = false;
  await assert.rejects(quoteWithCouponRecovery(state, async () => {
    throw Error('NetworkError: fetch failed');
  }, () => { saved = true; }), /NetworkError/);
  assert.equal(saved, false);
  assert.equal(state.selection.couponCode, 'PROMO10');
});
test('a second noncoupon quote failure cannot restore invalid coupon', async () => {
  const state = savedCart();
  let attempts = 0;
  await assert.rejects(quoteWithCouponRecovery(state, async () => {
    attempts++;
    throw Error(attempts === 1 ? 'Este cupom expirou.' : 'Serviço indisponível');
  }, () => {}), /Serviço indisponível/);
  assert.equal(state.selection.couponCode, '');
  assert.equal(state.quote, null);
});
test('manual validation rejects invalid cupom instead of silently giving a discount', async () => {
  const state = savedCart();
  await assert.rejects(quoteWithCouponRecovery(state, async () => {
    throw Error('Cupom inválido ou inativo.');
  }, () => {}, { recoverInvalidCoupon: false }), /Cupom inválido/);
  assert.equal(state.selection.couponCode, 'PROMO10');
});
test('noncoupon failures are never misclassified', () => {
  assert.equal(isCouponQuoteError(Error('Produto indisponível')), false);
  assert.equal(isCouponQuoteError(Error('Falha na conexão')), false);
  assert.equal(isCouponQuoteError(Error('Limite de uso deste cupom atingido')), true);
});
test('remove button always exists when quote fails and checkout ignores invalid draft', () => {
  const fs = requireSource();
  const start = fs.indexOf('function renderCustomer(');
  const end = fs.indexOf('function renderReview(', start);
  const customer = fs.slice(start, end);
  assert.match(customer, /id="removeCoupon"/);
  assert.doesNotMatch(customer, /state\.quote\?\.coupon \? `[\s\S]*?id="removeCoupon"/);
  assert.match(customer, /removeCouponFromCart\(state, persist\)/);
  assert.match(customer, /removeCouponFromCart\(state, persist,\s*\`/);
  assert.match(customer, /updateQuote\(state, \{ recoverInvalidCoupon: false \}\)/);
  assert.match(customer, /Cupom não aplicado\. Continuando sem desconto\./);
});
function requireSource() {
  return readFileSync(new URL('../public/js/client-v2-store.js', import.meta.url),'utf8');
}
import { readFileSync } from 'node:fs';
