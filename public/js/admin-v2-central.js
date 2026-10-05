import {
  api,
  dateBr,
  empty,
  esc,
  money,
  setViewMeta,
  showToast,
  statusClass,
  viewRoot,
} from './admin-v2-core.js';

function attentionRow(item) {
  return `
    <button
      class="row-card"
      type="button"
      data-open-order="${esc(item.code)}"
      style="text-align:left;cursor:pointer"
    >
      <span class="status ${statusClass(item.status)}">
        ${esc(item.statusLabel)}
      </span>

      <strong style="margin-top:7px">
        ${esc(item.code)} • ${esc(item.honoreeName)}
      </strong>

      <small>
        ${esc(item.customerName)}
        • ${esc(item.nextAction || '')}
      </small>
    </button>
  `;
}

function partyRow(item, today) {
  return `
    <div class="row-card">
      <strong>
        ${esc(item.honoreeName)}
      </strong>

      <small>
        ${esc(item.customerName)} • ${esc(item.code)}
        ${item.eventDate ? ` • ${dateBr(item.eventDate)}` : ''}
      </small>

      ${
        today
          ? `
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:9px">
              <a
                class="btn btn-secondary"
                href="${esc(item.congratulationsWhatsappUrl)}"
                target="_blank"
                rel="noopener"
              >
                Abrir WhatsApp
              </a>

              <button
                class="btn btn-ghost"
                type="button"
                data-congrats="${esc(item.code)}"
                ${item.congratulationsSent ? 'disabled' : ''}
              >
                ${item.congratulationsSent ? 'Enviado ✓' : 'Marcar enviado'}
              </button>
            </div>
          `
          : ''
      }
    </div>
  `;
}

export async function renderCentral(openOrder) {
  setViewMeta(
    'Central',
    'Visão do dia',
  );

  const data =
    await api(
      '/api/admin/v2/central',
    );

  const c =
    data.central;

  const used =
    c.capacity.reduce(
      (sum, day) =>
        sum + Number(day.usedUnits || 0),
      0,
    );

  const free =
    c.capacity.reduce(
      (sum, day) =>
        sum + Number(day.freeUnits || 0),
      0,
    );

  viewRoot.innerHTML = `
    <div class="kpi-grid">
      <article class="kpi">
        <span>Vendas do mês</span>
        <strong>${money(c.finance.salesCents)}</strong>
      </article>

      <article class="kpi">
        <span>Recebido no mês</span>
        <strong>${money(c.finance.cashCents)}</strong>
      </article>

      <article class="kpi">
        <span>A receber</span>
        <strong>${money(c.finance.receivableCents)}</strong>
      </article>

      <article class="kpi">
        <span>Capacidade livre • 14 dias</span>
        <strong>${(free / 100).toFixed(1)} pts</strong>
      </article>
    </div>

    <div class="section-grid">
      <section class="card">
        <div class="section-title">
          <h2>Festas de hoje</h2>
          <span class="status">${c.partiesToday.length}</span>
        </div>

        <div class="list">
          ${
            c.partiesToday.length
              ? c.partiesToday.map(
                (item) =>
                  partyRow(item, true),
              ).join('')
              : empty('Nenhuma festa hoje.')
          }
        </div>
      </section>

      <section class="card">
        <div class="section-title">
          <h2>Próximas festas</h2>
          <span class="status">${(c.partiesUpcoming || []).length}</span>
        </div>

        <div class="list">
          ${
            (c.partiesUpcoming || []).length
              ? c.partiesUpcoming.map(
                (item) => `
                  <button
                    class="row-card"
                    type="button"
                    data-open-order="${esc(item.code)}"
                    style="text-align:left;cursor:pointer"
                  >
                    <strong>${esc(item.honoreeName)}</strong>
                    <small>
                      ${dateBr(item.eventDate)}
                      • ${esc(item.customerName)}
                      • ${esc(item.statusLabel)}
                    </small>
                  </button>
                `,
              ).join('')
              : empty('Nenhuma festa próxima.')
          }
        </div>
      </section>

      <section class="card">
        <div class="section-title">
          <h2>Pagamentos pendentes</h2>
          <span class="status">${(c.pendingPayments || []).length}</span>
        </div>

        <div class="list">
          ${
            (c.pendingPayments || []).length
              ? c.pendingPayments.map(
                (item) => `
                  <button
                    class="row-card"
                    type="button"
                    data-open-order="${esc(item.code)}"
                    style="text-align:left;cursor:pointer"
                  >
                    <strong>
                      ${esc(item.code)} • ${esc(item.honoreeName)}
                    </strong>
                    <small>
                      ${esc(item.customerName)}
                      • ${esc(item.paymentMethod || '')}
                      • agora ${money(item.dueCents)}
                    </small>
                  </button>
                `,
              ).join('')
              : empty('Nenhum pagamento pendente.')
          }
        </div>
      </section>

      <section class="card">
        <div class="section-title">
          <h2>Novos pedidos</h2>
          <span class="status">${(c.newOrders || []).length}</span>
        </div>

        <div class="list">
          ${
            (c.newOrders || []).length
              ? c.newOrders.map(attentionRow).join('')
              : empty('Nenhum pedido novo.')
          }
        </div>
      </section>
    </div>

    <div class="section-grid">
      <section class="card">
        <div class="section-title">
          <h2>Precisa da sua atenção</h2>
          <span class="status">${c.attention.length}</span>
        </div>

        <div class="list">
          ${
            c.attention.length
              ? c.attention.map(attentionRow).join('')
              : empty('Nada urgente por aqui ✨')
          }
        </div>
      </section>

      <section class="card">
        <div class="section-title">
          <h2>Próximas entregas</h2>
        </div>

        <div class="list">
          ${
            c.upcomingDeliveries.length
              ? c.upcomingDeliveries.slice(0, 8).map(
                (item) => `
                  <button
                    class="row-card"
                    type="button"
                    data-open-order="${esc(item.code)}"
                    style="text-align:left;cursor:pointer"
                  >
                    <strong>
                      ${esc(item.code)} • ${esc(item.honoreeName)}
                    </strong>
                    <small>
                      ${dateBr(item.start)} a ${dateBr(item.end)}
                      • ${esc(item.statusLabel)}
                    </small>
                  </button>
                `,
              ).join('')
              : empty('Nenhuma entrega próxima.')
          }
        </div>
      </section>
    </div>

    <section class="card" style="margin-top:14px">
      <div class="section-title">
        <h2>Capacidade dos próximos 14 dias</h2>
        <span class="status blue">${(used / 100).toFixed(1)} pts ocupados</span>
      </div>

      <div class="capacity-strip">
        ${c.capacity.map(
          (day) => {
            const capacity =
              Number(day.capacityUnits || 0);

            const load =
              capacity > 0
                ? Math.min(
                  100,
                  Math.round(
                    (
                      Number(day.usedUnits || 0)
                      + Number(day.heldUnits || 0)
                    )
                    * 100
                    / capacity,
                  ),
                )
                : 0;

            return `
              <div class="capacity-day ${day.blocked ? 'blocked' : ''}">
                <strong>${dateBr(day.day)}</strong>
                <small>
                  ${day.blocked ? 'Bloqueado' : `${(day.freeUnits / 100).toFixed(1)} pts livres`}
                </small>
                <div class="metric-bar" style="margin-top:8px">
                  <span style="width:${load}%"></span>
                </div>
              </div>
            `;
          },
        ).join('')}
      </div>
    </section>
  `;

  viewRoot
    .querySelectorAll('[data-open-order]')
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          () =>
            openOrder(
              button.dataset.openOrder,
            ),
        ),
    );

  viewRoot
    .querySelectorAll('[data-congrats]')
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          async () => {
            button.disabled = true;

            try {
              await api(
                `/api/admin/v2/orders/${button.dataset.congrats}/congratulations-sent`,
                {
                  method: 'POST',
                  body: '{}',
                },
              );

              button.textContent =
                'Enviado ✓';
            } catch (error) {
              button.disabled = false;
              showToast(error.message);
            }
          },
        ),
    );
}
