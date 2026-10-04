export const app =
  document.getElementById(
    'app',
  );

export const headerHelp =
  document.getElementById(
    'headerHelp',
  );

export const brandSubtitle =
  document.getElementById(
    'brandSubtitle',
  );

const toast =
  document.getElementById(
    'toast',
  );

const modalRoot =
  document.getElementById(
    'modalRoot',
  );

export function esc(
  value,
) {
  return String(
    value ?? '',
  )
    .replace(
      /&/g,
      '&amp;',
    )
    .replace(
      /</g,
      '&lt;',
    )
    .replace(
      />/g,
      '&gt;',
    )
    .replace(
      /"/g,
      '&quot;',
    )
    .replace(
      /'/g,
      '&#039;',
    );
}

export function money(
  cents,
) {
  return new Intl.NumberFormat(
    'pt-BR',
    {
      style:
        'currency',
      currency:
        'BRL',
    },
  ).format(
    Number(cents || 0) / 100,
  );
}

export function dateBr(
  value,
) {
  if (!value) {
    return '';
  }

  const date =
    new Date(
      `${value}T12:00:00Z`,
    );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return value;
  }

  return new Intl.DateTimeFormat(
    'pt-BR',
    {
      timeZone:
        'UTC',
      day:
        '2-digit',
      month:
        '2-digit',
      year:
        'numeric',
    },
  ).format(date);
}

export function debounce(
  fn,
  wait = 350,
) {
  let timer;

  return (...args) => {
    window.clearTimeout(timer);

    timer =
      window.setTimeout(
        () =>
          fn(...args),
        wait,
      );
  };
}

export async function api(
  path,
  options = {},
) {
  const response =
    await fetch(
      path,
      {
        credentials:
          'same-origin',
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

  const type =
    response.headers.get(
      'content-type',
    )
    || '';

  const data =
    type.includes(
      'application/json',
    )
      ? await response.json()
      : null;

  if (!response.ok) {
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

    throw error;
  }

  return data;
}

let toastTimer;

export function showToast(
  message,
) {
  window.clearTimeout(
    toastTimer,
  );

  toast.textContent =
    message;

  toast.classList.remove(
    'hidden',
  );

  toastTimer =
    window.setTimeout(
      () => {
        toast.classList.add(
          'hidden',
        );
      },
      2600,
    );
}

export function modal(
  title,
  bodyHtml,
  {
    wide = false,
  } = {},
) {
  modalRoot.innerHTML = `
    <section
      class="modal-card"
      ${wide ? 'style="width:min(960px,100%)"' : ''}
      role="dialog"
      aria-modal="true"
      aria-label="${esc(title)}"
    >
      <header class="modal-head">
        <h2>${esc(title)}</h2>
        <button
          class="modal-close"
          type="button"
          aria-label="Fechar"
        >×</button>
      </header>

      <div class="modal-body">
        ${bodyHtml}
      </div>
    </section>
  `;

  modalRoot.classList.remove(
    'hidden',
  );

  modalRoot.setAttribute(
    'aria-hidden',
    'false',
  );

  const close = () => {
    modalRoot.classList.add(
      'hidden',
    );

    modalRoot.setAttribute(
      'aria-hidden',
      'true',
    );

    modalRoot.innerHTML = '';
  };

  modalRoot
    .querySelector(
      '.modal-close',
    )
    .addEventListener(
      'click',
      close,
    );

  modalRoot.addEventListener(
    'click',
    (event) => {
      if (
        event.target
        === modalRoot
      ) {
        close();
      }
    },
    {
      once:
        true,
    },
  );

  return close;
}

export function setHelp(
  url,
) {
  if (!url) {
    headerHelp.classList.add(
      'hidden',
    );

    return;
  }

  headerHelp.href =
    url;

  headerHelp.classList.remove(
    'hidden',
  );
}

export function setSubtitle(
  value,
) {
  brandSubtitle.textContent =
    value;
}

export function loading(
  title = 'Preparando tudo...',
  subtitle = 'Um instante ✨',
) {
  app.innerHTML = `
    <section class="loading-card">
      <span class="spinner" aria-hidden="true"></span>
      <strong>${esc(title)}</strong>
      <small>${esc(subtitle)}</small>
    </section>
  `;
}

export function errorPage(
  title,
  message,
  {
    actionHref = '/pedido',
    actionLabel = 'Voltar',
  } = {},
) {
  app.innerHTML = `
    <section class="page-card">
      <div class="page-head">
        <span class="eyebrow">Libri Convites</span>
        <h1 class="page-title">${esc(title)}</h1>
        <p class="page-subtitle">${esc(message)}</p>
      </div>

      <a class="btn btn-primary" href="${esc(actionHref)}">
        ${esc(actionLabel)}
      </a>
    </section>
  `;
}

export function randomId(
  prefix = 'req_',
) {
  const random =
    crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

  return `${prefix}${random}`;
}

export function pathInfo() {
  const path =
    window.location.pathname;

  const manual =
    path.match(
      /^\/pedido\/manual\/(ord_[a-f0-9]{36})\/?$/,
    );

  if (manual) {
    return {
      mode:
        'manual',
      token:
        manual[1],
    };
  }

  const area =
    path.match(
      /^\/meu-pedido\/(ord_[a-f0-9]{36})\/?$/,
    );

  if (area) {
    return {
      mode:
        'area',
      token:
        area[1],
    };
  }

  const product =
    path.match(
      /^\/pedido\/([a-z0-9-]+)\/?$/,
    );

  if (product) {
    return {
      mode:
        'store',
      productSlug:
        product[1],
    };
  }

  return {
    mode:
      'store',
    productSlug:
      '',
  };
}
