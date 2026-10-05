import { nowIso } from './http.js';

// The existing checkout request table also serializes operations on one order.
export async function withV2PaymentLock(db, orderId, action) {
  const key = `order-payment:${orderId}`;
  const result = await db.prepare(`INSERT OR IGNORE INTO v2_checkout_requests
    (request_key, order_id, status, created_at, updated_at)
    VALUES (?, ?, 'processing', ?, ?)`).bind(key, orderId, nowIso(), nowIso()).run();
  if (Number(result.meta?.changes) !== 1) {
    const error = new Error('Este pedido está sendo atualizado. Aguarde e tente novamente.');
    error.status = 409;
    error.code = 'order_busy';
    throw error;
  }
  try { return await action(); }
  finally {
    await db.prepare('DELETE FROM v2_checkout_requests WHERE request_key = ?').bind(key).run();
  }
}
