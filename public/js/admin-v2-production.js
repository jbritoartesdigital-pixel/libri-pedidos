import {
  api,
  dateBr,
  empty,
  esc,
  setViewMeta,
  statusClass,
  viewRoot,
} from './admin-v2-core.js';

const ATELIE_STAGES = [
  ['', 'Todas as etapas artísticas'],
  ['briefing', 'Briefing'],
  ['art_direction', 'Direção de arte'],
  ['creation', 'Criação'],
  ['revision', 'Revisão'],
  ['approval', 'Aprovação'],
  ['delivery', 'Entrega']
];
const ART_STAGE_LABELS = Object.fromEntries(ATELIE_STAGES);

const STATUS_OPTIONS = [
  ['', 'Todos'],
  ['ready_for_production', 'Prontos'],
  ['in_production', 'Em produção'],
  ['waiting_customer', 'Aguardando cliente'],
  ['adjustments', 'Ajustes'],
  ['approved', 'Aprovados'],
  ['balance_pending', 'Saldo pendente'],
  ['ready_for_delivery', 'Prontos para entrega'],
  ['finalized', 'Finalizados'],
];

export async function renderProduction(openOrder) {
  setViewMeta(
    'Produção',
    'Convites e identidades visuais',
  );

  viewRoot.innerHTML = `
    <div class="toolbar admin-v3-production-filters">
      <label class="admin-v3-filter">
        <span>Serviço</span>
        <select id="productionService" class="select" aria-label="Filtrar serviço">
          <option value="">Todos os serviços</option>
          <option value="convites">Convites Digitais</option>
          <option value="atelie">Identidade Visual · Ateliê</option>
        </select>
      </label>
      <label class="admin-v3-filter admin-v3-art-filter hidden" id="productionArtFilter">
        <span>Etapa artística</span>
        <select id="productionArtStage" class="select" aria-label="Filtrar etapa artística">
          ${ATELIE_STAGES.map(([value,label])=>`<option value="${esc(value)}">${esc(label)}</option>`).join('')}
        </select>
      </label>
      <input
        id="productionSearch"
        class="input"
        type="search"
        placeholder="Buscar pedido, cliente ou WhatsApp"
        style="max-width:360px"
      >

      <select
        id="productionStatus"
        class="select"
        style="max-width:240px"
      >
        ${STATUS_OPTIONS.map(
          ([value, label]) => `
            <option value="${esc(value)}">
              ${esc(label)}
            </option>
          `,
        ).join('')}
      </select>

      <select
        id="productionWhen"
        class="select"
        style="max-width:220px"
      >
        <option value="">Todas as datas</option>
        <option value="today">Hoje</option>
        <option value="week">Esta semana</option>
        <option value="new">Novos</option>
        <option value="in_production">Em produção</option>
      </select>
    </div>

    <p id="productionFinalizedHelp" class="muted hidden" style="font-size:12px;margin:0 0 8px">
      Exibindo pedidos finalizados. Os que já foram arquivados continuam na seção Arquivados.
    </p>
    <div id="productionList" class="order-list"></div>
  `;

  const list =
    document.getElementById(
      'productionList',
    );

  let timer;
  let requestSequence = 0;
  const serviceControl = document.getElementById('productionService');
  const stageControl = document.getElementById('productionArtStage');
  const initialService = new URLSearchParams(window.location.search).get('service');
  if(['atelie','convites'].includes(initialService)) serviceControl.value=initialService;
  const initialStage = new URLSearchParams(window.location.search).get('artStage');
  if(ATELIE_STAGES.some(([code])=>code===initialStage)) stageControl.value=initialStage;

  function syncService() {
    const art = serviceControl.value==='atelie';
    document.getElementById('productionArtFilter')?.classList.toggle('hidden',!art);
    if(!art)stageControl.value='';
    const url = new URL(window.location.href);
    if(serviceControl.value)url.searchParams.set('service',serviceControl.value);
    else url.searchParams.delete('service');
    if(art && stageControl.value)url.searchParams.set('artStage',stageControl.value);
    else url.searchParams.delete('artStage');
    history.replaceState({},'',url.pathname+url.search+url.hash);
  }
  syncService();

  const load = async () => {
    const currentRequest = ++requestSequence;
    const q =
      document
        .getElementById('productionSearch')
        .value
        .trim();

    const status =
      document
        .getElementById('productionStatus')
        .value;

    const when =
      document
        .getElementById('productionWhen')
        .value;

    document.getElementById('productionFinalizedHelp')?.classList.toggle(
      'hidden',
      status !== 'finalized',
    );
    list.innerHTML =
      empty('Carregando...');

    const params =
      new URLSearchParams();

    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (when) params.set('when', when);
    if (serviceControl.value)params.set('service',serviceControl.value);
    if (serviceControl.value==='atelie' && stageControl.value)
      params.set('artStage',stageControl.value);

    let data;
    try {
      data=await api(`/api/admin/v2/production?${params}`);
    } catch(e) {
      if(currentRequest===requestSequence)list.innerHTML=empty('Não foi possível consultar a fila. '+e.message);
      return;
    }
    if(currentRequest!==requestSequence)return;
    const orders=data.orders||[];

    list.innerHTML =
      orders.length
        ? orders.map(
          (order) => `
            <article class="order-card">
              <div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                  <span class="status ${statusClass(order.status)}">
                    ${esc(order.statusLabel)}
                  </span>
                  ${order.service==='atelie'
                    ? '<span class="admin-v3-type-tag">Identidade Visual</span>'
                    : '<span class="admin-v3-type-tag admin-v3-type-invite">Convite Digital</span>'}
                  ${order.service==='atelie'
                    ? '<span class="admin-v3-stage-tag">'+esc(ART_STAGE_LABELS[order.artStage]||'Briefing')+'</span>'
                    : ''}

                  ${
                    order.risk
                      ? `
                        <span class="risk-badge risk-${esc(order.risk.level)}">
                          Prazo: ${esc(order.risk.label)}
                        </span>
                      `
                      : ''
                  }
                </div>

                ${
                  order.risk?.reason
                    ? `<small class="risk-reason">${esc(order.risk.reason)}</small>`
                    : ''
                }

                <h3>
                  ${esc(order.code)} • ${esc(order.honoreeName)}
                </h3>

                <div class="order-meta">
                  <strong>${esc(order.customerName)}</strong>
                  • festa ${dateBr(order.eventDate)}
                  <br>
                  ${order.theme ? `Tema: ${esc(order.theme)} • ` : ''}
                  ${esc(order.productName || 'Formato não identificado')}
                  ${order.sceneCount ? ` • ${order.sceneCount} cena(s)` : ''}
                  <br>
                  Pagamento:
                  ${Number(order.paidCents || 0) >= Number(order.totalCents || 0)
                    ? 'pago'
                    : Number(order.paidCents || 0) > 0
                      ? `parcial • ${esc(order.paymentMethod || '')}`
                      : `pendente • ${esc(order.paymentMethod || '')}`}
                  • entrega ${dateBr(order.deliveryWindow.start)} a ${dateBr(order.deliveryWindow.end)}
                  <br>
                  Próximo: ${esc(order.nextAction || '')}
                </div>
              </div>

              <button
                class="btn btn-primary"
                type="button"
                data-open-order="${esc(order.code)}"
              >
                Abrir pedido
              </button>
            </article>
          `,
        ).join('')
        : empty(status === 'finalized'
          ? 'Nenhum pedido finalizado fora dos arquivados.'
          : 'Nenhum pedido nessa fila.');
  };

  serviceControl.addEventListener('change',()=>{
    stageControl.value='';
    syncService();
    load();
  });
  stageControl.addEventListener('change',()=>{syncService();load();});

  document
    .getElementById('productionStatus')
    .addEventListener('change', () => {
      // The date presets "Novos" and "Em produção" impose a different
      // status on the API and would silently hide completed orders.
      const status = document.getElementById('productionStatus').value;
      const period = document.getElementById('productionWhen');
      if (status === 'finalized' && ['new', 'in_production'].includes(period.value)) {
        period.value = '';
      }
      load();
    });

  document
    .getElementById('productionWhen')
    .addEventListener(
      'change',
      load,
    );

  document
    .getElementById('productionSearch')
    .addEventListener(
      'input',
      () => {
        clearTimeout(timer);
        timer =
          setTimeout(load, 280);
      },
    );

  list.addEventListener(
    'click',
    (event) => {
      const button =
        event.target.closest(
          '[data-open-order]',
        );

      if (button) {
        openOrder(
          button.dataset.openOrder,
        );
      }
    },
  );

  await load();
}
