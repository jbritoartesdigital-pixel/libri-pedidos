import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, day, providerMock } from './helpers.mjs';
import { loadV2Catalog } from '../src/lib/v2-catalog.js';
import {
  getV2OrderEditOptions, previewV2AdminOrderEdit, saveV2AdminOrderEdit,
} from '../src/lib/v2-admin-order-edit.js';
import { createV2ManualOrder, getV2ManualOrderForCustomer, startV2ManualOrderPayment }
  from '../src/lib/v2-orders-manual.js';
import { calculateCommercialV2Quote } from '../src/lib/v2-commercial-pricing.js';

const req=new Request('https://pedidos.libriconvites.com.br/api/v2/manual-order');
const env=DB=>({DB,MERCADO_PAGO_ACCESS_TOKEN:'TEST-token'});
async function fixture({method='pix',paid=0,pending=false,percent=100,status='awaiting_payment',
  briefing='locked'}={}) {
  const DB=database();
  const catalog=await loadV2Catalog(DB);
  const product=catalog.products.find(p=>p.variants.length>0);
  const variant=product.variants[0];
  const customer=DB.sqlite.prepare(
    "INSERT INTO v2_customers(name,whatsapp) VALUES ('Cliente Teste','5511999999999')"
  ).run().lastInsertRowid;
  const id=DB.sqlite.prepare(`
    INSERT INTO v2_orders(order_code,public_token,customer_id,event_type,honoree_display_name,
      event_date,status,source,briefing_status,delivery_start,delivery_end)
    VALUES ('LIBRI-9001','token-test',?,'birthday','Aniversário teste',?,?, 'manual_whatsapp',?,?,?)
  `).run(customer,day(55),status,briefing,day(20),day(22)).lastInsertRowid;
  const total=18000;
  DB.sqlite.prepare(`
    INSERT INTO v2_order_items(order_id,item_type,item_code,name_snapshot,quantity,
      unit_price_cents,points_units,configuration_json)
    VALUES (?,'product',?,?,1,?,?,?)
  `).run(id,variant.code,product.name,variant.priceCents,variant.pointsUnits,
    JSON.stringify({productCode:product.code,productSlug:product.slug,
      variantCode:variant.code,sceneCount:variant.sceneCount}));
  const deposit=Math.round(total*percent/100);
  DB.sqlite.prepare(`
    INSERT INTO v2_order_pricing(order_id,subtotal_cents,total_cents,
      payment_method,deposit_percent,deposit_cents,balance_cents,pricing_snapshot_json)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(id,total,total,method,percent,deposit,total-deposit,JSON.stringify({
    baseTotalCents:total,totalCents:total,product,variant,
    payment:{method,depositPercent:percent,depositCents:deposit,
      balanceCents:total-deposit,adminDepositException:percent===50},
  }));
  if(paid) DB.sqlite.prepare(`
    INSERT INTO v2_payments(order_id,provider,payment_type,method,status,amount_cents)
    VALUES (?, 'direct_pix','deposit','pix','approved',?)
  `).run(id,paid);
  if(pending) DB.sqlite.prepare(`
    INSERT INTO v2_payments(order_id,provider,payment_type,method,status,amount_cents)
    VALUES (?, 'mercado_pago','deposit','pix','pending',?)
  `).run(id,total);
  return {DB,id,total};
}
function payload(options,percent,other={}) {
  return {
    productCode:'',variantCode:'',
    addonCodes:options.current.items.filter(x=>x.type==='addon').map(x=>x.code),
    manualDiscountCents:options.current.manualDiscountCents,
    priceAdjustmentCents:options.current.priceAdjustmentCents,
    paymentDepositPercent:percent,
    expectedRevision:options.current.revision,
    expectedTotalCents:options.current.totalCents,
    note:'Entrada de 50% autorizada pela administradora via WhatsApp',
    ...other,
  };
}
test('admin permite alterar pedido existente de R$180 para entrada de R$90 sem cobrar', async()=>{
  const {DB,id,total}=await fixture();
  const options=await getV2OrderEditOptions(DB,'LIBRI-9001');
  assert.equal(options.current.paymentDepositPercent,100);
  assert.equal(options.current.canEditDeposit,true);
  const input=payload(options,50);
  const preview=await previewV2AdminOrderEdit(DB,'LIBRI-9001',input);
  assert.equal(preview.changed,true);
  assert.equal(preview.depositChanged,true);
  assert.equal(preview.newTotalCents,18000);
  assert.equal(preview.depositPercent,50);
  assert.equal(preview.depositCents,9000);
  assert.equal(preview.balanceCents,9000);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM v2_payments').get().n,0);
  const saved=await saveV2AdminOrderEdit(DB,'LIBRI-9001',input);
  assert.equal(saved.totalCents,total);
  assert.equal(saved.depositCents,9000);
  const row=DB.sqlite.prepare(
    'SELECT deposit_percent,deposit_cents,balance_cents,pricing_snapshot_json FROM v2_order_pricing WHERE order_id=?'
  ).get(id);
  assert.deepEqual([row.deposit_percent,row.deposit_cents,row.balance_cents],[50,9000,9000]);
  const snap=JSON.parse(row.pricing_snapshot_json);
  assert.equal(snap.payment.adminDepositException,true);
  assert.equal(snap.payment.depositPercent,50);
  assert.equal(snap.baseTotalCents,18000);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM v2_payments').get().n,0);
  const audit=DB.sqlite.prepare("SELECT metadata_json FROM v2_order_history WHERE action_code='admin_deposit_exception_changed'").get();
  assert.equal(JSON.parse(audit.metadata_json).authorizedHalfDeposit,true);
  await assert.rejects(saveV2AdminOrderEdit(DB,'LIBRI-9001',input),/mudou desde/);
});
test('admin pode voltar a 100% antes do pagamento, com trilha de autorização',async()=>{
  const {DB,id}=await fixture({percent:50});
  const options=await getV2OrderEditOptions(DB,'LIBRI-9001');
  await saveV2AdminOrderEdit(DB,'LIBRI-9001',payload(options,100));
  const row=DB.sqlite.prepare('SELECT deposit_percent,deposit_cents,balance_cents,pricing_snapshot_json FROM v2_order_pricing WHERE order_id=?').get(id);
  assert.deepEqual([row.deposit_percent,row.deposit_cents,row.balance_cents],[100,18000,0]);
  assert.equal(JSON.parse(row.pricing_snapshot_json).payment.adminDepositException,false);
});
test('ao editar total e entrada juntos, 50% é recalculado sobre o valor novo',async()=>{
  const {DB,id}=await fixture();
  const options=await getV2OrderEditOptions(DB,'LIBRI-9001');
  const preview=await previewV2AdminOrderEdit(DB,'LIBRI-9001',payload(options,50,{
    manualDiscountCents:2000,
  }));
  assert.equal(preview.newTotalCents,16000);
  assert.equal(preview.depositCents,8000);
  assert.equal(preview.balanceCents,8000);
  await saveV2AdminOrderEdit(DB,'LIBRI-9001',payload(options,50,{
    manualDiscountCents:2000,
  }));
  const row=DB.sqlite.prepare('SELECT total_cents,deposit_cents,balance_cents,pricing_snapshot_json FROM v2_order_pricing WHERE order_id=?').get(id);
  assert.deepEqual([row.total_cents,row.deposit_cents,row.balance_cents],[16000,8000,8000]);
  assert.equal(JSON.parse(row.pricing_snapshot_json).baseTotalCents,16000);
});
test('não pode alterar entrada de cartão, após pagamento, ou cobrança MP pendente',async()=>{
  for(const scenario of [{method:'card'}, {paid:9000}, {pending:true},
    {status:'in_production',briefing:'completed'}]) {
    const {DB,id}=await fixture(scenario);
    const options=await getV2OrderEditOptions(DB,'LIBRI-9001');
    assert.equal(options.current.canEditDeposit,false);
    await assert.rejects(previewV2AdminOrderEdit(DB,'LIBRI-9001',payload(options,50)),
      /cartão|pagamento|cobrança|entrada|checkout/i);
    assert.equal(DB.sqlite.prepare('SELECT deposit_percent FROM v2_order_pricing WHERE order_id=?').get(id).deposit_percent,100);
  }
});
test('percentual inválido não é aceito e pedido antigo com 50% pago permanece intacto',async()=>{
  const {DB,id}=await fixture({paid:9000,percent:50,status:'briefing_pending',briefing:'available'});
  const options=await getV2OrderEditOptions(DB,'LIBRI-9001');
  assert.equal(options.current.paymentDepositPercent,50);
  await assert.rejects(previewV2AdminOrderEdit(DB,'LIBRI-9001',payload(options,80)),/50% ou 100%/);
  assert.equal(DB.sqlite.prepare('SELECT amount_cents FROM v2_payments').get().amount_cents,9000);
  assert.equal(DB.sqlite.prepare('SELECT deposit_percent FROM v2_order_pricing WHERE order_id=?').get(id).deposit_percent,50);
});
test('pedido manual criado em 100% passa a cobrar 50% no Mercado Pago sem duplicar',async t=>{
  const DB=database(),mp=providerMock(t);
  const created=await createV2ManualOrder(req,env(DB),{
    customer:{name:'Cliente Manual',whatsapp:'5511999999999',email:'test@example.com'},
    event:{type:'birthday',honoreeName:'Festa',date:day(80)},
    selection:{productCode:'interactive_essential',paymentMethod:'pix',addonCodes:[]},
    deliveryWindow:{start:day(20),end:day(22)},paymentDepositPercent:100,
  });
  const options=await getV2OrderEditOptions(DB,created.order.code);
  assert.equal(options.current.canEditDeposit,true);
  await saveV2AdminOrderEdit(DB,created.order.code,payload(options,50));
  const manual=await getV2ManualOrderForCustomer(DB,created.order.publicToken);
  assert.equal(manual.pricing.depositPercent,50);
  const first=await startV2ManualOrderPayment(req,env(DB),created.order.publicToken,{
    termsAccepted:true,termsVersion:manual.terms.version,
    expectedTotalCents:manual.pricing.totalCents,
  });
  assert.equal(first.payment.amountDueNowCents,Math.round(manual.pricing.totalCents/2));
  assert.equal(mp.posts,1);
  const second=await startV2ManualOrderPayment(req,env(DB),created.order.publicToken,{
    termsAccepted:true,termsVersion:manual.terms.version,
    expectedTotalCents:manual.pricing.totalCents,
  });
  assert.equal(second.payment.checkoutUrl,first.payment.checkoutUrl);
  assert.equal(mp.posts,1);
});
test('UI Central inclui controle autorizado, prévia da entrada e histórico',()=>{
  const editor=readFileSync('public/js/admin-v2-edit-order.js','utf8');
  const server=readFileSync('src/lib/v2-admin-order-edit.js','utf8');
  const adminEntry=readFileSync('public/js/admin-v2.js','utf8');
  const html=readFileSync('public/admin-v2.html','utf8');
  assert.match(editor,/id="adminEditDepositPercent"/);
  assert.match(editor,/Exceção autorizada: 50% de entrada/);
  assert.match(editor,/paymentDepositPercent:/);
  assert.match(editor,/Saldo contratado:/);
  assert.match(server,/admin_deposit_exception_changed/);
  assert.match(server,/adminDepositException/);
  assert.match(adminEntry,/admin-v2-order\.js\?v=20261113-existing-checkout-gift-1/);
  assert.match(html,/admin-v2\.js\?v=20261113-existing-checkout-gift-1/);
});
