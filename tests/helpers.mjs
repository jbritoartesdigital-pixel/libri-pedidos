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
  const orders = new Map(); const keys = new Map(); const bodies = []; let posts = 0;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (!String(url).startsWith('https://api.mercadopago.com/v1/orders')) throw new Error(`Unexpected network call ${url}`);
    if (options.method === 'POST' && String(url).endsWith('/cancel')) {
      const id = String(url).split('/').at(-2); orders.get(id).status = 'cancelled'; orders.get(id).status_detail = 'cancelled';
      return Response.json(orders.get(id));
    }
    if (options.method === 'POST') {
      const key = options.headers['x-idempotency-key'];
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
  return { orders, keys, bodies, get posts() { return posts; },
    approve(id) { Object.assign(orders.get(id), { status: 'processed', status_detail: 'accredited' }); } };
}
