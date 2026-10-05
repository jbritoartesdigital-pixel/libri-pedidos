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

const WEEKDAYS =
  [
    'Dom',
    'Seg',
    'Ter',
    'Qua',
    'Qui',
    'Sex',
    'Sáb',
  ];

let agendaMonth =
  new Date();

let agendaMode =
  'calendar';

function pad(value) {
  return String(value)
    .padStart(
      2,
      '0',
    );
}

function isoDay(
  date,
) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthRange(
  date,
) {
  const start =
    new Date(
      date.getFullYear(),
      date.getMonth(),
      1,
    );

  const end =
    new Date(
      date.getFullYear(),
      date.getMonth() + 1,
      0,
    );

  return {
    start:
      isoDay(start),

    end:
      isoDay(end),

    leading:
      start.getDay(),

    days:
      end.getDate(),
  };
}

function monthTitle(
  date,
) {
  return new Intl
    .DateTimeFormat(
      'pt-BR',
      {
        month:
          'long',

        year:
          'numeric',
      },
    )
    .format(
      date,
    )
    .replace(
      /^./,
      (value) =>
        value.toUpperCase(),
    );
}

function moveMonth(
  amount,
) {
  agendaMonth =
    new Date(
      agendaMonth.getFullYear(),
      agendaMonth.getMonth() + amount,
      1,
    );
}

function capacityPercent(
  day,
) {
  const sellable =
    Number(
      day.sellableCapacityUnits
      || 0,
    );

  if (!sellable) {
    return 0;
  }

  const used =
    Number(
      day.productionUnits
      || 0,
    )
    + Number(
      day.cascadeReservedUnits
      || 0,
    )
    + Number(
      day.checkoutHeldUnits
      || 0,
    );

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        used
        * 100
        / sellable,
      ),
    ),
  );
}

function statusText(
  status,
) {
  return ({
    awaiting_payment:
      'Aguardando pagamento',
    briefing_pending:
      'Briefing pendente',
    ready_for_production:
      'Novo',
    in_production:
      'Em produção',
    waiting_customer:
      'Aguardando cliente',
    adjustments:
      'Ajustes',
    approved:
      'Aprovado',
    balance_pending:
      'Saldo pendente',
    ready_for_delivery:
      'Pronto para entrega',
    finalized:
      'Finalizado',
  }[
    status
  ] || status || '');
}

function dayHtml(
  day,
) {
  return `
    <article class="day-card ${day.blocked ? 'blocked' : ''}">
      <strong>${dateBr(day.day)}</strong>

      <div class="numbers">
        <span>
          <small>Produção</small>
          <strong>${(day.productionUnits / 100).toFixed(1)} pt</strong>
        </span>

        <span>
          <small>Reserva cascata</small>
          <strong>${(day.cascadeReservedUnits / 100).toFixed(1)} pt</strong>
        </span>

        <span>
          <small>Checkout</small>
          <strong>${(day.checkoutHeldUnits / 100).toFixed(1)} pt</strong>
        </span>

        <span>
          <small>Livre público</small>
          <strong>${(day.publicFreeUnits / 100).toFixed(1)} pt</strong>
        </span>
      </div>

      <button
        class="btn btn-ghost"
        type="button"
        data-edit-day="${esc(day.day)}"
        style="margin-top:10px"
      >
        Editar dia
      </button>
    </article>
  `;
}

function calendarCell(
  day,
  dayNumber,
) {
  const events =
    day?.events
    || [];

  const production =
    day?.orders
    || [];

  const percent =
    day
      ? capacityPercent(
          day,
        )
      : 0;

  return `
    <button
      class="agenda-calendar-day ${day?.blocked ? 'blocked' : ''} ${events.length ? 'has-event' : ''}"
      type="button"
      data-calendar-day="${esc(day?.day || '')}"
    >
      <span class="agenda-calendar-number">
        ${dayNumber}
      </span>

      ${events.length
        ? `
          <span class="agenda-event-pill">
            🎉 ${esc(events[0].honoreeName)}
          </span>

          ${events.length > 1
            ? `<small class="agenda-more">+${events.length - 1} evento(s)</small>`
            : ''}
        `
        : '<span class="agenda-no-event">sem festa</span>'}

      ${day?.blocked
        ? '<span class="agenda-blocked-label">Bloqueado</span>'
        : `
          <span class="agenda-capacity">
            <span style="width:${percent}%"></span>
          </span>
          <small class="agenda-capacity-label">
            ${production.length ? `${production.length} produção(ões) • ` : ''}
            ${(Number(day?.publicFreeUnits || 0) / 100).toFixed(1)} pt livre
          </small>
        `}
    </button>
  `;
}

function calendarHtml(
  agenda,
) {
  const range =
    monthRange(
      agendaMonth,
    );

  const byDay =
    new Map(
      (agenda.days || [])
        .map(
          (day) => [
            day.day,
            day,
          ],
        ),
    );

  const blanks =
    Array.from(
      {
        length:
          range.leading,
      },
      () =>
        '<div class="agenda-calendar-day outside"></div>',
    );

  const cells =
    Array.from(
      {
        length:
          range.days,
      },
      (
        _value,
        index,
      ) => {
        const dayNumber =
          index + 1;

        const date =
          new Date(
            agendaMonth.getFullYear(),
            agendaMonth.getMonth(),
            dayNumber,
          );

        return calendarCell(
          byDay.get(
            isoDay(
              date,
            ),
          ),
          dayNumber,
        );
      },
    );

  return `
    <section class="card">
      <div class="agenda-calendar-head">
        <button id="agendaPrev" class="btn btn-ghost" type="button">‹</button>

        <div>
          <span class="eyebrow">Calendário de eventos</span>
          <h2>${esc(monthTitle(agendaMonth))}</h2>
        </div>

        <button id="agendaNext" class="btn btn-ghost" type="button">›</button>
      </div>

      <div class="agenda-weekdays">
        ${WEEKDAYS.map(
          (day) =>
            `<span>${day}</span>`,
        ).join('')}
      </div>

      <div class="agenda-calendar-grid">
        ${[
          ...blanks,
          ...cells,
        ].join('')}
      </div>
    </section>
  `;
}

function dayDetail(
  day,
  openOrder,
) {
  const events =
    day.events
    || [];

  const production =
    day.orders
    || [];

  const close =
    modal(
      dateBr(
        day.day,
      ),
      `
        <div class="kpi-grid agenda-day-kpis">
          <div class="kpi">
            <span>Festas</span>
            <strong>${events.length}</strong>
          </div>

          <div class="kpi">
            <span>Produção</span>
            <strong>${(day.productionUnits / 100).toFixed(1)} pt</strong>
          </div>

          <div class="kpi">
            <span>Livre</span>
            <strong>${(day.publicFreeUnits / 100).toFixed(1)} pt</strong>
          </div>
        </div>

        <div class="section-title" style="margin-top:16px">
          <h3>Eventos</h3>
        </div>

        <div class="list">
          ${events.length
            ? events.map(
              (event) => `
                <button
                  class="row-card"
                  type="button"
                  data-agenda-order="${esc(event.code)}"
                  style="text-align:left;cursor:pointer"
                >
                  <strong>🎉 ${esc(event.honoreeName)}</strong>
                  <small>
                    ${esc(event.customerName)}
                    • ${esc(event.code)}
                    • ${esc(statusText(event.status))}
                  </small>
                </button>
              `,
            ).join('')
            : empty('Nenhuma festa neste dia.')}
        </div>

        <div class="section-title" style="margin-top:16px">
          <h3>Produção reservada</h3>
        </div>

        <div class="list">
          ${production.length
            ? production.map(
              (order) => `
                <button
                  class="row-card"
                  type="button"
                  data-agenda-order="${esc(order.code)}"
                  style="text-align:left;cursor:pointer"
                >
                  <strong>${esc(order.honoreeName)}</strong>
                  <small>
                    ${esc(order.code)}
                    • ${(Number(order.pointsUnits || 0) / 100).toFixed(1)} pt
                    • ${esc(statusText(order.status))}
                  </small>
                </button>
              `,
            ).join('')
            : empty('Nenhuma produção reservada neste dia.')}
        </div>

        <button
          id="editSelectedAgendaDay"
          class="btn btn-secondary"
          type="button"
          style="margin-top:16px"
        >
          Editar capacidade deste dia
        </button>
      `,
      {
        width:
          '720px',
      },
    );

  document
    .querySelectorAll('[data-agenda-order]')
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          async () => {
            const code =
              button.dataset.agendaOrder;

            close();

            if (openOrder) {
              await openOrder(
                code,
              );
            }
          },
        ),
    );

  document
    .getElementById('editSelectedAgendaDay')
    ?.addEventListener(
      'click',
      () => {
        close();
        editAgendaDay(
          day,
        );
      },
    );
}

function editAgendaDay(
  day,
) {
  const close =
    modal(
      `Editar ${dateBr(day.day)}`,
      `
        <div class="form-grid">
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
          Salvar
        </button>
      `,
      {
        width:
          '600px',
      },
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
        await renderAgenda();
      },
    );
}

export async function renderAgenda(
  openOrder = null,
) {
  setViewMeta(
    'Agenda',
    'Calendário, eventos e capacidade',
  );

  const range =
    monthRange(
      agendaMonth,
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
            cascade:
              null,
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

  viewRoot.innerHTML = `
    <div class="toolbar agenda-toolbar">
      <button
        class="btn ${agendaMode === 'calendar' ? 'btn-primary' : 'btn-ghost'}"
        type="button"
        data-agenda-mode="calendar"
      >
        Calendário
      </button>

      <button
        class="btn ${agendaMode === 'capacity' ? 'btn-primary' : 'btn-ghost'}"
        type="button"
        data-agenda-mode="capacity"
      >
        Capacidade
      </button>

      <button
        id="agendaToday"
        class="btn btn-ghost"
        type="button"
      >
        Hoje
      </button>

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

    ${agendaMode === 'calendar'
      ? calendarHtml(
          agenda,
        )
      : `
        <section class="card">
          <div class="section-title">
            <h2>Capacidade • ${esc(monthTitle(agendaMonth))}</h2>
            <span class="status blue">
              padrão ${(agenda.defaults?.sellableCapacityUnits || 400) / 100} pts/dia
            </span>
          </div>

          <div class="day-grid">
            ${(agenda.days || []).map(dayHtml).join('')}
          </div>
        </section>
      `}

    <section class="card" style="margin-top:14px">
      <div class="section-title">
        <h2>Antecipação em cascata</h2>
      </div>

      ${suggestions.length
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
                      ${source
                        ? `capacidade liberada por ${esc(source)}`
                        : 'sugestão de antecipação'}
                      ${units
                        ? ` • ${(Number(units) / 100).toFixed(1)} pt`
                        : ''}
                    </small>

                    ${source && target
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
                      : ''}
                  </div>
                `;
              },
            ).join('')}
          </div>
        `
        : empty('Nenhuma antecipação sugerida agora.')}
    </section>
  `;

  const periodModal =
    (blocked) => {
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
                method:
                  'POST',

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
            );
          },
        );
    };

  viewRoot
    .querySelectorAll('[data-agenda-mode]')
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          async () => {
            agendaMode =
              button.dataset.agendaMode;

            await renderAgenda(
              openOrder,
            );
          },
        ),
    );

  document
    .getElementById('agendaToday')
    .addEventListener(
      'click',
      async () => {
        agendaMonth =
          new Date();

        await renderAgenda(
          openOrder,
        );
      },
    );

  document
    .getElementById('agendaPrev')
    ?.addEventListener(
      'click',
      async () => {
        moveMonth(-1);
        await renderAgenda(
          openOrder,
        );
      },
    );

  document
    .getElementById('agendaNext')
    ?.addEventListener(
      'click',
      async () => {
        moveMonth(1);
        await renderAgenda(
          openOrder,
        );
      },
    );

  document
    .getElementById('blockPeriod')
    .addEventListener(
      'click',
      () =>
        periodModal(true),
    );

  document
    .getElementById('openPeriod')
    .addEventListener(
      'click',
      () =>
        periodModal(false),
    );

  viewRoot
    .querySelectorAll('[data-calendar-day]')
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
                    === button.dataset.calendarDay,
                );

            if (day) {
              dayDetail(
                day,
                openOrder,
              );
            }
          },
        ),
    );

  viewRoot
    .querySelectorAll('[data-edit-day]')
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

            if (day) {
              editAgendaDay(
                day,
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
            button.disabled =
              true;

            try {
              await api(
                '/api/admin/v2/agenda/cascade/anticipate',
                {
                  method:
                    'POST',

                  body:
                    JSON.stringify({
                      sourceOrderCode:
                        button.dataset.anticipateSource,

                      targetOrderCode:
                        button.dataset.anticipateTarget,

                      pointsUnits:
                        button.dataset.anticipateUnits
                          ? Number(
                              button.dataset.anticipateUnits,
                            )
                          : null,
                    }),
                },
              );

              showToast('Produção antecipada ✓');

              await renderAgenda(
                openOrder,
              );
            } catch (error) {
              button.disabled =
                false;

              showToast(
                error.message,
              );
            }
          },
        ),
    );
}
