import {
  api,
  dateBr,
  empty,
  esc,
  modal,
  setViewMeta,
  showToast,
  viewRoot,
} from './admin-v2-core.js';

const WEEKDAYS = [
  'Dom',
  'Seg',
  'Ter',
  'Qua',
  'Qui',
  'Sex',
  'Sáb',
];

const STATUS_LABELS = {
  briefing_pending: 'Briefing',
  ready_for_production: 'Novo',
  in_production: 'Produção',
  waiting_customer: 'Aguardando cliente',
  adjustments: 'Ajustes',
  approved: 'Aprovado',
  balance_pending: 'Saldo',
  ready_for_delivery: 'Entrega',
  finalized: 'Finalizado',
};

let activeMonth =
  null;

function isoDay(
  date,
) {
  return date
    .toISOString()
    .slice(
      0,
      10,
    );
}

function fromIsoDay(
  day,
) {
  return new Date(
    `${day}T12:00:00Z`,
  );
}

function monthStart(
  day = null,
) {
  const source =
    day
      ? fromIsoDay(
        day,
      )
      : new Date();

  return isoDay(
    new Date(
      Date.UTC(
        source.getUTCFullYear(),
        source.getUTCMonth(),
        1,
        12,
      ),
    ),
  );
}

function shiftMonth(
  day,
  amount,
) {
  const source =
    fromIsoDay(
      day,
    );

  return isoDay(
    new Date(
      Date.UTC(
        source.getUTCFullYear(),
        source.getUTCMonth()
          + amount,
        1,
        12,
      ),
    ),
  );
}

function addDays(
  day,
  amount,
) {
  const source =
    fromIsoDay(
      day,
    );

  source.setUTCDate(
    source.getUTCDate()
    + amount,
  );

  return isoDay(
    source,
  );
}

function monthGridRange(
  day,
) {
  const first =
    fromIsoDay(
      monthStart(
        day,
      ),
    );

  const monthEnd =
    new Date(
      Date.UTC(
        first.getUTCFullYear(),
        first.getUTCMonth()
          + 1,
        0,
        12,
      ),
    );

  const start =
    addDays(
      isoDay(first),
      -first.getUTCDay(),
    );

  const end =
    addDays(
      isoDay(monthEnd),
      6
      - monthEnd.getUTCDay(),
    );

  return {
    start,
    end,
  };
}

function monthTitle(
  day,
) {
  const value =
    new Intl
      .DateTimeFormat(
        'pt-BR',
        {
          month:
            'long',
          year:
            'numeric',
          timeZone:
            'UTC',
        },
      )
      .format(
        fromIsoDay(
          day,
        ),
      );

  return value
    .charAt(0)
    .toUpperCase()
    + value.slice(1);
}

function todayIso() {
  const parts =
    new Intl
      .DateTimeFormat(
        'en-CA',
        {
          year:
            'numeric',
          month:
            '2-digit',
          day:
            '2-digit',
          timeZone:
            'America/Sao_Paulo',
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

function statusLabel(
  status,
) {
  return STATUS_LABELS[
    status
  ]
  || status
  || '';
}

function calendarDayHtml(
  day,
  month,
) {
  const number =
    Number(
      day.day.slice(
        8,
        10,
      ),
    );

  const outside =
    day.day.slice(
      0,
      7,
    )
    !== month.slice(
      0,
      7,
    );

  const today =
    day.day
    === todayIso();

  const events =
    day.events
    || [];

  const deliveries =
    day.deliveries
    || [];

  return `
    <article
      class="calendar-day
        ${outside ? 'outside' : ''}
        ${today ? 'today' : ''}
        ${day.blocked ? 'blocked' : ''}"
    >
      <div class="calendar-day-head">
        <strong>${number}</strong>

        <button
          class="calendar-edit-day"
          type="button"
          data-edit-day="${esc(day.day)}"
          aria-label="Editar ${esc(dateBr(day.day))}"
        >
          •••
        </button>
      </div>

      <div class="calendar-events">
        ${events.map(
          (event) => `
            <button
              class="calendar-event party"
              type="button"
              data-open-order="${esc(event.code)}"
              title="${esc(`Festa • ${event.customerName} • ${event.productName || ''} • Entrega ${event.deliveryWindow?.start || ''} a ${event.deliveryWindow?.end || ''}`)}"
            >
              <span class="calendar-event-kind">Festa</span>
              <strong>${esc(event.honoreeName)}</strong>
              <small>${esc(event.customerName)}</small>
            </button>
          `,
        ).join('')}

        ${deliveries.map(
          (event) => `
            <button
              class="calendar-event delivery"
              type="button"
              data-open-order="${esc(event.code)}"
              title="${esc(`Entrega • ${event.customerName} • ${event.productName || ''}`)}"
            >
              <span class="calendar-event-kind">Entrega</span>
              <strong>${esc(event.customerName)}</strong>
              <small>
                ${esc(event.honoreeName)}
                ${event.deliveryWindow?.start && event.deliveryWindow?.end
                  ? ` • ${dateBr(event.deliveryWindow.start)} a ${dateBr(event.deliveryWindow.end)}`
                  : ''}
              </small>
            </button>
          `,
        ).join('')}
      </div>

      <div class="calendar-capacity">
        ${day.blocked
          ? '<span class="calendar-blocked">Bloqueado</span>'
          : `
            <span>
              Livre
              <strong>${(day.publicFreeUnits / 100).toFixed(1)} pt</strong>
            </span>
          `
        }
      </div>
    </article>
  `;
}

function capacityDetail(
  day,
) {
  return `
    <div class="kpi-grid calendar-day-kpis">
      <div class="kpi">
        <span>Produção</span>
        <strong>${(day.productionUnits / 100).toFixed(1)} pt</strong>
      </div>

      <div class="kpi">
        <span>Reserva cascata</span>
        <strong>${(day.cascadeReservedUnits / 100).toFixed(1)} pt</strong>
      </div>

      <div class="kpi">
        <span>Checkout</span>
        <strong>${(day.checkoutHeldUnits / 100).toFixed(1)} pt</strong>
      </div>

      <div class="kpi">
        <span>Livre público</span>
        <strong>${(day.publicFreeUnits / 100).toFixed(1)} pt</strong>
      </div>
    </div>
  `;
}

function dayEventsHtml(
  day,
  type = 'party',
) {
  const events =
    type === 'delivery'
      ? day.deliveries || []
      : day.events || [];

  if (!events.length) {
    return empty(
      type === 'delivery'
        ? 'Nenhuma entrega prevista neste dia.'
        : 'Nenhuma festa neste dia.',
    );
  }

  return `
    <div class="list">
      ${events.map(
        (event) => `
          <button
            class="row-card"
            type="button"
            data-modal-order="${esc(event.code)}"
            style="text-align:left;cursor:pointer"
          >
            <strong>
              ${type === 'delivery'
                ? `Entrega • ${esc(event.customerName)}`
                : `Festa • ${esc(event.honoreeName)}`}
            </strong>
            <small>
              ${type === 'delivery'
                ? `${esc(event.honoreeName)}
                   ${event.productName ? ` • ${esc(event.productName)}` : ''}
                   ${event.deliveryWindow?.start && event.deliveryWindow?.end
                     ? ` • janela ${dateBr(event.deliveryWindow.start)} a ${dateBr(event.deliveryWindow.end)}`
                     : ''}
                   • ${esc(statusLabel(event.status))}`
                : `Cliente: ${esc(event.customerName)}
                   ${event.productName ? ` • ${esc(event.productName)}` : ''}
                   ${event.deliveryWindow?.start && event.deliveryWindow?.end
                     ? ` • entrega ${dateBr(event.deliveryWindow.start)} a ${dateBr(event.deliveryWindow.end)}`
                     : ''}
                   • ${esc(statusLabel(event.status))}`
              }
            </small>
          </button>
        `,
      ).join('')}
    </div>
  `;
}

function bindDayEditor(
  agenda,
  openOrder,
) {
  viewRoot
    .querySelectorAll(
      '[data-edit-day]',
    )
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          () => {
            const day =
              (agenda.days || [])
                .find(
                  (item) =>
                    item.day
                    === button.dataset.editDay,
                );

            if (!day) {
              return;
            }

            const close =
              modal(
                `Agenda • ${dateBr(day.day)}`,
                `
                  <div class="section-title">
                    <h3>Festas</h3>
                    <span class="status">${(day.events || []).length}</span>
                  </div>

                  ${dayEventsHtml(day)}

                  <div class="section-title" style="margin-top:18px">
                    <h3>Entregas</h3>
                    <span class="status">${(day.deliveries || []).length}</span>
                  </div>

                  ${dayEventsHtml(day, 'delivery')}

                  <div class="section-title" style="margin-top:18px">
                    <h3>Capacidade</h3>
                  </div>

                  ${capacityDetail(day)}

                  <div class="form-grid" style="margin-top:16px">
                    <div class="field">
                      <label for="daySellable">Capacidade vendável em unidades</label>
                      <input
                        id="daySellable"
                        class="input"
                        type="number"
                        value="${esc(day.sellableCapacityUnits)}"
                      >
                    </div>

                    <div class="field">
                      <label for="dayBuffer">Buffer interno em unidades</label>
                      <input
                        id="dayBuffer"
                        class="input"
                        type="number"
                        value="${esc(day.internalBufferUnits)}"
                      >
                    </div>

                    <label class="field full">
                      <span class="field-label">Bloqueado</span>
                      <select id="dayBlocked" class="select">
                        <option value="0" ${day.blocked ? '' : 'selected'}>Não</option>
                        <option value="1" ${day.blocked ? 'selected' : ''}>Sim</option>
                      </select>
                    </label>

                    <div class="field full">
                      <label for="dayNote">Observação</label>
                      <input
                        id="dayNote"
                        class="input"
                        value="${esc(day.internalNote || '')}"
                      >
                    </div>
                  </div>

                  <button
                    id="saveDay"
                    class="btn btn-primary"
                    type="button"
                    style="margin-top:14px"
                  >
                    Salvar dia
                  </button>
                `,
                {
                  width:
                    '680px',
                },
              );

            document
              .querySelectorAll(
                '[data-modal-order]',
              )
              .forEach(
                (eventButton) =>
                  eventButton
                    .addEventListener(
                      'click',
                      async () => {
                        close();

                        if (openOrder) {
                          await openOrder(
                            eventButton.dataset.modalOrder,
                          );
                        }
                      },
                    ),
              );

            document
              .getElementById('saveDay')
              .addEventListener(
                'click',
                async () => {
                  await api(
                    `/api/admin/v2/agenda/day/${day.day}`,
                    {
                      method:
                        'PUT',
                      body:
                        JSON.stringify({
                          sellableCapacityUnits:
                            Number(
                              document
                                .getElementById('daySellable')
                                .value,
                            ),
                          internalBufferUnits:
                            Number(
                              document
                                .getElementById('dayBuffer')
                                .value,
                            ),
                          blocked:
                            document
                              .getElementById('dayBlocked')
                              .value
                            === '1',
                          internalNote:
                            document
                              .getElementById('dayNote')
                              .value
                              .trim(),
                        }),
                    },
                  );

                  close();
                  await renderAgenda(
                    openOrder,
                    activeMonth,
                  );
                },
              );
          },
        ),
    );
}

function periodModal(
  blocked,
  openOrder,
) {
  const close =
    modal(
      blocked
        ? 'Bloquear período'
        : 'Reabrir período',
      `
        <div class="form-grid">
          <div class="field">
            <label for="periodStart">Início</label>
            <input id="periodStart" class="input" type="date">
          </div>

          <div class="field">
            <label for="periodEnd">Fim</label>
            <input id="periodEnd" class="input" type="date">
          </div>

          <div class="field full">
            <label for="periodNote">Observação interna</label>
            <input id="periodNote" class="input">
          </div>
        </div>

        <button
          id="savePeriod"
          class="btn btn-primary"
          type="button"
          style="margin-top:14px"
        >
          Salvar
        </button>
      `,
      {
        width:
          '560px',
      },
    );

  document
    .getElementById('savePeriod')
    .addEventListener(
      'click',
      async () => {
        const start =
          document
            .getElementById('periodStart')
            .value;

        const end =
          document
            .getElementById('periodEnd')
            .value;

        if (!start || !end) {
          showToast('Informe o período.');
          return;
        }

        await api(
          '/api/admin/v2/agenda/period',
          {
            method: 'POST',
            body:
              JSON.stringify({
                start,
                end,
                blocked,
                internalNote:
                  document
                    .getElementById('periodNote')
                    .value
                    .trim(),
              }),
          },
        );

        close();

        await renderAgenda(
          openOrder,
          activeMonth,
        );
      },
    );
}

export async function renderAgenda(
  openOrder = null,
  month = null,
) {
  activeMonth =
    monthStart(
      month
      || activeMonth
      || todayIso(),
    );

  setViewMeta(
    'Agenda',
    'Calendário de festas e capacidade',
  );

  const range =
    monthGridRange(
      activeMonth,
    );

  const [
    agendaData,
    cascadeData,
  ] =
    await Promise.all([
      api(
        `/api/admin/v2/agenda?start=${range.start}&end=${range.end}`,
      ),
      api(
        '/api/admin/v2/agenda/cascade',
      )
        .catch(
          () => ({
            cascade: null,
          }),
        ),
    ]);

  const agenda =
    agendaData.agenda;

  const suggestions =
    cascadeData.cascade
      ?.suggestions
    || cascadeData.cascade
      ?.items
    || cascadeData.cascade
      ?.candidates
    || [];

  const releaseable =
    cascadeData.cascade
      ?.releaseable
    || [];

  viewRoot.innerHTML = `
    <div class="agenda-toolbar">
      <div class="agenda-month-nav">
        <button
          id="agendaPrev"
          class="btn btn-ghost"
          type="button"
          aria-label="Mês anterior"
        >
          ‹
        </button>

        <strong class="agenda-month-title">
          ${esc(monthTitle(activeMonth))}
        </strong>

        <button
          id="agendaNext"
          class="btn btn-ghost"
          type="button"
          aria-label="Próximo mês"
        >
          ›
        </button>

        <button
          id="agendaToday"
          class="btn btn-secondary"
          type="button"
        >
          Hoje
        </button>
      </div>

      <div class="agenda-actions">
        <button
          id="blockPeriod"
          class="btn btn-warning"
          type="button"
        >
          Bloquear período
        </button>

        <button
          id="openPeriod"
          class="btn btn-ghost"
          type="button"
        >
          Reabrir período
        </button>
      </div>
    </div>

    <section class="card agenda-calendar-card">
      <div class="section-title">
        <h2>Festas e entregas</h2>
        <span class="status blue">
          padrão ${(agenda.defaults?.sellableCapacityUnits || 400) / 100} pts/dia
        </span>
      </div>

      <div class="agenda-calendar-scroll">
        <div class="agenda-calendar">
          ${WEEKDAYS.map(
            (label) => `
              <div class="calendar-weekday">
                ${label}
              </div>
            `,
          ).join('')}

          ${(agenda.days || [])
            .map(
              (day) =>
                calendarDayHtml(
                  day,
                  activeMonth,
                ),
            )
            .join('')}
        </div>
      </div>

      <div class="agenda-legend">
        <span><i class="legend-dot event"></i> festa</span>
        <span><i class="legend-dot delivery"></i> entrega</span>
        <span><i class="legend-dot today"></i> hoje</span>
        <span><i class="legend-dot blocked"></i> bloqueado</span>
        <small>
          Toque nos ••• de um dia para ver festas, entregas, capacidade e editar.
        </small>
      </div>
    </section>

    <section class="card" style="margin-top:14px">
      <div class="section-title">
        <h2>Antecipação em cascata</h2>
      </div>

      ${
        suggestions.length
          ? `
            <div class="list">
              ${suggestions.map(
                (item) => {
                  const source =
                    item.sourceOrderCode
                    || item.source?.code
                    || '';

                  const target =
                    item.targetOrderCode
                    || item.target?.code
                    || '';

                  const units =
                    item.pointsUnits
                    ?? item.units
                    ?? null;

                  return `
                    <div class="row-card">
                      <strong>
                        ${esc(target || 'Pedido sugerido')}
                      </strong>

                      <small>
                        ${
                          source
                            ? `capacidade liberada por ${esc(source)}`
                            : 'sugestão de antecipação'
                        }
                        ${
                          units
                            ? ` • ${(Number(units) / 100).toFixed(1)} pt`
                            : ''
                        }
                      </small>

                      ${
                        source && target
                          ? `
                            <button
                              class="btn btn-primary"
                              type="button"
                              data-anticipate-source="${esc(source)}"
                              data-anticipate-target="${esc(target)}"
                              data-anticipate-units="${esc(units ?? '')}"
                              style="margin-top:8px"
                            >
                              Antecipar produção
                            </button>
                          `
                          : ''
                      }
                    </div>
                  `;
                },
              ).join('')}
            </div>
          `
          : empty('Nenhuma antecipação sugerida agora.')
      }

      ${
        releaseable.length
          ? `
            <div class="section-title" style="margin-top:16px">
              <h3>Excedente sem candidato</h3>
            </div>

            <div class="list">
              ${releaseable.map(
                (item) => `
                  <div class="row-card">
                    <strong>${esc(item.sourceOrderCode)}</strong>
                    <small>
                      ${(Number(item.pointsUnits || 0) / 100).toFixed(1)} pt sem cliente elegível para antecipação.
                    </small>

                    <button
                      class="btn btn-secondary"
                      type="button"
                      data-release-source="${esc(item.sourceOrderCode)}"
                      style="margin-top:8px"
                    >
                      Liberar excedente para venda
                    </button>
                  </div>
                `,
              ).join('')}
            </div>
          `
          : ''
      }
    </section>
  `;

  document
    .getElementById('agendaPrev')
    .addEventListener(
      'click',
      () =>
        renderAgenda(
          openOrder,
          shiftMonth(
            activeMonth,
            -1,
          ),
        ),
    );

  document
    .getElementById('agendaNext')
    .addEventListener(
      'click',
      () =>
        renderAgenda(
          openOrder,
          shiftMonth(
            activeMonth,
            1,
          ),
        ),
    );

  document
    .getElementById('agendaToday')
    .addEventListener(
      'click',
      () =>
        renderAgenda(
          openOrder,
          todayIso(),
        ),
    );

  document
    .getElementById('blockPeriod')
    .addEventListener(
      'click',
      () =>
        periodModal(
          true,
          openOrder,
        ),
    );

  document
    .getElementById('openPeriod')
    .addEventListener(
      'click',
      () =>
        periodModal(
          false,
          openOrder,
        ),
    );

  bindDayEditor(
    agenda,
    openOrder,
  );

  viewRoot
    .querySelectorAll(
      '[data-open-order]',
    )
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          async () => {
            if (openOrder) {
              await openOrder(
                button.dataset.openOrder,
              );
            }
          },
        ),
    );

  viewRoot
    .querySelectorAll('[data-anticipate-source]')
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          async () => {
            button.disabled = true;

            try {
              await api(
                '/api/admin/v2/agenda/cascade/anticipate',
                {
                  method: 'POST',
                  body:
                    JSON.stringify({
                      sourceOrderCode:
                        button.dataset.anticipateSource,
                      targetOrderCode:
                        button.dataset.anticipateTarget,
                      pointsUnits:
                        button.dataset.anticipateUnits
                          ? Number(button.dataset.anticipateUnits)
                          : null,
                    }),
                },
              );

              showToast('Produção antecipada ✓');

              await renderAgenda(
                openOrder,
                activeMonth,
              );
            } catch (error) {
              button.disabled = false;
              showToast(error.message);
            }
          },
        ),
    );
  viewRoot
    .querySelectorAll('[data-release-source]')
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          async () => {
            button.disabled = true;

            try {
              await api(
                '/api/admin/v2/agenda/cascade/release',
                {
                  method: 'POST',
                  body:
                    JSON.stringify({
                      sourceOrderCode:
                        button.dataset.releaseSource,
                    }),
                },
              );

              showToast('Capacidade excedente liberada ✓');

              await renderAgenda(
                openOrder,
                activeMonth,
              );
            } catch (error) {
              button.disabled = false;
              showToast(error.message);
            }
          },
        ),
    );
}
