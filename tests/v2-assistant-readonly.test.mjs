import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers.mjs';
import { loadV2Catalog } from '../src/lib/v2-catalog.js';
import {
  getLibriAssistantOrder,
  getLibriAssistantSceneLink,
  listLibriAssistantOrders,
} from '../src/lib/v2-assistant-readonly.js';

function exampleOrder(DB) {
  const customer = DB.sqlite.prepare(
    "INSERT INTO v2_customers(name, whatsapp, email) VALUES (?, ?, ?)"
  ).run('Cliente Privada', '5561999999999', 'privado@example.com').lastInsertRowid;

  const order = DB.sqlite.prepare(
    'INSERT INTO v2_orders(order_code, public_token, customer_id, event_type, '
    + 'honoree_display_name, event_date, status, delivery_start, delivery_end) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('LIBRI-9000', 'ord_test_private', Number(customer), 'birthday',
    'Bianca Teste', '2026-11-15', 'in_production', '2026-10-30', '2026-10-31'
  ).lastInsertRowid;

  DB.sqlite.prepare(
    'INSERT INTO v2_order_pricing(order_id, total_cents, payment_method) VALUES (?, ?, ?)'
  ).run(Number(order), 15000, 'pix');

  DB.sqlite.prepare(
    'INSERT INTO v2_order_items(order_id, item_type, item_code, '
    + 'name_snapshot, configuration_json, unit_price_cents) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(Number(order), 'product', 'cinematic_video_3', 'Cinematográfico • 3 cenas',
    JSON.stringify({ sceneCount: 3 }), 15000);

  const pay = DB.sqlite.prepare(
    'INSERT INTO v2_payments(order_id, provider, payment_type, '
    + 'method, status, amount_cents) VALUES (?, ?, ?, ?, ?, ?)'
  );
  pay.run(Number(order), 'direct_pix', 'deposit', 'pix', 'approved', 10000);
  pay.run(Number(order), 'direct_pix', 'refund', 'pix', 'approved', 2000);
  pay.run(Number(order), 'mercado_pago', 'balance', 'pix', 'pending', 5000);
}

test('assistant read-only search returns only whitelisted fields and net approved payment balance', async () => {
  const DB = database();
  exampleOrder(DB);
  const before = DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments').get().n;
  const result = await listLibriAssistantOrders(DB, {
    query: 'Bianca', deliveryFrom: '2026-10-30', deliveryTo: '2026-10-30',
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].code, 'LIBRI-9000');
  assert.equal(result[0].totalCents, 15000);
  assert.equal(result[0].paidCents, 8000);
  assert.equal(result[0].remainingBalanceCents, 7000);
  assert.equal(result[0].sceneCount, 3);
  const serialized = JSON.stringify(result);
  for (const secret of ['5561999999999', 'privado@example.com', 'ord_test_private']) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments').get().n, before);
  assert.equal((await listLibriAssistantOrders(DB, { query: '0000%' })).length, 0,
    'wildcard search is interpreted literally');
  assert.equal((await listLibriAssistantOrders(DB, { status: 'finalized' })).length, 0);
});

test('assistant order lookup rejects invalid IDs and never returns private tokens', async () => {
  const DB = database();
  exampleOrder(DB);
  const result = await getLibriAssistantOrder(DB, 'libri-9000');
  assert.equal(result.honoreeName, 'Bianca Teste');
  assert.equal(result.remainingBalanceCents, 7000);
  assert.equal('whatsapp' in result, false);
  assert.equal('publicToken' in result, false);
  assert.equal(await getLibriAssistantOrder(DB, 'LIBRI-9999'), null);
  await assert.rejects(getLibriAssistantOrder(DB, '../admin'), /inválido/);
  await assert.rejects(listLibriAssistantOrders(DB, { status: 'ANY;DELETE' }), /inválido/);
});

test('scene link reflects active catalogue variant and does not create an order', async () => {
  const DB = database();
  const catalog = await loadV2Catalog(DB);
  const product = catalog.products.find(x => x.pricingMode === 'scene_count'
    && x.variants.some(v => Number(v.sceneCount) === 3));
  assert.ok(product, 'seeded catalogue must contain an active 3-scene format');
  const count = () => DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n;
  const before = count();
  const link = await getLibriAssistantSceneLink(DB, product.code, 3);
  assert.equal(new URL(link.url).searchParams.get('cenas'), '3');
  assert.equal(new URL(link.url).origin, 'https://pedidos.libriconvites.com.br');
  assert.equal(link.priceCents, Number(product.variants.find(v => Number(v.sceneCount) === 3).priceCents));
  await assert.rejects(getLibriAssistantSceneLink(DB, product.code, 0), /inválida/);
  assert.equal(count(), before);
});
