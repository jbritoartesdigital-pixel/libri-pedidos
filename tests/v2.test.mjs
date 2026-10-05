import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { database, day, providerMock } from './helpers.mjs';
import { requestV2UrgencyReview, resumeV2Payment, startV2Checkout } from '../src/lib/v2-checkout.js';
import { decideV2Urgency, validateUrgencyWindow } from '../src/lib/v2-urgency-admin.js';
import { syncMercadoPagoOrder, validateMercadoPagoWebhook } from '../src/lib/v2-mercadopago.js';
import { getV2CustomerArea } from '../src/lib/v2-customer-area.js';
import { calculateCommercialV2Quote } from '../src/lib/v2-commercial-pricing.js';
import { runV2Scheduler } from '../src/lib/v2-scheduler.js';
import { getV2AgendaRange, setV2AgendaDay, setV2AgendaPeriod, getV2CascadeSuggestions, anticipateV2Production, releaseV2CascadeSurplus } from '../src/lib/v2-agenda-admin.js';
import worker from '../src/index.js';
import { createMercadoPagoCheckout } from '../src/lib/v2-mercadopago.js';

const request = new Request('https://pedidos.libriconvites.com.br/api/v2/checkout/start');
function env(DB) { return { DB, MERCADO_PAGO_ACCESS_TOKEN: 'TEST-token' }; }
function input(overrides = {}) { return { clientRequestId: crypto.randomUUID(),
  customer: { name: 'Cliente Teste', whatsapp: '5511999999999', email: 'test@example.com' },
  event: { honoreeName: 'Teste', type: 'birthday', date: day(2) },
  selection: { productCode: 'interactive_essential', paymentMethod: 'pix' }, ...overrides }; }
async function terms(DB, method = 'pix') {
  const row = await DB.prepare('SELECT version FROM v2_terms_versions WHERE active = 1').first();
  return { clientRequestId: crypto.randomUUID(), termsAccepted: true, termsVersion: row.version, paymentMethod: method };
}
async function urgency(DB) {
  return requestV2UrgencyReview(request, env(DB), input());
}

test('all migrations run in SQLite with V1 and V2 tables intact', () => {
  const DB = database(); assert.equal(DB.migrationCount, 12);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_products').get().n, 7);
  assert.equal(DB.sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.ok(DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'orders'").get());
});

test('urgency: request, approval, exact discounted price, Pix, repeated webhook and production preservation', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const result = await urgency(DB); const token = result.order.publicToken;
  assert.equal(mp.posts, 0);
  const pendingPricing = DB.sqlite.prepare('SELECT subtotal_cents, urgency_percent, urgency_amount_cents, total_cents FROM v2_order_pricing').get();
  assert.equal(pendingPricing.urgency_percent, 30);
  assert.equal(pendingPricing.urgency_amount_cents, Math.round(pendingPricing.subtotal_cents * 0.3));
  assert.equal(pendingPricing.total_cents, pendingPricing.subtotal_cents + pendingPricing.urgency_amount_cents);
  DB.sqlite.prepare('UPDATE v2_order_pricing SET subtotal_cents = 7001, combo_discount_cents = 1000, coupon_discount_cents = 500').run();
  const approved = await decideV2Urgency(DB, result.order.code, { decision: 'approve', deliveryStart: day(0), deliveryEnd: day(1) });
  assert.equal(approved.pricing.totalCents, 9101); assert.equal(approved.pricing.urgencyAmountCents, 2100);
  assert.equal(approved.pricing.payment.depositCents, 4551); assert.equal(approved.pricing.payment.balanceCents, 4550);
  await assert.rejects(decideV2Urgency(DB, result.order.code, { decision: 'reject', note: 'Duplicada' }));
  const payment = await resumeV2Payment(request, e, token, await terms(DB));
  assert.equal(mp.bodies[0].total_amount, '45.51'); assert.equal(payment.payment.ready, true);
  const reused = await resumeV2Payment(request, e, token, await terms(DB)); assert.equal(reused.payment.checkoutUrl, payment.payment.checkoutUrl); assert.equal(mp.posts, 1);
  mp.approve(payment.payment.providerOrderId);
  await syncMercadoPagoOrder(e, payment.payment.providerOrderId);
  const area = await getV2CustomerArea(e, token); assert.equal(area.briefing.locked, false);
  DB.sqlite.prepare("UPDATE v2_orders SET status = 'in_production', briefing_status = 'completed'").run();
  await syncMercadoPagoOrder(e, payment.payment.providerOrderId);
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_orders').get().status, 'in_production');
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_order_history WHERE action_code = 'payment_confirmed'").get().n, 1);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_agenda_allocations').get().n, 1);
  const units = DB.sqlite.prepare('SELECT points_units FROM v2_agenda_allocations').get().points_units;
  assert.equal(typeof units, 'number'); assert.equal(units, 100);
});

test('rejection prevents payment; invalid and past windows are rejected', async () => {
  const DB = database(); const result = await urgency(DB);
  assert.throws(() => validateUrgencyWindow(day(-1), day(1), day(2)));
  assert.throws(() => validateUrgencyWindow('2026-02-30', '2026-03-01', '2026-03-02'));
  await decideV2Urgency(DB, result.order.code, { decision: 'reject', note: 'Sem capacidade' });
  const area = await getV2CustomerArea(env(DB), result.order.publicToken); assert.equal(area.urgency.note, 'Sem capacidade');
  await assert.rejects(resumeV2Payment(request, env(DB), result.order.publicToken, await terms(DB)));
});

test('card charges 100%; payment-time capacity is revalidated and concurrent requests are serialized', async t => {
  const DB = database(); const mp = providerMock(t); const result = await urgency(DB);
  await decideV2Urgency(DB, result.order.code, { decision: 'approve', deliveryStart: day(0), deliveryEnd: day(1) });
  await setV2AgendaPeriod(DB, { start: day(0), end: day(1), blocked: true });
  await assert.rejects(resumeV2Payment(request, env(DB), result.order.publicToken, await terms(DB, 'card')), /capacidade/);
  assert.equal(mp.posts, 0);
  await setV2AgendaPeriod(DB, { start: day(0), end: day(1), blocked: false });
  const body = await terms(DB, 'card');
  const results = await Promise.allSettled([resumeV2Payment(request, env(DB), result.order.publicToken, body), resumeV2Payment(request, env(DB), result.order.publicToken, body)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1); assert.equal(mp.posts, 1);
  const pricing = DB.sqlite.prepare('SELECT total_cents, deposit_cents, balance_cents FROM v2_order_pricing').get();
  assert.equal(pricing.total_cents, pricing.deposit_cents); assert.equal(pricing.balance_cents, 0);
});

test('normal checkout resumes expired payment in same order; stale payment cannot mutate paid order', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const body = input({ event: { honoreeName: 'Teste', type: 'birthday', date: day(50) }, deliveryWindow: { start: day(10), end: day(12) }, ...await terms(DB) });
  const checkout = await startV2Checkout(request, e, body);
  const old = checkout.payment.providerOrderId; mp.orders.get(old).status = 'expired';
  mp.orders.get(old).status_detail = 'expired';
  const resumed = await resumeV2Payment(request, e, checkout.order.publicToken, { clientRequestId: crypto.randomUUID() });
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n, 1); assert.equal(mp.posts, 2);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_order_terms_acceptances').get().n, 1);
  mp.approve(resumed.payment.providerOrderId); await syncMercadoPagoOrder(e, resumed.payment.providerOrderId);
  await syncMercadoPagoOrder(e, old);
  assert.equal(DB.sqlite.prepare('SELECT next_action FROM v2_orders').get().next_action, 'Briefing aguardando preenchimento');
});

test('amount mismatch blocks unlocking; valid signature preserves order ID case and rejects tampering', async t => {
  const DB = database(); const mp = providerMock(t); const result = await urgency(DB);
  await decideV2Urgency(DB, result.order.code, { decision: 'approve', deliveryStart: day(0), deliveryEnd: day(1) });
  const payment = await resumeV2Payment(request, env(DB), result.order.publicToken, await terms(DB));
  mp.approve(payment.payment.providerOrderId); mp.orders.get(payment.payment.providerOrderId).total_amount = '0.01';
  await assert.rejects(syncMercadoPagoOrder(env(DB), payment.payment.providerOrderId), /Valor/);
  assert.equal(DB.sqlite.prepare('SELECT briefing_status FROM v2_orders').get().briefing_status, 'locked');
  const secret = 'test-secret'; const ts = '1742505638683'; const id = 'ORDabc123';
  const signature = createHmac('sha256', secret).update(`id:${id};request-id:req;ts:${ts};`).digest('hex');
  const url = new URL(`https://example.com/webhook?data.id=${id}`);
  const signed = new Request(url, { headers: { 'x-signature': `ts=${ts},v1=${signature}`, 'x-request-id': 'req' } });
  const config = { MERCADO_PAGO_WEBHOOK_SECRET: secret };
  assert.equal(await validateMercadoPagoWebhook(signed, config, url, { data: { id } }), true);
  assert.equal(await validateMercadoPagoWebhook(signed, config, url, { data: { id: 'OTHER' } }), false);
  assert.equal(await validateMercadoPagoWebhook(signed, config, new URL('https://example.com/?data.id=ordabc123'), {}), false);
});

test('scheduler repairs missing notifications, expires reservations and previews, cleans challenges, deduplicates events', async () => {
  const DB = database(); const result = await urgency(DB); const id = DB.sqlite.prepare('SELECT id FROM v2_orders').get().id;
  DB.sqlite.prepare('DELETE FROM v2_notifications').run();
  DB.sqlite.prepare("INSERT INTO v2_checkout_holds(token, order_id, expires_at) VALUES ('expired', ?, '2000-01-01')").run(id);
  DB.sqlite.prepare("INSERT INTO v2_previews(order_id, version_number, media_type, preview_r2_key, expires_at) VALUES (?, 1, 'image', 'test', '2000-01-01')").run(id);
  await runV2Scheduler(env(DB)); await runV2Scheduler(env(DB));
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_checkout_holds').get().status, 'expired');
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_previews').get().status, 'expired');
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_notifications WHERE event_code = 'URGENCY_REQUESTED'").get().n, 1);
  assert.equal((await getV2CustomerArea(env(DB), result.order.publicToken)).urgency.status, 'pending');
});

test('commercial quote applies configured urgency and fixed Pix 50% after combo and coupon discounts', async () => {
  const DB = database();
  DB.sqlite.exec(`INSERT INTO v2_combos(code,name,discount_type,discount_value) VALUES ('test','Test','fixed',100);
    INSERT INTO v2_coupons(code,discount_type,discount_value) VALUES ('TEST','percent',10);
    UPDATE v2_settings SET value = '99' WHERE key IN ('urgency_percent','pix_deposit_percent');`);
  const quote = await calculateCommercialV2Quote(DB, { productCode: 'interactive_essential', paymentMethod: 'pix', comboCode: 'test', couponCode: 'TEST' }, { urgencyApproved: true });
  assert.equal(quote.subtotalCents, Math.round((quote.productCents - 100) * 0.9));
  assert.equal(quote.urgency.percent, 99);
  assert.equal(quote.urgency.amountCents, Math.round(quote.subtotalCents * 0.99));
  assert.equal(quote.payment.depositPercent, 50);
});

test('restored agenda day/period and cascade suggestions run against actual schema', async () => {
  const DB = database();
  const edited = await setV2AgendaDay(DB, day(3), { sellableCapacityUnits: 200, internalBufferUnits: 100 });
  assert.equal(edited.sellableCapacityUnits, 200);
  assert.equal((await getV2AgendaRange(DB, { start: day(3), end: day(4) })).days.length, 2);
  assert.deepEqual(await getV2CascadeSuggestions(DB), { suggestions: [] });
  const a = await urgency(DB); const b = await requestV2UrgencyReview(request, env(DB), input());
  const rows = DB.sqlite.prepare('SELECT id,order_code FROM v2_orders ORDER BY id').all();
  DB.sqlite.prepare("UPDATE v2_orders SET status='finalized' WHERE id=?").run(rows[0].id);
  DB.sqlite.prepare("UPDATE v2_orders SET status='ready_for_production',briefing_status='completed' WHERE id=?").run(rows[1].id);
  DB.sqlite.prepare("INSERT INTO v2_payments(order_id,provider,payment_type,method,status,amount_cents) VALUES (?,'direct_pix','deposit','pix','approved',1000)").run(rows[1].id);
  for (const [i,d] of [[0,3],[1,5]]) DB.sqlite.prepare('INSERT INTO v2_agenda_allocations(order_id,day,points_units) VALUES (?,?,100)').run(rows[i].id,day(d));
  assert.equal((await getV2CascadeSuggestions(DB)).suggestions.length, 1);
  assert.equal((await anticipateV2Production(DB, { sourceOrderCode: a.order.code, targetOrderCode: b.order.code })).movedUnits, 100);
  assert.equal((await releaseV2CascadeSurplus(DB, { sourceOrderCode: a.order.code })).releasedUnits, 100);
});

test('normal delivery availability prevents urgency request', async () => {
  const DB = database();
  await assert.rejects(requestV2UrgencyReview(request, env(DB), input({ event: { honoreeName: 'Teste', date: day(50) } })), error => error.code === 'regular_delivery_available');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n, 0);
});

test('uncertain provider response is recovered with same idempotency key and no duplicate charge', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const a = await urgency(DB);
  await decideV2Urgency(DB, a.order.code, { decision: 'approve', deliveryStart: day(0), deliveryEnd: day(1) });
  const first = await resumeV2Payment(request, e, a.order.publicToken, await terms(DB));
  const order = DB.sqlite.prepare('SELECT id, order_code FROM v2_orders').get();
  await createMercadoPagoCheckout(request, e, { orderId: order.id, orderCode: order.order_code,
    publicToken: a.order.publicToken, paymentMethod: 'pix', amountDueNowCents: first.payment.amountDueNowCents });
  assert.equal(mp.posts, 1); assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments').get().n, 1);
  DB.sqlite.prepare('DELETE FROM v2_payments').run();
  const recovered = await resumeV2Payment(request, e, a.order.publicToken, await terms(DB));
  assert.equal(recovered.payment.providerOrderId, first.payment.providerOrderId); assert.equal(mp.posts, 1);
});

test('late accredited payment does not oversell capacity; repeated review is deduplicated', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB); const a = await urgency(DB);
  await decideV2Urgency(DB, a.order.code, { decision: 'approve', deliveryStart: day(0), deliveryEnd: day(1) });
  const payment = await resumeV2Payment(request, e, a.order.publicToken, await terms(DB));
  DB.sqlite.prepare("UPDATE v2_checkout_holds SET status='expired',expires_at='2000-01-01'").run();
  await setV2AgendaPeriod(DB, { start: day(0), end: day(1), blocked: true });
  mp.approve(payment.payment.providerOrderId);
  const result = await syncMercadoPagoOrder(e, payment.payment.providerOrderId); assert.equal(result.capacityReview, true);
  await syncMercadoPagoOrder(e, payment.payment.providerOrderId);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_agenda_allocations').get().n, 0);
  assert.equal(DB.sqlite.prepare('SELECT briefing_status FROM v2_orders').get().briefing_status, 'locked');
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_notifications WHERE dedupe_key LIKE 'payment-capacity:%'").get().n, 1);
});

test('stale cancellation cannot release replacement hold; provider canceled spelling supported', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const a = await urgency(DB); await decideV2Urgency(DB, a.order.code, { decision: 'approve', deliveryStart: day(0), deliveryEnd: day(1) });
  const first = await resumeV2Payment(request, e, a.order.publicToken, await terms(DB));
  mp.orders.get(first.payment.providerOrderId).status = 'canceled'; mp.orders.get(first.payment.providerOrderId).status_detail = 'canceled';
  const next = await resumeV2Payment(request, e, a.order.publicToken, await terms(DB));
  assert.notEqual(first.payment.providerOrderId, next.payment.providerOrderId);
  await syncMercadoPagoOrder(e, first.payment.providerOrderId);
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_checkout_holds ORDER BY id DESC LIMIT 1').get().status, 'active');
});

test('Worker V1/V2 public routes, Admin authentication, static shells and scheduler remain available', async () => {
  const DB = database(); const e = env(DB); delete e.MERCADO_PAGO_ACCESS_TOKEN;
  const served = []; e.ASSETS = { async fetch(r) { served.push(new URL(r.url).pathname); return new Response('shell'); } };
  const ctx = { waitUntil(p) { this.pending = p; } };
  for (const path of ['/api/catalog', '/api/v2/catalog']) assert.equal((await worker.fetch(new Request(`https://example.com${path}`), e, ctx)).status, 200);
  const unauth = await worker.fetch(new Request('https://example.com/api/admin/v2/orders/LIBRI-1001/urgency', { method: 'POST' }), e, ctx);
  assert.equal(unauth.status, 401);
  for (const path of ['/pedido', '/admin-v2', '/meu-pedido/ord_' + 'a'.repeat(36), '/']) assert.equal((await worker.fetch(new Request(`https://example.com${path}`), e, ctx)).status, 200);
  assert.deepEqual(served, ['/client-v2.html', '/admin-v2.html', '/client-v2.html', '/']);
  await worker.scheduled({}, e, ctx); await ctx.pending;
});
