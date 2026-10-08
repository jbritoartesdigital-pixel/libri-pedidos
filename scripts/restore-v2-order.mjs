// One-off targeted recovery from an authenticated D1 backup.
// Never commit customer records or restore an entire production database.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';

function rows(db, table, where, value) {
  return db.prepare(`SELECT * FROM "${table}" WHERE ${where} = ?`).all(value);
}
function sqlValue(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid numeric field');
    return String(value);
  }
  if (typeof value === 'string') return "'" + value.replaceAll("'", "''") + "'";
  if (value instanceof Uint8Array) return "X'" + Buffer.from(value).toString('hex') + "'";
  throw new Error('Unexpected backup field type');
}
function insertSql(table, record, omit = []) {
  const columns = Object.keys(record).filter(key => !omit.includes(key));
  return `INSERT INTO "${table}" (${columns.map(key => '"'+key+'"').join(', ')})
    VALUES (${columns.map(key => sqlValue(record[key])).join(', ')});`;
}
function getResultRows(jsonPath) {
  const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const groups = Array.isArray(data) ? data : [data];
  return groups.flatMap(part => part?.results || []);
}
function assertSameOrderContents(db, id, expectedItems) {
  const check = db.prepare('SELECT id, public_token FROM v2_orders WHERE id = ?').get(id);
  if (!check) throw new Error('Local restoration failed to recover order');
  const count = db.prepare('SELECT COUNT(*) AS n FROM v2_order_items WHERE order_id = ?').get(id).n;
  if (count !== expectedItems) throw new Error('Local restoration did not recover every order item');
}

const [snapshotPath, orderCode, sqlPath, orderCheck, customerCheck] = process.argv.slice(2);
if (!snapshotPath || !orderCode || !sqlPath) {
  throw new Error('Usage: node scripts/restore-v2-order.mjs backup.sql ORDER_CODE output.sql [order-check.json customer-check.json]');
}
const snapshot = readFileSync(snapshotPath, 'utf8');
const db = new DatabaseSync(':memory:');
db.exec(snapshot);
const order = db.prepare('SELECT * FROM v2_orders WHERE order_code = ?').get(orderCode);
if (!order || order.status !== 'awaiting_payment' || order.briefing_status !== 'locked') {
  throw new Error('Order not found in expected unpaid state in backup');
}
const customer = db.prepare('SELECT * FROM v2_customers WHERE id = ?').get(order.customer_id);
if (!customer) throw new Error('Customer missing from backup');
const payments = rows(db, 'v2_payments', 'order_id', order.id);
if (payments.length) throw new Error('Refusing restoration of order containing provider payments');
if (orderCheck && customerCheck) {
  const remoteOrders = getResultRows(orderCheck);
  if (remoteOrders.length) throw new Error('Production already contains matching order code or occupied historical id. No changes made.');
  const currentCustomers = getResultRows(customerCheck);
  if (currentCustomers.some(existing => existing.whatsapp !== customer.whatsapp)) {
    throw new Error('Customer id belongs to a different customer in production. No changes made.');
  }
}
const items = rows(db, 'v2_order_items', 'order_id', order.id);
const prices = rows(db, 'v2_order_pricing', 'order_id', order.id);
const briefings = rows(db, 'v2_briefings', 'order_id', order.id);
const terms = rows(db, 'v2_order_terms_acceptances', 'order_id', order.id);
const history = rows(db, 'v2_order_history', 'order_id', order.id);
const holds = rows(db, 'v2_checkout_holds', 'order_id', order.id);
if (!items.length || prices.length !== 1 || briefings.length !== 1 || !holds.length) {
  throw new Error('Backup missing essential customer-order relations');
}
const now = new Date().toISOString();
const sql = [
  '-- Targeted recovery of a single unpaid V2 order. No provider charges are recreated.',
  '-- The production snapshot and id-collision checks must pass before applying.',
  insertSql('v2_customers', customer).replace('INSERT INTO ', 'INSERT OR IGNORE INTO '),
  insertSql('v2_orders', { ...order, archived_at: null, updated_at: now }),
  ...items.map(row => insertSql('v2_order_items', row, ['id'])),
  ...prices.map(row => insertSql('v2_order_pricing', row)),
  ...briefings.map(row => insertSql('v2_briefings', row)),
  ...terms.map(row => insertSql('v2_order_terms_acceptances', row, ['id'])),
  // One historical inactive hold signals an attempted checkout; no capacity is reserved.
  insertSql('v2_checkout_holds', { ...holds[0], status: 'cancelled', updated_at: now }, ['id']),
  ...history.map(row => insertSql('v2_order_history', row, ['id'])),
  insertSql('v2_order_history', {
    order_id: order.id,
    action_code: 'order_unarchived',
    description: 'Pedido reativado a partir de backup do D1 para nova tentativa de pagamento.',
    metadata_json: '{}',
    created_at: now,
  }),
].join('\n');

// Validate the precise SQL against a local clone after simulating old cascade-deletion.
const trial = new DatabaseSync(':memory:');
trial.exec(snapshot);
trial.exec('PRAGMA foreign_keys = ON;');
trial.prepare('DELETE FROM v2_checkout_requests WHERE order_id = ?').run(order.id);
trial.prepare('DELETE FROM v2_checkout_holds WHERE order_id = ?').run(order.id);
trial.prepare('DELETE FROM v2_orders WHERE id = ?').run(order.id);
trial.prepare('DELETE FROM v2_customers WHERE id = ? AND NOT EXISTS (SELECT 1 FROM v2_orders WHERE customer_id = ?)').run(customer.id, customer.id);
trial.exec(sql);
assertSameOrderContents(trial, order.id, items.length);
const recovered = trial.prepare('SELECT archived_at FROM v2_orders WHERE id = ?').get(order.id);
if (recovered.archived_at != null) throw new Error('Recovered order remains archived');
const activeHold = trial.prepare("SELECT COUNT(*) AS n FROM v2_checkout_holds WHERE order_id = ? AND status = 'active'").get(order.id);
if (activeHold.n) throw new Error('Recovery must never block agenda capacity');
writeFileSync(sqlPath, sql, { mode: 0o600 });
console.log('Single unpaid order SQL generated; offline recovery and capacity checks passed.');
