import {
  api,
  dateBr,
  empty,
  esc,
  setViewMeta,
  statusClass,
  viewRoot,
} from './admin-v2-core.js';

export async function renderArchived(
  openOrder,
) {
  setViewMeta(
    'Arquivados',
    'Histórico fora da operação',
  );

  viewRoot.innerHTML = `
    <div class="toolbar">
      <input
        id="archivedSearch"
        class="input"
        type="search"
        placeholder="Buscar pedido, cliente, festa ou WhatsApp"
        style="max-width:420px"
      >
    </div>

    <div class="notice info" style="margin-bottom:14px">
      Pedidos arquivados saem das telas operacionais, mas continuam disponíveis aqui e permanecem no histórico financeiro.
    </div>

    <div id="archivedList"></div>
  `;

  const list =
    document
      .getElementById(
        'archivedList',
      );

  const search =
    document
      .getElementById(
        'archivedSearch',
      );

  const load =
    async () => {
      const params =
        new URLSearchParams({
          q:
            search.value
              .trim(),
        });

      list.innerHTML =
        empty(
          'Carregando arquivados...',
        );

      const data =
        await api(
          `/api/admin/v2/archived?${params}`,
        );

      const orders =
        data.orders
        || [];

      list.innerHTML =
        orders.length
          ? `
            <div class="list">
              ${orders.map(
                (order) => `
                  <button
                    class="row-card"
                    type="button"
                    data-open-archived="${esc(order.code)}"
                    style="text-align:left;cursor:pointer"
                  >
                    <span class="status ${statusClass(order.status)}">
                      ${esc(order.statusLabel)}
                    </span>

                    <strong style="margin-top:7px">
                      ${esc(order.code)} • ${esc(order.honoreeName)}
                    </strong>

                    <small>
                      ${esc(order.customerName)}
                      • festa ${dateBr(order.eventDate)}
                      • arquivado ${dateBr(String(order.archivedAt || '').slice(0, 10))}
                    </small>
                  </button>
                `,
              ).join('')}
            </div>
          `
          : empty(
            search.value
              ? 'Nenhum arquivado encontrado.'
              : 'Nenhum pedido arquivado.',
          );

      list
        .querySelectorAll(
          '[data-open-archived]',
        )
        .forEach(
          (button) =>
            button.addEventListener(
              'click',
              () =>
                openOrder(
                  button.dataset.openArchived,
                ),
            ),
        );
    };

  let timer;

  search
    .addEventListener(
      'input',
      () => {
        clearTimeout(
          timer,
        );

        timer =
          setTimeout(
            load,
            280,
          );
      },
    );

  await load();
}
