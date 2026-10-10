import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  safeAdminRoute,
  recordAdminDiagnostic,
  buildAdminDiagnostic,
  browserPlatform,
} from '../public/js/admin-v2-diagnostics.js';

test('diagnóstico anonimiza identificadores, query strings e mensagens de erro', () => {
  const secret = 'clienteSensible-ord_123456789012345678901234567890123456';
  const route = '/api/admin/v2/orders/' + secret
    + '/uploads/42/content?token=SEGREDO&whatsapp=559999999999';
  assert.equal(safeAdminRoute(route),
    '/api/admin/v2/orders/:id/uploads/:id/content');
  recordAdminDiagnostic({
    type: 'HTTP', route, method: 'POST', status: 500,
    errorId: 'ERR-ABCDEF123456',
    message: 'CPF 12345678900: cartão recusado',
  });
  const report = buildAdminDiagnostic({
    view: 'finance', build: '20261009-diagnostics-1',
    platform: 'Android', width: 390, height: 844,
    time: '2026-10-09T12:00:00.000Z',
  });
  assert.match(report, /Versão da interface: 20261009-diagnostics-1/);
  assert.match(report, /Tela: finance/);
  assert.match(report, /Android/);
  assert.match(report, /HTTP 500 \| ERR-ABCDEF123456/);
  assert.match(report, /\/api\/admin\/v2\/orders\/:id\/uploads\/:id\/content/);
  assert.doesNotMatch(report, /clienteSensible|SEGREDO|whatsapp=|12345678900|cartão recusado/);
});

test('diagnóstico trata nomes e IDs inesperados sem revelar conteúdo', () => {
  recordAdminDiagnostic({
    type: 'PROMISE', name: 'NomeCliente: segredo',
    stack: 'https://exemplo.invalid/?token=SEGREDO',
  });
  recordAdminDiagnostic({
    type: 'HTTP',
    route: '/api/admin/v2/orders/999?cpf=00000000000',
    status: 422,
    errorId: 'ERR-CUSTOMER-SECRET',
  });
  const report = buildAdminDiagnostic({
    view: 'pedido-da-cliente', build: 'abc?secret=1', platform: 'user@example.com',
    width: 360, height: 720,
  });
  assert.match(report, /PROMISE \| Erro JavaScript/);
  assert.match(report, /Tela: não identificada/);
  assert.match(report, /Versão da interface: não identificada/);
  assert.doesNotMatch(report, /NomeCliente|SEGREDO|00000000000|CUSTOMER-SECRET|user@example.com/);
});

test('somente labels genéricas do sistema entram no diagnóstico', () => {
  assert.equal(safeAdminRoute('/api/v2/checkout/start?cpf=123'), '(fora do Admin V2)');
  assert.equal(safeAdminRoute('/api/admin/v2/store-config/settings?token=abc'),
    '/api/admin/v2/store-config/settings');
  assert.equal(browserPlatform('Mozilla/5.0 (Linux; Android 16)'), 'Android');
  assert.equal(browserPlatform('Mozilla/5.0 (iPhone)'), 'iPhone/iPad');
});

test('botão é somente administrativo e identifica exceções 500 sem stack no cliente', () => {
  const html = readFileSync('public/admin-v2.html', 'utf8');
  const admin = readFileSync('public/js/admin-v2.js', 'utf8');
  const core = readFileSync('public/js/admin-v2-core.js', 'utf8');
  const worker = readFileSync('src/index.js', 'utf8');
  assert.match(html, /id="showAdminDiagnostic"/);
  assert.match(admin, /initAdminDiagnostics/);
  assert.match(html, /aria-label="Ver diagnóstico técnico"/);
  const diagnosticUi = readFileSync('public/js/admin-v2-diagnostics.js', 'utf8');
  assert.match(diagnosticUi, /dialog\.showModal\(\)/);
  assert.match(diagnosticUi, /libriDiagnosticReport/);
  assert.match(diagnosticUi, /Copiar relatório/);
  assert.match(diagnosticUi, /libriDiagnosticCloseFooter/);
  assert.match(core, /recordAdminDiagnostic/);
  assert.match(worker, /x-libri-error-id/);
  assert.match(worker, /crypto\.randomUUID\(\)/);
});
