import {
  api,
  empty,
  esc,
  money,
  setViewMeta,
  viewRoot,
} from './admin-v2-core.js';

function movementLabel(
  row,
) {
  if (
    row.paymentType
    === 'refund'
    || row.direction
    === 'out'
  ) {
    return 'Reembolso';
  }

  if (
    row.paymentType
    === 'balance'
  ) {
    return 'Saldo';
  }

  return 'Entrada';
}

export async function renderFinance() {
  setViewMeta(
    'Financeiro',
    'Caixa e recebimentos',
  );

  viewRoot.innerHTML = `
    <div class="toolbar">
      <select
        id="financePreset"
        class="select"
        style="max-width:220px"
      >
        <option value="this_month">Este mês</option>
        <option value="previous_month">Mês passado</option>
        <option value="year">Este ano</option>
        <option value="custom">Personalizado</option>
      </select>

      <div
        id="financeCustomDates"
        class="hidden"
        style="display:flex;gap:8px;flex-wrap:wrap"
      >
        <input
          id="financeStart"
          class="input"
          type="date"
          style="max-width:170px"
        >

        <input
          id="financeEnd"
          class="input"
          type="date"
          style="max-width:170px"
        >
      </div>

      <input
        id="financeSearch"
        class="input"
        type="search"
        placeholder="Buscar pedido ou cliente"
        style="max-width:300px"
      >
    </div>

    <div id="financeContent"></div>
  `;

  const content =
    document
      .getElementById(
        'financeContent',
      );

  const preset =
    document
      .getElementById(
        'financePreset',
      );

  const customDates =
    document
      .getElementById(
        'financeCustomDates',
      );

  const startInput =
    document
      .getElementById(
        'financeStart',
      );

  const endInput =
    document
      .getElementById(
        'financeEnd',
      );

  const searchInput =
    document
      .getElementById(
        'financeSearch',
      );

  const syncCustom =
    () => {
      customDates
        .classList
        .toggle(
          'hidden',
          preset.value
          !== 'custom',
        );
    };

  const load =
    async () => {
      if (
        preset.value
        === 'custom'
        && (
          !startInput.value
          || !endInput.value
        )
      ) {
        content.innerHTML =
          empty(
            'Escolha a data inicial e final.',
          );

        return;
      }

      const params =
        new URLSearchParams({
          preset:
            preset.value,

          q:
            searchInput.value
              .trim(),
        });

      if (
        preset.value
        === 'custom'
      ) {
        params.set(
          'start',
          startInput.value,
        );

        params.set(
          'end',
          endInput.value,
        );
      }

      content.innerHTML =
        empty(
          'Carregando financeiro...',
        );

      const data =
        await api(
          `/api/admin/v2/finance?${
            params
          }`,
        );

      const finance =
        data.finance
        || {};

      const summary =
        finance.summary
        || {};

      const rows =
        finance.movements
        || [];

      const receivables =
        finance.receivables
        || [];

      content.innerHTML = `
        <div class="kpi-grid">
          <article class="kpi">
            <span>Vendas realizadas</span>
            <strong>
              ${money(summary.salesCents)}
            </strong>
          </article>

          <article class="kpi">
            <span>Entrou no caixa</span>
            <strong>
              ${money(summary.cashInCents)}
            </strong>
          </article>

          <article class="kpi">
            <span>A receber • vendas do período</span>
            <strong>
              ${money(summary.receivableCents)}
            </strong>
          </article>

          <article class="kpi">
            <span>A receber • total aberto</span>
            <strong>
              ${money(summary.openReceivableAllCents)}
            </strong>
          </article>
        </div>

        <div class="kpi-grid" style="margin-top:12px">
          <article class="kpi">
            <span>Taxas Mercado Pago</span>
            <strong>
              ${money(summary.mercadoPagoFeeCents)}
            </strong>
          </article>

          <article class="kpi">
            <span>Descontos</span>
            <strong>
              ${money(summary.discountsCents)}
            </strong>
          </article>

          <article class="kpi">
            <span>Urgência</span>
            <strong>
              ${money(summary.urgencyAmountCents)}
            </strong>
          </article>

          <article class="kpi">
            <span>Movimento líquido</span>
            <strong>
              ${money(summary.netCashMovementCents)}
            </strong>
          </article>
        </div>

        <div class="section-grid">
          <section class="card">
            <div class="section-title">
              <h2>Movimentações</h2>
            </div>

            ${
              rows.length
                ? `
                  <div style="overflow:auto">
                    <table class="finance-table">
                      <thead>
                        <tr>
                          <th>Pedido</th>
                          <th>Cliente</th>
                          <th>Tipo</th>
                          <th>Método</th>
                          <th>Bruto</th>
                          <th>Taxa</th>
                          <th>Líquido</th>
                        </tr>
                      </thead>

                      <tbody>
                        ${rows.map(
                          (row) => `
                            <tr>
                              <td>${esc(row.orderCode || '')}</td>
                              <td>${esc(row.customerName || '')}</td>
                              <td>${esc(movementLabel(row))}</td>
                              <td>${esc(row.method || row.provider || '')}</td>
                              <td>${money(row.amountCents)}</td>
                              <td>${money(row.feeCents)}</td>
                              <td>${money(row.netCents)}</td>
                            </tr>
                          `,
                        ).join('')}
                      </tbody>
                    </table>
                  </div>
                `
                : empty(
                  'Nenhuma movimentação nesse período.',
                )
            }
          </section>

          <section class="card">
            <div class="section-title">
              <h2>Saldos Pix em aberto</h2>
            </div>

            <div class="list">
              ${
                receivables.length
                  ? receivables.map(
                    (item) => `
                      <div class="row-card">
                        <strong>
                          ${esc(item.orderCode)}
                          •
                          ${esc(item.honoreeName)}
                        </strong>

                        <small>
                          ${esc(item.customerName)}
                          • restante
                          ${money(item.remainingCents)}
                        </small>
                      </div>
                    `,
                  ).join('')
                  : empty(
                    'Nenhum saldo Pix em aberto.',
                  )
              }
            </div>
          </section>
        </div>
      `;
    };

  preset
    .addEventListener(
      'change',
      async () => {
        syncCustom();
        await load();
      },
    );

  startInput
    .addEventListener(
      'change',
      load,
    );

  endInput
    .addEventListener(
      'change',
      load,
    );

  let timer;

  searchInput
    .addEventListener(
      'input',
      () => {
        clearTimeout(
          timer,
        );

        timer =
          setTimeout(
            load,
            300,
          );
      },
    );

  syncCustom();
  await load();
}
