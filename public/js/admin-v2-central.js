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
    <div class="row-card">
      <button
        class="attention-main"
        type="button"
        data-open-order="${esc(item.code)}"
      >
        <span class="status ${statusClass(item.status)}">
          ${esc(item.statusLabel)}
        </span>

        <strong style="margin-top:7px">
          ${esc(item.code)} • ${esc(item.honoreeName)}
        </strong>

        <small>
          ${esc(item.customerName)}
          • ${esc(item.attentionReason || item.nextAction || '')}
        </small>
      </button>

      ${
        item.quickWhatsappUrl
          ? `
            <a
              class="btn btn-ghost btn-small"
              href="${esc(item.quickWhatsappUrl)}"
              target="_blank"
              rel="noopener"
              style="margin-top:9px"
            >
              WhatsApp
            </a>
          `
          : ''
      }
    </div>
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

function upcomingPartyRow(item) {
  return `
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

  // The same delivery appears in both backend summaries. Keep the
  // week workload visible and place only other deliveries in a disclosure.
  const workloadCodes = new Set(
    (c.workload?.orders || []).map(item => item.code),
  );
  const otherDeliveries = (c.upcomingDeliveries || [])
    .filter(item => !workloadCodes.has(item.code));

  // Event-day-only notices belong in Festas de hoje, not in priorities.
  // Keep ready-for-production orders actionable even on their party day.
  const attentionItems = (c.attention || []).filter(item =>
    item.attentionReason !== 'Festa hoje'
      || item.status === 'ready_for_production');

  viewRoot.innerHTML = `
    <div class="toolbar" style="justify-content:flex-end;margin-bottom:14px">
      <a
        class="btn btn-secondary"
        href="/pedido?simular=1"
        target="_blank"
        rel="noopener"
      >
        Simular compra
      </a>
    </div>

    <section class="card" id="advancedOrderSearch">
      <div class="section-title"><h2>Encontrar um pedido</h2></div>
      <div class="field">
        <label for="advOrderQuery">Nome, WhatsApp ou código</label>
        <input class="input" id="advOrderQuery" type="search"
          placeholder="Buscar cliente, festa ou LIBRI-..." autocomplete="off">
      </div>
      <details id="advancedOrderFilters" class="order-search-more" style="margin-top:10px">
        <summary>Mostrar mais filtros</summary>
        <p class="muted" style="font-size:12px;margin:8px 0">A busca também encontra pedidos arquivados.</p>
        <div class="form-grid">
        <div class="field"><label for="advOrderStatus">Situação</label><select class="select" id="advOrderStatus">
          <option value="">Todas</option>
          ${[['awaiting_payment','Aguardando pagamento'],['briefing_pending','Dados pendentes'],
            ['ready_for_production','Pronto para produção'],['in_production','Em produção'],
            ['waiting_customer','Aguardando cliente'],['adjustments','Ajustes'],
            ['approved','Aprovado'],['balance_pending','Saldo pendente'],
            ['ready_for_delivery','Pronto para entrega'],['finalized','Finalizado'],
            ['cancelled','Cancelado']].map(([v,label]) => `<option value="${v}">${label}</option>`).join('')}
          </select></div>
        <div class="field"><label for="advOrderProduct">Formato</label><select class="select" id="advOrderProduct">
          <option value="">Todos</option>
          ${[['cinematic_video','Convite em vídeo'],['interactive_essential','Interativo essencial'],
            ['interactive_gif','Interativo GIF'],['interactive_animated','Interativo animado'],
            ['cinematic_interactive','Interativo cinematográfico'],['book','Livro digital']]
            .map(([v,label]) => `<option value="${v}">${label}</option>`).join('')}
          </select></div>
        <div class="field"><label for="advOrderArchived">Arquivados</label><select class="select" id="advOrderArchived">
          <option value="all">Todos</option><option value="no">Somente ativos</option>
          <option value="yes">Somente arquivados</option></select></div>
        <div class="field"><label for="advOrderFrom">Festa a partir de</label>
          <input class="input" id="advOrderFrom" type="date"></div>
        <div class="field"><label for="advOrderTo">Festa até</label>
          <input class="input" id="advOrderTo" type="date"></div>
        </div>
        <button type="button" class="btn btn-secondary" id="runAdvancedOrderSearch" style="margin-top:8px">Buscar com filtros</button>
      </details>
      <div id="advancedOrderResults" class="list" style="margin-top:12px" aria-live="polite"></div>
    </section>

    <section class="card attention-center">
      <div class="section-title">
        <div>
          <span class="eyebrow">Prioridade</span>
          <h2 style="margin:4px 0 0">Hoje precisa da sua atenção</h2>
        </div>
        <span class="status">${attentionItems.length}</span>
      </div>

      <div class="list">
        ${
          attentionItems.length
            ? attentionItems.map(attentionRow).join('')
            : empty('Nada pedindo sua atenção agora ✨')
        }
      </div>
    </section>

    <section class="card monthly-goal-card" aria-label="Meta mensal de faturamento">
      <div class="section-title">
        <div><span class="eyebrow">Meta do mês</span><h2>Rumo aos ${money(c.finance.monthlyGoal?.targetCents || 200000)} 🎯</h2></div>
        <span class="status">${Number(c.finance.monthlyGoal?.progressPercent || 0)}%</span>
      </div>
      <div class="monthly-goal-amounts">
        <strong>${money(c.finance.monthlyGoal?.realizedCents || 0)}</strong>
        <span>de ${money(c.finance.monthlyGoal?.targetCents || 200000)}</span>
      </div>
      <div class="monthly-goal-bar" role="progressbar" aria-valuenow="${Math.max(0, Number(c.finance.monthlyGoal?.progressPercent || 0))}"
        aria-valuemin="0" aria-valuemax="100" aria-label="Progresso da meta mensal">
        <span style="width:${Math.min(100, Math.max(0, Number(c.finance.monthlyGoal?.progressPercent || 0)))}%"></span>
      </div>
      <small>${c.finance.monthlyGoal?.reached ? 'Meta alcançada! ✨' : `Faltam ${money(c.finance.monthlyGoal?.remainingCents || 0)} para sua meta.`}
        Base: recebimentos confirmados no mês, descontando estornos. Não inclui pedidos ainda não pagos.</small>
    </section>

    <div class="kpi-grid" style="margin-top:14px">
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
          ${(c.partiesUpcoming || []).length
            ? c.partiesUpcoming.slice(0, 3).map(upcomingPartyRow).join('')
            : empty('Nenhuma festa próxima.')}
        </div>
        ${(c.partiesUpcoming || []).length > 3 ? `
          <details class="order-optional" style="margin-top:10px">
            <summary>Ver mais festas (${c.partiesUpcoming.length - 3})</summary>
            <div class="list" style="margin-top:10px">
              ${c.partiesUpcoming.slice(3).map(upcomingPartyRow).join('')}
            </div>
          </details>` : ''}
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

      <details class="card order-optional">
        <summary>Novos pedidos (${(c.newOrders || []).length})</summary>
        <p class="muted" style="font-size:12px;margin:0 0 10px">
          Os pedidos que precisam de ação também aparecem nas prioridades.
        </p>
        <div class="list">
          ${
            (c.newOrders || []).length
              ? c.newOrders.map(attentionRow).join('')
              : empty('Nenhum pedido novo.')
          }
        </div>
      </details>
    </div>

    <section class="card" style="margin-top:14px">
      <div class="section-title">
        <h2>Entregas e produção • próximos 7 dias</h2>
        <span class="status">${Number(c.workload?.count || 0)} pedidos</span>
      </div>
      <p class="muted">${Number(c.workload?.scenes || 0)} cenas contratadas • Entregas que cruzam os próximos 7 dias.</p>
      <div class="list">
        ${(c.workload?.orders || []).slice(0, 12).map(item => `
          <button type="button" class="row-card" data-open-order="${esc(item.code)}"
            style="text-align:left;cursor:pointer">
            <strong>${esc(item.code)} • ${esc(item.honoreeName)}</strong>
            <small>${dateBr(item.start)} a ${dateBr(item.end)} • ${item.scenes} cenas • ${esc(item.statusLabel)}</small>
          </button>`).join('') || empty('Sem entregas em produção para os próximos sete dias.')}
      </div>
      ${otherDeliveries.length ? `
        <details class="order-optional" style="margin-top:12px">
          <summary>Outras entregas (${otherDeliveries.length})</summary>
          <p class="muted" style="font-size:12px;margin:4px 0 10px">
            Pedidos fora da fila de produção dos próximos sete dias.
          </p>
          <div class="list">
            ${otherDeliveries.slice(0, 12).map(item => `
              <button class="row-card" type="button"
                data-open-order="${esc(item.code)}"
                style="text-align:left;cursor:pointer">
                <strong>${esc(item.code)} • ${esc(item.honoreeName)}</strong>
                <small>${dateBr(item.start)} a ${dateBr(item.end)} • ${esc(item.statusLabel)}</small>
              </button>`).join('')}
          </div>
        </details>` : ''}
    </section>

    <details class="card order-optional" style="margin-top:14px">
      <summary>Ver capacidade diária dos próximos 14 dias</summary>
      <p class="muted" style="font-size:12px;margin:0 0 12px">
        ${(used / 100).toFixed(1)} pts ocupados no período.
      </p>
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
    </details>
  `;

  const searchButton = document.getElementById('runAdvancedOrderSearch');
  const quickSearch = document.getElementById('advOrderQuery');
  const searchResults = document.getElementById('advancedOrderResults');
  const extraFilters = document.getElementById('advancedOrderFilters');
  let searchDebounce;
  let searchRevision = 0;

  const refreshFilterIndicator = () => {
    const active = ['advOrderStatus', 'advOrderProduct', 'advOrderFrom', 'advOrderTo']
      .some(id => Boolean(document.getElementById(id)?.value))
      || document.getElementById('advOrderArchived')?.value !== 'all';
    const summary = extraFilters?.querySelector('summary');
    if (summary) summary.textContent = active
      ? 'Mostrar mais filtros • ativos' : 'Mostrar mais filtros';
  };

  async function runOrderSearch() {
    const revision = ++searchRevision;
    clearTimeout(searchDebounce);
    const hasQuery = Boolean(quickSearch?.value.trim());
    const hasExtraFilters = ['advOrderStatus', 'advOrderProduct', 'advOrderFrom', 'advOrderTo']
      .some(id => Boolean(document.getElementById(id)?.value))
      || document.getElementById('advOrderArchived')?.value !== 'all';
    refreshFilterIndicator();
    // Do not fetch (or show) every historical order when the name search is blank.
    if (!hasQuery && !hasExtraFilters) {
      searchResults.innerHTML = '';
      return;
    }
    const values = [
      ['q','advOrderQuery'], ['status','advOrderStatus'], ['product','advOrderProduct'],
      ['archived','advOrderArchived'], ['from','advOrderFrom'], ['to','advOrderTo'],
    ];
    const params = new URLSearchParams(values.map(([key,id]) =>
      [key, document.getElementById(id).value.trim()]));
    const results = searchResults;
    searchButton.disabled = true;
    results.innerHTML = '<small>Buscando...</small>';
    try {
      const data = await api('/api/admin/v2/orders/search?' + params);
      if (revision !== searchRevision) return;
      results.innerHTML = (data.orders || []).map(item => `
        <button class="row-card" type="button" data-searched-order="${esc(item.code)}"
          style="text-align:left;cursor:pointer">
          <strong>${esc(item.code)} • ${esc(item.honoreeName)}</strong>
          <small>${esc(item.customerName)} • ${dateBr(item.eventDate)}
            • ${esc(item.status)} ${item.archived ? '• Arquivado' : ''}</small>
        </button>`).join('') || empty('Nenhum pedido encontrado.');
      results.querySelectorAll('[data-searched-order]').forEach(button =>
        button.addEventListener('click', () => openOrder(button.dataset.searchedOrder)));
    } catch (error) {
      if (revision === searchRevision) {
        results.textContent = error.message || 'Não foi possível buscar.';
      }
    } finally {
      if (revision === searchRevision) searchButton.disabled = false;
    }
  }

  searchButton?.addEventListener('click', runOrderSearch);
  quickSearch?.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    // Invalidate older requests immediately so an old result never replaces
    // a newer search or reappears after clearing the field.
    ++searchRevision;
    if (!quickSearch.value.trim()) {
      if (['advOrderStatus', 'advOrderProduct', 'advOrderFrom', 'advOrderTo']
        .some(id => Boolean(document.getElementById(id)?.value))
        || document.getElementById('advOrderArchived')?.value !== 'all') {
        searchDebounce = setTimeout(runOrderSearch, 350);
      } else {
        searchResults.innerHTML = '';
        searchButton.disabled = false;
      }
      return;
    }
    searchDebounce = setTimeout(runOrderSearch, 350);
  });
  quickSearch?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runOrderSearch();
    }
  });
  ['advOrderStatus', 'advOrderProduct', 'advOrderArchived', 'advOrderFrom', 'advOrderTo']
    .forEach(id => document.getElementById(id)
      ?.addEventListener('change', refreshFilterIndicator));

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
