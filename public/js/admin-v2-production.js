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
  ['briefing_pending', 'Aguardando briefing'],
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
    'Convites, identidades visuais e retrospectivas',
  );

  viewRoot.innerHTML = `
    <nav class="admin-segmented production-service-tabs" aria-label="Área de produção">${[['','Todos'],['convites','Convites'],['atelie','Ateliê'],['retrospectivas','Retrospectivas']].map(([v,label])=>`<button type="button" data-production-service="${v}" aria-pressed="false">${label}</button>`).join('')}</nav>
    <div class="toolbar admin-v3-production-filters">
      <label class="admin-v3-filter hidden">
        <span>Serviço</span>
        <select id="productionService" class="select" aria-label="Filtrar serviço">
          <option value="">Todos os serviços</option>
          <option value="convites">Convites Digitais</option>
          <option value="atelie">Identidade Visual · Ateliê</option>
          <option value="retrospectivas">Retrospectivas</option>
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

    <div class="production-workbar"><div class="admin-quick-filters" aria-label="Filtros rápidos">${[['all','Todos'],['today','Festas hoje'],['late','Entregas atrasadas'],['new','Novos'],['waiting_customer','Aguardando aprovação'],['approved','Aprovados'],['ready_for_delivery','Prontos para entrega']].map(([v,label])=>`<button type="button" data-production-quick="${v}" aria-pressed="false">${label}</button>`).join('')}</div><div class="admin-segmented production-layout" aria-label="Visualização">${[['list','Lista'],['board','Kanban']].map(([v,label])=>`<button type="button" data-production-layout="${v}" aria-pressed="false">${label}</button>`).join('')}</div></div>
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
  let layout='list',quick='all',currentData=null;
  try{if(localStorage.getItem('libriProductionLayout')==='board')layout='board';}catch{}
  const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const familyMap={convites:'convite',atelie:'identidade_visual',retrospectivas:'retrospectiva'};
  const stages=[['briefing_pending','Briefing / conferência'],['ready_for_production','Pronto para produzir'],['in_production','Em produção'],['waiting_customer','Aguardando aprovação'],['adjustments','Ajustes'],['approved','Aprovado'],['balance_pending','Saldo pendente'],['ready_for_delivery','Pronto para entrega'],['finalized','Entregue'],['other','Outras situações']];
  const v3Stage={pending:'briefing_pending',ready:'ready_for_production',in_production:'in_production',waiting_customer:'waiting_customer',adjustments:'adjustments',approved:'approved',delivered:'finalized'};
  const nextAction={briefing_pending:'Conferir dados e agenda',ready_for_production:'Iniciar produção',in_production:'Preparar prévia',waiting_customer:'Acompanhar aprovação',adjustments:'Realizar ajustes',approved:'Conferir entrega final',balance_pending:'Conferir saldo',ready_for_delivery:'Entregar',finalized:'Consultar histórico'};
  function visibleServices(o){const status=document.getElementById('productionStatus').value,when=document.getElementById('productionWhen').value;return o.services.filter(s=>(!familyMap[serviceControl.value]||familyMap[serviceControl.value]===s.family)&&(!status||v3Stage[s.productionStatus]===status)&&(!['new','in_production'].includes(when)||v3Stage[s.productionStatus]===(when==='new'?'ready_for_production':'in_production'))&&(quick!=='late'||(s.deliveryWindow?.end&&s.deliveryWindow.end<today()&&!['delivered','cancelled'].includes(s.productionStatus))));}
  function board(orders,v3Orders){const cols=new Map(stages.map(([k])=>[k,[]]));const add=(o,s,stage)=>{const key=cols.has(stage)?stage:'other';cols.get(key).push({o,s,stage});};for(const o of v3Orders)for(const s of visibleServices(o)){if(s.productionStatus!=='cancelled')add(o,s,v3Stage[s.productionStatus]);}for(const o of orders)add(o,null,o.status);return '<div class="production-board" aria-label="Quadro por etapa; somente consulta">'+stages.filter(([k])=>k!=='other'||cols.get(k).length).map(([k,label])=>'<section class="board-lane"><header><h3>'+esc(label)+'</h3><span>'+cols.get(k).length+'</span></header><div class="board-items">'+(cols.get(k).map(({o,s,stage})=>'<article class="board-item"><small>'+esc(o.code)+'</small><strong>'+esc(o.honoreeName)+'</strong><span>'+esc(s?.productName||o.productName||'Pedido')+'</span><small>'+esc(s?.deliveryWindow?.end?dateBr(s.deliveryWindow.end):o.deliveryWindow?.end?dateBr(o.deliveryWindow.end):'Prazo a definir')+'</small><p>'+esc(s?(nextAction[stage]||s.statusLabel):o.nextAction||nextAction[stage]||'Consultar ficha')+'</p><button type="button" class="btn btn-secondary" data-open-order="'+esc(o.code)+'">Abrir ficha</button></article>').join('')||'<p class="muted board-empty">Sem itens</p>')+'</div></section>').join('')+'</div><p class="muted board-note">Cada cartão representa um serviço contratado ou um pedido clássico. A mudança de etapa é feita na ficha, com as validações existentes.</p>';}
  function syncWorkbar(){viewRoot.querySelectorAll('[data-production-layout]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.productionLayout===layout)));viewRoot.querySelectorAll('[data-production-quick]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.productionQuick===quick)));}
  syncWorkbar();
  const serviceControl = document.getElementById('productionService');
  const stageControl = document.getElementById('productionArtStage');
  const initialService = new URLSearchParams(window.location.search).get('service');
  if(['atelie','convites','retrospectivas'].includes(initialService)) serviceControl.value=initialService;
  const initialStage = new URLSearchParams(window.location.search).get('artStage');
  if(ATELIE_STAGES.some(([code])=>code===initialStage)) stageControl.value=initialStage;

  function syncService() {
    const art = serviceControl.value==='atelie';
    viewRoot.querySelectorAll('[data-production-service]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.productionService===serviceControl.value)));
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
    if(!list.isConnected)return;
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
    if(currentRequest!==requestSequence||!list.isConnected)return;
    currentData=data;renderRows();
  };
  function renderRows(){if(!currentData||!list.isConnected)return;let orders=currentData.orders||[],v3Orders=currentData.v3Orders||[];const status=document.getElementById('productionStatus').value;
    if(quick==='late'){orders=orders.filter(o=>o.deliveryWindow?.end&&o.deliveryWindow.end<today()&&!['finalized','cancelled'].includes(o.status));v3Orders=v3Orders.filter(o=>visibleServices(o).length);}
    if(layout==='board'){list.innerHTML=board(orders,v3Orders);return;}
    const modular=v3Orders.map(order=>`<article class="order-card"><div><span class="status ${statusClass(order.aggregate.status)}">${esc(order.aggregate.label)}</span><h3>${esc(order.code)} • ${esc(order.honoreeName)}</h3><div class="order-meta"><strong>${esc(order.customerName)}</strong> • festa ${dateBr(order.eventDate)}<br>${order.aggregate.deliveredServices} de ${order.aggregate.totalServices} serviços entregues</div>${visibleServices(order).map(s=>`<div class="production-service-line"><strong>${esc(s.productName)}</strong><span>${esc(s.statusLabel)}</span>${s.deliveryWindow?`<small>${dateBr(s.deliveryWindow.start)} a ${dateBr(s.deliveryWindow.end)}</small>`:''}</div>`).join('')}</div><button class="btn btn-primary" type="button" data-open-order="${esc(order.code)}">Abrir pedido</button></article>`).join('');

    list.innerHTML =
      orders.length||v3Orders.length
        ? modular+orders.map(
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
                  • entrega ${dateBr(order.deliveryWindow?.start)} a ${dateBr(order.deliveryWindow?.end)}
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

  viewRoot.querySelectorAll('[data-production-layout]').forEach(b=>b.addEventListener('click',()=>{layout=b.dataset.productionLayout;try{localStorage.setItem('libriProductionLayout',layout);}catch{}syncWorkbar();renderRows();}));
  viewRoot.querySelectorAll('[data-production-quick]').forEach(b=>b.addEventListener('click',()=>{quick=b.dataset.productionQuick;const status=document.getElementById('productionStatus'),period=document.getElementById('productionWhen');status.value=['waiting_customer','approved','ready_for_delivery'].includes(quick)?quick:'';period.value=['today','new'].includes(quick)?quick:'';syncWorkbar();load();}));
  viewRoot.querySelectorAll('[data-production-service]').forEach(b=>b.addEventListener('click',()=>{serviceControl.value=b.dataset.productionService;serviceControl.dispatchEvent(new Event('change'));}));
  serviceControl.addEventListener('change',()=>{
    stageControl.value='';
    const statusControl=document.getElementById('productionStatus');

    syncService();
    load();
  });
  stageControl.addEventListener('change',()=>{syncService();load();});

  document
    .getElementById('productionStatus')
    .addEventListener('change', () => {
      // The date presets "Novos" and "Em produção" impose a different
      // status on the API and would silently hide completed orders.
      quick='all';syncWorkbar();
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
      ()=>{quick='all';syncWorkbar();load();},
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
