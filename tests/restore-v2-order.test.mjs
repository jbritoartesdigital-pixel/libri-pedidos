import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('targeted D1 recovery builds runnable single-order SQL without retaining capacity holds', t => {
  const dir = mkdtempSync(join(tmpdir(), 'libri-recovery-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fixturePath = join(dir, 'snapshot.sql');
  const sqlPath = join(dir, 'restore.sql');
  const remoteOrderCheck = join(dir, 'orders.json');
  const remoteCustomerCheck = join(dir, 'customers.json');
  const snapshot = `
    PRAGMA foreign_keys = ON;
    CREATE TABLE v2_customers (id INTEGER PRIMARY KEY, name TEXT, whatsapp TEXT, email TEXT);
    CREATE TABLE v2_orders (id INTEGER PRIMARY KEY, order_code TEXT UNIQUE, public_token TEXT UNIQUE,
      customer_id INTEGER REFERENCES v2_customers(id), status TEXT, briefing_status TEXT,
      archived_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE v2_payments (id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES v2_orders(id),
      status TEXT);
    CREATE TABLE v2_order_items (id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES v2_orders(id) ON DELETE CASCADE,
      item_code TEXT, name_snapshot TEXT);
    CREATE TABLE v2_order_pricing (order_id INTEGER PRIMARY KEY REFERENCES v2_orders(id) ON DELETE CASCADE, total_cents INTEGER);
    CREATE TABLE v2_briefings (order_id INTEGER PRIMARY KEY REFERENCES v2_orders(id) ON DELETE CASCADE, data_json TEXT);
    CREATE TABLE v2_order_terms_acceptances (id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES v2_orders(id) ON DELETE CASCADE, terms_version TEXT);
    CREATE TABLE v2_checkout_holds (id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES v2_orders(id) ON DELETE CASCADE,
      token TEXT UNIQUE, status TEXT, updated_at TEXT, expires_at TEXT);
    CREATE TABLE v2_order_history (id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES v2_orders(id) ON DELETE CASCADE,
      action_code TEXT, description TEXT, metadata_json TEXT, created_at TEXT);
    CREATE TABLE v2_checkout_requests (request_key TEXT PRIMARY KEY, order_id INTEGER REFERENCES v2_orders(id) ON DELETE SET NULL);
    INSERT INTO v2_customers VALUES (67,'Cliente Teste','5511999999999','test@example.com');
    INSERT INTO v2_orders VALUES (74,'LIBRI-1011','ord_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      67,'awaiting_payment','locked',NULL,'2026-10-07T23:10:00Z','2026-10-07T23:10:00Z');
    INSERT INTO v2_order_items VALUES (1,74,'essential','Convite Interativo');
    INSERT INTO v2_order_items VALUES (2,74,'addon','Adicional');
    INSERT INTO v2_order_pricing VALUES (74,15900);
    INSERT INTO v2_briefings VALUES (74,'{}');
    INSERT INTO v2_order_terms_acceptances VALUES (1,74,'2.0');
    INSERT INTO v2_checkout_holds VALUES (1,74,'historic-hold','cancelled','2026-10-07T23:10:00Z','2026-10-07T23:40:00Z');
    INSERT INTO v2_order_history VALUES (1,74,'checkout_created','Solicitação iniciada','{}','2026-10-07T23:10:00Z');
  `;
  writeFileSync(fixturePath, snapshot);
  writeFileSync(remoteOrderCheck, '[{"results":[]}]');
  writeFileSync(remoteCustomerCheck, '[{"results":[{"id":67,"whatsapp":"5511999999999"}]}]');
  const out = execFileSync(process.execPath,
    ['scripts/restore-v2-order.mjs', fixturePath, 'LIBRI-1011', sqlPath, remoteOrderCheck, remoteCustomerCheck],
    { encoding: 'utf8' });
  assert.match(out, /offline recovery and capacity checks passed/);
  const recoveredSql = readFileSync(sqlPath, 'utf8');
  assert.ok(!recoveredSql.includes('INSERT INTO "v2_payments"'));
  const db = new DatabaseSync(':memory:');
  db.exec(snapshot);
  db.prepare('DELETE FROM v2_orders WHERE id = ?').run(74);
  db.prepare('DELETE FROM v2_customers WHERE id = ?').run(67);
  db.exec(recoveredSql);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM v2_order_items WHERE order_id=74').get().n, 2);
  assert.equal(db.prepare("SELECT status FROM v2_checkout_holds WHERE order_id=74").get().status, 'cancelled');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM v2_order_history WHERE order_id=74 AND action_code='order_unarchived'").get().n, 1);

  writeFileSync(remoteOrderCheck, '[{"results":[{"id":74,"order_code":"OTHER-ORDER"}]}]');
  const blocked = spawnSync(process.execPath,
    ['scripts/restore-v2-order.mjs', fixturePath, 'LIBRI-1011', join(dir, 'blocked.sql'), remoteOrderCheck, remoteCustomerCheck],
    { encoding: 'utf8' });
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /No changes made/);
});
