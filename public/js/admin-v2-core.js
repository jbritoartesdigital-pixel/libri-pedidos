import { recordAdminDiagnostic } from './admin-v2-diagnostics.js';

export async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  let response;
  try {
    response = await fetch(
      path,
      {
        credentials: 'same-origin',
        ...options,
        headers: {
          ...(options.body
          && !(options.body instanceof FormData)
            ? {
              'content-type':
                'application/json',
            }
            : {}),
          ...(options.headers || {}),
        },
      },
    );
  } catch (error) {
    recordAdminDiagnostic({ type: 'NETWORK', route: path, method });
    throw error;
  }

  const contentType =
    response.headers.get('content-type')
    || '';

  const data =
    contentType.includes('application/json')
      ? await response.json()
      : null;

  if (!response.ok) {
    if (response.status !== 401) {
      recordAdminDiagnostic({
        type: 'HTTP',
        route: path,
        method,
        status: response.status,
        errorId: response.headers.get('x-libri-error-id') || data?.errorId,
      });
    }
    const error =
      new Error(
        data?.error
        || data?.message
        || `Erro ${response.status}`,
      );

    error.status =
      response.status;

    error.data =
      data;

    if (response.status === 401) {
      window.dispatchEvent(
        new CustomEvent('libri-admin-unauthorized'),
      );
    }

    throw error;
  }

  return data;
}

let toastTimer;

export function showToast(message) {
  clearTimeout(toastTimer);

  toast.textContent =
    message;

  toast.classList.remove('hidden');

  toastTimer =
    setTimeout(
      () =>
        toast.classList.add('hidden'),
      2800,
    );
}

export function modal(
  title,
  html,
  {
    width = '920px',
  } = {},
) {
  modalRoot.innerHTML = `
    <section
      class="modal"
      style="width:min(${esc(width)},100%)"
      role="dialog"
      aria-modal="true"
    >
      <header class="modal-head">
        <h2>${esc(title)}</h2>

        <button
          class="close-btn"
          type="button"
          aria-label="Fechar"
        >
          ×
        </button>
      </header>

      <div class="modal-body">
        ${html}
      </div>
    </section>
  `;

  modalRoot.classList.remove('hidden');
  modalRoot.setAttribute('aria-hidden', 'false');

  const close = () => {
    modalRoot.classList.add('hidden');
    modalRoot.setAttribute('aria-hidden', 'true');
    modalRoot.innerHTML = '';
  };

  modalRoot
    .querySelector('.close-btn')
    .addEventListener('click', close);

  modalRoot.addEventListener(
    'click',
    (event) => {
      if (event.target === modalRoot) {
        close();
      }
    },
    {
      once: true,
    },
  );

  return close;
}

export function setViewMeta(title, eyebrow) {
  viewTitle.textContent =
    title;

  viewEyebrow.textContent =
    eyebrow;
}

export function loading(label = 'Carregando...') {
  viewRoot.innerHTML = `
    <div class="card empty">
      ${esc(label)}
    </div>
  `;
}

export function empty(label) {
  return `
    <div class="empty">
      ${esc(label)}
    </div>
  `;
}

export function statusClass(status) {
  if (
    [
      'ready_for_delivery',
      'finalized',
      'approved',
    ].includes(status)
  ) {
    return 'green';
  }

  if (
    [
      'balance_pending',
      'waiting_customer',
      'awaiting_urgency_decision',
    ].includes(status)
  ) {
    return 'yellow';
  }

  if (
    [
      'in_production',
      'ready_for_production',
    ].includes(status)
  ) {
    return 'blue';
  }

  return '';
}

export function bindNav(onChange) {
  document
    .querySelectorAll('[data-view]')
    .forEach(
      (button) => {
        button.addEventListener(
          'click',
          () => {
            state.view =
              button.dataset.view;

            document
              .querySelectorAll('[data-view]')
              .forEach(
                (entry) =>
                  entry.classList.toggle(
                    'active',
                    entry === button,
                  ),
              );

            onChange(state.view);
          },
        );
      },
    );
}

export function setBellCount(count) {
  const bubble =
    document.getElementById('bellCount');

  bubble.textContent =
    String(count || 0);

  bubble.classList.toggle(
    'hidden',
    !count,
  );
}
