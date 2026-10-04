import {
  bindNav,
  loading,
  setBellCount,
  state,
} from './admin-v2-core.js';

import {
  ensureAuth,
  logout,
} from './admin-v2-auth.js';

import {
  renderCentral,
} from './admin-v2-central.js';

import {
  renderProduction,
} from './admin-v2-production.js';

import {
  openOrder,
} from './admin-v2-order.js';

import {
  renderAgenda,
} from './admin-v2-agenda.js';

import {
  renderFinance,
} from './admin-v2-finance.js';

import {
  renderStore,
} from './admin-v2-config.js';

import {
  refreshBell,
  renderNotifications,
} from './admin-v2-notifications.js';

import {
  renderSecurity,
} from './admin-v2-security.js';

async function renderCurrent() {
  loading();

  const open =
    async (code) =>
      openOrder(
        code,
        renderCurrent,
      );

  if (
    state.view === 'production'
  ) {
    await renderProduction(open);
  } else if (
    state.view === 'agenda'
  ) {
    await renderAgenda();
  } else if (
    state.view === 'finance'
  ) {
    await renderFinance();
  } else if (
    state.view === 'store'
  ) {
    await renderStore();
  } else if (
    state.view === 'notifications'
  ) {
    await renderNotifications();
  } else if (
    state.view === 'security'
  ) {
    await renderSecurity();
  } else {
    await renderCentral(open);
  }

  await refreshBell();
}

async function ready() {
  bindNav(
    async () => {
      try {
        await renderCurrent();
      } catch (error) {
        document
          .getElementById('viewRoot')
          .innerHTML = `
            <div class="card empty">
              ${error.message}
            </div>
          `;
      }
    },
  );

  document
    .getElementById('refreshBtn')
    .addEventListener(
      'click',
      renderCurrent,
    );

  document
    .getElementById('notificationBell')
    .addEventListener(
      'click',
      async () => {
        state.view =
          'notifications';

        document
          .querySelectorAll('[data-view]')
          .forEach(
            (button) =>
              button.classList.toggle(
                'active',
                button.dataset.view
                === 'notifications',
              ),
          );

        await renderCurrent();
      },
    );

  document
    .getElementById('logoutBtn')
    .addEventListener(
      'click',
      logout,
    );

  await renderCurrent();

  const orderCode =
    new URLSearchParams(
      window.location.search,
    )
      .get(
        'order',
      );

  if (
    orderCode
    && /^LIBRI-\d+$/
      .test(
        orderCode,
      )
  ) {
    try {
      await openOrder(
        orderCode,
        renderCurrent,
      );
    } finally {
      const cleanUrl =
        new URL(
          window.location.href,
        );

      cleanUrl.searchParams
        .delete(
          'order',
        );

      history.replaceState(
        {},
        '',
        `${
          cleanUrl.pathname
        }${
          cleanUrl.search
        }${
          cleanUrl.hash
        }`,
      );
    }
  }
}

window.addEventListener(
  'libri-admin-unauthorized',
  () => {
    setBellCount(0);
    location.reload();
  },
);

ensureAuth(ready)
  .catch(
    (error) => {
      document
        .getElementById('authGate')
        .classList
        .remove('hidden');

      document
        .getElementById('authGate')
        .innerHTML = `
          <section class="auth-card">
            <span class="eyebrow">Admin V2</span>
            <h1>Não foi possível abrir o painel</h1>
            <p>${error.message}</p>
          </section>
        `;
    },
  );
