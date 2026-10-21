import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, day } from './helpers.mjs';
import { loadV2Catalog } from '../src/lib/v2-catalog.js';
import {
  getV2OrderEditOptions, previewV2AdminOrderEdit, saveV2AdminOrderEdit,
} from '../src/lib/v2-admin-order-edit.js';
import { getV2AdminOrderDetail } from '../src/lib/v2-admin-core.js';

async function fixture({ source = 'store', method = 'pix', paid = 0, pendingMp = false } = {}) {
  const DB=database();
  const catalog=await loadV2Catalog(DB);
  const product=catalog.products.find(p=>p.variants.length>=2) || catalog.products[0];
  assert.ok(product,'seeded catalog product');
  const variant=product.variants[0];
  assert.ok(variant);
  const cid=Number(DB.sqlite.prepare("INSERT INTO v2_customers(name,whatsapp) VALUES ('Cliente Teste','5511999999999')").run().lastInsertRowid);
  const id=Number(DB.sqlite.prepare(`
    INSERT INTO v2_orders(order_code,public_token,customer_id,event_type,honoree_display_name,event_date,
      status,source,briefing_status,delivery_start,delivery_end)
    VALUES ('LIBRI-9001','token-9001',?,'birthday','Aniversário fictício',?,
      'in_production',?,'completed',?,?)
  `).run(cid,day(62),source,day(15),day(17)).lastInsertRowid);
  const total=variant.priceCents;
  DB.sqlite.prepare(`
    INSERT INTO v2_order_items(order_id,item_type,item_code,name_snapshot,quantity,unit_price_cents,
      points_units,configuration_json)
    VALUES (?,'product',?,?,1,?,?,?)
  `).run(id,variant.code,product.name,total,variant.pointsUnits,
    JSON.stringify({productCode:product.code,productSlug:product.slug,
      variantCode:variant.code,sceneCount:variant.sceneCount}));
  DB.sqlite.prepare(`
    INSERT INTO v2_order_pricing(order_id,subtotal_cents,total_cents,payment_method,
      deposit_percent,deposit_cents,balance_cents,pricing_snapshot_json)
    VALUES (?,?,?, ?,50,?,?,?)
  `).run(id,total,total,method,Math.round(total/2),total-Math.round(total/2),
    JSON.stringify({baseTotalCents:total}));
  if(paid) DB.sqlite.prepare(`
    INSERT INTO v2_payments(order_id,provider,payment_type,method,status,amount_cents)
    VALUES (?,?, 'deposit', ?, 'approved',?)
  `).run(id,method==='card'?'mercado_pago':'direct_pix',method,paid);
  if(pendingMp) DB.sqlite.prepare(`
    INSERT INTO v2_payments(order_id,provider,payment_type,method,status,amount_cents)
    VALUES (?,'mercado_pago','deposit','pix','pending',?)
  `).run(id,total);
  return {DB,id,total,product,variant,catalog};
}
function payload(options, extra = {}) {
  const current=options.current;
  return {productCode:current.items[0].config.productCode,
    variantCode:current.items[0].config.variantCode,
    addonCodes:current.items.filter(x=>x.type==='addon').map(x=>x.code),
    manualDiscountCents:current.manualDiscountCents,
    priceAdjustmentCents:current.priceAdjustmentCents,
    expectedTotalCents:current.totalCents,expectedRevision:current.revision,
    note:'Ajuste autorizado via WhatsApp pela cliente',...extra};
}
test('discount available for regular store order and direct payment untouched', async()=>{
  const {DB,id,total}=await fixture({paid:100});
  const before=await getV2OrderEditOptions(DB,'LIBRI-9001');
  const input=payload(before,{manualDiscountCents:150});
  const preview=await previewV2AdminOrderEdit(DB,'LIBRI-9001',input);
  assert.equal(preview.newTotalCents,total-150);
  assert.equal(preview.remainingCents,total-250);
  assert.equal(DB.sqlite.prepare('SELECT total_cents FROM v2_order_pricing WHERE order_id=?').get(id).total_cents,total);
  const out=await saveV2AdminOrderEdit(DB,'LIBRI-9001',input);
  assert.equal(out.totalCents,total-150);
  assert.equal(out.paidCents,100);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments WHERE order_id=?').get(id).n,1);
  const snapshot=JSON.parse(DB.sqlite.prepare('SELECT pricing_snapshot_json FROM v2_order_pricing WHERE order_id=?').get(id).pricing_snapshot_json);
  assert.equal(snapshot.adminEdit.manualDiscountCents,150);
  assert.ok((await getV2AdminOrderDetail(DB,'LIBRI-9001')).payment.remainingBalanceCents>=0);
  const again=await getV2OrderEditOptions(DB,'LIBRI-9001');
  assert.equal(again.current.manualDiscountCents,150);
  await assert.rejects(saveV2AdminOrderEdit(DB,'LIBRI-9001',input),/mudou desde/);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_order_history WHERE action_code='admin_order_edited'").get().n,1);
});
test('catalog add-on updates items and points while protecting confirmed allocations', async()=>{
  const {DB,id,catalog,total,variant}=await fixture({paid:100});
  const addon=catalog.addons.find(a=>a.priceCents>=0&&a.pointsUnits>=0);
  assert.ok(addon,'catalog addon');
  const old=await getV2OrderEditOptions(DB,'LIBRI-9001');
  DB.sqlite.prepare('INSERT INTO v2_agenda_days(day,sellable_capacity_units,internal_buffer_units) VALUES (?,10000,100)').run(day(17));
  DB.sqlite.prepare('INSERT INTO v2_agenda_allocations(order_id,day,points_units) VALUES (?,?,?)').run(id,day(17),Math.max(1,variant.pointsUnits));
  const action=payload(old,{addonCodes:[addon.code]});
  const output=await saveV2AdminOrderEdit(DB,'LIBRI-9001',action);
  assert.equal(output.totalCents,total+addon.priceCents);
  const items=DB.sqlite.prepare('SELECT item_code FROM v2_order_items WHERE order_id=? ORDER BY id').all(id);
  assert.ok(items.some(x=>x.item_code===addon.code));
  const allocation=DB.sqlite.prepare('SELECT SUM(points_units) AS n FROM v2_agenda_allocations WHERE order_id=?').get(id).n;
  assert.equal(allocation,Math.max(1,variant.pointsUnits)+addon.pointsUnits);
  assert.equal(DB.sqlite.prepare('SELECT briefing_status FROM v2_orders WHERE id=?').get(id).briefing_status,'in_progress');
});
test('change variant scenes with current catalogue prices and enforce capacity', async()=>{
  const {DB,id,catalog,product,variant,total}=await fixture({paid:100});
  const other=product.variants.find(v=>v.code!==variant.code);
  assert.ok(other);
  const old=await getV2OrderEditOptions(DB,'LIBRI-9001');
  const changed=payload(old,{variantCode:other.code});
  const p=await previewV2AdminOrderEdit(DB,'LIBRI-9001',changed);
  assert.equal(p.newTotalCents,total+other.priceCents-variant.priceCents);
  if(other.pointsUnits>variant.pointsUnits){
    const alloc=DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_agenda_allocations WHERE order_id=?').get(id).n;
    assert.equal(alloc,0);
    await saveV2AdminOrderEdit(DB,'LIBRI-9001',changed);
  } else {
    // Declining workload with zero allocations cannot be silently removed.
    if(other.pointsUnits<variant.pointsUnits){
      await assert.rejects(saveV2AdminOrderEdit(DB,'LIBRI-9001',changed),/alocações suficientes/);
    } else await saveV2AdminOrderEdit(DB,'LIBRI-9001',changed);
  }
});
test('Pix and Mercado Pago paid amounts cannot be edited, over-discounted, or rewritten',async()=>{
  const {DB,id,total}=await fixture({method:'card',paid:500});
  const before=await getV2OrderEditOptions(DB,'LIBRI-9001');
  await assert.rejects(saveV2AdminOrderEdit(DB,'LIBRI-9001',payload(before,{
    manualDiscountCents:total,
  })),/abaixo do valor já recebido|total precisa ser positivo/);
  const add=payload(before,{priceAdjustmentCents:200});
  const after=await saveV2AdminOrderEdit(DB,'LIBRI-9001',add);
  assert.equal(after.totalCents,total+200);
  assert.equal(DB.sqlite.prepare("SELECT amount_cents FROM v2_payments WHERE order_id=?").get(id).amount_cents,500);
  assert.equal(DB.sqlite.prepare("SELECT status FROM v2_payments WHERE order_id=?").get(id).status,'approved');
});
test('pending Mercado Pago charge blocks price change and no data is modified',async()=>{
  const {DB,id,total}=await fixture({pendingMp:true});
  const before=await getV2OrderEditOptions(DB,'LIBRI-9001');
  assert.equal(before.current.pendingMercadoPago,true);
  await assert.rejects(saveV2AdminOrderEdit(DB,'LIBRI-9001',payload(before,{
    manualDiscountCents:100,
  })),/cobrança pendente/);
  assert.equal(DB.sqlite.prepare('SELECT total_cents FROM v2_order_pricing WHERE order_id=?').get(id).total_cents,total);
});
test('forbidden state and missing audit justification cannot be edited',async()=>{
  const {DB,id}=await fixture();
  const before=await getV2OrderEditOptions(DB,'LIBRI-9001');
  await assert.rejects(saveV2AdminOrderEdit(DB,'LIBRI-9001',payload(before,{
    manualDiscountCents:100,note:'ok',
  })),/mínimo 5 caracteres/);
  DB.sqlite.prepare("UPDATE v2_orders SET status='finalized' WHERE id=?").run(id);
  await assert.rejects(saveV2AdminOrderEdit(DB,'LIBRI-9001',payload(before,{
    manualDiscountCents:100,
  })),/encerrado/);
});

test('regression: R$155 five-scene invitation + R$35 RSVP - R$100 already received = R$90 balance',async()=>{
  const {DB,id,catalog}=await fixture({paid:10000});
  const cinematic=catalog.products.find(p=>p.code==='cinematic_interactive');
  const five=cinematic.variants.find(v=>Number(v.sceneCount)===5);
  const one=cinematic.variants.find(v=>Number(v.sceneCount)===1);
  const rsvp=catalog.addons.find(a=>a.name.includes('Confirmação de Presença Libri'));
  assert.ok(five&&one&&rsvp);
  assert.equal(five.priceCents,15500);
  assert.equal(one.priceCents,5500);
  assert.equal(rsvp.priceCents,3500);
  // Historically inconsistent item row: stored 1-scene unit price while
  // product's visible configuration and the contracted total are 5 scenes.
  DB.sqlite.prepare(`UPDATE v2_order_items SET item_code=?,name_snapshot=?,
    unit_price_cents=?,points_units=?,configuration_json=? WHERE order_id=?`)
    .run(one.code,'Cinematográfico Interativo • 5 cenas',one.priceCents,five.pointsUnits,
      JSON.stringify({productCode:cinematic.code,productSlug:cinematic.slug,
        variantCode:one.code,sceneCount:5}),id);
  DB.sqlite.prepare(`UPDATE v2_order_pricing SET total_cents=15500,
    subtotal_cents=15500,deposit_cents=7750,balance_cents=7750 WHERE order_id=?`).run(id);
  const old=await getV2OrderEditOptions(DB,'LIBRI-9001');
  const input=payload(old,{productCode:'',variantCode:'',addonCodes:[rsvp.code]});
  const p=await previewV2AdminOrderEdit(DB,'LIBRI-9001',input);
  assert.equal(p.beforeTotalCents,15500);
  assert.equal(p.itemsDifferenceCents,3500);
  assert.equal(p.productDifferenceCents,0);
  assert.equal(p.addonDifferenceCents,3500);
  assert.equal(p.newTotalCents,19000);
  assert.equal(p.paidCents,10000);
  assert.equal(p.remainingCents,9000);
  const result=await saveV2AdminOrderEdit(DB,'LIBRI-9001',input);
  assert.equal(result.totalCents,19000);
  assert.equal(result.remainingCents,9000);
  assert.equal(DB.sqlite.prepare('SELECT SUM(amount_cents) AS n FROM v2_payments WHERE order_id=?').get(id).n,10000);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_order_items WHERE item_type='addon' AND order_id=?").get(id).n,1);
});
test('regression: changing from five to six scenes uses catalogue difference R$35, not stale unit R$55',async()=>{
  const {DB,id,catalog}=await fixture({paid:10000});
  const cinematic=catalog.products.find(p=>p.code==='cinematic_interactive');
  const one=cinematic.variants.find(v=>Number(v.sceneCount)===1);
  const five=cinematic.variants.find(v=>Number(v.sceneCount)===5);
  const six=cinematic.variants.find(v=>Number(v.sceneCount)===6);
  assert.equal(six.priceCents,19000);
  DB.sqlite.prepare(`UPDATE v2_order_items SET item_code=?,name_snapshot=?,
    unit_price_cents=?,points_units=?,configuration_json=? WHERE order_id=?`)
    .run(one.code,'Cinematográfico Interativo • 5 cenas',one.priceCents,five.pointsUnits,
      JSON.stringify({productCode:cinematic.code,productSlug:cinematic.slug,
        variantCode:one.code,sceneCount:5}),id);
  DB.sqlite.prepare(`UPDATE v2_order_pricing SET total_cents=15500,subtotal_cents=15500 WHERE order_id=?`).run(id);
  const old=await getV2OrderEditOptions(DB,'LIBRI-9001');
  const staying=payload(old,{productCode:cinematic.code,variantCode:five.code});
  const same=await previewV2AdminOrderEdit(DB,'LIBRI-9001',staying);
  assert.equal(same.changed,false,'same 5-scene model must never silently reprice');
  assert.equal(same.newTotalCents,15500);
  const upgrading=payload(old,{productCode:cinematic.code,variantCode:six.code});
  const updated=await previewV2AdminOrderEdit(DB,'LIBRI-9001',upgrading);
  assert.equal(updated.productDifferenceCents,3500);
  assert.equal(updated.newTotalCents,19000);
  assert.equal(updated.remainingCents,9000);
});

test('mobile admin exposes inline order editor, revision and checkout evidence',()=>{
  const ui=readFileSync('public/js/admin-v2-order.js','utf8');
  const editor=readFileSync('public/js/admin-v2-edit-order.js','utf8');
  const css=readFileSync('public/css/admin-v2.css','utf8');
  const route=readFileSync('src/routes/admin-orders-v2.js','utf8');
  assert.match(ui,/id="editAdminOrder"/);
  assert.match(editor,/id="adminEditDiscount"/);
  assert.match(editor,/id="adminEditProduct"/);
  assert.match(editor,/id="adminEditVariant"/);
  assert.match(editor,/data-edit-addon/);
  assert.match(editor,/id="adminEditPreview"/);
  assert.match(editor,/id="adminEditSave"/);
  assert.match(editor,/Nenhum Pix ou pagamento no cartão será modificado/);
  assert.match(css,/@media \(max-width:620px\)/);
  assert.match(css,/\.admin-edit-order-panel/);
  assert.match(route,/previewV2AdminOrderEdit/);
  assert.match(route,/saveV2AdminOrderEdit/);
});
