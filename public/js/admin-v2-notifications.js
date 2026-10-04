import {
  api,
  dateTimeBr,
  empty,
  esc,
  setBellCount,
  setViewMeta,
  showToast,
  viewRoot,
} from './admin-v2-core.js';

function b64urlToUint8(value) {
  const padded =
    value
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(
        Math.ceil(value.length / 4) * 4,
        '=',
      );

  const raw =
    atob(padded);

  return Uint8Array.from(
    raw,
    (char) =>
      char.charCodeAt(0),
  );
}

export async function refreshBell() {
  try {
    const data =
      await api(
        '/api/admin/v2/notifications?unread=1&limit=1',
      );

    setBellCount(
      data.result
        ?.unreadCount
      || 0,
    );
  } catch {
    setBellCount(0);
  }
}

async function enablePush() {
  const config =
    await api(
      '/api/admin/v2/notifications/push/config',
    );

  if (
    !config.push
      ?.configured
  ) {
    throw new Error(
      'Web Push ainda não está configurado no Worker.',
    );
  }

  const registration =
    await navigator.serviceWorker.register(
      config.push.serviceWorkerPath,
    );

  const permission =
    await Notification.requestPermission();

  if (
    permission !== 'granted'
  ) {
    throw new Error(
      'Permissão de notificação não concedida.',
    );
  }

  let subscription =
    await registration
      .pushManager
      .getSubscription();

  if (!subscription) {
    subscription =
      await registration
        .pushManager
        .subscribe({
          userVisibleOnly: true,
          applicationServerKey:
            b64urlToUint8(
              config.push.publicKey,
            ),
        });
  }

  await api(
    '/api/admin/v2/notifications/push/subscribe',
    {
      method: 'POST',
      body:
        JSON.stringify(
          subscription.toJSON(),
        ),
    },
  );
}

export async function renderNotifications() {
  setViewMeta(
    'Notificações',
    'Sino e Push',
  );

  const [
    listData,
    prefsData,
    pushData,
  ] =
    await Promise.all([
      api(
        '/api/admin/v2/notifications?limit=50',
      ),
      api(
        '/api/admin/v2/notifications/preferences',
      ),
      api(
        '/api/admin/v2/notifications/push/config',
      ),
    ]);

  const result =
    listData.result;

  setBellCount(
    result.unreadCount,
  );

  viewRoot.innerHTML = `
    <div class="toolbar">
      <button id="markAllRead" class="btn btn-ghost" type="button">
        Marcar todas como lidas
      </button>

      <button id="enablePush" class="btn btn-secondary" type="button">
        Ativar notificações neste aparelho
      </button>

      <button id="testPush" class="btn btn-ghost" type="button" ${pushData.push?.configured ? '' : 'disabled'}>
        Testar Push
      </button>
    </div>

    <div class="section-grid">
      <section class="card">
        <div class="section-title">
          <h2>Sino</h2>
          <span class="status">${result.unreadCount} não lida(s)</span>
        </div>

        <div class="list">
          ${
            result.notifications.length
              ? result.notifications.map(
                (n) => `
                  <article
                    class="notification-card ${n.read ? '' : 'unread'} ${n.resolved ? 'resolved' : ''}"
                  >
                    <div>
                      <h3>${esc(n.title)}</h3>
                      <p>
                        ${esc(n.body)}
                        <br>
                        ${dateTimeBr(n.createdAt)}
                      </p>
                    </div>

                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                      ${
                        !n.read
                          ? `
                            <button
                              class="btn btn-ghost"
                              type="button"
                              data-read="${n.id}"
                            >
                              Lida
                            </button>
                          `
                          : ''
                      }

                      ${
                        !n.resolved
                          ? `
                            <button
                              class="btn btn-success"
                              type="button"
                              data-resolve="${n.id}"
                            >
                              Resolver
                            </button>
                          `
                          : ''
                      }
                    </div>
                  </article>
                `,
              ).join('')
              : empty('Nenhuma notificação.')
          }
        </div>
      </section>

      <section class="card">
        <div class="section-title">
          <h2>Preferências</h2>
        </div>

        <div class="list">
          ${prefsData.preferences.map(
            (pref) => `
              <div class="row-card">
                <strong>${esc(pref.eventCode)}</strong>

                <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap">
                  <label>
                    <input
                      type="checkbox"
                      data-pref="${esc(pref.eventCode)}"
                      data-pref-kind="bell"
                      ${pref.bellEnabled ? 'checked' : ''}
                    >
                    Sino
                  </label>

                  <label>
                    <input
                      type="checkbox"
                      data-pref="${esc(pref.eventCode)}"
                      data-pref-kind="push"
                      ${pref.pushEnabled ? 'checked' : ''}
                    >
                    Push
                  </label>
                </div>
              </div>
            `,
          ).join('')}
        </div>
      </section>
    </div>
  `;

  document
    .getElementById('markAllRead')
    .addEventListener(
      'click',
      async () => {
        await api(
          '/api/admin/v2/notifications/read-all',
          {
            method: 'POST',
            body: '{}',
          },
        );

        await renderNotifications();
      },
    );

  document
    .getElementById('enablePush')
    .addEventListener(
      'click',
      async () => {
        try {
          await enablePush();
          showToast('Notificações ativadas ✓');
        } catch (error) {
          showToast(error.message);
        }
      },
    );

  document
    .getElementById('testPush')
    .addEventListener(
      'click',
      async () => {
        try {
          await api(
            '/api/admin/v2/notifications/push/test',
            {
              method: 'POST',
              body: '{}',
            },
          );

          showToast('Push de teste enviado.');
        } catch (error) {
          showToast(error.message);
        }
      },
    );

  viewRoot
    .querySelectorAll('[data-read]')
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          async () => {
            await api(
              `/api/admin/v2/notifications/${button.dataset.read}/read`,
              {
                method: 'POST',
                body: '{}',
              },
            );

            await renderNotifications();
          },
        ),
    );

  viewRoot
    .querySelectorAll('[data-resolve]')
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          async () => {
            await api(
              `/api/admin/v2/notifications/${button.dataset.resolve}/resolve`,
              {
                method: 'POST',
                body: '{}',
              },
            );

            await renderNotifications();
          },
        ),
    );

  viewRoot
    .querySelectorAll('[data-pref]')
    .forEach(
      (input) =>
        input.addEventListener(
          'change',
          async () => {
            const code =
              input.dataset.pref;

            const bell =
              viewRoot.querySelector(
                `[data-pref="${CSS.escape(code)}"][data-pref-kind="bell"]`,
              ).checked;

            const push =
              viewRoot.querySelector(
                `[data-pref="${CSS.escape(code)}"][data-pref-kind="push"]`,
              ).checked;

            await api(
              `/api/admin/v2/notifications/preferences/${code}`,
              {
                method: 'PATCH',
                body:
                  JSON.stringify({
                    bellEnabled: bell,
                    pushEnabled: push,
                  }),
              },
            );
          },
        ),
    );
}
