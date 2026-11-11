import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers.mjs';
import { handleAuthorizedLibriMcp } from '../src/lib/v2-assistant-mcp.js';
import { loadV2Catalog } from '../src/lib/v2-catalog.js';

const ORIGIN = 'https://pedidos.libriconvites.com.br';
const PRINCIPAL = Object.freeze({
  verified: true, subject: 'owner-passkey', scopes: ['libri:read'],
});
function post(method, params = {}, id = 1, headers = {}) {
  return new Request(ORIGIN + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
}
async function dispatch(DB, req, principal = PRINCIPAL) {
  return handleAuthorizedLibriMcp(req, { DB }, principal);
}

test('MCP blocks missing identity, insufficient scope and unexpected methods before database access', async () => {
  const DB = database();
  const read = post('tools/list');
  let response = await dispatch(DB, read, null);
  assert.equal(response.status, 401);
  assert.match(response.headers.get('www-authenticate'), /resource_metadata/);
  response = await dispatch(DB, post('tools/list'), {
    verified: true, subject: 'other', scopes: ['other:read'],
  });
  assert.equal(response.status, 403);
  response = await dispatch(DB, post('tools/list'), {
    verified: false, subject: 'attacker', scopes: ['libri:read'],
  });
  assert.equal(response.status, 401);
  response = await dispatch(DB, new Request(ORIGIN + '/mcp'), PRINCIPAL);
  assert.equal(response.status, 405);
});

test('MCP initializes, exposes exactly three OAuth read-only tools and accepts notifications', async () => {
  const DB = database();
  const initialized = await dispatch(DB, post('initialize', {
    protocolVersion: '2025-11-25', capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  }));
  const body = await initialized.json();
  assert.equal(body.result.protocolVersion, '2025-11-25');
  const tools = await (await dispatch(DB, post('tools/list'))).json();
  assert.deepEqual(tools.result.tools.map(x => x.name), [
    'listar_pedidos', 'consultar_pedido', 'gerar_link_por_cenas',
  ]);
  for (const tool of tools.result.tools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: ['libri:read'] }]);
  }
  const response = await dispatch(DB, new Request(ORIGIN + '/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  }));
  assert.equal(response.status, 202);
});

test('MCP invokes catalog through D1 and rejects invalid input without writes', async () => {
  const DB = database();
  const catalog = await loadV2Catalog(DB);
  const product = catalog.products.find(x => x.pricingMode === 'scene_count'
    && x.variants.some(v => Number(v.sceneCount) === 3));
  assert.ok(product);
  const before = DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n;
  const response = await dispatch(DB, post('tools/call', {
    name: 'gerar_link_por_cenas',
    arguments: { productCode: product.code, sceneCount: 3 },
  }));
  const result = (await response.json()).result.structuredContent;
  assert.equal(new URL(result.url).searchParams.get('cenas'), '3');
  assert.equal(result.sceneCount, 3);
  assert.equal(before, DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n);

  const bad = await (await dispatch(DB, post('tools/call', {
    name: 'gerar_link_por_cenas', arguments: {
      productCode: product.code, sceneCount: 3, publicToken: 'private',
    },
  }))).json();
  assert.equal(bad.error.code, -32602);
  const unknown = await (await dispatch(DB, post('tools/call', {
    name: 'registrar_pagamento', arguments: {},
  }))).json();
  assert.equal(unknown.error.code, -32602);
});

test('MCP caps requests and handles invalid JSON safely', async () => {
  const DB = database();
  const response = await dispatch(DB, new Request(ORIGIN + '/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: '{',
  }));
  assert.equal(response.status, 400);
  const huge = await dispatch(DB, new Request(ORIGIN + '/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1,
      params: { payload: 'X'.repeat(20000) } }),
  }));
  assert.equal(huge.status, 413);
});
