import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const store = readFileSync('public/js/client-v2-store.js', 'utf8');
const customerArea = readFileSync('public/js/client-v2-area.js', 'utf8');
const quoteHtmlSource = store.slice(
  store.indexOf('function quoteHtml('),
  store.indexOf('async function openExamples('),
);
assert.ok(quoteHtmlSource.includes('function quoteHtml('), 'renderizador da cotação encontrado');
const quoteHtml = runInNewContext(`${quoteHtmlSource}\nquoteHtml`, {
  money: cents => `R$ ${Number(cents).toFixed(2)}`,
  quoteSavingsHtml: () => '',
});

test('resumo Pix 100% não exibe saldo posterior zerado', () => {
  const html = quoteHtml({totalCents: 9000, payment: {
    method: 'pix', depositPercent: 100, depositCents: 9000, balanceCents: 0,
  }});
  assert.match(html, /Pagamento integral antecipado no Pix/);
  assert.match(html, /R\$ 9000\.00/);
  assert.doesNotMatch(html, /Saldo/i);
});

test('resumo Pix 50% autorizado preserva saldo de R$ 45,00', () => {
  const html = quoteHtml({totalCents: 9000, payment: {
    method: 'pix', depositPercent: 50, depositCents: 4500, balanceCents: 4500,
  }});
  assert.match(html, /Entrada excepcional autorizada pela Libri \(50%\)/);
  assert.match(html, /Saldo restante após a entrada/);
  assert.match(html, /R\$ 4500\.00/);
});

test('resumo cartão integral não inventa linha de saldo', () => {
  const html = quoteHtml({totalCents: 9450, payment: {
    method: 'card', depositPercent: 100, depositCents: 9450, balanceCents: 0,
  }});
  assert.match(html, /100% no cartão/);
  assert.doesNotMatch(html, /Saldo/i);
});

test('área da cliente omite saldo zero inclusive após trocar forma de pagamento', () => {
  assert.doesNotMatch(customerArea, /saldo após o pagamento/i);
  assert.match(customerArea, /remainingCents > 0/);
  assert.match(customerArea, /Pix • integral/);
  assert.match(customerArea, /Pix • entrada/);
  assert.match(customerArea, /saldo após a entrada/);
});
