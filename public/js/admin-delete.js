let currentOrderId = null;
let deleteToastTimer = null;

const detailBody =
  document.querySelector('#detailBody');

const adminModal =
  document.querySelector('#adminModal');

const refreshOrdersButton =
  document.querySelector('#refreshOrders');

const adminToast =
  document.querySelector('#adminToast');

function showDeleteToast(
  message,
  type = 'success',
) {
  if (!adminToast) {
    return;
  }

  clearTimeout(
    deleteToastTimer,
  );

  adminToast.textContent =
    message;

  adminToast.className =
    `admin-toast ${type}`;

  deleteToastTimer =
    setTimeout(
      () => {
        adminToast
          .classList
          .add('hidden');
      },
      2800,
    );
}

function currentOrderCode() {
  return (
    detailBody
      ?.querySelector(
        '.order-code',
      )
      ?.textContent
      ?.trim()
    || ''
  );
}

function closeDeletedOrder() {
  if (adminModal) {
    adminModal
      .classList
      .add('hidden');
  }

  if (detailBody) {
    detailBody.innerHTML = '';
  }

  currentOrderId = null;
}

async function deleteOrder(
  button,
) {
  if (
    !currentOrderId
    || button.dataset.loading
      === 'true'
  ) {
    return;
  }

  const orderId =
    currentOrderId;

  const orderCode =
    currentOrderCode();

  const label =
    orderCode
    || `pedido #${orderId}`;

  const firstConfirmation =
    window.confirm(
      `Excluir permanentemente o pedido ${label}?\n\nUse esta opção somente para pedidos de teste, duplicados ou criados por engano.`,
    );

  if (!firstConfirmation) {
    return;
  }

  const typedConfirmation =
    window.prompt(
      `Esta ação não pode ser desfeita.\n\nPara confirmar a exclusão, digite exatamente:\n${label}`,
      '',
    );

  if (
    typedConfirmation === null
  ) {
    return;
  }

  if (
    typedConfirmation.trim()
    !== label
  ) {
    showDeleteToast(
      'Código diferente. O pedido não foi excluído.',
      'error',
    );

    return;
  }

  const originalText =
    button.textContent;

  button.dataset.loading =
    'true';

  button.disabled =
    true;

  button.textContent =
    'Excluindo...';

  try {
    const response =
      await fetch(
        `/api/admin/orders/${orderId}`,
        {
          method:
            'DELETE',

          headers: {
            'content-type':
              'application/json',
          },
        },
      );

    const data =
      await response
        .json()
        .catch(
          () => ({}),
        );

    if (!response.ok) {
      throw new Error(
        data.error
        || 'Não foi possível excluir o pedido.',
      );
    }

    closeDeletedOrder();

    if (
      refreshOrdersButton
    ) {
      refreshOrdersButton
        .click();
    }

    showDeleteToast(
      `${label} excluído permanentemente.`,
    );
  } catch (error) {
    button.dataset.loading =
      'false';

    button.disabled =
      false;

    button.textContent =
      originalText;

    showDeleteToast(
      error.message
      || 'Não foi possível excluir o pedido.',
      'error',
    );
  }
}

function createDeleteZone() {
  if (
    !detailBody
    || !currentOrderId
  ) {
    return;
  }

  if (
    detailBody.querySelector(
      '#deleteOrderZone',
    )
  ) {
    return;
  }

  const detailGrid =
    detailBody.querySelector(
      '.detail-grid',
    );

  if (!detailGrid) {
    return;
  }

  const section =
    document.createElement(
      'section',
    );

  section.id =
    'deleteOrderZone';

  section.className =
    'detail-card full';

  section.style.border =
    '1px solid #ead0d2';

  section.style.background =
    '#fffafa';

  section.innerHTML = `
    <div
      style="
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:18px;
        flex-wrap:wrap;
      "
    >
      <div
        style="
          flex:1 1 360px;
        "
      >
        <h3
          style="
            color:#8f343c;
            margin-bottom:6px;
          "
        >
          Excluir pedido
        </h3>

        <p
          class="detail-card-subtitle"
          style="
            margin-bottom:0;
          "
        >
          Use somente para testes,
          pedidos duplicados ou criados
          por engano. Para um pedido real
          que não seguirá, prefira marcar
          como Cancelado.
        </p>
      </div>

      <button
        id="deleteOrder"
        class="btn btn-small"
        type="button"
        style="
          background:#ffffff;
          border:1px solid #c96c74;
          color:#92313a;
          white-space:nowrap;
        "
      >
        Excluir pedido permanentemente
      </button>
    </div>
  `;

  detailGrid
    .appendChild(
      section,
    );

  section
    .querySelector(
      '#deleteOrder',
    )
    ?.addEventListener(
      'click',
      (event) => {
        deleteOrder(
          event.currentTarget,
        );
      },
    );
}

document
  .addEventListener(
    'click',
    (event) => {
      const button =
        event.target.closest(
          '[data-open-order]',
        );

      if (!button) {
        return;
      }

      const id =
        Number(
          button.dataset
            .openOrder,
        );

      currentOrderId =
        Number.isFinite(id)
          ? id
          : null;
    },
    true,
  );

if (detailBody) {
  const observer =
    new MutationObserver(
      () => {
        createDeleteZone();
      },
    );

  observer.observe(
    detailBody,
    {
      childList:
        true,

      subtree:
        true,
    },
  );
}
