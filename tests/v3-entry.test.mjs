import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('V3 preview has a dedicated route; V2 store, admin and customer routes remain intact', () => {
  const worker = source('src/index.js');
  assert.match(worker, /\['\/loja','\/loja\/'/);
  assert.match(worker, /'\/pedido-v3'/);
  assert.match(worker, /'\/client-v3\.html'/);
  assert.match(worker, /isClientV2Page\(/);
  assert.match(worker, /isAdminV2Page\(/);
  assert.match(worker, /handleCustomerV2Api\(/);
});

test('V3 preview is noindex and loads its own assets', () => {
  const html = source('public/client-v3.html');
  assert.match(html, /index,follow/);
  assert.match(html, /rel="canonical"/);
  assert.match(html, /client-v3\.css/);
  assert.match(html, /client-v3\.js/);
  assert.match(html, /Loja atual/);
});

test('V3 reads live catalog and quote, and hands off only to established V2 checkout', () => {
  const js = source('public/js/client-v3.js');
  assert.match(js, /\/api\/v2\/catalog/);
  assert.match(js, /\/api\/v2\/quote/);
  assert.match(js, /localStorage\.setItem\(V2_KEY/);
  assert.match(js, /window\.location\.assign\('\/pedido'\)/);
  assert.doesNotMatch(js, /\/api\/v2\/checkout\/start/);
  assert.doesNotMatch(js, /fetch\(['"]\/api\/v2\/payments/);
  assert.match(js, /state\.eventType/);
  assert.match(js, /state\.addonCodes/);
});

test('V3 provides the free WhatsApp confirmation and avoids duplicating Moments filter', () => {
  const js = source('public/js/client-v3.js');
  assert.match(js, /R\$ 0,00/);
  assert.match(js, /Confirmação Libri/);
  assert.match(js, /hasGroup\('moments'\)/);
  assert.match(js, /c!=='custom_filter'/);
});

test('V3 excludes commercial claims for non-configured products and supports reduced motion', () => {
  const js = source('public/js/client-v3.js');
  const css = source('public/css/client-v3.css');
  assert.match(js, /Contratação em preparação/);
  assert.match(js, /item\.scopeApproved/);
  assert.match(js, /Não vamos prometer entregas antes disso/);
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});
