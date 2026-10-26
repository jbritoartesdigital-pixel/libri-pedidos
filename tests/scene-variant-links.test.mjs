import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database } from './helpers.mjs';
import { loadV2Catalog } from '../src/lib/v2-catalog.js';
import { sceneLinkUrl, sceneLinkSelection } from '../public/js/v2-scene-links.js';

test('scene links open the exact active cinematic variant without changing catalogue prices', async () => {
  const db=database();
  const catalogue=await loadV2Catalog(db);
  const product=catalogue.products.find(p=>p.code==='cinematic_interactive');
  const variant=product.variants.find(v=>v.sceneCount===3);
  assert.ok(variant);
  assert.equal(variant.priceCents,10000);
  const link=sceneLinkUrl('https://pedidos.libriconvites.com.br',
    product.slug,variant.sceneCount);
  assert.equal(link,'https://pedidos.libriconvites.com.br/pedido/cinematografico-interativo?cenas=3');
  const parsed=new URL(link);
  const selection=sceneLinkSelection(product,parsed.search);
  assert.equal(selection.requested,true);
  assert.equal(selection.variant.code,variant.code);
  assert.equal(selection.variant.priceCents,10000);
});
test('scene links only resolve active and available scenes for that product',async()=>{
  const db=database();
  const catalogue=await loadV2Catalog(db);
  const product=catalogue.products.find(p=>p.code==='cinematic_video');
  assert.equal(sceneLinkSelection(product,'').requested,false);
  for(const wrong of ['?cenas=0','?cenas=-1','?cenas=3.5','?cenas=abc',
    '?cenas=100','?cenas=99999999','?cenas=1%20x']) {
    const result=sceneLinkSelection(product,wrong);
    assert.equal(result.requested,true,wrong);
    assert.equal(result.variant,null,wrong);
  }
  const fixed=catalogue.products.find(p=>p.code==='interactive_essential');
  assert.equal(sceneLinkSelection(fixed,'?cenas=3').variant,null);
  const third=product.variants.find(v=>v.sceneCount===3);
  db.sqlite.prepare('UPDATE v2_product_variants SET active=0 WHERE code=?')
    .run(third.code);
  const updated=await loadV2Catalog(db);
  const fresh=updated.products.find(p=>p.code===product.code);
  assert.equal(sceneLinkSelection(fresh,'?cenas=3').variant,null,
    'disabled variant must not be preselected');
});
test('scene link URL construction validates input and retains per-product identity',()=>{
  assert.throws(()=>sceneLinkUrl('https://pedidos.libriconvites.com.br','../foo',3),/inválida/);
  assert.throws(()=>sceneLinkUrl('https://pedidos.libriconvites.com.br','cinematografico-video',0),/inválida/);
  assert.equal(new URL(sceneLinkUrl('https://pedidos.libriconvites.com.br',
    'cinematografico-video',7)).pathname,'/pedido/cinematografico-video');
});
test('admin product variants expose copy links only for active scene-count variants',()=>{
  const js=readFileSync('public/js/admin-v2-store-products.js','utf8');
  const client=readFileSync('public/js/client-v2-store.js','utf8');
  const adminEntry=readFileSync('public/js/admin-v2-config.js','utf8');
  assert.match(js,/data-copy-scene-link/);
  assert.match(js,/data-scene-count/);
  assert.match(js,/variant\.active/);
  assert.match(js,/product\.pricingMode === 'scene_count'/);
  assert.match(js,/sceneLinkUrl\(/);
  assert.match(client,/sceneLinkSelection\(product, window\.location\.search\)/);
  assert.match(client,/state\.selection\.variantCode = linkedScenes\.variant\.code/);
  assert.match(client,/state\.step = 2/);
  assert.match(adminEntry,/admin-v2-store-products\.js\?v=20261026-scene-links-1/);
});
