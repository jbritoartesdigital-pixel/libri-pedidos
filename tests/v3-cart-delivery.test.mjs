import test from 'node:test';
import assert from 'node:assert/strict';
import {database,day} from './helpers.mjs';
import worker from '../src/index.js';
import {setAtelieSaleStatus} from '../src/lib/v3-atelie-release.js';
import {previewV3CartDelivery} from '../src/lib/v3-cart-delivery.js';

const invitation={productCode:'interactive_essential',variantCode:'interactive_essential_default',addonCodes:[]};
const atelie={productCode:'atelie_essencia',variantCode:'atelie_essencia_default',addonCodes:[]};
const body={eventType:'birthday',paymentMethod:'pix',items:[invitation,atelie]};
test('combined delivery uses all production points and a minimum 15-day window without creating a hold or payment',async()=>{
  const db=database();
  await setAtelieSaleStatus(db,'essencia',true);
  const preview=await previewV3CartDelivery(db,{...body,eventDate:day(65),pointsUnits:1,productionDays:0});
  assert.equal(preview.quote.pointsUnits,400);
  assert.equal(preview.delivery.minimumProductionDays,15);
  assert.equal(preview.delivery.provisionalUntilBriefing,true);
  assert.equal(preview.delivery.reserved,false);
  assert.equal(preview.delivery.canCheckout,false);
  assert.ok(preview.delivery.options.length);
  assert.ok(preview.delivery.options.every(x=>x.start>=day(15)));
  const first=preview.delivery.options[0];
  assert.equal(first.recommended,true);
  const earliest=preview.delivery.options.find(x=>x.earliest);assert.ok(earliest);
  assert.equal(earliest.start,preview.delivery.options.map(x=>x.start).sort()[0]);
  if(!first.earliest)assert.equal(preview.delivery.options[1].earliest,true);
  const selected=await previewV3CartDelivery(db,{...body,eventDate:day(65),deliveryWindow:first});
  assert.deepEqual(selected.delivery.selected,{start:first.start,end:first.end});
  for(const table of ['v2_orders','v2_payments','v2_checkout_holds']){
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0);
  }
});
test('short and invalid dates cannot bypass the shared production minimum',async()=>{
  const db=database();
  await setAtelieSaleStatus(db,'essencia',true);
  const short=await previewV3CartDelivery(db,{...body,eventDate:day(10)});
  assert.deepEqual(short.delivery.options,[]);
  assert.equal(short.delivery.needsUrgencyReview,true);
  await assert.rejects(previewV3CartDelivery(db,{...body,eventDate:'2027-02-30'}),/data do evento/);
  await assert.rejects(previewV3CartDelivery(db,{...body,eventDate:day(65),deliveryWindow:{start:day(5),end:day(7)}}),/15 dias/);
  const single=await previewV3CartDelivery(db,{...body,items:[invitation],eventDate:day(65)});
  assert.equal(single.delivery.minimumProductionDays,0);
  assert.equal(single.delivery.provisionalUntilBriefing,false);
});
test('cart delivery API is read-only and rejects malformed dates',async()=>{
  const DB=database(),env={DB},ctx={waitUntil(){}};
  const req=payload=>new Request('https://test/api/v3/cart/delivery-options',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const response=await worker.fetch(req({...body,items:[invitation],eventDate:day(65)}),env,ctx);
  assert.equal(response.status,200);
  assert.equal((await response.json()).delivery.reserved,false);
  const bad=await worker.fetch(req({...body,eventDate:'invalid'}),env,ctx);
  assert.equal(bad.status,422);
});
