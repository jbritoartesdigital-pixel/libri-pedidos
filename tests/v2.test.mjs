import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { database, day, providerMock } from './helpers.mjs';
import { requestV2UrgencyReview, resumeV2Payment, startV2Checkout } from '../src/lib/v2-checkout.js';
import { decideV2Urgency, validateUrgencyWindow } from '../src/lib/v2-urgency-admin.js';
import { syncMercadoPagoOrder, validateMercadoPagoWebhook } from '../src/lib/v2-mercadopago.js';
import { getV2CustomerArea } from '../src/lib/v2-customer-area.js';
import { calculateCommercialV2Quote } from '../src/lib/v2-commercial-pricing.js';
import { loadV2Catalog } from '../src/lib/v2-catalog.js';
import { runV2Scheduler } from '../src/lib/v2-scheduler.js';
import { cancelV2Order, deleteUnpaidV2Order, getV2Central, listV2Production } from '../src/lib/v2-admin-core.js';
import { getV2AgendaRange, setV2AgendaDay, setV2AgendaPeriod, getV2CascadeSuggestions, anticipateV2Production, releaseV2CascadeSurplus } from '../src/lib/v2-agenda-admin.js';
import { findV2DeliveryOptions, validateV2DeliveryWindow } from '../src/lib/v2-agenda.js';
import worker from '../src/index.js';
import { createMercadoPagoCheckout } from '../src/lib/v2-mercadopago.js';
import { createV2Preview, revokeV2Preview } from '../src/lib/v2-preview.js';
import { getV2FinanceDashboard } from '../src/lib/v2-finance.js';

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
  const DB = database(); assert.equal(DB.migrationCount, 15);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_products').get().n, 7);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_combos').get().n, 5);
  assert.equal(DB.sqlite.prepare("SELECT value FROM v2_settings WHERE key = 'company_name'").get().value, 'Libri Convites');
  assert.equal(DB.sqlite.prepare("SELECT value FROM v2_settings WHERE key = 'company_instagram'").get().value, '@libriconvites');
  assert.equal(DB.sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.ok(DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'orders'").get());
});

test('legacy V1 orders migrate idempotently into the V2 model without deleting source data', () => {
  const DB = database();
  const legacyToken = 'ord_' + 'b'.repeat(36);

  DB.sqlite.prepare(`
    INSERT INTO orders(
      order_code, public_token, customer_name, whatsapp,
      honoree_name, display_name, age,
      event_date, event_time, venue_name, venue_address, location_url, theme,
      experience, format, addons_json, briefing_json, pricing_json,
      subtotal_cents, urgency_enabled, urgency_percent, urgency_amount_cents,
      total_cents, deposit_percent, deposit_cents, balance_cents,
      terms_version, terms_accepted_at, portfolio_consent,
      status, photos_status, entry_status, mascot_status, speech_mode,
      speech_status, invitation_status, balance_status,
      production_started_at, production_deadline_at,
      created_at, updated_at, finalized_at
    )
    VALUES (
      'LIBRI-0999', ?, 'Cliente Legada', '5561999999999',
      'Aurora Legada', 'Aurora', 5,
      '2026-12-20', '16:00', 'Salão', 'Rua Teste', 'https://maps.example/teste', 'Jardim',
      'full', 'interactive',
      '{"confirmation":true,"extraPerson":1,"photoAlbumPlan":"festa","photoAlbumExtra100":1}',
      '{"mustHave":"Borboletas","speechPreference":"libri"}',
      '{"productCents":18000,"addonsCents":11900}',
      29900, 1, 30, 8970,
      38870, 50, 19435, 19435,
      '1.0', '2026-10-01T12:00:00.000Z', 1,
      'producing', 'approved', 'confirmed', 'approved', 'libri',
      'not_required', 'producing', 'waiting',
      '2026-10-02T12:00:00.000Z', '2026-10-10T12:00:00.000Z',
      '2026-10-01T12:00:00.000Z', '2026-10-03T12:00:00.000Z', '2026-10-03T12:00:00.000Z'
    )
  `).run(legacyToken);

  const legacyId = DB.sqlite.prepare("SELECT id FROM orders WHERE order_code='LIBRI-0999'").get().id;
  DB.sqlite.prepare(`
    INSERT INTO order_history(order_id, action_code, description, metadata_json, created_at)
    VALUES (?, 'update_entry_status', 'Entrada confirmada', '{}', '2026-10-01T13:00:00.000Z')
  `).run(legacyId);
  DB.sqlite.prepare(`
    INSERT INTO internal_notes(order_id, note, created_at)
    VALUES (?, 'Manter detalhe aprovado pela cliente.', '2026-10-02T14:00:00.000Z')
  `).run(legacyId);

  const migration = readFileSync('migrations/0014_v1_to_v2_retirement.sql', 'utf8');
  DB.sqlite.exec(migration);
  DB.sqlite.exec(migration);

  const migrated = DB.sqlite.prepare(`
    SELECT o.*, c.name AS customer_name, c.whatsapp
    FROM v2_orders o
    JOIN v2_customers c ON c.id = o.customer_id
    WHERE o.order_code='LIBRI-0999'
  `).get();

  assert.equal(migrated.public_token, legacyToken);
  assert.equal(migrated.customer_name, 'Cliente Legada');
  assert.equal(migrated.whatsapp, '5561999999999');
  assert.equal(migrated.honoree_display_name, 'Aurora');
  assert.equal(migrated.status, 'in_production');
  assert.equal(migrated.briefing_status, 'completed');
  assert.equal(migrated.delivery_end, '2026-10-10');

  const briefing = JSON.parse(DB.sqlite.prepare(
    "SELECT data_json FROM v2_briefings WHERE order_id=?"
  ).get(migrated.id).data_json);
  assert.equal(briefing.theme_or_style, 'Jardim');
  assert.equal(briefing.event_time, '16:00');
  assert.equal(briefing.mustHave, 'Borboletas');

  assert.equal(DB.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM v2_order_items WHERE order_id=?"
  ).get(migrated.id).n, 5);
  assert.equal(DB.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM v2_payments WHERE order_id=? AND status='approved'"
  ).get(migrated.id).n, 1);
  assert.equal(DB.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM v2_order_terms_acceptances WHERE order_id=?"
  ).get(migrated.id).n, 1);
  assert.equal(DB.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM v2_internal_notes WHERE order_id=?"
  ).get(migrated.id).n, 1);
  assert.ok(DB.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM v2_agenda_allocations WHERE order_id=?"
  ).get(migrated.id).n > 0);

  assert.equal(DB.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM v2_orders WHERE order_code='LIBRI-0999'"
  ).get().n, 1);
  assert.equal(DB.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM orders WHERE order_code='LIBRI-0999'"
  ).get().n, 1);
});

test('legacy repair finalizes delivered historical orders and moves imported payments off migration month', async () => {
  const DB = database();

  const legacyToken = 'ord_' + 'c'.repeat(36);
  DB.sqlite.prepare(`
    INSERT INTO orders(
      order_code, public_token, customer_name, whatsapp,
      honoree_name, display_name, age,
      event_date, event_time, venue_name, venue_address, location_url, theme,
      experience, format, addons_json, briefing_json, pricing_json,
      subtotal_cents, urgency_enabled, urgency_percent, urgency_amount_cents,
      total_cents, deposit_percent, deposit_cents, balance_cents,
      terms_version, terms_accepted_at, portfolio_consent,
      status, photos_status, entry_status, mascot_status, speech_mode,
      speech_status, invitation_status, balance_status,
      production_started_at, production_deadline_at,
      created_at, updated_at, finalized_at
    )
    VALUES (
      'LIBRI-0998', ?, 'Cliente Histórica', '5561888888888',
      'Evento Histórico', 'Evento Histórico', 7,
      '2026-09-20', '18:00', 'Salão', 'Rua Antiga', '', 'Tema antigo',
      'full', 'interactive', '{}', '{"mustHave":"Histórico"}', '{}',
      10000, 0, 0, 0,
      10000, 50, 5000, 5000,
      '1.0', '2026-08-01T12:00:00.000Z', 1,
      'producing', 'approved', 'confirmed', 'approved', 'libri',
      'not_required', 'approved', 'waiting',
      '2026-08-03T12:00:00.000Z', '2026-08-10T12:00:00.000Z',
      '2026-08-01T12:00:00.000Z', '2026-10-06T01:00:00.000Z', '2026-08-01T12:00:00.000Z'
    )
  `).run(legacyToken);

  const migration14 = readFileSync('migrations/0014_v1_to_v2_retirement.sql', 'utf8');
  const migration15 = readFileSync('migrations/0015_fix_legacy_finalized_finance.sql', 'utf8');
  DB.sqlite.exec(migration14);

  const before = DB.sqlite.prepare(
    "SELECT status FROM v2_orders WHERE order_code='LIBRI-0998'"
  ).get();
  assert.equal(before.status, 'balance_pending');

  const beforePayment = DB.sqlite.prepare(`
    SELECT paid_at
    FROM v2_payments
    WHERE order_id=(SELECT id FROM v2_orders WHERE order_code='LIBRI-0998')
      AND payment_type='deposit'
  `).get();
  assert.equal(beforePayment.paid_at, '2026-10-06T01:00:00.000Z');

  DB.sqlite.exec(migration15);
  DB.sqlite.exec(migration15);

  const repaired = DB.sqlite.prepare(`
    SELECT status, next_action, finalized_at
    FROM v2_orders
    WHERE order_code='LIBRI-0998'
  `).get();
  assert.equal(repaired.status, 'finalized');
  assert.match(repaired.next_action, /Finalizado/);
  assert.ok(repaired.finalized_at);

  const repairedPayment = DB.sqlite.prepare(`
    SELECT paid_at
    FROM v2_payments
    WHERE order_id=(SELECT id FROM v2_orders WHERE order_code='LIBRI-0998')
      AND payment_type='deposit'
  `).get();
  assert.equal(repairedPayment.paid_at, '2026-08-01T12:00:00.000Z');

  assert.equal(DB.sqlite.prepare(`
    SELECT COUNT(*) AS n
    FROM v2_agenda_allocations
    WHERE order_id=(SELECT id FROM v2_orders WHERE order_code='LIBRI-0998')
  `).get().n, 0);

  const finance = await getV2FinanceDashboard(DB, { preset: 'this_month' });
  assert.equal(finance.summary.receivableCents, 0);
  assert.equal(finance.summary.openReceivableAllCents, 0);
  assert.equal(finance.receivables.some(item => item.orderCode === 'LIBRI-0998'), false);
  assert.equal(finance.movements.some(item => item.orderCode === 'LIBRI-0998'), false);
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
  assert.equal(mp.bodies[0].total_amount, '45.51');
  assert.equal(mp.bodies[0].capture_mode, undefined);
  assert.equal(mp.bodies[0].expiration_time, undefined);
  assert.equal(mp.bodies[0].description, undefined);
  assert.equal(mp.bodies[0].config.statement_descriptor, undefined);
  assert.equal(mp.bodies[0].config.online.auto_return, 'approved');
  assert.equal(mp.bodies[0].config.online.retries, undefined);
  assert.deepEqual(Object.keys(mp.bodies[0].items[0]).sort(),
    ['quantity', 'title', 'unit_price']);
  assert.equal(mp.bodies[0].payer.email, 'test@example.com');
  assert.equal(payment.payment.ready, true);
  const reused = await resumeV2Payment(request, e, token, await terms(DB)); assert.equal(reused.payment.checkoutUrl, payment.payment.checkoutUrl); assert.equal(mp.posts, 1);
  mp.approve(payment.payment.providerOrderId);
  await syncMercadoPagoOrder(e, payment.payment.providerOrderId);
  const area = await getV2CustomerArea(e, token); assert.equal(area.briefing.locked, false);
  assert.equal(area.payment.paidCents, 4551); assert.equal(area.payment.remainingCents, 4550);
  DB.sqlite.prepare("UPDATE v2_settings SET value='pix-teste' WHERE key='balance_pix_key'").run();
  DB.sqlite.prepare("UPDATE v2_settings SET value='Libri Teste' WHERE key='balance_pix_recipient_name'").run();
  DB.sqlite.prepare("UPDATE v2_orders SET status='balance_pending'").run();
  const balanceArea = await getV2CustomerArea(e, token);
  assert.deepEqual(balanceArea.payment.balancePix, { key: 'pix-teste', recipient: 'Libri Teste' });
  DB.sqlite.prepare("UPDATE v2_orders SET status = 'in_production', briefing_status = 'completed'").run();
  await syncMercadoPagoOrder(e, payment.payment.providerOrderId);
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_orders').get().status, 'in_production');
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_order_history WHERE action_code = 'payment_confirmed'").get().n, 1);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_agenda_allocations').get().n, 1);
  const units = DB.sqlite.prepare('SELECT points_units FROM v2_agenda_allocations').get().points_units;
  assert.equal(typeof units, 'number'); assert.equal(units, 100);
});

test('customer area reconciles an approved urgency payment without waiting for the scheduler', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const result = await urgency(DB); const token = result.order.publicToken;
  await decideV2Urgency(DB, result.order.code, {
    decision: 'approve', deliveryStart: day(0), deliveryEnd: day(1),
  });
  const payment = await resumeV2Payment(request, e, token, await terms(DB));
  mp.approve(payment.payment.providerOrderId);

  const area = await getV2CustomerArea(e, token);

  assert.equal(area.briefing.locked, false);
  assert.equal(area.order.status, 'briefing_pending');
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
  assert.equal(mp.bodies[0].config.payment_method.default_type, undefined);
  assert.equal(mp.bodies[0].config.payment_method.max_installments, 12);
  assert.equal(mp.bodies[0].config.payment_method.installments_cost, undefined);
  assert.equal(mp.bodies[0].config.payment_method.installments, undefined);
  assert.deepEqual(mp.bodies[0].config.payment_method.not_allowed_types,
    ['bank_transfer', 'debit_card', 'prepaid_card', 'ticket', 'account_money', 'digital_currency']);
  const pricing = DB.sqlite.prepare('SELECT total_cents, deposit_cents, balance_cents FROM v2_order_pricing').get();
  assert.equal(pricing.total_cents, pricing.deposit_cents); assert.equal(pricing.balance_cents, 0);
});

test('customer can switch an unpaid regular order from card to Pix without creating another order', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const body = input({
    event: { honoreeName: 'Troca método', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    selection: { productCode: 'interactive_essential', paymentMethod: 'card' },
    ...await terms(DB, 'card'),
  });

  const first = await startV2Checkout(request, e, body);
  assert.equal(first.payment.method, 'card');
  assert.equal(first.payment.amountDueNowCents, first.payment.totalCents);

  const switched = await resumeV2Payment(request, e, first.order.publicToken, {
    clientRequestId: crypto.randomUUID(),
    paymentMethod: 'pix',
  });

  assert.equal(switched.order.code, first.order.code);
  assert.equal(switched.payment.method, 'pix');
  assert.equal(switched.payment.amountDueNowCents, Math.round(switched.payment.totalCents * 0.5));
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n, 1);
  assert.equal(DB.sqlite.prepare('SELECT payment_method FROM v2_order_pricing').get().payment_method, 'pix');
  assert.equal(mp.posts, 2);
  assert.equal(mp.orders.get(first.payment.providerOrderId).status, 'cancelled');
});

test('admin can delete only unpaid pre-production orders and pending provider checkout is canceled', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const body = input({ event: { honoreeName: 'Teste apagar', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) }, ...await terms(DB) });
  const checkout = await startV2Checkout(request, e, body);
  const orderId = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code = ?').get(checkout.order.code).id;
  const providerOrderId = checkout.payment.providerOrderId;

  const deleted = await deleteUnpaidV2Order(e, checkout.order.code);
  assert.equal(deleted.deleted, true);
  assert.equal(mp.orders.get(providerOrderId).status, 'cancelled');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders WHERE id = ?').get(orderId).n, 0);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_checkout_holds WHERE order_id = ?').get(orderId).n, 0);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_checkout_requests WHERE order_id = ?').get(orderId).n, 0);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_customers').get().n, 0);

  const paidBody = input({ clientRequestId: crypto.randomUUID(),
    event: { honoreeName: 'Teste pago', type: 'birthday', date: day(60) },
    deliveryWindow: { start: day(20), end: day(22) }, ...await terms(DB) });
  const paid = await startV2Checkout(request, e, paidBody);
  mp.approve(paid.payment.providerOrderId);
  await syncMercadoPagoOrder(e, paid.payment.providerOrderId);
  await assert.rejects(deleteUnpaidV2Order(e, paid.order.code), /pagamento confirmado/i);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders WHERE order_code = ?').get(paid.order.code).n, 1);
});

test('V2 cancellation keeps the order record, releases capacity and cancels pending checkout', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const body = input({
    event: { honoreeName: 'Cancelamento', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  });
  const checkout = await startV2Checkout(request, e, body);
  const providerOrderId = checkout.payment.providerOrderId;
  const cancelled = await cancelV2Order(e, checkout.order.code, { reason: 'Cliente desistiu' });

  assert.equal(cancelled.cancelled, true);
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_orders WHERE order_code = ?').get(checkout.order.code).status, 'cancelled');
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_checkout_holds WHERE order_id = (SELECT id FROM v2_orders WHERE order_code = ?) ORDER BY id DESC LIMIT 1').get(checkout.order.code).status, 'cancelled');
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_payments WHERE provider_order_id = ?').get(providerOrderId).status, 'cancelled');
  assert.equal(mp.orders.get(providerOrderId).status, 'cancelled');
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_order_history WHERE action_code = 'order_cancelled'").get().n, 1);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders WHERE order_code = ?').get(checkout.order.code).n, 1);
});

test('Admin preview publication and revocation follow the production workflow', async t => {
  const DB = database(); providerMock(t);
  const e = env(DB);
  const body = input({
    event: { honoreeName: 'Prévia', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  });
  const checkout = await startV2Checkout(request, e, body);
  DB.sqlite.prepare("UPDATE v2_orders SET status='in_production', briefing_status='completed' WHERE order_code = ?")
    .run(checkout.order.code);

  const stored = [];
  e.FILES = {
    async put(key) { stored.push(key); },
    async delete() {},
  };

  const form = new FormData();
  form.append('file', new Blob(['preview'], { type: 'image/jpeg' }), 'preview.jpg');
  form.append('watermarkConfirmed', 'true');
  form.append('watermarkLabel', 'PRÉVIA • TESTE');

  const previewRequest = new Request(
    'https://pedidos.libriconvites.com.br/api/admin/v2/orders/' + checkout.order.code + '/previews',
    { method: 'POST', body: form },
  );
  const createdResponse = await createV2Preview(previewRequest, e, checkout.order.code);
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.preview.status, 'active');
  assert.equal(stored.length, 1);
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_orders WHERE order_code = ?').get(checkout.order.code).status, 'waiting_customer');

  const revokedResponse = await revokeV2Preview(e, created.preview.id);
  assert.equal(revokedResponse.status, 200);
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_previews WHERE id = ?').get(created.preview.id).status, 'revoked');
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_orders WHERE order_code = ?').get(checkout.order.code).status, 'in_production');
});

test('production search finds theme and exposes the planned card data', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const body = input({
    event: { honoreeName: 'Aurora', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  });
  const checkout = await startV2Checkout(request, e, body);
  mp.approve(checkout.payment.providerOrderId);
  await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);
  DB.sqlite.prepare("UPDATE v2_orders SET status='ready_for_production', briefing_status='completed' WHERE order_code = ?")
    .run(checkout.order.code);
  DB.sqlite.prepare("UPDATE v2_briefings SET data_json = ? WHERE order_id = (SELECT id FROM v2_orders WHERE order_code = ?)")
    .run(JSON.stringify({ theme_or_style: 'Jardim Encantado' }), checkout.order.code);

  const rows = await listV2Production(DB, { q: 'Jardim Encantado', when: 'new' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].honoreeName, 'Aurora');
  assert.equal(rows[0].theme, 'Jardim Encantado');
  assert.ok(rows[0].productName);
  assert.ok(rows[0].paidCents > 0);
});

test('finance does not pretend Mercado Pago fees are zero before reconciliation', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Financeiro', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  }));
  mp.approve(checkout.payment.providerOrderId);
  await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);

  const finance = await getV2FinanceDashboard(DB, { preset: 'this_month' });
  assert.equal(finance.summary.mercadoPagoFeesComplete, false);
  assert.equal(finance.summary.mercadoPagoFeePendingCount, 1);
  assert.equal(finance.summary.netCashMovementComplete, false);
  assert.equal(finance.movements[0].feeKnown, false);
  assert.equal(finance.movements[0].netKnown, false);
  assert.equal(finance.movements[0].netCents, null);
});

test('approved Mercado Pago payment reconciles real fee and net amount from Payments API', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Taxa real', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  }));

  mp.setFinanceDetails(checkout.payment.providerOrderId, {
    feeCents: 237,
  });
  mp.approve(checkout.payment.providerOrderId);

  const synced = await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);
  assert.equal(synced.financeReconciled, true);

  const payment = DB.sqlite.prepare(
    'SELECT amount_cents, fee_cents, net_cents FROM v2_payments WHERE provider_order_id = ?'
  ).get(checkout.payment.providerOrderId);

  assert.equal(payment.fee_cents, 237);
  assert.equal(payment.net_cents, payment.amount_cents - 237);

  const finance = await getV2FinanceDashboard(DB, { preset: 'this_month' });
  assert.equal(finance.summary.mercadoPagoFeesComplete, true);
  assert.equal(finance.summary.mercadoPagoFeeCents, 237);
  assert.equal(finance.summary.netCashMovementComplete, true);
  assert.equal(finance.movements[0].feeKnown, true);
  assert.equal(finance.movements[0].feeCents, 237);
  assert.equal(finance.movements[0].netKnown, true);
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

test('unpaid abandoned orders do not count as sales and are removed after checkout expiry', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const body = input({ event: { honoreeName: 'Abandonado', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) }, ...await terms(DB) });
  const checkout = await startV2Checkout(request, e, body);

  const centralBefore = await getV2Central(DB);
  assert.equal(centralBefore.finance.salesCents, 0);
  assert.equal(centralBefore.finance.receivableCents, 0);

  DB.sqlite.prepare("UPDATE v2_orders SET updated_at = '2000-01-01T00:00:00.000Z' WHERE order_code = ?")
    .run(checkout.order.code);
  DB.sqlite.prepare("UPDATE v2_checkout_holds SET expires_at = '2000-01-01T00:00:00.000Z' WHERE order_id = (SELECT id FROM v2_orders WHERE order_code = ?)")
    .run(checkout.order.code);

  const result = await runV2Scheduler(e);
  assert.equal(result.abandonedOrders.deleted, 1);
  assert.equal(mp.orders.get(checkout.payment.providerOrderId).status, 'cancelled');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders WHERE order_code = ?').get(checkout.order.code).n, 0);
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

test('public catalog exposes official combo composition', async () => {
  const DB = database();
  const catalog = await loadV2Catalog(DB);
  assert.equal(catalog.combos.length, 5);
  const complete = catalog.combos.find(item => item.code === 'libri_completo');
  assert.equal(complete.discountValue, 0);
  assert.equal(complete.discountType, 'percent');
  assert.deepEqual(
    complete.items.map(item => item.itemCode).sort(),
    ['confirmation', 'moments', 'reminder', 'save_the_date'],
  );
});

test('official combos are seeded with the approved compositions and configurable zero discount', () => {
  const DB = database();
  const rows = DB.sqlite.prepare(`
    SELECT c.code, c.name, c.discount_value, i.item_type, i.item_code
    FROM v2_combos c
    LEFT JOIN v2_combo_items i ON i.combo_id = c.id
    ORDER BY c.code, i.item_code
  `).all();

  const byCode = rows.reduce((acc, row) => {
    (acc[row.code] ||= []).push(row);
    return acc;
  }, {});
  assert.deepEqual(byCode.convite_save.map(row => row.item_code), ['save_the_date']);
  assert.deepEqual(byCode.antes_festa.map(row => row.item_code), ['reminder', 'save_the_date']);
  assert.deepEqual(byCode.organizacao.map(row => row.item_code), ['confirmation', 'reminder']);
  assert.deepEqual(byCode.festa_completa.map(row => row.item_code), ['confirmation', 'moments']);
  assert.deepEqual(byCode.libri_completo.map(row => row.item_code), ['confirmation', 'moments', 'reminder', 'save_the_date']);
  assert.ok(rows.every(row => row.discount_value === 0));
});

test('combo is suggested only after its real addons are selected and never injects items', async () => {
  const DB = database();

  DB.sqlite.prepare(`
    UPDATE v2_combos
    SET discount_type = 'fixed',
        discount_value = 700
    WHERE code = 'antes_festa'
  `).run();

  const selection = {
    productCode: 'interactive_essential',
    paymentMethod: 'pix',
    addonCodes: [
      'save_animated',
      'reminder_static',
    ],
  };

  const suggested =
    await calculateCommercialV2Quote(
      DB,
      selection,
    );

  assert.equal(suggested.combo, null);
  assert.equal(
    suggested.suggestedCombo.code,
    'antes_festa',
  );
  assert.equal(
    suggested.suggestedCombo.discountCents,
    700,
  );
  assert.deepEqual(
    suggested.addons.map(
      (item) => item.code,
    ).sort(),
    [
      'reminder_static',
      'save_animated',
    ],
  );

  const applied =
    await calculateCommercialV2Quote(
      DB,
      {
        ...selection,
        comboCode:
          'antes_festa',
      },
    );

  assert.equal(
    applied.combo.code,
    'antes_festa',
  );
  assert.equal(
    applied.suggestedCombo,
    null,
  );
  assert.deepEqual(
    applied.addons.map(
      (item) => item.code,
    ).sort(),
    [
      'reminder_static',
      'save_animated',
    ],
  );

  const removed =
    await calculateCommercialV2Quote(
      DB,
      selection,
    );

  assert.deepEqual(
    removed.addons.map(
      (item) => item.code,
    ).sort(),
    [
      'reminder_static',
      'save_animated',
    ],
  );

  const missingRequirement =
    await calculateCommercialV2Quote(
      DB,
      {
        ...selection,
        addonCodes: [
          'save_animated',
        ],
      },
    );

  assert.equal(
    missingRequirement.suggestedCombo,
    null,
  );
});

test('most complete eligible configured combo is the single public suggestion', async () => {
  const DB = database();

  DB.sqlite.exec(`
    UPDATE v2_combos
    SET discount_type = 'fixed',
        discount_value = CASE code
          WHEN 'convite_save' THEN 100
          WHEN 'antes_festa' THEN 200
          WHEN 'organizacao' THEN 200
          WHEN 'festa_completa' THEN 300
          WHEN 'libri_completo' THEN 400
          ELSE 0
        END;
  `);

  const quote =
    await calculateCommercialV2Quote(
      DB,
      {
        productCode:
          'interactive_essential',
        paymentMethod:
          'pix',
        addonCodes: [
          'save_static',
          'reminder_animated',
          'confirmation_libri',
          'moments_premium',
        ],
      },
    );

  assert.equal(
    quote.suggestedCombo.code,
    'libri_completo',
  );

  assert.equal(
    quote.suggestedCombo.discountCents,
    400,
  );
});

test('public store does not expose a fixed combo chooser or auto-add combo items', () => {
  const source =
    readFileSync(
      'public/js/client-v2-store.js',
      'utf8',
    );

  assert.equal(
    source.includes(
      '<strong>Sem combo</strong>',
    ),
    false,
  );

  assert.equal(
    source.includes(
      'ensureComboSelections',
    ),
    false,
  );

  assert.match(
    source,
    /Suas escolhas formam o combo/,
  );

  assert.match(
    source,
    /Continuar sem adicionais/,
  );

  assert.match(
    source,
    /recommendedShortScenes/,
  );

  assert.match(
    source,
    /recommendedCompleteScenes/,
  );
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

test('delivery windows are capacity-driven instead of fixed to 3 or 4 days', async () => {
  const DB = database();

  for (let offset = 1; offset <= 8; offset += 1) {
    await setV2AgendaDay(DB, day(offset), {
      sellableCapacityUnits: 100,
      internalBufferUnits: 100,
      blocked: offset === 3,
    });
  }

  const delivery = await findV2DeliveryOptions(DB, {
    eventDate: day(60),
    pointsUnits: 500,
    limit: 6,
  });

  assert.ok(delivery.options.length > 0);
  assert.ok(delivery.options.some(option => {
    const start = new Date(option.start + 'T12:00:00Z');
    const end = new Date(option.end + 'T12:00:00Z');
    return Math.round((end - start) / 86400000) + 1 > 4;
  }));

  await assert.doesNotReject(validateV2DeliveryWindow(DB, {
    eventDate: day(60),
    start: delivery.options[0].start,
    end: delivery.options[0].end,
  }));
});
test('agenda separates party date from delivery deadline and exposes customer identity', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const eventDate = day(40);
  const deliveryStart = day(5);
  const deliveryEnd = day(7);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Festa Calendário', type: 'birthday', date: eventDate },
    deliveryWindow: { start: deliveryStart, end: deliveryEnd },
    ...await terms(DB),
  }));
  mp.approve(checkout.payment.providerOrderId);
  await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);

  const partyAgenda = await getV2AgendaRange(DB, { start: eventDate, end: eventDate });
  assert.equal(partyAgenda.days.length, 1);
  assert.equal(partyAgenda.days[0].events.length, 1);
  assert.equal(partyAgenda.days[0].events[0].code, checkout.order.code);
  assert.equal(partyAgenda.days[0].events[0].honoreeName, 'Festa Calendário');
  assert.equal(partyAgenda.days[0].events[0].customerName, 'Cliente Teste');
  assert.deepEqual(partyAgenda.days[0].events[0].deliveryWindow, {
    start: deliveryStart,
    end: deliveryEnd,
  });

  const deliveryAgenda = await getV2AgendaRange(DB, { start: deliveryEnd, end: deliveryEnd });
  assert.equal(deliveryAgenda.days.length, 1);
  assert.equal(deliveryAgenda.days[0].events.length, 0);
  assert.equal(deliveryAgenda.days[0].deliveries.length, 1);
  assert.equal(deliveryAgenda.days[0].deliveries[0].code, checkout.order.code);
  assert.equal(deliveryAgenda.days[0].deliveries[0].customerName, 'Cliente Teste');
  assert.equal(deliveryAgenda.days[0].deliveries[0].deliveryWindow.end, deliveryEnd);
});

test('restored agenda day/period and cascade suggestions run against actual schema', async () => {
  const DB = database();
  const edited = await setV2AgendaDay(DB, day(3), { sellableCapacityUnits: 200, internalBufferUnits: 100 });
  assert.equal(edited.sellableCapacityUnits, 200);
  assert.equal((await getV2AgendaRange(DB, { start: day(3), end: day(4) })).days.length, 2);
  assert.deepEqual(await getV2CascadeSuggestions(DB), { suggestions: [], releaseable: [] });
  const a = await urgency(DB); const b = await requestV2UrgencyReview(request, env(DB), input());
  const rows = DB.sqlite.prepare('SELECT id,order_code FROM v2_orders ORDER BY id').all();
  DB.sqlite.prepare("UPDATE v2_orders SET status='finalized' WHERE id=?").run(rows[0].id);
  DB.sqlite.prepare("UPDATE v2_orders SET status='ready_for_production',briefing_status='completed' WHERE id=?").run(rows[1].id);
  DB.sqlite.prepare("INSERT INTO v2_payments(order_id,provider,payment_type,method,status,amount_cents) VALUES (?,'direct_pix','deposit','pix','approved',1000)").run(rows[1].id);
  for (const [i,d] of [[0,3],[1,5]]) DB.sqlite.prepare('INSERT INTO v2_agenda_allocations(order_id,day,points_units) VALUES (?,?,100)').run(rows[i].id,day(d));
  assert.equal((await getV2CascadeSuggestions(DB)).suggestions.length, 1);
  assert.equal((await anticipateV2Production(DB, { sourceOrderCode: a.order.code, targetOrderCode: b.order.code })).movedUnits, 100);
  const afterAnticipation = await getV2CascadeSuggestions(DB);
  assert.equal(afterAnticipation.suggestions.length, 0);
  assert.equal(afterAnticipation.releaseable.length, 1);
  assert.equal(afterAnticipation.releaseable[0].sourceOrderCode, a.order.code);
  assert.equal((await releaseV2CascadeSurplus(DB, { sourceOrderCode: a.order.code })).releasedUnits, 100);
});

test('normal delivery availability prevents urgency request', async () => {
  const DB = database();
  await assert.rejects(requestV2UrgencyReview(request, env(DB), input({ event: { honoreeName: 'Teste', date: day(50) } })), error => error.code === 'regular_delivery_available');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n, 0);
});

test('explicit provider rejection releases old attempt and retries with a fresh idempotency key', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const body = input({ event: { honoreeName: 'Teste', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) }, ...await terms(DB) });

  mp.rejectNext();

  const first = await startV2Checkout(request, e, body);
  assert.equal(first.payment.ready, false);
  assert.equal(DB.sqlite.prepare("SELECT status FROM v2_checkout_holds ORDER BY id DESC LIMIT 1").get().status, 'cancelled');

  const resumed = await resumeV2Payment(request, e, first.order.publicToken, {
    clientRequestId: crypto.randomUUID(),
  });

  assert.equal(resumed.payment.ready, true);
  assert.equal(mp.keysUsed.length, 2);
  assert.notEqual(mp.keysUsed[0], mp.keysUsed[1]);
  assert.equal(DB.sqlite.prepare("SELECT status FROM v2_checkout_holds ORDER BY id DESC LIMIT 1").get().status, 'active');
});

test('uncertain provider response is recovered with same idempotency key and no duplicate charge', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const a = await urgency(DB);
  await decideV2Urgency(DB, a.order.code, { decision: 'approve', deliveryStart: day(0), deliveryEnd: day(1) });
  const first = await resumeV2Payment(request, e, a.order.publicToken, await terms(DB));
  const order = DB.sqlite.prepare('SELECT id, order_code FROM v2_orders').get();
  await createMercadoPagoCheckout(request, e, { orderId: order.id, orderCode: order.order_code,
    publicToken: a.order.publicToken, paymentMethod: 'pix', amountDueNowCents: first.payment.amountDueNowCents,
    customerEmail: 'test@example.com' });
  assert.equal(mp.posts, 1); assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments').get().n, 1);
  DB.sqlite.prepare('DELETE FROM v2_payments').run();
  const recovered = await resumeV2Payment(request, e, a.order.publicToken, await terms(DB));
  assert.equal(recovered.payment.providerOrderId, first.payment.providerOrderId); assert.equal(mp.posts, 1);
});

test('approved payment rebuilds a missing temporary hold and unlocks briefing when capacity still fits', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Reserva perdida', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  }));

  const orderId = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code = ?').get(checkout.order.code).id;
  DB.sqlite.prepare('DELETE FROM v2_checkout_holds WHERE order_id = ?').run(orderId);

  mp.approve(checkout.payment.providerOrderId);
  const result = await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);

  assert.equal(result.approved, true);
  assert.equal(result.capacityReview, undefined);
  assert.equal(DB.sqlite.prepare('SELECT briefing_status FROM v2_orders WHERE id = ?').get(orderId).briefing_status, 'available');
  assert.ok(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_agenda_allocations WHERE order_id = ?').get(orderId).n > 0);
});

test('scheduler repairs a paid order left locked after the temporary hold disappeared', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Reparo automático', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  }));

  const orderId = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code = ?').get(checkout.order.code).id;
  DB.sqlite.prepare('DELETE FROM v2_checkout_holds WHERE order_id = ?').run(orderId);
  mp.approve(checkout.payment.providerOrderId);
  DB.sqlite.prepare("UPDATE v2_payments SET status='approved' WHERE provider_order_id = ?")
    .run(checkout.payment.providerOrderId);

  await runV2Scheduler(e);

  assert.equal(DB.sqlite.prepare('SELECT briefing_status FROM v2_orders WHERE id = ?').get(orderId).briefing_status, 'available');
  assert.ok(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_agenda_allocations WHERE order_id = ?').get(orderId).n > 0);
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
  const reviewArea = await getV2CustomerArea(e, a.order.publicToken);
  assert.equal(reviewArea.payment.capacityReview, true);
  assert.ok(reviewArea.payment.paidCents > 0);
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

test('Worker serves only V2 runtime, redirects legacy pages and retires V1 APIs', async () => {
  const DB = database(); const e = env(DB); delete e.MERCADO_PAGO_ACCESS_TOKEN;
  const served = []; e.ASSETS = { async fetch(r) { served.push(new URL(r.url).pathname); return new Response('shell'); } };
  const ctx = { waitUntil(p) { this.pending = p; } };

  assert.equal((await worker.fetch(new Request('https://example.com/api/v2/catalog'), e, ctx)).status, 200);
  for (const path of ['/api/catalog', '/api/orders', '/api/admin/orders']) {
    assert.equal((await worker.fetch(new Request(`https://example.com${path}`), e, ctx)).status, 410);
  }

  const unauth = await worker.fetch(new Request('https://example.com/api/admin/v2/orders/LIBRI-1001/urgency', { method: 'POST' }), e, ctx);
  assert.equal(unauth.status, 401);

  for (const path of ['/pedido', '/admin-v2', '/meu-pedido/ord_' + 'a'.repeat(36)]) {
    assert.equal((await worker.fetch(new Request(`https://example.com${path}`), e, ctx)).status, 200);
  }

  const root = await worker.fetch(new Request('https://example.com/'), e, ctx);
  const admin = await worker.fetch(new Request('https://example.com/admin'), e, ctx);
  assert.equal(root.status, 308);
  assert.equal(root.headers.get('location'), 'https://example.com/pedido');
  assert.equal(admin.status, 308);
  assert.equal(admin.headers.get('location'), 'https://example.com/admin-v2');
  assert.deepEqual(served, ['/client-v2.html', '/admin-v2.html', '/client-v2.html']);

  await worker.scheduled({}, e, ctx); await ctx.pending;
});
