import {
  getLibriAssistantOrder,
  getLibriAssistantSceneLink,
  listLibriAssistantOrders,
} from './v2-assistant-readonly.js';

// JSON-only, stateless MCP 2025-11-25 transport core. NOT HTTP-routed here.
// The OAuth gateway must authenticate every request before calling this module.
// Never pass identity from request JSON or model-supplied tool arguments.
const PROTOCOL = '2025-11-25';
const MAX_REQUEST_BYTES = 16_384;
const AUTH_SCOPE = 'libri:read';
const MCP_RESOURCE_METADATA =
  'https://pedidos.libriconvites.com.br/.well-known/oauth-protected-resource';

const SCHEMAS = [
  {
    name: 'listar_pedidos',
    title: 'Listar pedidos Libri',
    description: 'Busca pedidos ativos da Libri por nome, código, status ou data prevista de início da entrega. Somente leitura; não retorna contatos ou links privados.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        query: { type: 'string', maxLength: 80, description: 'Nome da cliente, homenageado ou código.' },
        status: { type: 'string', maxLength: 50 },
        deliveryFrom: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        deliveryTo: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
      },
    },
  },
  {
    name: 'consultar_pedido',
    title: 'Consultar pedido Libri',
    description: 'Consulta produto, prazo, situação do briefing e saldo de um pedido pelo código LIBRI. Somente leitura e dados minimizados.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { orderCode: { type: 'string', pattern: '^LIBRI-\\d{1,12}$' } },
      required: ['orderCode'],
    },
  },
  {
    name: 'gerar_link_por_cenas',
    title: 'Gerar link por cenas',
    description: 'Retorna um link da loja para um produto por quantidade de cenas ativa. Não cria pedido, não altera preços e não realiza cobrança.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        productCode: { type: 'string', minLength: 2, maxLength: 80 },
        sceneCount: { type: 'integer', minimum: 1, maximum: 99 },
      },
      required: ['productCode', 'sceneCount'],
    },
  },
].map(tool => ({
  ...tool,
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  securitySchemes: [{ type: 'oauth2', scopes: [AUTH_SCOPE] }],
}));

const TOOLS = new Map(SCHEMAS.map(tool => [tool.name, tool]));

function asJson(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...headers },
  });
}
function rpc(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
function unauthorized() {
  return asJson({ error: 'authentication_required' }, 401, {
    'www-authenticate': `Bearer resource_metadata="${MCP_RESOURCE_METADATA}", scope="${AUTH_SCOPE}"`,
  });
}
function forbidden() {
  return asJson({ error: 'insufficient_scope' }, 403);
}
function invalidArguments(schema, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return true;
  const props = schema.inputSchema.properties;
  if (Object.keys(args).some(key => !(key in props))) return true;
  if ((schema.inputSchema.required || []).some(key => !(key in args))) return true;
  for (const [key, value] of Object.entries(args)) {
    const rule = props[key];
    if (rule.type === 'string') {
      if (typeof value !== 'string' || value.length > (rule.maxLength || 200)
        || value.length < (rule.minLength || 0)
        || (rule.pattern && !(new RegExp(rule.pattern).test(value)))) return true;
    } else if (rule.type === 'integer') {
      if (!Number.isInteger(value) || value < rule.minimum || value > rule.maximum) return true;
    } else return true;
  }
  return false;
}

async function handleRpc(message, db) {
  if (!message || Array.isArray(message) || typeof message !== 'object'
    || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcError(null, -32600, 'Requisição JSON-RPC inválida.');
  }
  const { id, method, params } = message;
  if (id !== undefined && id !== null && typeof id !== 'number' && typeof id !== 'string') {
    return rpcError(null, -32600, 'ID inválido.');
  }
  if (method === 'notifications/initialized') return null;
  if (id === undefined || id === null) return null;

  if (method === 'initialize') {
    return rpc(id, {
      protocolVersion: PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'libri-pedidos-privado', version: '0.1.0' },
      instructions: 'Ferramentas exclusivas do Libri Pedidos. Consultar informações de forma restrita, sem alterar pedidos, finanças ou dados de clientes. Valores monetários são informados em centavos.',
    });
  }
  if (method === 'ping') return rpc(id, {});
  if (method === 'tools/list') {
    if (params && (typeof params !== 'object' || Array.isArray(params)
      || Object.keys(params).some(key => key !== 'cursor'))) {
      return rpcError(id, -32602, 'Parâmetros inválidos.');
    }
    if (params?.cursor) return rpcError(id, -32602, 'Cursor inválido.');
    return rpc(id, { tools: SCHEMAS });
  }
  if (method !== 'tools/call') return rpcError(id, -32601, 'Método não encontrado.');
  if (!params || typeof params !== 'object' || Array.isArray(params)
    || typeof params.name !== 'string' ||
    Object.keys(params).some(k => k !== 'name' && k !== 'arguments')) {
    return rpcError(id, -32602, 'Chamada de ferramenta inválida.');
  }
  const tool = TOOLS.get(params.name);
  if (!tool) return rpcError(id, -32602, 'Ferramenta não encontrada.');
  const args = params.arguments || {};
  if (invalidArguments(tool, args)) return rpcError(id, -32602, 'Argumentos inválidos.');
  try {
    let data;
    if (tool.name === 'listar_pedidos') data = { orders: await listLibriAssistantOrders(db, args) };
    if (tool.name === 'consultar_pedido') data = { order: await getLibriAssistantOrder(db, args.orderCode) };
    if (tool.name === 'gerar_link_por_cenas') data = await getLibriAssistantSceneLink(
      db, args.productCode, args.sceneCount
    );
    return rpc(id, {
      structuredContent: data,
      content: [{ type: 'text', text: JSON.stringify(data) }],
    });
  } catch (error) {
    // Avoid leaking database or token details to MCP callers.
    const safeError = error instanceof Error
      && /^(Código de pedido inválido|Produto não disponível|Quantidade de cenas não está ativa|Produto ou quantidade de cenas inválida|Período de entrega inválido|Data inválida|Status inválido)/.test(error.message)
      ? error.message : 'Consulta indisponível no momento.';
    return rpc(id, {
      isError: true, content: [{ type: 'text', text: safeError }],
    });
  }
}

/**
 * Invoke ONLY after validated OAuth verification by the HTTP gateway.
 * identity is a trusted server-side principal, NEVER a field in the request.
 * This handler is not wired to any public URL by this PR.
 */
export async function handleAuthorizedLibriMcp(request, env, identity) {
  if (!identity || identity.verified !== true
    || typeof identity.subject !== 'string' || identity.subject.length < 1) {
    return unauthorized();
  }
  if (!Array.isArray(identity.scopes) || !identity.scopes.includes(AUTH_SCOPE)) {
    return forbidden();
  }
  if (request.method !== 'POST') {
    return new Response(null, {
      status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' },
    });
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return asJson(rpcError(null, -32700, 'Content-Type inválido.'), 415);
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_REQUEST_BYTES) {
    return asJson(rpcError(null, -32600, 'Requisição muito grande.'), 413);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_REQUEST_BYTES) {
    return asJson(rpcError(null, -32600, 'Requisição muito grande.'), 413);
  }
  let message;
  try { message = JSON.parse(raw); }
  catch { return asJson(rpcError(null, -32700, 'JSON inválido.'), 400); }
  if (Array.isArray(message)) {
    return asJson(rpcError(null, -32600, 'Lotes JSON-RPC não permitidos.'), 400);
  }
  const result = await handleRpc(message, env.DB);
  if (!result) return new Response(null, { status: 202, headers: { 'cache-control': 'no-store' } });
  return asJson(result);
}
