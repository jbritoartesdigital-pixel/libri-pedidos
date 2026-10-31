// Mapa local de navegação. Não consulta clientes nem executa operações de escrita.
export const ADMIN_FEATURES = Object.freeze([
  { title: 'Buscar pedido', section: 'Pedidos', view: 'central', detail: 'Nome, WhatsApp, código, situação e filtros' },
  { title: 'Novos pedidos e prioridades', section: 'Pedidos', view: 'central', detail: 'Fila do dia e pedidos que precisam de atenção' },
  { title: 'Cadastrar pedido manual', section: 'Pedidos', view: 'manual', detail: 'Criar pedido com condições de pagamento da Central' },
  { title: 'Pedidos arquivados', section: 'Pedidos', view: 'archived', detail: 'Consultar ou reabrir histórico' },
  { title: 'Produção dos convites', section: 'Produção', view: 'production', detail: 'Pedidos em produção e próximos passos' },
  { title: 'Agenda e bloqueios', section: 'Produção', view: 'agenda', detail: 'Datas, capacidade e disponibilidade' },
  { title: 'Pagamentos e saldos', section: 'Financeiro', view: 'finance', detail: 'Recebimentos, saldos Pix e movimentações' },
  { title: 'Registrar Pix recebido', section: 'Financeiro', view: 'central', detail: 'Encontre o pedido e abra o detalhe para registrar' },
  { title: 'Meta e faturamento', section: 'Financeiro', view: 'finance', detail: 'Indicadores financeiros e vendas' },
  { title: 'Produtos e preços', section: 'Loja', view: 'store', tab: 'products', detail: 'Catálogo, variações por cenas e valores' },
  { title: 'Adicionais', section: 'Loja', view: 'store', tab: 'addons', detail: 'Itens opcionais de cada produto' },
  { title: 'Combos', section: 'Loja', view: 'store', tab: 'combos', detail: 'Pacotes e ofertas combinadas' },
  { title: 'Cupons', section: 'Loja', view: 'store', tab: 'coupons', keywords: 'cupom desconto promoção', detail: 'Criar e administrar descontos promocionais' },
  { title: 'Configurações da loja', section: 'Loja', view: 'store', tab: 'settings', detail: 'Dados, pagamento, mensagens, metas e experiência' },
  { title: 'Termos de contratação', section: 'Loja', view: 'store', tab: 'terms', detail: 'Versões dos termos' },
  { title: 'Modelos de contrato', section: 'Loja', view: 'store', tab: 'contracts', detail: 'Texto padrão do contrato' },
  { title: 'Galeria de exemplos', section: 'Loja', view: 'store', tab: 'gallery', detail: 'Imagens e vídeos de vitrine' },
  { title: 'Notificações', section: 'Sistema', view: 'notifications', detail: 'Avisos e lembretes do painel' },
  { title: 'Segurança', section: 'Sistema', view: 'security', detail: 'Acessos e proteção da Central' },
]);

export function normalizeFeatureSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
export function searchAdminFeatures(term) {
  const q = normalizeFeatureSearch(term);
  return ADMIN_FEATURES.filter(item => !q || normalizeFeatureSearch(
    item.title + ' ' + item.section + ' ' + item.detail + ' ' + (item.keywords || '')
  ).includes(q));
}

export function initAdminFeatureFinder(onNavigate) {
  const trigger = document.getElementById('findAdminFeature');
  const root = document.getElementById('featureFinder');
  if (!trigger || !root) return { close() {} };
  root.innerHTML = `
    <div class="feature-finder-header">
      <div>
        <strong>O que você precisa fazer?</strong>
        <small>Encontre a função sem navegar por vários menus.</small>
      </div>
      <button type="button" class="btn btn-ghost btn-small" id="featureFinderClose" aria-label="Fechar busca de funções">Fechar</button>
    </div>
    <label for="featureFinderQuery" class="feature-finder-label">Buscar função</label>
    <input class="input" id="featureFinderQuery" type="search"
      placeholder="Ex.: cupom, Pix, cenas, contrato..." autocomplete="off" maxlength="100">
    <div class="feature-finder-results" id="featureFinderResults" aria-live="polite"></div>
  `;
  const input = root.querySelector('#featureFinderQuery');
  const results = root.querySelector('#featureFinderResults');
  function render() {
    const matches = searchAdminFeatures(input.value);
    if (!matches.length) {
      results.innerHTML = '<p class="muted feature-finder-empty">Nenhuma função encontrada. Tente outro termo.</p>';
      return;
    }
    results.innerHTML = matches.map((item) => {
      const position = ADMIN_FEATURES.indexOf(item);
      return `<button type="button" class="feature-result" data-feature-index="${position}">
        <span><strong>${item.title}</strong><small>${item.detail}</small></span>
        <span class="feature-result-section">${item.section}</span>
      </button>`;
    }).join('');
  }
  function close({ focus = false } = {}) {
    root.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
    if (focus) trigger.focus();
  }
  function open() {
    root.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
    input.value = '';
    render();
    input.focus();
  }
  trigger.addEventListener('click', () => root.classList.contains('hidden') ? open() : close({focus:true}));
  root.querySelector('#featureFinderClose').addEventListener('click', () => close({focus:true}));
  input.addEventListener('input', render);
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-feature-index]');
    if (!button || !root.contains(button)) return;
    const item = ADMIN_FEATURES[Number(button.dataset.featureIndex)];
    if (!item) return;
    close();
    await onNavigate(item.view, item.tab);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !root.classList.contains('hidden')) close({focus:true});
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (root.classList.contains('hidden')) open();
      else input.focus();
    }
  });
  document.addEventListener('pointerdown', event => {
    if (root.classList.contains('hidden')) return;
    if (!root.contains(event.target) && !trigger.contains(event.target)) close();
  });
  return { close };
}
