// Mapa local de navegação. Não consulta clientes nem executa operações de escrita.
export const ADMIN_FEATURES = Object.freeze([
  { title: 'Buscar pedido', section: 'Pedidos', view: 'orders', detail: 'Nome, WhatsApp, código, situação e filtros' },
  { title: 'Novos pedidos e prioridades', section: 'Pedidos', view: 'central', detail: 'Fila do dia e pedidos que precisam de atenção' },
  { title: 'Cadastrar pedido manual', section: 'Pedidos', view: 'manual', detail: 'Criar pedido com condições de pagamento da Central' },
  { title: 'Pedidos arquivados', section: 'Pedidos', view: 'archived', detail: 'Consultar ou reabrir histórico' },
  { title: 'Produção dos convites', section: 'Produção', view: 'production', service:'convites', detail: 'Fila de convites digitais e próximos passos' },
  { title: 'Produção do Ateliê', section: 'Produção', view: 'production', service:'atelie', keywords:'identidade visual brasao criacao arte revisão aprovação', detail: 'Briefings pagos, direção de arte, revisões e entrega das identidades visuais' },
  { title: 'Produção de retrospectivas', section: 'Produção', view: 'production', service:'retrospectivas', detail: 'Fila de produção, revisão e entrega de retrospectivas' },
  { title: 'Agenda e bloqueios', section: 'Produção', view: 'agenda', detail: 'Datas, capacidade e disponibilidade' },
  { title: 'Pagamentos e saldos', section: 'Financeiro', view: 'finance', detail: 'Recebimentos, saldos Pix e movimentações' },
  { title: 'Complementos e upgrades', section: 'Financeiro', view: 'finance', tab:'supplements', detail: 'Recebimentos de adicionais e novos serviços' },
  { title: 'Devoluções e estornos', section: 'Financeiro', view: 'finance', tab:'refunds', detail: 'Devoluções confirmadas e cobranças em conferência' },
  { title: 'Alterar pedido, cenas ou adicionais', section:'Pedidos', view:'orders', detail:'Encontre a ficha e abra Alterar contratação ou complemento' },
  { title: 'Enviar prévia e entrega', section:'Produção', view:'production', detail:'Abra a ficha do serviço e acesse Produção e entrega' },
  { title: 'Registrar Pix recebido', section: 'Financeiro', view: 'orders', detail: 'Encontre o pedido e abra o detalhe para registrar' },
  { title: 'Meta e faturamento', section: 'Financeiro', view: 'finance', detail: 'Indicadores financeiros e vendas' },
  { title: 'Produtos e preços', section: 'Loja', view: 'store', tab: 'products', detail: 'Catálogo, variações por cenas e valores' },
  { title: 'Libri Ateliê', section: 'Loja', view: 'store', tab: 'atelie', keywords: 'identidade visual essencia encanto universo brasao monograma estampas', detail: 'Pacotes, entregáveis, preços, revisões, capacidade e ativação comercial individual.' },
  { title: 'Pacotes de retrospectiva', section: 'Loja', view: 'store', tab:'retrospectives', detail: 'Valores, fotos, vídeos, pontos e situação dos pacotes próprios' },
  { title: 'Adicionais', section: 'Loja', view: 'store', tab: 'addons', detail: 'Itens opcionais de cada produto' },
  { title: 'Combos', section: 'Loja', view: 'store', tab: 'combos', detail: 'Pacotes e ofertas combinadas' },
  { title: 'Cupons', section: 'Loja', view: 'store', tab: 'coupons', keywords: 'cupom desconto promoção', detail: 'Criar e administrar descontos promocionais' },
  { title: 'Campanhas combinadas', section: 'Loja', view: 'store', tab: 'campaigns', detail: 'Programar desconto temporário de dois ou três serviços' },
  { title: 'Balão Premiado Black Libri', section: 'Loja', view: 'store', tab: 'black-libri', keywords: 'black friday baloes premio estoque probabilidade desconto brinde', detail: 'Prêmios e configuração da promoção Black Libri' },
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

export function initAdminFeatureFinder(onNavigate,{lookup,openOrder}={}) {
  const trigger = document.getElementById('findAdminFeature');
  const root = document.getElementById('featureFinder');
  if (!trigger || !root) return { close() {} };
  root.innerHTML = `
    <div class="feature-finder-header">
      <div>
        <strong>O que você precisa fazer?</strong>
        <small>Encontre um pedido, uma cliente ou qualquer função.</small>
      </div>
      <button type="button" class="btn btn-ghost btn-small" id="featureFinderClose" aria-label="Fechar busca de funções">Fechar</button>
    </div>
    <label for="featureFinderQuery" class="feature-finder-label">Busca universal</label>
    <input class="input" id="featureFinderQuery" type="search"
      placeholder="Nome, LIBRI-..., WhatsApp, cupom, Pix..." autocomplete="off" maxlength="100">
    <div id="universalOrderResults" class="universal-orders" aria-live="polite"></div>
    <div class="feature-finder-results" id="featureFinderResults" aria-live="polite"></div>
  `;
  const input = root.querySelector('#featureFinderQuery');
  const results = root.querySelector('#featureFinderResults');
  const orderResults=root.querySelector('#universalOrderResults'),pins=document.getElementById('adminPinned');
  const keyOf=item=>item.view+'|'+(item.tab||'')+'|'+(item.service||'')+'|'+item.title;
  const key='libriAdminPinnedV1';let pinned=[];try{const stored=JSON.parse(localStorage.getItem(key)||'null');if(Array.isArray(stored))pinned=stored.filter(k=>ADMIN_FEATURES.some(x=>keyOf(x)===k)).slice(0,5);}catch{}
  const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function renderPins(){if(!pins)return;pins.innerHTML='<span class="pinned-label">Meus atalhos</span>'+pinned.map(k=>{const item=ADMIN_FEATURES.find(x=>keyOf(x)===k);return '<button type="button" class="pinned-chip" data-pin-open="'+ADMIN_FEATURES.indexOf(item)+'">'+escape(item.title)+'</button>';}).join('')+'<button type="button" class="pinned-add" id="managePinned" aria-label="Personalizar atalhos">+ Personalizar</button>';pins.querySelector('#managePinned').onclick=open;pins.querySelectorAll('[data-pin-open]').forEach(b=>b.onclick=()=>{const x=ADMIN_FEATURES[Number(b.dataset.pinOpen)];onNavigate(x.view,x.tab,x.service);});}
  let seq=0,timer;
  function renderOrders(){const q=input.value.trim(),id=++seq;clearTimeout(timer);orderResults.innerHTML='';if(!lookup||q.length<2)return;orderResults.textContent='Buscando pedidos…';timer=setTimeout(async()=>{try{const rows=await lookup(q);if(id!==seq||root.classList.contains('hidden'))return;orderResults.innerHTML=rows.length?'<h3>Pedidos encontrados</h3>'+rows.map(x=>'<button type="button" class="feature-result" data-universal-order="'+escape(x.code)+'"><span><strong>'+escape(x.honoreeName)+' · '+escape(x.code)+'</strong><small>'+escape(x.customerName)+'</small></span><span class="feature-result-section">Abrir</span></button>').join(''):'<small>Nenhum pedido encontrado.</small>';}catch{if(id===seq&&!root.classList.contains('hidden'))orderResults.textContent='Não foi possível consultar pedidos. Tente novamente.';}},300);}
  function render() {
    const matches = searchAdminFeatures(input.value);
    if (!matches.length) {
      results.innerHTML = '<p class="muted feature-finder-empty">Nenhuma função encontrada. Tente outro termo.</p>';
      return;
    }
    results.innerHTML = matches.map((item) => {
      const position = ADMIN_FEATURES.indexOf(item);
      const selected=pinned.includes(keyOf(item));return `<div class="feature-result-wrap"><button type="button" class="feature-result" data-feature-index="${position}">
        <span><strong>${item.title}</strong><small>${item.detail}</small></span>
        <span class="feature-result-section">${item.section}</span>
      </button><button type="button" class="feature-pin" data-pin-index="${position}" aria-pressed="${selected}" aria-label="${selected?'Remover':'Fixar'} ${escape(item.title)}" title="${selected?'Remover atalho':'Fixar atalho'}">${selected?'★':'☆'}</button></div>`;
    }).join('');
  }
  function close({ focus = false } = {}) {
    ++seq;clearTimeout(timer);orderResults.innerHTML='';input.value='';root.classList.add('hidden');
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
  input.addEventListener('input',()=>{render();renderOrders();});renderPins();
  root.addEventListener('click', async (event) => {
    const pin=event.target.closest('[data-pin-index]');if(pin){const item=ADMIN_FEATURES[Number(pin.dataset.pinIndex)];if(!item)return;const k=keyOf(item);if(pinned.includes(k))pinned=pinned.filter(x=>x!==k);else if(pinned.length<5)pinned.push(k);else{orderResults.textContent='Você pode fixar até cinco funções. Remova uma para adicionar outra.';return;}try{localStorage.setItem(key,JSON.stringify(pinned));}catch{}render();renderPins();return;}
    const result=event.target.closest('[data-universal-order]');if(result&&openOrder){const code=result.dataset.universalOrder;close();try{await openOrder(code);}catch(e){orderResults.textContent=String(e.message);root.classList.remove('hidden');trigger.setAttribute('aria-expanded','true');}return;}
    const button = event.target.closest('[data-feature-index]');
    if (!button || !root.contains(button)) return;
    const item = ADMIN_FEATURES[Number(button.dataset.featureIndex)];
    if (!item) return;
    close();
    await onNavigate(item.view, item.tab, item.service);
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
    if (!root.contains(event.target) && !trigger.contains(event.target) && !pins?.contains(event.target)) close();
  });
  return { close };
}
