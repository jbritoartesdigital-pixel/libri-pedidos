// Diagnóstico local do Admin V2. Não registra mensagens, respostas, dados de pedidos ou URLs completas.
const STORAGE_KEY = 'libri-admin-diagnostic-v1';
const MAX_EVENTS = 8;
const eventLog = [];
const VIEWS = new Set([
  'central', 'manual', 'production', 'agenda', 'finance',
  'archived', 'store', 'notifications', 'security',
]);
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const TYPES = new Set(['HTTP', 'NETWORK', 'JS', 'PROMISE']);
const ERROR_NAMES = new Set([
  'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError',
  'URIError', 'EvalError', 'AggregateError',
]);
// Apenas nomes fixos de rotas. Identificadores de pedidos, datas, nomes e valores viram :id.
const ROUTE_PARTS = new Set([
  'auth', 'registration', 'authentication', 'options', 'verify',
  'logout', 'session', 'central', 'orders', 'manual', 'action',
  'actions', 'preview', 'approve', 'approval', 'uploads', 'content',
  'production', 'agenda', 'day', 'period', 'finance', 'payments',
  'archived', 'archive', 'customers', 'lookup', 'notifications',
  'push', 'config', 'store-config', 'settings', 'products', 'addons',
  'gallery', 'security', 'passkeys', 'contracts', 'pdf', 'zip',
  'quote', 'dashboard', 'search', 'stats', 'files', 'download',
  'finalize', 'finalized', 'checklist', 'history', 'summary',
  'urgency', 'delivery', 'cancel', 'complete', 'ready',
  'availability', 'status', 'retention', 'purge', 'simulate',
  'v2', 'admin', 'api', 'permissions', 'terms', 'analytics',
]);

export function safeAdminRoute(input) {
  try {
    const url = new URL(String(input), 'https://diagnostico.invalid');
    if (!url.pathname.startsWith('/api/admin/v2/')) return '(fora do Admin V2)';
    const parts = url.pathname.split('/').filter(Boolean).slice(3, 9);
    return '/api/admin/v2/' + parts
      .map(part => ROUTE_PARTS.has(part) ? part : ':id').join('/');
  } catch {
    return '(rota indisponível)';
  }
}

function safeErrorId(value) {
  const id = String(value || '');
  return /^ERR-[A-F0-9]{12}$/.test(id) ? id : '';
}

function safeErrorName(value) {
  const name = String(value || '');
  return ERROR_NAMES.has(name) ? name : 'Erro JavaScript';
}

function sanitizeEvent(event) {
  if (!TYPES.has(event?.type)) return null;
  const time = typeof event.time === 'string' && !Number.isNaN(Date.parse(event.time))
    ? new Date(event.time).toISOString()
    : new Date().toISOString();
  if (event.type === 'HTTP' || event.type === 'NETWORK') {
    const status = Number(event.status);
    return {
      time,
      type: event.type,
      route: safeAdminRoute(event.route),
      method: METHODS.has(event.method) ? event.method : 'GET',
      status: event.type === 'NETWORK' ? 0
        : Number.isInteger(status) && status >= 400 && status <= 599 ? status : 0,
      errorId: safeErrorId(event.errorId),
    };
  }
  return { time, type: event.type, name: safeErrorName(event.name) };
}

function persist() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(eventLog));
  } catch {
    // Navegação privada ou armazenamento bloqueado: ainda funciona nesta aba.
  }
}

export function recordAdminDiagnostic(event) {
  const safe = sanitizeEvent(event);
  if (!safe) return;
  eventLog.push(safe);
  if (eventLog.length > MAX_EVENTS) eventLog.splice(0, eventLog.length - MAX_EVENTS);
  persist();
}

export function browserPlatform(userAgent = '') {
  const ua = String(userAgent);
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iPhone/iPad';
  if (/windows/i.test(ua)) return 'Windows';
  if (/macintosh|mac os/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Não identificado';
}

export function buildAdminDiagnostic({
  view = 'central', build = '', platform = '', width = 0, height = 0, time,
} = {}) {
  const safeView = VIEWS.has(view) ? view : 'não identificada';
  const safeBuild = /^[a-zA-Z0-9_-]{1,70}$/.test(build) ? build : 'não identificada';
  const safePlatform = ['Android', 'iPhone/iPad', 'Windows', 'macOS', 'Linux']
    .includes(platform) ? platform : 'Não identificado';
  const viewport = Number.isInteger(width) && Number.isInteger(height)
    && width > 0 && width <= 10000 && height > 0 && height <= 10000
    ? width + ' x ' + height : 'não identificado';
  const isoTime = time && !Number.isNaN(Date.parse(time))
    ? new Date(time).toISOString() : new Date().toISOString();

  const lines = [
    'LIBRI PEDIDOS | DIAGNÓSTICO DO ADMIN',
    'Gerado em: ' + isoTime,
    'Versão da interface: ' + safeBuild + ' (não é o SHA do deploy)',
    'Tela: ' + safeView,
    'Dispositivo: ' + safePlatform,
    'Área visível: ' + viewport,
    '',
    'ÚLTIMAS FALHAS NESTA ABA:',
  ];
  if (!eventLog.length) lines.push('Nenhuma falha registrada desde a abertura desta aba.');
  for (const item of eventLog) {
    if (item.type === 'HTTP' || item.type === 'NETWORK') {
      lines.push(item.time + ' | ' + item.type + ' | ' + item.method
        + ' ' + item.route + ' | HTTP ' + (item.status || 'sem resposta')
        + (item.errorId ? ' | ' + item.errorId : ''));
    } else {
      lines.push(item.time + ' | ' + item.type + ' | ' + item.name);
    }
  }
  lines.push('', 'Sem nomes, fotos, links de pedidos, CPF, respostas da API, senhas ou tokens.');
  lines.push('Gerado localmente. Nada é transmitido automaticamente.');
  return lines.join('\n');
}

function loadStoredEvents() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(stored)) {
      for (const item of stored.slice(-MAX_EVENTS)) {
        const safe = sanitizeEvent(item);
        if (safe) eventLog.push(safe);
      }
    }
  } catch {
    // Histórico opcional; problemas de armazenamento não afetam o painel.
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback para browsers que bloqueiam clipboard mesmo sob HTTPS.
    }
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.style.position = 'fixed';
  field.style.left = '-9999px';
  document.body.appendChild(field);
  field.focus();
  field.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    // O usuário ainda poderá copiar o relatório manualmente.
  }
  field.remove();
  return copied;
}

function makeDiagnosticDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'libri-diagnostic-dialog';
  dialog.setAttribute('aria-labelledby', 'libriDiagnosticTitle');
  dialog.innerHTML = `
    <header class="libri-diagnostic-head">
      <div>
        <h2 id="libriDiagnosticTitle">🐞 Diagnóstico</h2>
        <p>Informações técnicas desta aba, sem dados das clientes.</p>
      </div>
      <button id="libriDiagnosticClose" class="libri-diagnostic-dismiss"
        type="button" aria-label="Fechar diagnóstico">×</button>
    </header>
    <div class="libri-diagnostic-body">
      <textarea id="libriDiagnosticReport" readonly spellcheck="false"
        aria-label="Relatório técnico para consultar ou copiar"></textarea>
      <p id="libriDiagnosticFeedback" role="status" aria-live="polite"></p>
    </div>
    <footer class="libri-diagnostic-actions">
      <button id="libriDiagnosticCopy" type="button" class="btn btn-secondary">
        Copiar relatório
      </button>
      <button id="libriDiagnosticCloseFooter" type="button" class="btn btn-ghost">
        Fechar
      </button>
    </footer>
  `;
  document.body.appendChild(dialog);
  return dialog;
}

export function initAdminDiagnostics({ onCopied = () => {} } = {}) {
  loadStoredEvents();
  window.addEventListener('error', event => {
    recordAdminDiagnostic({ type: 'JS', name: event.error?.name });
  });
  window.addEventListener('unhandledrejection', event => {
    recordAdminDiagnostic({ type: 'PROMISE', name: event.reason?.name });
  });

  const button = document.getElementById('showAdminDiagnostic');
  if (!button) return;
  let dialog = null;

  button.addEventListener('click', () => {
    if (!dialog) {
      dialog = makeDiagnosticDialog();
      const close = () => dialog.close();
      dialog.querySelector('#libriDiagnosticClose').addEventListener('click', close);
      dialog.querySelector('#libriDiagnosticCloseFooter').addEventListener('click', close);
      dialog.addEventListener('click', event => {
        if (event.target === dialog) dialog.close();
      });
      dialog.addEventListener('close', () => button.focus());
      dialog.querySelector('#libriDiagnosticCopy').addEventListener('click', async () => {
        const report = dialog.querySelector('#libriDiagnosticReport');
        const feedback = dialog.querySelector('#libriDiagnosticFeedback');
        if (await copyText(report.value)) {
          feedback.textContent = 'Copiado! Envie aqui na conversa.';
          onCopied();
        } else {
          feedback.textContent = 'Selecione o texto e copie manualmente.';
          report.focus();
          report.select();
        }
      });
    }

    const script = document.querySelector('script[src*="/js/admin-v2.js"]');
    const build = script
      ? new URL(script.src, location.origin).searchParams.get('v') || ''
      : '';
    const view = document.querySelector('.nav-btn.active')?.dataset.view || '';
    dialog.querySelector('#libriDiagnosticReport').value = buildAdminDiagnostic({
      view,
      build,
      platform: browserPlatform(navigator.userAgent),
      width: window.innerWidth,
      height: window.innerHeight,
    });
    dialog.querySelector('#libriDiagnosticFeedback').textContent = '';
    dialog.showModal();
  });
}
