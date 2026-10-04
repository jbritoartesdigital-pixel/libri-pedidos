import {
  api,
  dateTimeBr,
  empty,
  esc,
  setViewMeta,
  showToast,
  viewRoot,
} from './admin-v2-core.js';

import {
  registerAdditionalPasskey,
  securityView,
} from './admin-v2-auth.js';

export async function renderSecurity() {
  setViewMeta(
    'Segurança',
    'Passkeys e aparelhos',
  );

  const data =
    await securityView();

  viewRoot.innerHTML = `
    <div class="section-grid">
      <section class="card">
        <div class="section-title">
          <h2>Sessão</h2>
        </div>

        <div class="row-card">
          <strong>
            ${esc(data.status.session?.deviceLabel || 'Passkey')}
          </strong>

          <small>
            Sessão válida até
            ${dateTimeBr(data.status.session?.expiresAt)}
          </small>
        </div>

        <div class="notice" style="margin-top:12px">
          A biometria não é enviada para a Libri.
          O painel usa WebAuthn/Passkey e armazena somente os dados públicos da credencial necessários para autenticar.
        </div>
      </section>

      <section class="card">
        <div class="section-title">
          <h2>Aparelhos</h2>

          <button
            id="addPasskey"
            class="btn btn-secondary"
            type="button"
          >
            Adicionar Passkey
          </button>
        </div>

        <div class="list">
          ${
            data.devices.length
              ? data.devices.map(
                (device) => `
                  <div class="row-card">
                    <strong>
                      ${esc(device.deviceLabel || device.label || 'Passkey')}
                    </strong>

                    <small>
                      ${device.lastUsedAt ? `Último uso ${dateTimeBr(device.lastUsedAt)}` : ''}
                    </small>

                    ${
                      device.id
                        ? `
                          <button
                            class="btn btn-danger"
                            type="button"
                            data-revoke-passkey="${device.id}"
                            style="margin-top:8px"
                          >
                            Revogar
                          </button>
                        `
                        : ''
                    }
                  </div>
                `,
              ).join('')
              : empty('Nenhum aparelho listado.')
          }
        </div>
      </section>
    </div>
  `;

  document
    .getElementById('addPasskey')
    .addEventListener(
      'click',
      async () => {
        const label =
          prompt(
            'Nome deste aparelho:',
            'Novo aparelho',
          );

        if (!label) {
          return;
        }

        try {
          await registerAdditionalPasskey(
            label,
          );

          showToast('Passkey adicionada ✓');
          await renderSecurity();
        } catch (error) {
          showToast(error.message);
        }
      },
    );

  viewRoot
    .querySelectorAll('[data-revoke-passkey]')
    .forEach(
      (button) =>
        button.addEventListener(
          'click',
          async () => {
            if (
              !confirm(
                'Revogar esta Passkey?',
              )
            ) {
              return;
            }

            try {
              await api(
                `/api/admin/v2/auth/devices/${button.dataset.revokePasskey}/revoke`,
                {
                  method: 'POST',
                  body: '{}',
                },
              );

              showToast('Passkey revogada.');
              await renderSecurity();
            } catch (error) {
              showToast(error.message);
            }
          },
        ),
    );
}
