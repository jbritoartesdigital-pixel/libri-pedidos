import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers.mjs';
import {listV3RetrospectivePackages} from '../src/lib/v3-retrospective-catalog.js';
import worker from '../src/index.js';

test('Retrospectivas V3 usam os cinco pacotes aprovados, mas sem venda direta',async()=>{
  const db=database();
  const catalog=await listV3RetrospectivePackages(db,{admin:true});
  assert.deepEqual(catalog.map(p=>p.code),[
    'RETRO_070','RETRO_100','RETRO_150','RETRO_200','RETRO_250'
  ]);
  assert.deepEqual(catalog.map(p=>p.maxPhotos),[70,100,150,200,250]);
  assert.deepEqual(catalog.map(p=>p.priceCents),[14900,19900,26900,32900,39900]);
  assert.deepEqual(catalog.map(p=>p.pointsUnits),[200,300,500,700,900]);
  assert.ok(catalog.every(p=>p.minimumProductionDays===15 && !p.saleEnabled && !p.purchaseAvailable));
  assert.deepEqual(catalog.map(p=>p.revisionLimit),[1,1,1,2,2]);
  assert.deepEqual(catalog.map(p=>p.maxTotalVideoSeconds),[180,300,360,480,600]);
  assert.ok(catalog.every(p=>p.maxVideoSeconds===60 && p.materialsChannel==='whatsapp' && p.scopeApproved && p.specificTerms.includes('90 dias')));
  assert.deepEqual(catalog.map(p=>p.captionsIncluded),[false,true,true,true,true]);
  assert.deepEqual(db.sqlite.prepare("SELECT price_cents FROM v2_addons WHERE addon_group='retrospectiva' ORDER BY sort_order").all().map(x=>x.price_cents),[10000,15000,20000,25000,30000]);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_products').get().n,7);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n,0);
});
test('Catálogo público de Retrospectivas oculta valores internos e não altera adicionais',async()=>{
  const DB=database(),ctx={waitUntil(){}};
  const response=await worker.fetch(new Request('https://test/api/v3/retrospectivas/catalog'),{DB},ctx);
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.packages.length,5);
  assert.ok(data.packages.every(p=>!('priceCents' in p)&&!('pointsUnits' in p)&&!p.purchaseAvailable));
  assert.ok(data.packages.every(p=>p.minimumProductionDays===15));
  const addons=DB.sqlite.prepare("SELECT count(*) AS n FROM v2_addons WHERE addon_group='retrospectiva'").get();
  assert.equal(addons.n,5);
  const legacy=await worker.fetch(new Request('https://test/api/v2/catalog'),{DB},ctx);
  assert.equal(legacy.status,200);
});
