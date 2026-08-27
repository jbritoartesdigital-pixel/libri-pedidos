(() => {
  'use strict';

  /* ==================================================
     LIBRI CONVITES
     PAINEL ADMIN | V5
  ================================================== */

  const $ = (
    selector,
    root = document,
  ) =>
    root.querySelector(
      selector,
    );

  const $$ = (
    selector,
    root = document,
  ) =>
    Array.from(
      root.querySelectorAll(
        selector,
      ),
    );

  const state = {
    authenticated: false,

    authConfigured: false,

    orders: [],

    orderMap:
      new Map(),

    observer: null,

    transformTimer: null,

    transforming: false,

    currentEdit: null,
  };

  /* ==================================================
     HELPERS
  ================================================== */

  function esc(
    value = '',
  ) {
    return String(
      value,
    ).replace(
      /[&<>'"]/g,

      (char) => ({
        '&':
          '&amp;',

        '<':
          '&lt;',

        '>':
          '&gt;',

        "'":
          '&#39;',

        '"':
          '&quot;',
      })[char],
    );
  }

  function money(
    cents = 0,
  ) {
    return new Intl
      .NumberFormat(
        'pt-BR',
        {
          style:
            'currency',

          currency:
            'BRL',
        },
      )
      .format(
        (
          Number(cents)
          || 0
        )
        / 100,
      );
  }

  function formatDate(
    value,
  ) {
    if (!value) {
      return 'Não informado';
    }

    const parts =
      String(value)
        .split('-');

    if (
      parts.length
      !== 3
    ) {
      return String(
        value,
      );
    }

    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  function todayISO() {
    const now =
      new Date();

    const year =
      now.getFullYear();

    const month =
      String(
        now.getMonth()
        + 1,
      ).padStart(
        2,
        '0',
      );

    const day =
      String(
        now.getDate(),
      ).padStart(
        2,
        '0',
      );

    return `${year}-${month}-${day}`;
  }

  function centsFromReais(
    value,
  ) {
    const raw =
      String(
        value
        || '',
      ).trim();

    if (!raw) {
      return null;
    }

    const normalized =
      raw.includes(',')
        ? raw
          .replace(
            /\./g,
            '',
          )
          .replace(
            ',',
            '.',
          )
        : raw;

    const number =
      Number(
        normalized,
      );

    if (
      !Number.isFinite(
        number,
      )
      || number <= 0
    ) {
      return null;
    }

    return Math.round(
      number
      * 100,
    );
  }

  function reaisFromCents(
    cents,
  ) {
    if (
      cents === undefined
      || cents === null
      || cents === ''
    ) {
      return '';
    }

    return (
      Number(cents)
      / 100
    )
      .toFixed(2)
      .replace(
        '.',
        ',',
      );
  }

  function normalizeText(
    value,
  ) {
    return String(
      value
      ?? '',
    ).trim();
  }

  function statusLabel(
    status,
  ) {
    return ({
      new:
        'Novo pedido',

      ready:
        'Pronto para produção',

      producing:
        'Em produção',

      waiting_client:
        'Aguardando cliente',

      revisions:
        'Ajustes',

      waiting_balance:
        'Aguardando saldo',

      finished:
        'Finalizado',

      cancelled:
        'Cancelado',
    })[status]
      || status
      || 'Não informado';
  }

  function statusCss(
    status,
  ) {
    if (
      status === 'new'
      || status === 'ready'
    ) {
      return 'new';
    }

    if (
      status === 'producing'
    ) {
      return 'production';
    }

    if (
      status
      === 'waiting_client'
    ) {
      return 'waiting';
    }

    if (
      status
      === 'revisions'
    ) {
      return 'revisions';
    }

    if (
      status
      === 'waiting_balance'
    ) {
      return 'balance';
    }

    if (
      status
      === 'finished'
    ) {
      return 'finished';
    }

    if (
      status
      === 'cancelled'
    ) {
      return 'cancelled';
    }

    return 'new';
  }

  function cardCss(
    status,
  ) {
    if (
      status === 'new'
      || status === 'ready'
    ) {
      return 'is-new';
    }

    if (
      status === 'producing'
    ) {
      return 'is-production';
    }

    if (
      status
      === 'waiting_client'
    ) {
      return 'is-waiting';
    }

    if (
      status
      === 'revisions'
    ) {
      return 'is-revision';
    }

    if (
      status
      === 'waiting_balance'
    ) {
      return 'is-balance';
    }

    return '';
  }

  function productLabel(
    order,
  ) {
    const experience =
      order.experience
      === 'reduced'
        ? 'Reduzido'
        : 'Completo';

    const format =
      order.format
      === 'interactive'
        ? 'Interativo'
        : 'Vídeo';

    return `${format} ${experience}`;
  }

  function albumLabel(
    plan,
  ) {
    return ({
      festa:
        'Moments Festa',

      premium:
        'Moments Premium',

      exclusive:
        'Moments Exclusive',
    })[plan]
      || '';
  }

  function nextAction(
    order,
  ) {
    if (
      order.nextAction
    ) {
      return order.nextAction;
    }

    switch (
      order.status
    ) {
      case 'new':
        return 'Conferir briefing e materiais';

      case 'ready':
        return 'Iniciar produção';

      case 'producing':
        return 'Continuar produção';

      case 'waiting_client':
        return 'Aguardar retorno da cliente';

      case 'revisions':
        return 'Fazer ajustes';

      case 'waiting_balance':
        return 'Aguardar pagamento final';

      case 'finished':
        return 'Pedido concluído e arquivado';

      case 'cancelled':
        return 'Pedido cancelado';

      default:
        return 'Abrir pedido';
    }
  }

  function eventTimestamp(
    order,
  ) {
    const date =
      order.eventDate
      || order.event_date;

    if (!date) {
      return Number
        .MAX_SAFE_INTEGER;
    }

    const value =
      new Date(
        `${date}T12:00:00`,
      )
        .getTime();

    return Number.isFinite(
      value,
    )
      ? value
      : Number
        .MAX_SAFE_INTEGER;
  }

  /* ==================================================
     API
  ================================================== */

  async function api(
    path,
    options = {},
  ) {
    const response =
      await fetch(
        path,
        {
          ...options,

          headers: {
            'content-type':
              'application/json',

            ...(
              options.headers
              || {}
            ),
          },
        },
      );

    const data =
      await response
        .json()
        .catch(
          () => ({}),
        );

    if (
      !response.ok
    ) {
      if (
        response.status
        === 401

        && data
          ?.details
          ?.code
        === 'admin_auth_required'
      ) {
        showAuthGate();
      }

      const error =
        new Error(
          data.error
          || 'Não foi possível concluir a ação.',
        );

      error.status =
        response.status;

      error.data =
        data;

      throw error;
    }

    return data;
  }

  /* ==================================================
     FEEDBACK
  ================================================== */

  function toast(
    message,
    type = 'success',
  ) {
    const element =
      $('#adminToast');

    if (!element) {
      return;
    }

    element.textContent =
      message;

    element.className =
      `admin-toast ${
        type === 'error'
          ? 'v5-error'
          : 'v5-success'
      }`;

    setTimeout(
      () => {
        element
          .classList
          .add(
            'hidden',
          );
      },
      2800,
    );
  }

  /* ==================================================
     LOGIN
  ================================================== */

  function authGateHtml() {
    return `
      <div
        id="adminAuthGate"
        class="admin-auth-gate"
      >
        <section
          class="admin-auth-card"
        >
          <div
            class="admin-auth-mark"
            aria-hidden="true"
          >
            L
          </div>

          <span
            class="admin-auth-kicker"
          >
            Libri Convites
          </span>

          <h1>
            Central de Produção
          </h1>

          <p>
            Digite a senha administrativa para acessar os pedidos.
          </p>

          <form
            id="adminAuthForm"
            class="admin-auth-form"
          >
            <label
              for="adminPassword"
            >
              Senha
            </label>

            <input
              id="adminPassword"
              type="password"
              autocomplete="current-password"
              required
              autofocus
            >

            <button
              id="adminLoginButton"
              class="btn btn-primary"
              type="submit"
            >
              Entrar
            </button>
          </form>

          <div
            id="adminAuthMessage"
            class="admin-auth-message"
            aria-live="polite"
          ></div>
        </section>
      </div>
    `;
  }

  function installAuthGate() {
    if (
      $('#adminAuthGate')
    ) {
      return;
    }

    document.body
      .insertAdjacentHTML(
        'afterbegin',
        authGateHtml(),
      );

    document.body
      .classList
      .add(
        'admin-locked',
      );

    $('#adminAuthForm')
      ?.addEventListener(
        'submit',
        login,
      );
  }

  function showAuthGate() {
    installAuthGate();

    $('#adminAuthGate')
      ?.classList
      .remove(
        'hidden',
      );

    document.body
      .classList
      .add(
        'admin-locked',
      );

    state.authenticated =
      false;

    setTimeout(
      () => {
        $('#adminPassword')
          ?.focus();
      },
      30,
    );
  }

  function hideAuthGate() {
    $('#adminAuthGate')
      ?.classList
      .add(
        'hidden',
      );

    document.body
      .classList
      .remove(
        'admin-locked',
      );

    document.body
      .classList
      .add(
        'v5-admin-ready',
      );

    state.authenticated =
      true;
  }

  async function login(
    event,
  ) {
    event.preventDefault();

    const password =
      $('#adminPassword')
        ?.value
      || '';

    const message =
      $('#adminAuthMessage');

    const button =
      $('#adminLoginButton');

    if (
      !password
    ) {
      if (message) {
        message.textContent =
          'Digite a senha.';
      }

      return;
    }

    if (button) {
      button.disabled =
        true;

      button.textContent =
        'Entrando...';
    }

    if (message) {
      message.textContent =
        '';
    }

    try {
      await api(
        '/api/admin/auth/login',
        {
          method:
            'POST',

          body:
            JSON.stringify({
              password,
            }),
        },
      );

      hideAuthGate();

      installSessionControls();

      await loadV5Orders();

      triggerOldRefresh();

      toast(
        'Painel liberado.',
      );
    } catch (
      error
    ) {
      if (message) {
        message.textContent =
          error.message;
      }
    } finally {
      if (button) {
        button.disabled =
          false;

        button.textContent =
          'Entrar';
      }
    }
  }

  async function logout() {
    try {
      await api(
        '/api/admin/auth/logout',
        {
          method:
            'POST',

          body:
            '{}',
        },
      );
    } catch {
      /*
       * Mesmo se a sessão já tiver
       * expirado, mostramos o login.
       */
    }

    showAuthGate();

    const password =
      $('#adminPassword');

    if (password) {
      password.value =
        '';
    }
  }

  async function checkAuth() {
    installAuthGate();

    try {
      const data =
        await api(
          '/api/admin/auth/status',
        );

      state.authConfigured =
        data.configured
        === true;

      if (
        data.authenticated
        === true
      ) {
        hideAuthGate();

        installSessionControls();

        await loadV5Orders();

        triggerOldRefresh();

        return;
      }

      showAuthGate();

      if (
        data.configured
        !== true
      ) {
        const message =
          $('#adminAuthMessage');

        if (message) {
          message.textContent =
            'A senha administrativa ainda precisa ser configurada no Cloudflare.';
        }
      }
    } catch (
      error
    ) {
      showAuthGate();

      const message =
        $('#adminAuthMessage');

      if (message) {
        message.textContent =
          error.message;
      }
    }
  }

  /* ==================================================
     SESSÃO
  ================================================== */

  function installSessionControls() {
    if (
      $('#adminLogoutV5')
    ) {
      return;
    }

    const top =
      $('.admin-top');

    if (!top) {
      return;
    }

    top.classList.add(
      'admin-top-v5',
    );

    const nav =
      $('.admin-tabs');

    const wrap =
      document.createElement(
        'div',
      );

    wrap.className =
      'admin-session-actions';

    wrap.innerHTML = `
      <span
        class="admin-session-badge"
      >
        <i
          class="admin-session-dot"
        ></i>

        Sessão ativa
      </span>

      <button
        id="adminLogoutV5"
        class="btn btn-secondary btn-small"
        type="button"
      >
        Sair
      </button>
    `;

    if (nav) {
      nav.insertAdjacentElement(
        'afterend',
        wrap,
      );
    } else {
      top.appendChild(
        wrap,
      );
    }

    $('#adminLogoutV5')
      ?.addEventListener(
        'click',
        logout,
      );
  }

  /* ==================================================
     PEDIDOS
  ================================================== */

  async function loadV5Orders() {
    if (
      !state.authenticated
    ) {
      return;
    }

    try {
      const data =
        await api(
          '/api/admin/orders',
        );

      state.orders =
        data.orders
        || [];

      state.orderMap =
        new Map(
          state.orders.map(
            (order) => [
              Number(
                order.id,
              ),
              order,
            ],
          ),
        );

      renderSummary();

      scheduleTransform();
    } catch (
      error
    ) {
      if (
        error.status
        !== 401
      ) {
        toast(
          error.message,
          'error',
        );
      }
    }
  }

  function renderSummary() {
    const kpis =
      $('#kpis');

    if (!kpis) {
      return;
    }

    const orders =
      state.orders;

    const today =
      todayISO();

    const active =
      orders.filter(
        (order) =>
          ![
            'finished',
            'cancelled',
          ].includes(
            order.status,
          ),
      );

    const counts = {
      today:
        orders.filter(
          (order) =>
            order.eventDate
            === today,
        ).length,

      new:
        active.filter(
          (order) =>
            [
              'new',
              'ready',
            ].includes(
              order.status,
            ),
        ).length,

      production:
        active.filter(
          (order) =>
            order.status
            === 'producing',
        ).length,

      waiting:
        active.filter(
          (order) =>
            [
              'waiting_client',
              'revisions',
              'waiting_balance',
            ].includes(
              order.status,
            ),
        ).length,
    };

    kpis.className =
      'production-summary';

    kpis.innerHTML = `
      <article
        class="production-summary-card"
      >
        <span>
          🎂 Festa hoje
        </span>

        <strong>
          ${counts.today}
        </strong>
      </article>

      <article
        class="production-summary-card new"
      >
        <span>
          Novos
        </span>

        <strong>
          ${counts.new}
        </strong>
      </article>

      <article
        class="production-summary-card production"
      >
        <span>
          Em produção
        </span>

        <strong>
          ${counts.production}
        </strong>
      </article>

      <article
        class="production-summary-card waiting"
      >
        <span>
          Aguardando / ajustes
        </span>

        <strong>
          ${counts.waiting}
        </strong>
      </article>
    `;
  }

  /* ==================================================
     TRANSFORMAÇÃO DA LISTA EXISTENTE
  ================================================== */

  function scheduleTransform() {
    clearTimeout(
      state.transformTimer,
    );

    state.transformTimer =
      setTimeout(
        transformQueue,
        60,
      );
  }

  function disconnectObserver() {
    state.observer
      ?.disconnect();
  }

  function reconnectObserver() {
    const list =
      $('#ordersList');

    if (
      !list
      || !state.observer
    ) {
      return;
    }

    state.observer.observe(
      list,
      {
        childList:
          true,

        subtree:
          true,
      },
    );
  }

  function findOrderIdFromCard(
    card,
  ) {
    const button =
      $('[data-open-order]', card);

    return Number(
      button
        ?.dataset
        ?.openOrder
      || 0,
    );
  }

  function addEditButton(
    card,
    id,
  ) {
    if (
      $('[data-v5-edit]', card)
    ) {
      return;
    }

    const actions =
      $('.order-actions', card);

    if (!actions) {
      return;
    }

    const button =
      document.createElement(
        'button',
      );

    button.type =
      'button';

    button.className =
      'btn btn-secondary btn-small';

    button.dataset.v5Edit =
      String(id);

    button.textContent =
      'Editar pedido';

    button.addEventListener(
      'click',
      () => {
        openEdit(
          id,
        );
      },
    );

    actions.appendChild(
      button,
    );
  }

  function enhanceCard(
    card,
    order,
  ) {
    card.classList.add(
      'order-card-v5',
    );

    card.classList.remove(
      'is-new',
      'is-production',
      'is-waiting',
      'is-revision',
      'is-balance',
      'archived',
    );

    const css =
      cardCss(
        order.status,
      );

    if (css) {
      card.classList.add(
        css,
      );
    }

    if (
      order.urgencyEnabled
      || order.urgency_enabled
    ) {
      card.classList.add(
        'is-urgent',
      );
    }

    if (
      [
        'finished',
        'cancelled',
      ].includes(
        order.status,
      )
    ) {
      card.classList.add(
        'archived',
      );
    }

    const badgeRow =
      $('.order-meta-row.badges', card);

    if (badgeRow) {
      $('[data-v5-album-chip]', badgeRow)
        ?.remove();

      const plan =
        order.photoAlbumPlan
        || order.addons
          ?.photoAlbumPlan
        || '';

      if (plan) {
        const chip =
          document.createElement(
            'span',
          );

        chip.className =
          'badge purple';

        chip.dataset.v5AlbumChip =
          '1';

        const extraPacks =
          Number(
            order.photoAlbumExtra100
            || order.addons
              ?.photoAlbumExtra100
            || 0,
          );

        const extraText =
          extraPacks > 0
            ? ` • +${extraPacks * 100} fotos`
            : '';

        chip.textContent =
          `📷 ${albumLabel(plan)}${extraText}`;

        badgeRow.appendChild(
          chip,
        );
      }
    }

    const oldAction =
      $('.order-next-action', card);

    if (oldAction) {
      oldAction.className =
        'next-action-v5';

      oldAction.innerHTML = `
        <span>
          Próxima ação:
        </span>

        <strong>
          ${esc(
            nextAction(
              order,
            ),
          )}
        </strong>
      `;
    }

    const oldActions =
      $('.order-actions', card);

    if (oldActions) {
      oldActions.classList.add(
        'order-v5-actions',
      );
    }

    addEditButton(
      card,
      Number(
        order.id,
      ),
    );
  }

  function groupHtml({
    key,

    title,

    subtitle,

    cards,
  }) {
    const section =
      document.createElement(
        'section',
      );

    section.className =
      `queue-group queue-${key}`;

    section.innerHTML = `
      <header
        class="queue-group-header"
      >
        <div
          class="queue-group-title"
        >
          <h3>
            ${esc(title)}
          </h3>

          <span
            class="queue-group-count"
          >
            ${cards.length}
          </span>
        </div>

        <span
          class="queue-group-subtitle"
        >
          ${esc(subtitle)}
        </span>
      </header>
    `;

    const body =
      document.createElement(
        'div',
      );

    body.className =
      'orders-list';

    cards.forEach(
      (card) => {
        body.appendChild(
          card,
        );
      },
    );

    section.appendChild(
      body,
    );

    return section;
  }

  function sortCards(
    cards,
  ) {
    return cards.sort(
      (
        a,
        b,
      ) => {
        const idA =
          findOrderIdFromCard(
            a,
          );

        const idB =
          findOrderIdFromCard(
            b,
          );

        const orderA =
          state.orderMap
            .get(
              idA,
            );

        const orderB =
          state.orderMap
            .get(
              idB,
            );

        return eventTimestamp(
          orderA
          || {},
        )
        - eventTimestamp(
          orderB
          || {},
        );
      },
    );
  }

  function transformQueue() {
    if (
      state.transforming
      || !state.authenticated
    ) {
      return;
    }

    const list =
      $('#ordersList');

    if (!list) {
      return;
    }

    let cards =
      $$(
        '.order-card',
        list,
      );

    /*
     * Quando a lista já foi agrupada
     * pelo V5, os cards continuam
     * dentro do mesmo #ordersList.
     */
    if (
      !cards.length
    ) {
      cards =
        $$(
          '.order-card-v5',
          list,
        );
    }

    if (
      !cards.length
    ) {
      return;
    }

    state.transforming =
      true;

    disconnectObserver();

    try {
      const groups = {
        new:
          [],

        production:
          [],

        waiting:
          [],

        archived:
          [],
      };

      cards.forEach(
        (card) => {
          const id =
            findOrderIdFromCard(
              card,
            );

          const order =
            state.orderMap
              .get(id);

          if (!order) {
            return;
          }

          enhanceCard(
            card,
            order,
          );

          if (
            [
              'finished',
              'cancelled',
            ].includes(
              order.status,
            )
          ) {
            groups.archived
              .push(
                card,
              );

            return;
          }

          if (
            [
              'new',
              'ready',
            ].includes(
              order.status,
            )
          ) {
            groups.new
              .push(
                card,
              );

            return;
          }

          if (
            order.status
            === 'producing'
          ) {
            groups.production
              .push(
                card,
              );

            return;
          }

          groups.waiting
            .push(
              card,
            );
        },
      );

      Object.keys(
        groups,
      ).forEach(
        (key) => {
          groups[key] =
            sortCards(
              groups[key],
            );
        },
      );

      const fragment =
        document.createDocumentFragment();

      const queue =
        document.createElement(
          'div',
        );

      queue.className =
        'production-queue';

      if (
        groups.new.length
      ) {
        queue.appendChild(
          groupHtml({
            key:
              'new',

            title:
              'Novos pedidos',

            subtitle:
              'Primeiro o que ainda precisa entrar na produção',

            cards:
              groups.new,
          }),
        );
      }

      if (
        groups.production.length
      ) {
        queue.appendChild(
          groupHtml({
            key:
              'production',

            title:
              'Em produção',

            subtitle:
              'Pedidos em criação agora',

            cards:
              groups.production,
          }),
        );
      }

      if (
        groups.waiting.length
      ) {
        queue.appendChild(
          groupHtml({
            key:
              'waiting',

            title:
              'Aguardando / ajustes',

            subtitle:
              'Retornos, revisões e pagamento final',

            cards:
              groups.waiting,
          }),
        );
      }

      fragment.appendChild(
        queue,
      );

      if (
        groups.archived.length
      ) {
        const archive =
          document.createElement(
            'section',
          );

        archive.className =
          'archive-section';

        archive.innerHTML = `
          <button
            class="archive-toggle"
            type="button"
            data-archive-toggle
          >
            <span>
              Arquivados
              (${groups.archived.length})
            </span>

            <span>
              Ocultar
            </span>
          </button>

          <div
            class="archive-body"
            data-archive-body
          ></div>
        `;

        const body =
          $('[data-archive-body]', archive);

        groups.archived.forEach(
          (card) => {
            body.appendChild(
              card,
            );
          },
        );

        $('[data-archive-toggle]', archive)
          ?.addEventListener(
            'click',
            () => {
              const hidden =
                body.classList
                  .toggle(
                    'hidden',
                  );

              const label =
                $('[data-archive-toggle] span:last-child', archive);

              if (label) {
                label.textContent =
                  hidden
                    ? 'Mostrar'
                    : 'Ocultar';
              }
            },
          );

        fragment.appendChild(
          archive,
        );
      }

      list.innerHTML =
        '';

      list.appendChild(
        fragment,
      );
    } finally {
      state.transforming =
        false;

      reconnectObserver();
    }
  }

  /* ==================================================
     OBSERVER
  ================================================== */

  function installObserver() {
    const list =
      $('#ordersList');

    if (
      !list
      || state.observer
    ) {
      return;
    }

    state.observer =
      new MutationObserver(
        () => {
          if (
            !state.transforming
          ) {
            scheduleTransform();
          }
        },
      );

    reconnectObserver();
  }

  /* ==================================================
     REFRESH EXISTENTE
  ================================================== */

  function triggerOldRefresh() {
    setTimeout(
      () => {
        $('#refreshOrders')
          ?.click();

        setTimeout(
          loadV5Orders,
          160,
        );
      },
      50,
    );
  }

  /* ==================================================
     EDIÇÃO
  ================================================== */

  function formField(
    label,
    name,
    value = '',
    {
      type = 'text',

      full = false,

      placeholder = '',
    } = {},
  ) {
    return `
      <div
        class="field ${
          full
            ? 'full'
            : ''
        }"
      >
        <label>
          ${esc(label)}
        </label>

        <input
          name="${esc(name)}"
          type="${esc(type)}"
          value="${esc(
            value
            ?? '',
          )}"
          placeholder="${esc(
            placeholder,
          )}"
        >
      </div>
    `;
  }

  function textareaField(
    label,
    name,
    value = '',
    {
      full = true,

      placeholder = '',
    } = {},
  ) {
    return `
      <div
        class="field ${
          full
            ? 'full'
            : ''
        }"
      >
        <label>
          ${esc(label)}
        </label>

        <textarea
          name="${esc(name)}"
          placeholder="${esc(
            placeholder,
          )}"
        >${esc(
          value
          ?? '',
        )}</textarea>
      </div>
    `;
  }

  function selectField(
    label,
    name,
    value,
    options,
  ) {
    return `
      <div
        class="field"
      >
        <label>
          ${esc(label)}
        </label>

        <select
          name="${esc(name)}"
        >
          ${options.map(
            ([
              optionValue,
              text,
            ]) => `
              <option
                value="${esc(
                  optionValue,
                )}"
                ${
                  String(value)
                  === String(
                    optionValue,
                  )
                    ? 'selected'
                    : ''
                }
              >
                ${esc(text)}
              </option>
            `,
          ).join('')}
        </select>
      </div>
    `;
  }

  function checkboxField(
    label,
    name,
    checked,
  ) {
    return `
      <label
        class="edit-price-option"
      >
        <input
          type="checkbox"
          name="${esc(name)}"
          ${
            checked
              ? 'checked'
              : ''
          }
        >

        <span>
          <strong>
            ${esc(label)}
          </strong>
        </span>
      </label>
    `;
  }

  function editHtml(
    order,
  ) {
    const b =
      order.briefing
      || {};

    const addons =
      order.addons
      || {};

    const manualSubtotal =
      order.pricing
        ?.manualSubtotalCents
      ?? null;

    return `
      <form
        id="editOrderV5Form"
        class="edit-order-v5"
      >
        <section
          class="edit-section-v5"
        >
          <h3>
            Cliente e festa
          </h3>

          <div
            class="edit-grid-v5"
          >
            ${formField(
              'Nome da cliente',
              'customerName',
              order.customer_name,
            )}

            ${formField(
              'WhatsApp',
              'whatsapp',
              order.whatsapp,
            )}

            ${formField(
              'Nome da criança / homenageado(a)',
              'honoreeName',
              order.honoree_name,
            )}

            ${formField(
              'Nome no convite',
              'displayName',
              order.display_name,
            )}

            ${formField(
              'Idade',
              'age',
              order.age,
              {
                type:
                  'number',
              },
            )}

            ${formField(
              'Tema',
              'theme',
              order.theme,
            )}

            ${formField(
              'Data',
              'eventDate',
              order.event_date,
              {
                type:
                  'date',
              },
            )}

            ${formField(
              'Horário',
              'eventTime',
              order.event_time,
              {
                type:
                  'time',
              },
            )}

            ${formField(
              'Local',
              'venueName',
              order.venue_name,
            )}

            ${formField(
              'Endereço',
              'venueAddress',
              order.venue_address,
              {
                full:
                  true,
              },
            )}

            ${formField(
              'Link da localização',
              'locationUrl',
              b.locationUrl
              || order.location_url,
              {
                full:
                  true,
              },
            )}
          </div>
        </section>

        <section
          class="edit-section-v5"
        >
          <h3>
            Produto e adicionais
          </h3>

          <div
            class="edit-grid-v5"
          >
            ${selectField(
              'Experiência',
              'experience',
              order.experience,
              [
                [
                  'full',
                  'Completa',
                ],
                [
                  'reduced',
                  'Reduzida',
                ],
              ],
            )}

            ${selectField(
              'Formato',
              'format',
              order.format,
              [
                [
                  'video',
                  'Vídeo',
                ],
                [
                  'interactive',
                  'Interativo',
                ],
              ],
            )}

            ${selectField(
              'Libri Moments',
              'photoAlbumPlan',
              addons.photoAlbumPlan
              || '',
              [
                [
                  '',
                  'Sem álbum',
                ],
                [
                  'festa',
                  'Festa - R$ 79',
                ],
                [
                  'premium',
                  'Premium - R$ 119',
                ],
                [
                  'exclusive',
                  'Exclusive - R$ 149',
                ],
              ],
            )}

            ${formField(
              'Pacotes de +100 fotos',
              'photoAlbumExtra100',
              addons.photoAlbumExtra100
              || 0,
              {
                type:
                  'number',
              },
            )}

            ${formField(
              'Cenas extras',
              'extraScene',
              addons.extraScene
              || 0,
              {
                type:
                  'number',
              },
            )}

            ${formField(
              'Pessoas extras',
              'extraPerson',
              addons.extraPerson
              || 0,
              {
                type:
                  'number',
              },
            )}
          </div>

          <div
            class="edit-price-options"
          >
            ${checkboxField(
              'Confirmação Libri',
              'confirmation',
              addons.confirmation
              === true,
            )}

            ${checkboxField(
              'Filtro personalizado avulso',
              'filter',
              addons.filter
              === true,
            )}
          </div>

          <div
            class="edit-commercial-warning"
          >
            Alterar produto ou adicionais pode alterar o valor contratado.
            Escolha abaixo como tratar o preço.
          </div>

          <div
            class="edit-price-options"
          >
            <label
              class="edit-price-option"
            >
              <input
                type="radio"
                name="priceMode"
                value="keep"
                checked
              >

              <span>
                <strong>
                  Manter valor atual
                </strong>

                <span>
                  Use quando estiver corrigindo apenas informações do pedido.
                </span>
              </span>
            </label>

            <label
              class="edit-price-option"
            >
              <input
                type="radio"
                name="priceMode"
                value="recalculate"
              >

              <span>
                <strong>
                  Recalcular pelo preço atual
                </strong>

                <span>
                  Use quando o produto ou os adicionais realmente mudaram.
                </span>
              </span>
            </label>

            <label
              class="edit-price-option"
            >
              <input
                type="radio"
                name="priceMode"
                value="manual"
              >

              <span>
                <strong>
                  Informar valor-base contratado
                </strong>

                <span>
                  Para acordos especiais feitos com a cliente.
                </span>
              </span>
            </label>
          </div>

          <div
            id="manualPriceV5"
            class="edit-grid-v5 hidden"
            style="margin-top:10px"
          >
            ${formField(
              'Valor-base contratado em R$',
              'manualSubtotal',
              manualSubtotal
                ? reaisFromCents(
                  manualSubtotal,
                )
                : '',
              {
                placeholder:
                  'Ex.: 180,00',
              },
            )}
          </div>
        </section>

        <section
          class="edit-section-v5"
        >
          <h3>
            Presentes e recursos
          </h3>

          <div
            class="edit-grid-v5"
          >
            ${selectField(
              'Página de presentes',
              'giftPage',
              b.giftPage
              || 'unsure',
              [
                [
                  'yes',
                  'Sim',
                ],
                [
                  'no',
                  'Não',
                ],
                [
                  'unsure',
                  'A definir',
                ],
              ],
            )}

            ${selectField(
              'Modo da confirmação',
              'confirmationMode',
              b.confirmationMode
              || 'unsure',
              [
                [
                  'open',
                  'Livre',
                ],
                [
                  'list',
                  'Lista de convidados',
                ],
                [
                  'unsure',
                  'A definir',
                ],
              ],
            )}

            ${textareaField(
              'Sugestões de presentes',
              'giftDetails',
              b.giftDetails,
            )}
          </div>
        </section>

        <section
          class="edit-section-v5"
        >
          <h3>
            Briefing
          </h3>

          <div
            class="edit-grid-v5"
          >
            ${textareaField(
              'Personagem específico',
              'characterWanted',
              b.characterWanted,
              {
                full:
                  false,
              },
            )}

            ${textareaField(
              'Não pode faltar',
              'mustHave',
              b.mustHave,
              {
                full:
                  false,
              },
            )}

            ${textareaField(
              'Não quer',
              'avoid',
              b.avoid,
              {
                full:
                  false,
              },
            )}

            ${textareaField(
              'Informações especiais',
              'specialInfo',
              b.specialInfo,
              {
                full:
                  false,
              },
            )}

            ${textareaField(
              'Detalhes da roupa',
              'outfitDetails',
              b.outfitDetails,
              {
                full:
                  false,
              },
            )}

            ${textareaField(
              'Detalhes da aparência',
              'appearanceDetails',
              b.appearanceDetails,
              {
                full:
                  false,
              },
            )}

            ${textareaField(
              'Cores desejadas',
              'colors',
              b.colors,
              {
                full:
                  false,
              },
            )}

            ${textareaField(
              'Cores a evitar',
              'colorsAvoided',
              b.colorsAvoided,
              {
                full:
                  false,
              },
            )}

            ${textareaField(
              'Ideia / referência',
              'creativeIdea',
              b.creativeIdea,
            )}

            ${textareaField(
              'Frase própria',
              'ownSpeech',
              b.ownSpeech,
            )}
          </div>
        </section>

        <div
          id="editOrderV5Message"
          class="admin-auth-message"
        ></div>

        <div
          class="form-actions"
        >
          <button
            id="cancelEditV5"
            class="btn btn-secondary"
            type="button"
          >
            Cancelar
          </button>

          <button
            id="saveEditV5"
            class="btn btn-primary"
            type="submit"
          >
            Salvar alterações
          </button>
        </div>
      </form>
    `;
  }

  async function openEdit(
    id,
  ) {
    try {
      const data =
        await api(
          `/api/admin/orders/${id}`,
        );

      state.currentEdit =
        data.order;

      const modal =
        $('#infoModal');

      const title =
        $('#infoModalTitle');

      const body =
        $('#infoModalBody');

      if (
        !modal
        || !title
        || !body
      ) {
        return;
      }

      title.textContent =
        `Editar ${
          data.order.order_code
          || ''
        }`;

      body.innerHTML =
        editHtml(
          data.order,
        );

      modal
        .classList
        .remove(
          'hidden',
        );

      bindEditForm();
    } catch (
      error
    ) {
      toast(
        error.message,
        'error',
      );
    }
  }

  function closeEditModal() {
    $('#infoModal')
      ?.classList
      .add(
        'hidden',
      );

    state.currentEdit =
      null;
  }

  function editSelectionFromOrder(
    order,
  ) {
    const addons =
      order.addons
      || {};

    return {
      experience:
        order.experience
        || '',

      format:
        order.format
        || '',

      confirmation:
        addons.confirmation
        === true,

      filter:
        addons.filter
        === true,

      extraScene:
        Number(
          addons.extraScene
          || 0,
        ),

      extraPerson:
        Number(
          addons.extraPerson
          || 0,
        ),

      photoAlbumPlan:
        addons.photoAlbumPlan
        || '',

      photoAlbumExtra100:
        Number(
          addons.photoAlbumExtra100
          || 0,
        ),
    };
  }

  function editSelectionFromForm(
    form,
  ) {
    const data =
      new FormData(
        form,
      );

    return {
      experience:
        normalizeText(
          data.get(
            'experience',
          ),
        ),

      format:
        normalizeText(
          data.get(
            'format',
          ),
        ),

      confirmation:
        data.get(
          'confirmation',
        )
        === 'on',

      filter:
        data.get(
          'filter',
        )
        === 'on',

      extraScene:
        Math.max(
          0,
          Number(
            data.get(
              'extraScene',
            )
            || 0,
          ),
        ),

      extraPerson:
        Math.max(
          0,
          Number(
            data.get(
              'extraPerson',
            )
            || 0,
          ),
        ),

      photoAlbumPlan:
        normalizeText(
          data.get(
            'photoAlbumPlan',
          ),
        ),

      photoAlbumExtra100:
        Math.max(
          0,
          Number(
            data.get(
              'photoAlbumExtra100',
            )
            || 0,
          ),
        ),
    };
  }

  function selectionChanged(
    before,
    after,
  ) {
    return JSON.stringify(
      before,
    )
    !== JSON.stringify(
      after,
    );
  }

  function bindEditForm() {
    const form =
      $('#editOrderV5Form');

    if (!form) {
      return;
    }

    $$(
      'input[name="priceMode"]',
      form,
    ).forEach(
      (radio) => {
        radio.addEventListener(
          'change',
          () => {
            $('#manualPriceV5')
              ?.classList
              .toggle(
                'hidden',
                radio.value
                !== 'manual',
              );
          },
        );
      },
    );

    const album =
      $('[name="photoAlbumPlan"]', form);

    const filter =
      $('[name="filter"]', form);

    album
      ?.addEventListener(
        'change',
        () => {
          if (
            album.value
          ) {
            if (filter) {
              filter.checked =
                false;
            }
          }
        },
      );

    $('#cancelEditV5')
      ?.addEventListener(
        'click',
        closeEditModal,
      );

    form.addEventListener(
      'submit',
      saveEdit,
    );
  }

  async function saveEdit(
    event,
  ) {
    event.preventDefault();

    const form =
      event.currentTarget;

    const order =
      state.currentEdit;

    if (
      !order
      || !order.id
    ) {
      return;
    }

    const data =
      new FormData(
        form,
      );

    const beforeSelection =
      editSelectionFromOrder(
        order,
      );

    const afterSelection =
      editSelectionFromForm(
        form,
      );

    const changed =
      selectionChanged(
        beforeSelection,
        afterSelection,
      );

    const priceMode =
      data.get(
        'priceMode',
      )
      || 'keep';

    const message =
      $('#editOrderV5Message');

    if (
      changed
      && priceMode
      === 'keep'
    ) {
      if (message) {
        message.textContent =
          'Você alterou produto ou adicionais. Escolha recalcular o valor ou informar um valor-base contratado.';
      }

      return;
    }

    const payload = {
      customerName:
        normalizeText(
          data.get(
            'customerName',
          ),
        ),

      whatsapp:
        normalizeText(
          data.get(
            'whatsapp',
          ),
        ),

      honoreeName:
        normalizeText(
          data.get(
            'honoreeName',
          ),
        ),

      displayName:
        normalizeText(
          data.get(
            'displayName',
          ),
        ),

      age:
        data.get(
          'age',
        ),

      theme:
        normalizeText(
          data.get(
            'theme',
          ),
        ),

      eventDate:
        normalizeText(
          data.get(
            'eventDate',
          ),
        ),

      eventTime:
        normalizeText(
          data.get(
            'eventTime',
          ),
        ),

      venueName:
        normalizeText(
          data.get(
            'venueName',
          ),
        ),

      venueAddress:
        normalizeText(
          data.get(
            'venueAddress',
          ),
        ),

      locationUrl:
        normalizeText(
          data.get(
            'locationUrl',
          ),
        ),

      experience:
        afterSelection
          .experience,

      format:
        afterSelection
          .format,

      addons: {
        confirmation:
          afterSelection
            .confirmation,

        filter:
          afterSelection
            .photoAlbumPlan
            ? false
            : afterSelection
              .filter,

        extraScene:
          afterSelection
            .extraScene,

        extraPerson:
          afterSelection
            .extraPerson,

        photoAlbumPlan:
          afterSelection
            .photoAlbumPlan,

        photoAlbumExtra100:
          afterSelection
            .photoAlbumPlan
            ? afterSelection
              .photoAlbumExtra100
            : 0,
      },

      briefing: {
        giftPage:
          normalizeText(
            data.get(
              'giftPage',
            ),
          ),

        giftDetails:
          normalizeText(
            data.get(
              'giftDetails',
            ),
          ),

        confirmationMode:
          normalizeText(
            data.get(
              'confirmationMode',
            ),
          ),

        characterWanted:
          normalizeText(
            data.get(
              'characterWanted',
            ),
          ),

        mustHave:
          normalizeText(
            data.get(
              'mustHave',
            ),
          ),

        avoid:
          normalizeText(
            data.get(
              'avoid',
            ),
          ),

        specialInfo:
          normalizeText(
            data.get(
              'specialInfo',
            ),
          ),

        outfitDetails:
          normalizeText(
            data.get(
              'outfitDetails',
            ),
          ),

        appearanceDetails:
          normalizeText(
            data.get(
              'appearanceDetails',
            ),
          ),

        colors:
          normalizeText(
            data.get(
              'colors',
            ),
          ),

        colorsAvoided:
          normalizeText(
            data.get(
              'colorsAvoided',
            ),
          ),

        creativeIdea:
          normalizeText(
            data.get(
              'creativeIdea',
            ),
          ),

        ownSpeech:
          normalizeText(
            data.get(
              'ownSpeech',
            ),
          ),
      },
    };

    if (
      priceMode
      === 'recalculate'
    ) {
      payload.recalculatePrice =
        true;
    }

    if (
      priceMode
      === 'manual'
    ) {
      const manual =
        centsFromReais(
          data.get(
            'manualSubtotal',
          ),
        );

      if (!manual) {
        if (message) {
          message.textContent =
            'Informe um valor-base contratado válido.';
        }

        return;
      }

      payload.manualSubtotalCents =
        manual;
    }

    const button =
      $('#saveEditV5');

    if (button) {
      button.disabled =
        true;

      button.textContent =
        'Salvando...';
    }

    if (message) {
      message.textContent =
        '';
    }

    try {
      await api(
        `/api/admin/orders/${order.id}/edit`,
        {
          method:
            'PATCH',

          body:
            JSON.stringify(
              payload,
            ),
        },
      );

      closeEditModal();

      toast(
        'Pedido atualizado.',
      );

      await loadV5Orders();

      triggerOldRefresh();
    } catch (
      error
    ) {
      if (message) {
        message.textContent =
          error.message;
      }
    } finally {
      if (button) {
        button.disabled =
          false;

        button.textContent =
          'Salvar alterações';
      }
    }
  }

  /* ==================================================
     TOOLBAR
  ================================================== */

  function simplifyToolbar() {
    const filter =
      $('#statusFilter');

    if (filter) {
      /*
       * O V5 separa os pedidos
       * automaticamente.
       *
       * Limpamos o filtro antigo antes
       * de escondê-lo para que um valor
       * preservado pelo navegador não
       * faça pedidos desaparecerem.
       */
      filter.value =
        '';

      filter.classList.add(
        'hidden',
      );
    }

    const toolbar =
      $('.orders-toolbar');

    if (toolbar) {
      toolbar.classList.add(
        'production-toolbar',
      );
    }
  }

  /* ==================================================
     BOTÃO MANUAL
  ================================================== */

  function markManualButton() {
    const buttons =
      $$('button');

    const manual =
      buttons.find(
        (button) =>
          normalizeText(
            button.textContent,
          )
            .toLowerCase()
            .includes(
              'novo pedido manual',
            ),
      );

    if (manual) {
      manual.classList.add(
        'btn-new-order',
      );
    }
  }

  /* ==================================================
     EVENTOS DE REFRESH
  ================================================== */

  function installRefreshHooks() {
    $('#refreshOrders')
      ?.addEventListener(
        'click',
        () => {
          setTimeout(
            loadV5Orders,
            180,
          );
        },
      );

    $('#search')
      ?.addEventListener(
        'input',
        () => {
          setTimeout(
            scheduleTransform,
            500,
          );
        },
      );
  }

  /* ==================================================
     INIT
  ================================================== */

  function init() {
    installAuthGate();

    simplifyToolbar();

    installObserver();

    installRefreshHooks();

    /*
     * admin-manual.js pode inserir
     * o botão alguns instantes depois.
     */
    setTimeout(
      markManualButton,
      250,
    );

    setTimeout(
      markManualButton,
      900,
    );

    checkAuth();
  }

  if (
    document.readyState
    === 'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      init,
      {
        once:
          true,
      },
    );
  } else {
    init();
  }
})();
