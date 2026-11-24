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

const FAMILY_LABELS={convite:'Convite',identidade_visual:'Ateliê',retrospectiva:'Retrospectiva'};
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

let lastPeriodFeedback = null;
let agendaMode='calendar';try{const m=localStorage.getItem('libriAdminAgendaMode');if(['calendar','week','list','capacity'].includes(m))agendaMode=m;}catch{}
let agendaWeek=0;
function capacityState(day){const capacity=Number(day.sellableCapacityUnits||0),used=Number(day.productionUnits||0)+Number(day.cascadeReservedUnits||0)+Number(day.checkoutHeldUnits||0),free=Number(day.publicFreeUnits||0);return {capacity,used,free,key:day.blocked?'blocked':used>capacity?'over':capacity<=0||free<=0?'full':used>0?'busy':'free',label:day.blocked?'Bloqueado':used>capacity?'Acima da capacidade':capacity<=0||free<=0?'Sem vagas':used>0?'Parcialmente ocupado':'Livre'};}
function agendaListHtml(days){return days.map(day=>{const events=day.events||[],deliveries=day.deliveries||[],s=capacityState(day);return '<article class="agenda-list-day"><header><strong>'+dateBr(day.day)+'</strong><small>'+esc(s.label)+' · '+(s.free/100).toFixed(1)+' pt livres</small><button type="button" class="btn btn-ghost btn-small" data-edit-day="'+esc(day.day)+'">Ver dia</button></header><div class="agenda-list-events">'+[...events.map(x=>({x,label:'Festa'})),...deliveries.map(x=>({x,label:FAMILY_LABELS[x.serviceFamily]||'Entrega'}))].map(({x,label})=>'<button type="button" class="agenda-list-event" data-open-order="'+esc(x.code)+'"><span>'+esc(label)+'</span><strong>'+esc(x.honoreeName||x.customerName)+'</strong><small>'+esc(x.productName||x.customerName||'')+'</small></button>').join('')+'</div></article>';}).join('')||empty('Nenhuma festa ou entrega no período.');}
function capacityMapHtml(days){return '<div class="capacity-map-legend">'+[['free','Livre'],['busy','Parcial'],['full','Sem vagas'],['over','Acima da capacidade'],['blocked','Bloqueado']].map(([k,label])=>'<span><i class="capacity-swatch capacity-'+k+'"></i>'+label+'</span>').join('')+'</div><div class="capacity-map">'+days.map(day=>{const s=capacityState(day);return '<button type="button" class="capacity-tile capacity-'+s.key+'" data-edit-day="'+esc(day.day)+'" aria-label="'+esc(dateBr(day.day)+' '+s.label+' '+(s.free/100).toFixed(1)+' pontos livres')+'"><strong>'+esc(day.day.slice(8))+'</strong><span>'+esc(s.label)+'</span><small>'+(s.free/100).toFixed(1)+' pt livres</small><span class="capacity-tile-bar"><i style="width:'+Math.max(0,Math.min(100,s.capacity?100*s.used/s.capacity:0))+'%"></i></span></button>';}).join('')+'</div><small class="muted">A capacidade inclui produção, reservas de cascata e checkout. Toque em um dia para conferir a distribuição de pontos e editar.</small>';}

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
              <span class="calendar-event-kind">${esc(FAMILY_LABELS[event.serviceFamily]||'Entrega')}</span>
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
                ? `${esc(FAMILY_LABELS[event.serviceFamily]||'Entrega')} • ${esc(event.customerName)}`
                : `Festa • ${esc(event.honoreeName)}`}
            </strong>
            <small>
              ${type === 'delivery'
                ? `${esc(event.honoreeName)}
                   ${event.productName ? ` • ${esc(event.productName)}` : ''}
                   ${event.deliveryWindow?.start && event.deliveryWindow?.end
                     ? ` • janela ${dateBr(event.deliveryWindow.start)} a ${dateBr(event.deliveryWindow.end)}`
                     : ''}
                   • ${esc(event.statusLabel||statusLabel(event.status))}`
                : `Cliente: ${esc(event.customerName)}
                   ${event.productName ? ` • ${esc(event.productName)}` : ''}
                   ${event.deliveryWindow?.start && event.deliveryWindow?.end
                     ? ` • entrega ${dateBr(event.deliveryWindow.start)} a ${dateBr(event.deliveryWindow.end)}`
                     : ''}
                   • ${esc(event.statusLabel||statusLabel(event.status))}`
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
  root=viewRoot,
) {
  root
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
                  <h4>Distribuição de pontos</h4>
                  <div class="list">${(day.orders||[]).map(a=>`<button type="button" class="row-card" data-modal-order="${esc(a.code)}" style="text-align:left"><strong>${esc(a.code)} · ${esc(a.honoreeName)}</strong><small>${esc(FAMILY_LABELS[a.serviceFamily]||(a.modular?'Reserva integrada ainda não distribuída':'Pedido legado'))} · ${(a.pointsUnits/100).toFixed(2)} pt${a.provisional?' · Provisório':''}${a.serviceStatus==='delivered'?' · Entregue (reserva mantida)':''}</small></button>`).join('')||empty('Sem alocações neste dia.')}</div>

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

function periodSelectionPreview(start, end, excludeWeekends) {
  if (!start || !end) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return 'Informe datas válidas.';
  }
  const startDate = fromIsoDay(start);
  const endDate = fromIsoDay(end);
  if (isoDay(startDate) !== start || isoDay(endDate) !== end || startDate > endDate) {
    return 'A data final precisa ser igual ou posterior à inicial.';
  }
  const days = Math.round((endDate - startDate) / (24 * 60 * 60 * 1000)) + 1;
  if (days > 181) return 'Selecione um intervalo de até 181 dias.';
  let weekends = 0;
  for (let i = 0; i < days; i++) {
    const weekday = fromIsoDay(addDays(start, i)).getUTCDay();
    if (weekday === 0 || weekday === 6) weekends++;
  }
  const eligible = days - (excludeWeekends ? weekends : 0);
  return eligible
    ? `${eligible} dia(s) selecionado(s)${excludeWeekends ? ` • ${weekends} sábado(s)/domingo(s) excluído(s)` : ''}.`
    : 'Nenhum dia útil neste intervalo. Ajuste as datas ou inclua os fins de semana.';
}

function periodModal(blocked, openOrder) {
  const close = modal(blocked ? 'Bloquear período' : 'Reabrir período', `
    <div class="form-grid">
      <div class="field">
        <label for="periodStart">Início</label>
        <input id="periodStart" class="input" type="date" value="${todayIso()}">
      </div>
      <div class="field">
        <label for="periodEnd">Fim</label>
        <input id="periodEnd" class="input" type="date" value="${todayIso()}">
      </div>
      <label class="field full checkline">
        <input id="periodExcludeWeekends" type="checkbox" ${blocked ? 'checked' : ''}>
        <span>Excluir sábados e domingos deste período</span>
      </label>
      ${blocked ? `
        <label class="field full checkline">
          <input id="periodSkipReserved" type="checkbox" checked>
          <span>Preservar dias com pedidos ou pagamentos reservados</span>
        </label>
        <small class="field full" style="color:var(--muted)">
          Datas preservadas ficarão como estavam. Nenhuma reserva existente será alterada.
        </small>
      ` : ''}
      <div class="field full">
        <label for="periodNote">Observação interna (opcional)</label>
        <input id="periodNote" class="input" maxlength="1000" placeholder="Ex.: férias, folga, agenda fechada">
      </div>
    </div>
    <p id="periodPreview" role="status" style="font-size:13px;margin-top:12px"></p>
    <p id="periodError" role="alert" class="hidden" style="font-size:13px;margin-top:10px"></p>
    <button id="savePeriod" class="btn btn-primary" type="button" style="margin-top:12px">
      ${blocked ? 'Bloquear dias selecionados' : 'Reabrir dias selecionados'}
    </button>
  `, { width: '520px' });

  const start = document.getElementById('periodStart');
  const end = document.getElementById('periodEnd');
  const exclude = document.getElementById('periodExcludeWeekends');
  const skip = document.getElementById('periodSkipReserved');
  const note = document.getElementById('periodNote');
  const preview = document.getElementById('periodPreview');
  const errorBox = document.getElementById('periodError');
  const button = document.getElementById('savePeriod');

  const previewSelection = () => {
    preview.textContent = periodSelectionPreview(start.value, end.value, exclude.checked);
    errorBox.classList.add('hidden');
    errorBox.textContent = '';
  };
  [start, end, exclude, skip].filter(Boolean).forEach(input =>
    input.addEventListener('change', previewSelection));
  previewSelection();

  button.addEventListener('click', async () => {
    const selectionText = periodSelectionPreview(start.value, end.value, exclude.checked);
    if (!selectionText.includes('selecionado(s)')) {
      errorBox.textContent = selectionText || 'Informe o período.';
      errorBox.classList.remove('hidden');
      return;
    }
    button.disabled = true;
    button.textContent = 'Salvando período…';
    try {
      const response = await api('/api/admin/v2/agenda/period', {
        method: 'POST',
        body: JSON.stringify({
          start: start.value,
          end: end.value,
          blocked,
          excludeWeekends: exclude.checked,
          skipReservedDays: blocked && Boolean(skip?.checked),
          internalNote: note.value.trim(),
        }),
      });
      const result = response.result;
      const skipped = result.skippedReservedDays || [];
      const action = blocked ? 'bloqueados' : 'reabertos';
      const summary = `${result.updatedDays} dia(s) ${action}.`;
      lastPeriodFeedback = summary
        + (result.excludedWeekendDays
          ? ` ${result.excludedWeekendDays} dia(s) de fim de semana fora do intervalo aplicado.` : '')
        + (skipped.length
          ? ` ${skipped.length} dia(s) com reservas permaneceram inalterados: ${skipped.map(dateBr).join(', ')}.` : '');
      close();
      await renderAgenda(openOrder, activeMonth);
      showToast(summary);
    } catch (error) {
      errorBox.textContent = error?.message || 'Não foi possível salvar o período.';
      errorBox.classList.remove('hidden');
    } finally {
      button.disabled = false;
      button.textContent = blocked ? 'Bloquear dias selecionados' : 'Reabrir dias selecionados';
    }
  });
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

    ${lastPeriodFeedback ? `
      <div class="notice info" role="status" id="agendaPeriodFeedback" style="margin:12px 0">
        ${esc(lastPeriodFeedback)}
      </div>
    ` : ''}

    <nav class="admin-segmented agenda-view-switch" aria-label="Visualização da agenda">${[['calendar','Mês'],['week','Semana'],['list','Lista'],['capacity','Capacidade']].map(([id,label])=>`<button type="button" data-agenda-mode="${id}" aria-pressed="false">${label}</button>`).join('')}</nav>
    <section class="card agenda-calendar-card" data-agenda-page="calendar">
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

    <section class="card agenda-week-card" data-agenda-page="week" hidden><div class="section-title"><h2>Semana</h2><div class="agenda-week-controls"><button type="button" class="btn btn-ghost" id="agendaWeekPrev" aria-label="Semana anterior">‹</button><span id="agendaWeekLabel"></span><button type="button" class="btn btn-ghost" id="agendaWeekNext" aria-label="Próxima semana">›</button></div></div><div id="agendaWeekRows"></div></section>
    <section class="card agenda-list-card" data-agenda-page="list" hidden><div class="section-title"><h2>Festas e entregas do mês</h2></div>${agendaListHtml((agenda.days||[]).filter(d=>d.day.slice(0,7)===activeMonth.slice(0,7)&&((d.events||[]).length||(d.deliveries||[]).length)))}</section>
    <section class="card agenda-capacity-card" data-agenda-page="capacity" hidden><div class="section-title"><h2>Mapa de capacidade</h2><small>Pontos por dia</small></div>${capacityMapHtml((agenda.days||[]).filter(d=>d.day.slice(0,7)===activeMonth.slice(0,7)))}</section>
    <details class="card agenda-advanced" style="margin-top:14px" ${suggestions.length||releaseable.length?'open':''}>
      <summary>Antecipações e liberação de capacidade (${suggestions.length+releaseable.length})</summary>

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
    </details>
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

  const days=agenda.days||[],weekCount=Math.max(1,Math.ceil(days.length/7));
  const todayIndex=days.findIndex(d=>d.day===todayIso());if(month||agendaWeek>=weekCount)agendaWeek=todayIndex>=0?Math.floor(todayIndex/7):0;
  function renderWeek(){const selected=days.slice(agendaWeek*7,agendaWeek*7+7);document.getElementById('agendaWeekLabel').textContent=selected.length?dateBr(selected[0].day)+' a '+dateBr(selected.at(-1).day):'';document.getElementById('agendaWeekPrev').disabled=agendaWeek===0;document.getElementById('agendaWeekNext').disabled=agendaWeek>=weekCount-1;document.getElementById('agendaWeekRows').innerHTML=agendaListHtml(selected);bindDayEditor(agenda,openOrder,document.getElementById('agendaWeekRows'));document.querySelectorAll('#agendaWeekRows [data-open-order]').forEach(b=>b.onclick=()=>openOrder?.(b.dataset.openOrder));}
  function setMode(mode){agendaMode=mode;viewRoot.querySelectorAll('[data-agenda-page]').forEach(el=>el.hidden=el.dataset.agendaPage!==mode);viewRoot.querySelectorAll('[data-agenda-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.agendaMode===mode)));try{localStorage.setItem('libriAdminAgendaMode',mode);}catch{}}
  viewRoot.querySelectorAll('[data-agenda-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.agendaMode));document.getElementById('agendaWeekPrev').onclick=()=>{if(agendaWeek>0){agendaWeek--;renderWeek();}};document.getElementById('agendaWeekNext').onclick=()=>{if(agendaWeek<weekCount-1){agendaWeek++;renderWeek();}};
  bindDayEditor(agenda,openOrder);renderWeek();setMode(agendaMode);

  viewRoot
    .querySelectorAll(
      '[data-open-order]',
    )
    .forEach(
      (button) => {
        if(button.closest('#agendaWeekRows'))return;
        button.addEventListener(
          'click',
          async () => {
            if (openOrder) {
              await openOrder(
                button.dataset.openOrder,
              );
            }
          },
        );},
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
