import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {database} from './helpers.mjs';
import {ATELIE_V41_APPROVED_CATALOG,ATELIE_V41_COMMON_TERMS} from '../src/lib/v3-atelie-v41-commercial-catalog.js';
import {listAteliePackages} from '../src/lib/v3-atelie-catalog.js';

test('V3 approved catalog is installed automatically and matches the official commercial specification',async()=>{
  const db=database();
  const rows=await listAteliePackages(db,{admin:true});
  assert.equal(rows.length,3);
  for(const row of rows){
    const p=ATELIE_V41_APPROVED_CATALOG[row.code];
    assert.equal(row.priceCents,p.priceCents);
    assert.equal(row.pointsUnits,p.pointsUnits);
    assert.equal(row.revisionLimit,p.revisionLimit);
    assert.deepEqual(row.includedDraft,p.includedItems);
    assert.deepEqual(row.excludedDraft,p.excludedItems);
    assert.equal(row.specificTermsDraft,ATELIE_V41_COMMON_TERMS);
    assert.equal(row.scopeApproved,true);
    assert.equal(row.saleEnabled,false);
  }
  assert.deepEqual(rows.map(x=>x.pointsUnits),[300,500,800]);
  assert.ok((await listAteliePackages(db)).every(x=>!x.purchaseAvailable && !('priceCents' in x)));
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_products WHERE code LIKE 'atelie_%' AND active=1").get().n,0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n,0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments').get().n,0);
});
test('automatic catalog migration never overwrites an active package',()=>{
  const db=database({beforeApprovedAtelie:true});
  db.sqlite.exec("UPDATE v3_atelie_packages SET sale_enabled=1,price_cents=77700,points_units=900 WHERE code='essencia'");
  db.sqlite.exec(readFileSync('migrations/0040_atelie_v41_approved_catalog.sql','utf8'));
  const active=db.sqlite.prepare("SELECT sale_enabled,price_cents,points_units FROM v3_atelie_packages WHERE code='essencia'").get();
  assert.equal(active.sale_enabled,1);
  assert.equal(active.price_cents,77700);
  assert.equal(active.points_units,900);
  assert.equal(db.sqlite.prepare("SELECT points_units FROM v3_atelie_packages WHERE code='encanto'").get().points_units,500);
});

test('Ateliê public common items no longer advertise the removed mockup',async()=>{const db=database();for(const row of await listAteliePackages(db)){assert.ok(!row.includedCommon.some(x=>/simula/i.test(x)));assert.ok(row.includedCommon.some(x=>/PDF/.test(x)));}});
