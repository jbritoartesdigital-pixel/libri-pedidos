import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ADMIN_FEATURES, searchAdminFeatures} from '../public/js/admin-v2-find.js';

const html=readFileSync('public/admin-v2.html','utf8');
const admin=readFileSync('public/js/admin-v2.js','utf8');
const store=readFileSync('public/js/admin-v2-config.js','utf8');
const css=readFileSync('public/css/admin-v2.css','utf8');

test('Admin oferece seis destinos principais sem duplicar links em Mais', () => {
  const main=html.match(/<div class="nav-primary">([\s\S]*?)<\/div>/)?.[1];
  const secondary=html.match(/<div class="nav-secondary">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(main && secondary);
  assert.deepEqual([...main.matchAll(/data-view="([^"]+)"/g)].map(m=>m[1]),
    ['central','manual','production','agenda','finance','store']);
  assert.deepEqual([...secondary.matchAll(/data-view="([^"]+)"/g)].map(m=>m[1]),
    ['archived','notifications','security']);
  for (const id of ['logoutBtn','showAdminDiagnostic','findAdminFeature','notificationBell']) {
    assert.equal(html.split('id="'+id+'"').length-1,1,id+' should be unique');
  }
  assert.match(html, /id="adminMoreMenu"/);
  assert.match(html, /id="featureFinder"/);
  assert.match(css, /\.nav-primary \{ grid-template-columns:repeat\(3/);
  assert.match(css, /\.feature-finder-results \{ grid-template-columns:1fr/);
});

test('localizador encontra funções por sinônimos parciais e acentos', () => {
  assert.equal(searchAdminFeatures('PIX').some(x=>x.title==='Registrar Pix recebido'), true);
  assert.equal(searchAdminFeatures('cupom')[0].tab,'coupons');
  assert.equal(searchAdminFeatures('Contrato').some(x=>x.tab==='contracts'),true);
  assert.equal(searchAdminFeatures('CENAS').some(x=>x.tab==='products'),true);
  assert.deepEqual(searchAdminFeatures('palavra inexistente'),[]);
  assert.ok(ADMIN_FEATURES.every(x=>x.view && x.title && x.detail));
  assert.doesNotMatch(readFileSync('public/js/admin-v2-find.js','utf8'), /fetch\(/);
});

test('destinos do localizador existem e todas as abas da Loja têm acesso direto', () => {
  const allViews=['central','manual','production','agenda','finance','archived','store','notifications','security'];
  assert.ok(ADMIN_FEATURES.every(x=>allViews.includes(x.view)));
  const tabs=[...store.matchAll(/data-store-tab="([^"]+)"/g)].map(x=>x[1]);
  assert.equal(new Set(tabs).size,8);
  assert.ok(ADMIN_FEATURES.filter(x=>x.tab).every(x=>tabs.includes(x.tab)));
  assert.match(store, /searchParams\.set\('storeTab', tab\)/);
  assert.match(admin, /initAdminFeatureFinder\(navigateTo\)/);
  assert.match(admin, /searchParams\.set\('storeTab', storeTab\)/);
  assert.match(admin, /openOrder\(/);
});
