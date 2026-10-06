import {
  api,
  dateBr,
  empty,
  esc,
  setViewMeta,
  statusClass,
  viewRoot,
} from './admin-v2-core.js';

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
    'Fila operacional',
  );

  viewRoot.innerHTML = `
    <div class="toolbar">
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

    <div id="productionList" class="order-list"></div>
  `;

  const list =
    document.getElementById(
      'productionList',
    );

  let timer;

  const load = async () => {
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

    list.innerHTML =
      empty('Carregando...');

    const params =
      new URLSearchParams();

    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (when) params.set('when', when);

    const data =
      await api(
        `/api/admin/v2/production?${params}`,
      );

    const orders =
      data.orders || [];

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
        : empty('Nenhum pedido nessa fila.');
  };

  document
    .getElementById('productionStatus')
    .addEventListener(
      'change',
      load,
    );

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
