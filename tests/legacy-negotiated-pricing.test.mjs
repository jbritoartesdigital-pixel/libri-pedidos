import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, day } from './helpers.mjs';
import { setV2LegacyNegotiatedTotal } from '../src/lib/v2-legacy-negotiated-pricing.js';
import { createV2FinancePayment } from '../src/lib/v2-finance.js';
import { getV2AdminOrderDetail } from '../src/lib/v2-admin-core.js';
import { reconcileV2LegacyPixStatus } from '../src/lib/v2-legacy-payment-reconcile.js';

function seeded(orderCode = 'LIBRI-1064', { legacy = true } = {}) {
  const DB = database();
  const customer = DB.sqlite.prepare(`
    INSERT INTO v2_customers(name,whatsapp)
    VALUES ('Cliente Fictícia da Antonella', '5511999999999')
  `).run();
  const order = DB.sqlite.prepare(`
    INSERT INTO v2_orders
    (order_code,public_token,customer_id,event_type,event_subtype,
      honoree_display_name,event_date,status,source,briefing_status)
    VALUES (?, ?, ?, 'birthday', ?, 'Antonella Fictícia', ?, 'awaiting_payment', 'store', 'locked')
  `).run(orderCode, 'token-' + orderCode, Number(customer.lastInsertRowid),
    legacy ? 'legacy_v1' : 'modern', day(50));
  const id = Number(order.lastInsertRowid);
  DB.sqlite.prepare(`
    INSERT INTO v2_order_pricing(order_id,subtotal_cents,total_cents,
      payment_method,deposit_percent,deposit_cents,balance_cents,pricing_snapshot_json)
    VALUES (?,18000,18000,'pix',50,9000,9000,?)
  `).run(id, JSON.stringify(legacy ? { legacyV1: 1 } : {}));
  return { DB, id, orderCode };
}
function price(DB,id) {
  return { ...DB.sqlite.prepare(`
    SELECT total_cents,subtotal_cents,combo_discount_cents,coupon_discount_cents,
      deposit_cents,balance_cents,pricing_snapshot_json
    FROM v2_order_pricing WHERE order_id=?
  `).get(id) };
}
function payments(DB,id) {
  return DB.sqlite.prepare('SELECT provider,payment_type,amount_cents,status FROM v2_payments WHERE order_id=? ORDER BY id').all(id);
}

test('legacy V1 R$180 discounted to R$165 and FULL external Pix settled without fake balance', async () => {
  const { DB,id,orderCode }=seeded();
  const changed=await setV2LegacyNegotiatedTotal(DB,orderCode,{
    expectedTotalCents:18000,agreedTotalCents:16500,
    reason:'Desconto de R$15 acertado no WhatsApp',
  });
  assert.equal(changed.totalCents,16500);
  assert.equal(changed.discountCents,1500);
  assert.equal(changed.remainingCents,16500);
  const p=price(DB,id);
  assert.equal(p.subtotal_cents,18000);
  assert.equal(p.total_cents,16500);
  assert.equal(p.balance_cents,7500);
  assert.equal(p.combo_discount_cents,0);
  assert.equal(p.coupon_discount_cents,0);
  assert.equal(JSON.parse(p.pricing_snapshot_json).adminNegotiatedOriginalTotalCents,18000);
  assert.equal(payments(DB,id).length,0,'price correction must not invent a payment');

  const received=await createV2FinancePayment(DB,{
    orderCode,amountCents:16500,paidDate:day(0),paymentType:'full_payment',
    note:'Pix fictício confirmado externamente',
  });
  assert.equal(received.remainingCents,0);
  assert.equal(payments(DB,id).length,1);
  assert.equal(payments(DB,id)[0].amount_cents,16500);
  const order={...DB.sqlite.prepare('SELECT status,briefing_status FROM v2_orders WHERE id=?').get(id)};
  assert.deepEqual(order,{status:'briefing_pending',briefing_status:'available'});
  const detail=await getV2AdminOrderDetail(DB,orderCode);
  assert.equal(detail.pricing.totalCents,16500);
  assert.equal(detail.pricing.negotiatedDiscountCents,1500);
  assert.equal(detail.pricing.originalNegotiatedTotalCents,18000);
  assert.equal(detail.payment.paidCents,16500);
  assert.equal(detail.payment.remainingBalanceCents,0);
  const histories=DB.sqlite.prepare('SELECT action_code,metadata_json FROM v2_order_history WHERE order_id=? ORDER BY id').all(id);
  assert.ok(histories.some(x=>x.action_code==='legacy_negotiated_discount'));
  assert.ok(histories.some(x=>x.action_code==='finance_payment_added'));
  assert.ok(histories.some(x=>JSON.parse(x.metadata_json).reason==='Desconto de R$15 acertado no WhatsApp'));
});

test('legacy V1 imported entrance: only remaining R$75 can be recorded', async () => {
  const { DB,id,orderCode }=seeded('LIBRI-1065');
  DB.sqlite.prepare(`
    INSERT INTO v2_payments(order_id,provider,payment_type,method,status,amount_cents)
    VALUES (?,'direct_pix','deposit','pix','approved',9000)
  `).run(id);
  const changed=await setV2LegacyNegotiatedTotal(DB,orderCode,{
    expectedTotalCents:18000,agreedTotalCents:16500,reason:'Desconto no saldo final',
  });
  assert.equal(changed.paidCents,9000);
  assert.equal(changed.remainingCents,7500);
  await assert.rejects(createV2FinancePayment(DB,{
    orderCode,amountCents:16500,paidDate:day(0),paymentType:'balance',
  }),/maior que o saldo/);
  await createV2FinancePayment(DB,{
    orderCode,amountCents:7500,paidDate:day(0),paymentType:'balance',
  });
  const detail=await getV2AdminOrderDetail(DB,orderCode);
  assert.equal(detail.payment.paidCents,16500);
  assert.equal(detail.payment.remainingBalanceCents,0);
  assert.equal(payments(DB,id).length,2,'imported deposit must be preserved once');
});

test('legacy negotiation protects payments, versions, nonlegacy, cancellation and Mercado Pago',async()=>{
  let {DB,id,orderCode}=seeded('LIBRI-1066');
  await assert.rejects(setV2LegacyNegotiatedTotal(DB,orderCode,{
    expectedTotalCents:17900,agreedTotalCents:16500,reason:'Acordo registrado',
  }),/mudou/);
  await assert.rejects(setV2LegacyNegotiatedTotal(DB,orderCode,{
    expectedTotalCents:18000,agreedTotalCents:18100,reason:'Acordo registrado',
  }),/acréscimos/);
  await assert.rejects(setV2LegacyNegotiatedTotal(DB,orderCode,{
    expectedTotalCents:18000,agreedTotalCents:16500,reason:'x',
  }),/motivo/);
  DB.sqlite.prepare(`
    INSERT INTO v2_payments(order_id,provider,payment_type,method,status,amount_cents)
    VALUES (?,'direct_pix','deposit','pix','approved',17000)
  `).run(id);
  await assert.rejects(setV2LegacyNegotiatedTotal(DB,orderCode,{
    expectedTotalCents:18000,agreedTotalCents:16500,reason:'Desconto acordado',
  }),/menor que o valor líquido/);
  DB.sqlite.prepare('DELETE FROM v2_payments WHERE order_id=?').run(id);
  DB.sqlite.prepare(`
    INSERT INTO v2_payments(order_id,provider,payment_type,method,status,amount_cents)
    VALUES (?,'mercado_pago','deposit','pix','pending',9000)
  `).run(id);
  await assert.rejects(setV2LegacyNegotiatedTotal(DB,orderCode,{
    expectedTotalCents:18000,agreedTotalCents:16500,reason:'Desconto acordado',
  }),/Mercado Pago/);
  DB.sqlite.prepare('DELETE FROM v2_payments WHERE order_id=?').run(id);
  DB.sqlite.prepare("UPDATE v2_orders SET status='finalized' WHERE id=?").run(id);
  await assert.rejects(setV2LegacyNegotiatedTotal(DB,orderCode,{
    expectedTotalCents:18000,agreedTotalCents:16500,reason:'Desconto acordado',
  }),/encerrado/);
  const notLegacy=seeded('LIBRI-2001',{legacy:false});
  await assert.rejects(setV2LegacyNegotiatedTotal(notLegacy.DB,notLegacy.orderCode,{
    expectedTotalCents:18000,agreedTotalCents:16500,reason:'Desconto acordado',
  }),/importados da V1/);
  assert.equal(price(DB,id).total_cents,18000);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_order_history WHERE order_id=?').get(id).n,0);
});

test('subsequent legacy corrections preserve first original price and complete history',async()=>{
  const {DB,id,orderCode}=seeded('LIBRI-1067');
  await setV2LegacyNegotiatedTotal(DB,orderCode,{
    expectedTotalCents:18000,agreedTotalCents:16500,reason:'Desconto de R$15',
  });
  await assert.rejects(setV2LegacyNegotiatedTotal(DB,orderCode,{
    expectedTotalCents:18000,agreedTotalCents:16000,reason:'Outro desconto',
  }),/mudou/);
  const next=await setV2LegacyNegotiatedTotal(DB,orderCode,{
    expectedTotalCents:16500,agreedTotalCents:16000,reason:'Mais R$5 negociados',
  });
  assert.equal(next.discountCents,2000);
  assert.equal(JSON.parse(price(DB,id).pricing_snapshot_json).adminNegotiatedOriginalTotalCents,18000);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_order_history WHERE action_code='legacy_negotiated_discount'").get().n,2);
});
test('order detail includes price and receipt controls only for legacy V1 or manual orders',()=>{
  const js=readFileSync('public/js/admin-v2-order.js','utf8');
  const route=readFileSync('src/routes/admin-orders-v2.js','utf8');
  assert.match(js,/detail\.order\.eventSubtype === 'legacy_v1'/);
  assert.match(js,/id="toggleLegacyNegotiatedPrice"/);
  assert.match(js,/id="toggleOrderPixReceipt"/);
  assert.match(js,/expectedTotalCents: detail\.pricing\.totalCents/);
  assert.match(js,/Confirme primeiro que o Pix entrou na sua conta/);
  assert.match(route,/setV2LegacyNegotiatedTotal/);
  assert.match(route,/legacy-price/);
});

test('already recorded legacy V1 Pix repairs stale awaiting-payment state without duplicating receipt',async()=>{
  const {DB,id,orderCode}=seeded('LIBRI-0064');
  DB.sqlite.prepare("UPDATE v2_orders SET briefing_status='completed' WHERE id=?").run(id);
  DB.sqlite.prepare(`
    INSERT INTO v2_payments(order_id,provider,payment_type,method,status,amount_cents)
    VALUES (?,'direct_pix','full_payment','pix','approved',16500)
  `).run(id);
  const countBefore=payments(DB,id).length;
  const changed=await reconcileV2LegacyPixStatus(DB,orderCode);
  assert.equal(changed.changed,true);
  assert.equal(changed.status,'ready_for_production');
  assert.equal(changed.briefingStatus,'completed');
  assert.equal(changed.paidCents,16500);
  assert.equal(payments(DB,id).length,countBefore);
  const row={...DB.sqlite.prepare('SELECT status,briefing_status FROM v2_orders WHERE id=?').get(id)};
  assert.deepEqual(row,{status:'ready_for_production',briefing_status:'completed'});
  const again=await reconcileV2LegacyPixStatus(DB,orderCode);
  assert.equal(again.changed,false);
  assert.equal(payments(DB,id).length,1);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_order_history WHERE action_code='finance_manual_receipt_reconciled'").get().n,1);
});

test('late imported Pix unlocks pending briefing but preserves existing fields',async()=>{
  const {DB,id,orderCode}=seeded('LIBRI-0065');
  DB.sqlite.prepare("UPDATE v2_orders SET briefing_status='in_progress' WHERE id=?").run(id);
  DB.sqlite.prepare(`
    INSERT INTO v2_payments(order_id,provider,payment_type,method,status,amount_cents)
    VALUES (?,'direct_pix','deposit','pix','approved',9000)
  `).run(id);
  const x=await reconcileV2LegacyPixStatus(DB,orderCode);
  assert.equal(x.status,'briefing_pending');
  assert.equal(x.briefingStatus,'in_progress');
  assert.equal(x.remainingCents,9000);
  DB.sqlite.prepare("UPDATE v2_orders SET status='ready_for_delivery' WHERE id=?").run(id);
  const unchanged=await reconcileV2LegacyPixStatus(DB,orderCode);
  assert.equal(unchanged.changed,false);
  assert.equal(unchanged.status,'ready_for_delivery');
});

test('reconciliation refuses missing evidence or nonlegacy orders',async()=>{
  const {DB,id,orderCode}=seeded('LIBRI-0066');
  await assert.rejects(reconcileV2LegacyPixStatus(DB,orderCode),
    /Não há Pix manual aprovado/);
  DB.sqlite.prepare(`
    INSERT INTO v2_payments(order_id,provider,payment_type,method,status,amount_cents)
    VALUES (?,'direct_pix','full_payment','pix','pending',16500)
  `).run(id);
  await assert.rejects(reconcileV2LegacyPixStatus(DB,orderCode),
    /Não há Pix manual aprovado/);
  assert.equal(DB.sqlite.prepare("SELECT status FROM v2_orders WHERE id=?").get(id).status,'awaiting_payment');
  const other=seeded('LIBRI-2002',{legacy:false});
  await assert.rejects(reconcileV2LegacyPixStatus(other.DB,other.orderCode),
    /importados da V1/);
});

test('legacy snapshot marker enables pricing and Pix action even if subtype is missing',async()=>{
  const {DB,id,orderCode}=seeded('LIBRI-0067',{legacy:false});
  DB.sqlite.prepare("UPDATE v2_order_pricing SET pricing_snapshot_json='{\"legacyV1\":1}' WHERE order_id=?").run(id);
  const detail=await getV2AdminOrderDetail(DB,orderCode);
  assert.equal(detail.order.isLegacyV1,true);
  await setV2LegacyNegotiatedTotal(DB,orderCode,{
    expectedTotalCents:18000,agreedTotalCents:16500,reason:'Desconto especial combinado',
  });
  DB.sqlite.prepare(`
    INSERT INTO v2_payments(order_id,provider,payment_type,method,status,amount_cents)
    VALUES (?,'direct_pix','full_payment','pix','approved',16500)
  `).run(id);
  const later=await getV2AdminOrderDetail(DB,orderCode);
  assert.equal(later.order.canReconcileManualPix,true);
  await reconcileV2LegacyPixStatus(DB,orderCode);
  assert.equal((await getV2AdminOrderDetail(DB,orderCode)).order.canReconcileManualPix,false);
});

test('visible admin card offers already-approved Pix repair without another financial launch',()=>{
  const js=readFileSync('public/js/admin-v2-order.js','utf8');
  const core=readFileSync('src/lib/v2-admin-core.js','utf8');
  const finance=readFileSync('src/lib/v2-finance.js','utf8');
  assert.match(js,/id="reconcileLegacyPixStatus"/);
  assert.match(js,/Pix registrado:/);
  assert.match(js,/Nenhum pagamento novo será lançado/);
  assert.match(core,/canReconcileManualPix/);
  assert.match(core,/statusLabel\(row.status, row.paid_cents, row.total_cents\)/);
  assert.match(finance,/await reconcileV2LegacyPixStatus\(db, code\)/);
});
