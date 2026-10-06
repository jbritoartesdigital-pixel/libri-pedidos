import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

export function database() {
  const sqlite = new DatabaseSync(':memory:');
  const migrations = readdirSync('migrations').filter(x => x.endsWith('.sql')).sort();
  for (const name of migrations) sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));
  function prepare(sql) {
    const stmt = sqlite.prepare(sql);
    let args = [];
    const query = {
      bind(...values) { args = values; return query; },
      async first(column) { const row = stmt.get(...args) || null; return column && row ? row[column] : row; },
      async all() { return { results: stmt.all(...args) }; },
      async run() { const r = stmt.run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      execute() { const r = stmt.run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    };
    return query;
  }
  return { sqlite, migrationCount: migrations.length, prepare,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = statements.map(x => x.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}

export function day(offset) {
  const date = new Date(); date.setUTCDate(date.getUTCDate() + offset);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function providerMock(t) {
  const orders = new Map(); const keys = new Map(); const bodies = [];
  const financeDetails = new Map();
  const rejectedKeys = new Set(); const keysUsed = []; let posts = 0; let rejectNextPost = false;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const href = String(url);

    if (href.startsWith('https://api.mercadopago.com/v1/payments/search')) {
      const parsed = new URL(href);
      const externalReference = parsed.searchParams.get('external_reference') || '';
      const results = [];

      for (const [providerOrderId, order] of orders) {
        const detail = financeDetails.get(providerOrderId);

        if (
          !detail
          || order.external_reference !== externalReference
          || order.status !== 'processed'
        ) {
          continue;
        }

        results.push({
          id: `PAYMENT-${providerOrderId}`,
          status: 'approved',
          status_detail: 'accredited',
          external_reference: order.external_reference,
          transaction_amount: Number(order.total_amount),
          date_approved: '2026-10-05T12:00:00.000Z',
        });
      }

      return Response.json({ results });
    }

    if (href.startsWith('https://api.mercadopago.com/v1/payments/')) {
      const paymentId = href.split('/').at(-1);
      const providerOrderId = paymentId.replace(/^PAYMENT-/, '');
      const order = orders.get(providerOrderId);
      const detail = financeDetails.get(providerOrderId);

      if (!order || !detail) {
        return Response.json({}, { status: 404 });
      }

      return Response.json({
        id: paymentId,
        status: 'approved',
        status_detail: 'accredited',
        external_reference: order.external_reference,
        transaction_amount: Number(order.total_amount),
        fee_details: detail.feeDetails,
        transaction_details: {
          net_received_amount: detail.netReceivedAmount,
        },
      });
    }

    if (!href.startsWith('https://api.mercadopago.com/v1/orders')) throw new Error(`Unexpected network call ${url}`);
    if (options.method === 'POST' && String(url).endsWith('/cancel')) {
      const id = String(url).split('/').at(-2); orders.get(id).status = 'cancelled'; orders.get(id).status_detail = 'cancelled';
      return Response.json(orders.get(id));
    }
    if (options.method === 'POST') {
      const key = options.headers['x-idempotency-key'];
      keysUsed.push(key);
      if (rejectedKeys.has(key)) {
        return Response.json({ message: 'X-Idempotency-Key already used.',
          errors: [{ code: 'idempotency_key_already_used' }] }, { status: 400 });
      }
      if (rejectNextPost) {
        rejectNextPost = false;
        rejectedKeys.add(key);
        return Response.json({ message: 'Properties not supported',
          errors: [{ code: 'unsupported_properties', property: 'config.online.retries' }] }, { status: 400 });
      }
      if (keys.has(key)) return Response.json(orders.get(keys.get(key)));
      posts++; const body = JSON.parse(options.body); bodies.push(body);
      const order = { id: `ORD${posts}`, status: 'created', status_detail: 'created',
        total_amount: body.total_amount, external_reference: body.external_reference,
        checkout_url: `https://www.mercadopago.com.br/checkout/v1/redirect?order=${posts}` };
      keys.set(key, order.id); orders.set(order.id, order); return Response.json(order, { status: 201 });
    }
    const id = String(url).split('/').at(-1);
    return orders.has(id) ? Response.json(orders.get(id)) : Response.json({}, { status: 404 });
  });
  return { orders, keys, bodies, keysUsed, get posts() { return posts; },
    rejectNext() { rejectNextPost = true; },
    setFinanceDetails(id, { feeCents = 0, netCents }) {
      const order = orders.get(id);
      if (!order) throw new Error('Order do mock não encontrada.');
      const grossCents = Math.round(Number(order.total_amount) * 100);
      const safeNetCents = Number.isInteger(netCents) ? netCents : grossCents - feeCents;
      financeDetails.set(id, {
        feeDetails: [{
          type: 'mercadopago_fee',
          fee_payer: 'collector',
          amount: (feeCents / 100).toFixed(2),
        }],
        netReceivedAmount: (safeNetCents / 100).toFixed(2),
      });
    },
    approve(id) { Object.assign(orders.get(id), { status: 'processed', status_detail: 'accredited' }); } };
}
