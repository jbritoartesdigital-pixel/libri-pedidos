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

function dayHtml(day) {
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

export async function renderAgenda() {
  setViewMeta(
    'Agenda',
    'Capacidade e antecipação',
  );

  const [
    agendaData,
    cascadeData,
  ] =
    await Promise.all([
      api(
        '/api/admin/v2/agenda',
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

  viewRoot.innerHTML = `
    <div class="toolbar">
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

    <section class="card">
      <div class="section-title">
        <h2>Capacidade</h2>
        <span class="status blue">
          padrão ${(agenda.defaults?.sellableCapacityUnits || 400) / 100} pts/dia
        </span>
      </div>

      <div class="day-grid">
        ${(agenda.days || []).map(dayHtml).join('')}
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
            width: '560px',
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
            await renderAgenda();
          },
        );
    };

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
    .querySelectorAll('[data-edit-day]')
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          () => {
            const day =
              (agenda.days || []).find(
                (item) =>
                  item.day
                  === button.dataset.editDay,
              );

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
                  width: '600px',
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
                      method: 'PUT',
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
              await renderAgenda();
            } catch (error) {
              button.disabled = false;
              showToast(error.message);
            }
          },
        ),
    );
}
