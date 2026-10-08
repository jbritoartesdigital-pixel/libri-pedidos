import {
  api,
  dateBr,
  empty,
  esc,
  modal,
  money,
  setViewMeta,
  showToast,
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

  if (
    row.paymentType
    === 'full_payment'
  ) {
    return 'Pagamento integral';
  }

  return 'Entrada';
}

function feeBreakdownHtml(row) {
  if (row.provider !== 'mercado_pago' || !row.feeKnown || !row.feeBreakdown) return '';
  const detail = row.feeBreakdown;
  const items = (detail.parts || []).map(part => `
    <div class="finance-fee-line">
      <span>${esc(part.label)}</span><strong>${money(part.amountCents)}</strong>
    </div>
  `).join('');
  return `
    <details class="finance-fee-details">
      <summary>Ver descontos</summary>
      <div class="finance-fee-breakdown">
        ${items}
        ${Number(detail.otherCents || 0) > 0 ? `
          <div class="finance-fee-line"><span>Diferença não discriminada pelo provedor</span>
            <strong>${money(detail.otherCents)}</strong></div>` : ''}
        <div class="finance-fee-line total"><span>Desconto efetivo</span>
          <strong>${money(row.feeCents)}</strong></div>
        ${detail.note ? `<small>${esc(detail.note)}</small>` : ''}
      </div>
    </details>`;
}

function todaySaoPaulo() {
  const parts =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone:
          'America/Sao_Paulo',
        year:
          'numeric',
        month:
          '2-digit',
        day:
          '2-digit',
      },
    )
      .formatToParts(
        new Date(),
      );

  const map =
    Object.fromEntries(
      parts.map(
        (part) => [
          part.type,
          part.value,
        ],
      ),
    );

  return `${map.year}-${map.month}-${map.day}`;
}

export async function renderFinance(openOrderDetail = null) {
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

      <button
        id="addFinancePayment"
        class="btn btn-primary"
        type="button"
      >
        Adicionar lançamento
      </button>
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
            <span>Taxas e descontos Mercado Pago</span>
            <strong>
              ${summary.mercadoPagoFeesComplete
                ? money(summary.mercadoPagoFeeCents)
                : 'A conciliar'}
            </strong>
            <small>Diferença entre o valor bruto e o valor líquido creditado.</small>
            ${summary.mercadoPagoFeesComplete
              ? ''
              : `<small>${Number(summary.mercadoPagoFeePendingCount || 0)} pagamento(s)</small>`}
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
              ${summary.netCashMovementComplete
                ? money(summary.netCashMovementCents)
                : 'A conciliar'}
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
                          <th>Data</th>
                          <th>Tipo</th>
                          <th>Método</th>
                          <th>Bruto</th>
                          <th>Taxa</th>
                          <th>Líquido</th>
                          <th></th>
                        </tr>
                      </thead>

                      <tbody>
                        ${rows.map(
                          (row) => `
                            <tr>
                              <td>${esc(row.orderCode || '')}</td>
                              <td>${esc(row.customerName || '')}</td>
                              <td>${esc(dateBr(row.paidAt || ''))}</td>
                              <td>
                                ${esc(movementLabel(row))}
                                ${row.note ? `<small style="display:block;margin-top:3px">${esc(row.note)}</small>` : ''}
                              </td>
                              <td>${esc(row.method || row.provider || '')}</td>
                              <td>${money(row.amountCents)}</td>
                              <td>${row.feeKnown ? money(row.feeCents) : 'A conciliar'}
                                ${feeBreakdownHtml(row)}
                              </td>
                              <td>${row.netKnown ? money(row.netCents) : 'A conciliar'}</td>
                              <td>
                                <div class="finance-movement-actions">
                                  <button type="button" class="btn btn-secondary btn-small"
                                    data-finance-open-order="${esc(row.orderCode || '')}">Abrir pedido</button>
                                  ${
                                    row.editable
                                      ? `<button class="btn btn-ghost btn-small" type="button"
                                          data-edit-payment="${Number(row.id)}"
                                          data-amount-cents="${Number(row.amountCents || 0)}"
                                          data-paid-date="${esc(String(row.paidAt || '').slice(0, 10))}"
                                          data-payment-type="${esc(row.paymentType || 'deposit')}">Editar</button>`
                                      : ''
                                  }
                                </div>
                              </td>
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

                        <div style="margin-top:10px">
                          <button
                            class="btn btn-secondary btn-small"
                            type="button"
                            data-receive-balance="${esc(item.orderCode)}"
                          >
                            Marcar saldo recebido
                          </button>
                        </div>
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

      content.querySelectorAll('[data-finance-open-order]').forEach(button => {
        button.addEventListener('click', async () => {
          const orderCode = button.dataset.financeOpenOrder;
          if (!/^LIBRI-\\d+$/.test(orderCode || '') || !openOrderDetail) return;
          button.disabled = true;
          try {
            await openOrderDetail(orderCode);
          } catch (error) {
            showToast(error.message || 'Não foi possível abrir o pedido.');
          } finally {
            button.disabled = false;
          }
        });
      });

      content
        .querySelectorAll(
          '[data-edit-payment]',
        )
        .forEach(
          (button) => {
            button.addEventListener(
              'click',
              () => {
                const paymentId =
                  button.dataset.editPayment;

                const close =
                  modal(
                    'Editar lançamento',
                    `
                      <div class="form-grid">
                        <div class="field">
                          <label for="financeEditAmount">Valor recebido</label>
                          <input
                            id="financeEditAmount"
                            class="input"
                            type="number"
                            min="0.01"
                            step="0.01"
                            value="${(
                              Number(
                                button.dataset.amountCents
                                || 0,
                              )
                              / 100
                            ).toFixed(2)}"
                          >
                        </div>

                        <div class="field">
                          <label for="financeEditDate">Data do recebimento</label>
                          <input
                            id="financeEditDate"
                            class="input"
                            type="date"
                            value="${esc(button.dataset.paidDate || '')}"
                          >
                        </div>

                        <div class="field">
                          <label for="financeEditType">Tipo</label>
                          <select
                            id="financeEditType"
                            class="select"
                          >
                            <option value="deposit">Entrada</option>
                            <option value="balance">Saldo</option>
                            <option value="full_payment">Pagamento integral</option>
                          </select>
                        </div>
                      </div>

                      <div class="notice info" style="margin-top:14px">
                        Apenas Pix manual pode ser corrigido aqui. Mercado Pago continua vindo da conciliação do provedor.
                      </div>

                      <div class="action-row">
                        <span></span>
                        <button
                          id="saveFinancePayment"
                          class="btn btn-primary"
                          type="button"
                        >
                          Salvar correção
                        </button>
                      </div>
                    `,
                    {
                      width:
                        '620px',
                    },
                  );

                const type =
                  document
                    .getElementById(
                      'financeEditType',
                    );

                type.value =
                  button.dataset.paymentType
                  || 'deposit';

                document
                  .getElementById(
                    'saveFinancePayment',
                  )
                  .addEventListener(
                    'click',
                    async () => {
                      const amount =
                        Number(
                          document
                            .getElementById(
                              'financeEditAmount',
                            )
                            .value,
                        );

                      const paidDate =
                        document
                          .getElementById(
                            'financeEditDate',
                          )
                          .value;

                      if (
                        !Number.isFinite(amount)
                        || amount <= 0
                        || !paidDate
                      ) {
                        showToast(
                          'Confira o valor e a data.',
                        );

                        return;
                      }

                      try {
                        await api(
                          `/api/admin/v2/finance/payments/${paymentId}`,
                          {
                            method:
                              'PATCH',
                            body:
                              JSON.stringify({
                                amountCents:
                                  Math.round(
                                    amount
                                    * 100,
                                  ),
                                paidDate,
                                paymentType:
                                  type.value,
                              }),
                          },
                        );

                        close();
                        showToast(
                          'Lançamento corrigido.',
                        );

                        await load();
                      } catch (error) {
                        showToast(
                          error.message,
                        );
                      }
                    },
                  );
              },
            );
          },
        );

      content
        .querySelectorAll(
          '[data-receive-balance]',
        )
        .forEach(
          (button) => {
            button.addEventListener(
              'click',
              async () => {
                const orderCode =
                  button.dataset.receiveBalance;

                if (
                  !confirm(
                    `Confirmar o saldo de ${orderCode} como recebido agora?`,
                  )
                ) {
                  return;
                }

                button.disabled =
                  true;

                try {
                  await api(
                    `/api/admin/v2/orders/${orderCode}/action`,
                    {
                      method:
                        'POST',
                      body:
                        JSON.stringify({
                          action:
                            'balance_received',
                        }),
                    },
                  );

                  showToast(
                    'Saldo registrado.',
                  );

                  await load();
                } catch (error) {
                  button.disabled =
                    false;

                  showToast(
                    error.message,
                  );
                }
              },
            );
          },
        );
    };

  document
    .getElementById(
      'addFinancePayment',
    )
    .addEventListener(
      'click',
      () => {
        const close =
          modal(
            'Adicionar lançamento',
            `
              <div class="form-grid">
                <div class="field">
                  <label for="financeNewOrder">Pedido</label>
                  <input
                    id="financeNewOrder"
                    class="input"
                    placeholder="LIBRI-1001"
                    autocomplete="off"
                  >
                </div>

                <div class="field">
                  <label for="financeNewType">Tipo</label>
                  <select
                    id="financeNewType"
                    class="select"
                  >
                    <option value="deposit">Entrada</option>
                    <option value="balance">Saldo</option>
                    <option value="full_payment">Pagamento integral</option>
                    <option value="refund">Reembolso / ajuste negativo</option>
                  </select>
                </div>

                <div class="field">
                  <label for="financeNewAmount">Valor</label>
                  <input
                    id="financeNewAmount"
                    class="input"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="0,00"
                  >
                </div>

                <div class="field">
                  <label for="financeNewDate">Data</label>
                  <input
                    id="financeNewDate"
                    class="input"
                    type="date"
                    value="${todaySaoPaulo()}"
                  >
                </div>

                <div class="field full">
                  <label for="financeNewNote">Observação</label>
                  <textarea
                    id="financeNewNote"
                    class="textarea"
                    placeholder="Ex.: saldo recebido por Pix fora do sistema"
                  ></textarea>
                </div>
              </div>

              <div class="notice info" style="margin-top:14px">
                O lançamento ficará registrado no histórico do pedido. O sistema não permite receber acima do saldo aberto nem reembolsar acima do valor realmente recebido.
              </div>

              <div class="action-row">
                <span></span>
                <button
                  id="saveNewFinancePayment"
                  class="btn btn-primary"
                  type="button"
                >
                  Salvar lançamento
                </button>
              </div>
            `,
          );

        document
          .getElementById(
            'saveNewFinancePayment',
          )
          .addEventListener(
            'click',
            async (event) => {
              const orderCode =
                document
                  .getElementById(
                    'financeNewOrder',
                  )
                  .value
                  .trim()
                  .toUpperCase();

              const amount =
                Number(
                  document
                    .getElementById(
                      'financeNewAmount',
                    )
                    .value,
                );

              const paidDate =
                document
                  .getElementById(
                    'financeNewDate',
                  )
                  .value;

              const paymentType =
                document
                  .getElementById(
                    'financeNewType',
                  )
                  .value;

              const note =
                document
                  .getElementById(
                    'financeNewNote',
                  )
                  .value
                  .trim();

              if (
                !/^LIBRI-\d+$/
                  .test(
                    orderCode,
                  )
                || !Number.isFinite(
                  amount,
                )
                || amount <= 0
                || !paidDate
              ) {
                showToast(
                  'Confira pedido, valor e data.',
                );
                return;
              }

              const button =
                event.currentTarget;

              button.disabled =
                true;

              try {
                await api(
                  '/api/admin/v2/finance/payments',
                  {
                    method:
                      'POST',
                    body:
                      JSON.stringify({
                        orderCode,
                        amountCents:
                          Math.round(
                            amount
                            * 100,
                          ),
                        paidDate,
                        paymentType,
                        note,
                      }),
                  },
                );

                close();
                showToast(
                  'Lançamento registrado ✓',
                );
                await load();
              } catch (error) {
                button.disabled =
                  false;
                showToast(
                  error.message,
                );
              }
            },
          );
      },
    );

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
