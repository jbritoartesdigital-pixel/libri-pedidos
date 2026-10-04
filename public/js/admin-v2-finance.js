import {
  api,
  empty,
  esc,
  money,
  setViewMeta,
  viewRoot,
} from './admin-v2-core.js';

function findValue(object, keys, fallback = 0) {
  for (const key of keys) {
    if (
      object
      && object[key] !== undefined
      && object[key] !== null
    ) {
      return object[key];
    }
  }

  return fallback;
}

export async function renderFinance() {
  setViewMeta(
    'Financeiro',
    'Caixa e recebimentos',
  );

  viewRoot.innerHTML = `
    <div class="toolbar">
      <select id="financePreset" class="select" style="max-width:220px">
        <option value="this_month">Este mês</option>
        <option value="last_month">Mês passado</option>
        <option value="this_year">Este ano</option>
        <option value="custom">Personalizado</option>
      </select>

      <input id="financeSearch" class="input" type="search" placeholder="Buscar pedido ou cliente" style="max-width:300px">
    </div>

    <div id="financeContent"></div>
  `;

  const content =
    document
      .getElementById('financeContent');

  const load =
    async () => {
      const params =
        new URLSearchParams({
          preset:
            document
              .getElementById('financePreset')
              .value,
          q:
            document
              .getElementById('financeSearch')
              .value
              .trim(),
        });

      const data =
        await api(
          `/api/admin/v2/finance?${params}`,
        );

      const f =
        data.finance || {};

      const summary =
        f.summary
        || f.totals
        || f;

      const rows =
        f.transactions
        || f.payments
        || f.rows
        || f.items
        || [];

      content.innerHTML = `
        <div class="kpi-grid">
          <article class="kpi">
            <span>Vendas</span>
            <strong>
              ${money(findValue(summary, ['salesCents','grossSalesCents','totalSalesCents']))}
            </strong>
          </article>

          <article class="kpi">
            <span>Recebido</span>
            <strong>
              ${money(findValue(summary, ['cashCents','receivedCents','paidCents']))}
            </strong>
          </article>

          <article class="kpi">
            <span>A receber</span>
            <strong>
              ${money(findValue(summary, ['receivableCents','pendingCents','openBalanceCents']))}
            </strong>
          </article>

          <article class="kpi">
            <span>Taxas Mercado Pago</span>
            <strong>
              ${money(findValue(summary, ['mercadoPagoFeeCents','feeCents','feesCents']))}
            </strong>
          </article>
        </div>

        <section class="card" style="margin-top:14px">
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
                        <th>Método</th>
                        <th>Status</th>
                        <th>Bruto</th>
                        <th>Taxa</th>
                        <th>Líquido</th>
                      </tr>
                    </thead>

                    <tbody>
                      ${rows.map(
                        (row) => `
                          <tr>
                            <td>${esc(row.orderCode || row.code || '')}</td>
                            <td>${esc(row.customerName || '')}</td>
                            <td>${esc(row.method || row.provider || '')}</td>
                            <td>${esc(row.status || '')}</td>
                            <td>${money(row.amountCents ?? row.grossCents ?? 0)}</td>
                            <td>${money(row.feeCents ?? 0)}</td>
                            <td>${money(row.netCents ?? 0)}</td>
                          </tr>
                        `,
                      ).join('')}
                    </tbody>
                  </table>
                </div>
              `
              : empty('Nenhuma movimentação nesse período.')
          }
        </section>
      `;
    };

  document
    .getElementById('financePreset')
    .addEventListener(
      'change',
      load,
    );

  let timer;

  document
    .getElementById('financeSearch')
    .addEventListener(
      'input',
      () => {
        clearTimeout(timer);
        timer =
          setTimeout(load, 300);
      },
    );

  await load();
}
