const $v4 = (selector, root = document) =>
  root.querySelector(selector);

let activeOrderIdV4 = null;
let legacyRefreshTimerV4 = null;
let detailRefreshTimerV4 = null;

/* ==================================================
   HELPERS
================================================== */

function escV4(value = '') {
  return String(value).replace(
    /[&<>'"]/g,
    (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    }[char]),
  );
}

function valueV4(
  value,
  fallback = 'N\u00e3o informado',
) {
  const text =
    String(value ?? '').trim();

  return text || fallback;
}

function moneyV4(cents = 0) {
  return new Intl.NumberFormat(
    'pt-BR',
    {
      style: 'currency',
      currency: 'BRL',
    },
  ).format(
    (Number(cents) || 0) / 100,
  );
}

function formatDateV4(value) {
  if (!value) {
    return 'N\u00e3o informado';
  }

  const parts =
    String(value).split('-');

  if (parts.length !== 3) {
    return String(value);
  }

  return (
    `${parts[2]}/`
    + `${parts[1]}/`
    + `${parts[0]}`
  );
}

function experienceV4(value) {
  return (
    value === 'reduced'
      ? 'Reduzida'
      : 'Completa'
  );
}

function formatV4(value) {
  return (
    value === 'interactive'
      ? 'Interativo'
      : 'V\u00eddeo'
  );
}

function productV4(order) {
  return (
    `${formatV4(order.format)} `
    + `${experienceV4(order.experience)}`
  );
}

function childStyleV4(value) {
  return (
    {
      drawing:
        'Desenho / bonequinho',

      real:
        'Mais real e detalhado',

      libri:
        'A Libri escolhe',
    }[value]
    || value
    || 'N\u00e3o informado'
  );
}

function outfitV4(value) {
  return (
    {
      party:
        'Parecida com a roupa da festa',

      specific:
        'Roupa espec\u00edfica',

      libri:
        'A Libri cria',
    }[value]
    || value
    || 'N\u00e3o informado'
  );
}

function speechV4(value) {
  return (
    {
      libri:
        'A Libri cria',

      approve:
        'Cliente quer aprovar antes',

      own:
        'Cliente enviou frase pr\u00f3pria',
    }[value]
    || value
    || 'N\u00e3o informado'
  );
}

function confirmationModeV4(value) {
  return (
    {
      open:
        'Livre',

      list:
        'Lista de convidados',

      unsure:
        'Ainda n\u00e3o definido',
    }[value]
    || value
    || 'Ainda n\u00e3o definido'
  );
}

function photoStatusV4(value) {
  return (
    {
      waiting:
        'Aguardando',

      received:
        'Recebidas, precisam de confer\u00eancia',

      approved:
        'Aprovadas',

      needs_new:
        'Precisa enviar novas fotos',
    }[value]
    || value
    || 'N\u00e3o informado'
  );
}

function giftPageV4(value) {
  return (
    {
      yes:
        'Sim',

      no:
        'N\u00e3o',

      unsure:
        'A definir',
    }[value]
    || value
    || 'A definir'
  );
}

function financeStatusV4(value) {
  return (
    {
      waiting:
        'Aguardando',

      confirmed:
        'Confirmado',
    }[value]
    || value
    || 'N\u00e3o informado'
  );
}

function orderSourceV4(briefing = {}) {
  if (
    briefing.manualOrder
    || briefing.source
      === 'whatsapp_manual'
  ) {
    return 'WhatsApp manual';
  }

  return 'Portal de Pedidos';
}

function addonLabelV4(key) {
  return (
    {
      confirmation:
        'Confirma\u00e7\u00e3o Libri',

      filter:
        'Filtro personalizado',

      extraScene:
        'Cena extra',

      extraPerson:
        'Outra crian\u00e7a ou pessoa',

      photoAlbumFesta:
        'Libri Moments Festa',

      photoAlbumPremium:
        'Libri Moments Premium',

      photoAlbumExclusive:
        'Libri Moments Exclusive',

      photoAlbumExtra100:
        'Pacote de +100 fotos',
    }[key]
    || key
  );
}

function albumPlanV4(value) {
  return (
    {
      festa: {
        name:
          'Festa',

        photos:
          200,

        days:
          30,
      },

      premium: {
        name:
          'Premium',

        photos:
          400,

        days:
          60,
      },

      exclusive: {
        name:
          'Exclusive',

        photos:
          700,

        days:
          90,
      },
    }[value]
    || null
  );
}

async function apiV4(path) {
  const response =
    await fetch(
      path,
      {
        headers: {
          accept:
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
      || 'N\u00e3o foi poss\u00edvel carregar os dados.',
    );
  }

  return data;
}

/* ==================================================
   ALERTA DE PEDIDO LEGADO
================================================== */

async function refreshLegacyBadgesV4() {
  try {
    const data =
      await apiV4(
        '/api/admin/orders',
      );

    const orders =
      data.orders
      || [];

    document
      .querySelectorAll(
        '[data-v4-legacy-badge]',
      )
      .forEach(
        (element) =>
          element.remove(),
      );

    orders
      .filter(
        (order) =>
          order
            .legacyCommercialIssue
          === true,
      )
      .forEach(
        (order) => {
          const button =
            document.querySelector(
              `[data-open-order="${order.id}"]`,
            );

          const card =
            button
              ?.closest(
                '.order-card',
              );

          const badges =
            card
              ?.querySelector(
                '.badges',
              );

          if (!badges) {
            return;
          }

          const badge =
            document.createElement(
              'span',
            );

          badge.dataset
            .v4LegacyBadge = 'true';

          badge.className =
            'badge red';

          badge.textContent =
            '\u26a0\ufe0f Conferir cobran\u00e7a';

          badges.appendChild(
            badge,
          );
        },
      );
  } catch {
    /*
     * O painel principal continua
     * funcionando mesmo se este
     * refor\u00e7o visual falhar.
     */
  }
}

function scheduleLegacyRefreshV4() {
  clearTimeout(
    legacyRefreshTimerV4,
  );

  legacyRefreshTimerV4 =
    setTimeout(
      refreshLegacyBadgesV4,
      180,
    );
}

/* ==================================================
   RESUMO DE PRODU\u00c7\u00c3O
================================================== */

function addonPriceLinesV4(order) {
  const pricing =
    order.pricing
    || {};

  const lines =
    Array.isArray(
      pricing.addonLines,
    )
      ? pricing.addonLines
      : [];

  return lines
    .filter(
      (line) =>
        Number(
          line.qty
          || 0,
        ) > 0,
    )
    .map(
      (line) => {
        const qty =
          Number(
            line.qty
            || 0,
          );

        const label =
          addonLabelV4(
            line.key,
          );

        const qtyText =
          qty > 1
            ? ` \u00d7 ${qty}`
            : '';

        return (
          `${label}${qtyText}: `
          + `${moneyV4(line.totalCents)}`
        );
      },
    );
}

function contractedResourcesV4(
  order,
) {
  const addons =
    order.addons
    || {};

  const b =
    order.briefing
    || {};

  const pricing =
    order.pricing
    || {};

  const resources = [];

  const album =
    pricing.photoAlbum
    || null;

  const photoAlbumPlan =
    addons.photoAlbumPlan
    || album?.plan
    || '';

  if (
    addons.confirmation
  ) {
    resources.push(
      `Confirma\u00e7\u00e3o Libri | ${confirmationModeV4(
        b.confirmationMode,
      )}`,
    );
  }

  if (
    addons.filter
    && !photoAlbumPlan
  ) {
    resources.push(
      'Filtro personalizado',
    );
  }

  if (
    Number(
      addons.extraScene
      || 0,
    ) > 0
  ) {
    resources.push(
      `${addons.extraScene} cena(s) extra`,
    );
  }

  if (
    Number(
      addons.extraPerson
      || 0,
    ) > 0
  ) {
    resources.push(
      `${addons.extraPerson} pessoa(s) extra`,
    );
  }

  if (
    photoAlbumPlan
  ) {
    const fallback =
      albumPlanV4(
        photoAlbumPlan,
      );

    const extra100 =
      Number(
        addons.photoAlbumExtra100
        ?? album?.extra100
        ?? 0,
      )
      || 0;

    const albumName =
      album?.name
      || fallback?.name
      || photoAlbumPlan;

    const photos =
      Number(
        album?.photos,
      )
      || (
        Number(
          fallback?.photos
          || 0,
        )
        + (
          extra100
          * 100
        )
      );

    const days =
      Number(
        album?.days,
      )
      || Number(
        fallback?.days
        || 0,
      );

    const details = [
      photos > 0
        ? `${photos} fotos`
        : '',

      days > 0
        ? `${days} dias`
        : '',

      'filtro personalizado incluso',
    ]
      .filter(Boolean)
      .join(' | ');

    resources.push(
      `Libri Moments ${albumName}${
        details
          ? ` | ${details}`
          : ''
      }`,
    );
  }

  return resources;
}

function buildProductionSummaryV4(
  order,
) {
  const b =
    order.briefing
    || {};

  const pricing =
    order.pricing
    || {};

  const lines = [];

  lines.push(
    `${valueV4(order.order_code)} | ${valueV4(
      order.display_name
      || order.honoree_name,
    )}`,
  );

  lines.push('');
  lines.push('CLIENTE');
  lines.push(
    `${valueV4(order.customer_name)} | WhatsApp: ${valueV4(order.whatsapp)}`,
  );

  lines.push('');
  lines.push('CRIAN\u00c7A / HOMENAGEADO(A)');
  lines.push(
    `Nome: ${valueV4(order.honoree_name)}`,
  );
  lines.push(
    `Nome no convite: ${valueV4(
      order.display_name
      || order.honoree_name,
    )}`,
  );
  lines.push(
    `Idade: ${valueV4(order.age)}`,
  );

  lines.push('');
  lines.push('EVENTO');
  lines.push(
    `Data: ${formatDateV4(order.event_date)}`,
  );
  lines.push(
    `Hor\u00e1rio: ${valueV4(order.event_time)}`,
  );
  lines.push(
    `Local: ${valueV4(order.venue_name)}`,
  );
  lines.push(
    `Endere\u00e7o: ${valueV4(order.venue_address)}`,
  );
  lines.push(
    `Localiza\u00e7\u00e3o: ${valueV4(
      order.location_url
      || b.locationUrl,
      'N\u00e3o informada',
    )}`,
  );

  lines.push('');
  lines.push('CONTRATA\u00c7\u00c3O');
  lines.push(
    `Experi\u00eancia: ${experienceV4(order.experience)}`,
  );
  lines.push(
    `Formato: ${formatV4(order.format)}`,
  );
  lines.push(
    `Produto-base: ${productV4(order)}`,
  );

  const urgencyEnabled =
    Boolean(
      Number(
        order.urgency_enabled
        || 0,
      ),
    )
    || pricing.urgencyEnabled
      === true;

  const urgencyPercent =
    Number(
      order.urgency_percent
      || pricing.urgencyPercent
      || 0,
    );

  lines.push(
    urgencyEnabled
      ? `Urg\u00eancia: Sim${
        urgencyPercent > 0
          ? ` (+${urgencyPercent}%)`
          : ''
      }`
      : 'Urg\u00eancia: N\u00e3o',
  );

  if (
    Number(
      pricing.productCents,
    ) > 0
  ) {
    lines.push(
      `Valor do produto-base: ${moneyV4(
        pricing.productCents,
      )}`,
    );
  }

  addonPriceLinesV4(
    order,
  ).forEach(
    (line) =>
      lines.push(line),
  );

  lines.push(
    `TOTAL CONTRATADO: ${moneyV4(
      order.total_cents,
    )}`,
  );

  if (
    order.legacyCommercialIssue
  ) {
    lines.push('');
    lines.push(
      '\u26a0\ufe0f ATEN\u00c7\u00c3O COMERCIAL: este pedido legado est\u00e1 salvo como V\u00eddeo + Confirma\u00e7\u00e3o Libri. Conferir o valor contratado antes de seguir.',
    );
  }

  lines.push('');
  lines.push('TEMA');
  lines.push(
    valueV4(
      order.theme,
    ),
  );

  lines.push('');
  lines.push('PERSONAGEM ESPEC\u00cdFICO');
  lines.push(
    valueV4(
      b.characterWanted,
      'Nenhum informado',
    ),
  );

  lines.push('');
  lines.push('DIRE\u00c7\u00c3O OBRIGAT\u00d3RIA');

  const direction = [
    String(
      b.colors
      || '',
    ).trim(),

    String(
      b.mustHave
      || '',
    ).trim(),
  ]
    .filter(Boolean);

  lines.push(
    direction.length
      ? direction.join(' | ')
      : 'Nenhuma dire\u00e7\u00e3o obrigat\u00f3ria informada',
  );

  lines.push('');
  lines.push('N\u00c3O QUER');
  lines.push(
    valueV4(
      b.colorsAvoided
      || b.avoid,
      'Nada espec\u00edfico informado',
    ),
  );

  if (
    b.colorsAvoided
    && b.avoid
  ) {
    lines.push(
      `Outras restri\u00e7\u00f5es: ${b.avoid}`,
    );
  }

  lines.push('');
  lines.push('INFORMA\u00c7\u00d5ES ESPECIAIS');
  lines.push(
    valueV4(
      b.specialInfo,
      'Nenhuma',
    ),
  );

  lines.push('');
  lines.push('CRIAN\u00c7A | DIRE\u00c7\u00c3O VISUAL');
  lines.push(
    `Estilo: ${childStyleV4(
      b.childStyle,
    )}`,
  );
  lines.push(
    `Roupa: ${outfitV4(
      b.outfitChoice,
    )}`,
  );
  lines.push(
    `Dire\u00e7\u00e3o da roupa: ${valueV4(
      b.outfitDetails,
      'Nenhuma dire\u00e7\u00e3o extra informada',
    )}`,
  );
  lines.push(
    `Detalhes da apar\u00eancia: ${valueV4(
      b.appearanceDetails,
      'Nenhum detalhe extra informado',
    )}`,
  );

  lines.push('');
  lines.push('DIRE\u00c7\u00c3O CRIATIVA');
  lines.push(
    `Cores desejadas: ${valueV4(
      b.colors,
      'N\u00e3o informadas separadamente',
    )}`,
  );
  lines.push(
    `Cores a evitar: ${valueV4(
      b.colorsAvoided,
      'Nenhuma informada',
    )}`,
  );
  lines.push(
    `Ideia / refer\u00eancia: ${valueV4(
      b.creativeIdea,
      'Nenhuma ideia extra informada',
    )}`,
  );

  lines.push('');
  lines.push('FALAS');
  lines.push(
    speechV4(
      b.speechPreference,
    ),
  );

  if (
    b.speechPreference
      === 'own'
    && b.ownSpeech
  ) {
    lines.push(
      `Frase enviada: ${b.ownSpeech}`,
    );
  }

  lines.push('');
  lines.push('SUGEST\u00d5ES DE PRESENTES');

  const giftPage =
    b.giftPage
    || (
      String(
        b.giftDetails
        || '',
      ).trim()
        ? 'yes'
        : 'unsure'
    );

  lines.push(
    `Deseja: ${giftPageV4(
      giftPage,
    )}`,
  );

  if (
    giftPage === 'yes'
    || String(
      b.giftDetails
      || '',
    ).trim()
  ) {
    lines.push(
      `Detalhes: ${valueV4(
        b.giftDetails,
        'N\u00e3o informados',
      )}`,
    );
  }

  lines.push('');
  lines.push('RECURSOS CONTRATADOS');

  const resources =
    contractedResourcesV4(
      order,
    );

  if (
    resources.length
  ) {
    resources.forEach(
      (resource) =>
        lines.push(
          `\u2022 ${resource}`,
        ),
    );
  } else {
    lines.push(
      'Nenhum adicional',
    );
  }

  lines.push('');
  lines.push('MATERIAIS / OPERA\u00c7\u00c3O');
  lines.push(
    `Origem do pedido: ${orderSourceV4(
      b,
    )}`,
  );
  lines.push(
    `Fotos: ${photoStatusV4(
      order.photos_status,
    )}`,
  );

  if (
    order.photos_note
  ) {
    lines.push(
      `Observa\u00e7\u00e3o das fotos: ${order.photos_note}`,
    );
  }

  lines.push(
    `Entrada: ${moneyV4(
      order.deposit_cents,
    )} | ${financeStatusV4(
      order.entry_status,
    )}`,
  );

  lines.push(
    `Saldo: ${moneyV4(
      order.balance_cents,
    )} | ${financeStatusV4(
      order.balance_status,
    )}`,
  );

  if (
    String(
      b.manualNotes
      || '',
    ).trim()
  ) {
    lines.push(
      `Observa\u00e7\u00f5es do pedido manual: ${b.manualNotes}`,
    );
  }

  lines.push(
    'Fotos, refer\u00eancias de roupa e refer\u00eancias visuais recebidas fora do portal devem ser conferidas na conversa da cliente no WhatsApp.',
  );

  return lines.join(
    '\n',
  );
}

function summaryPreviewHtmlV4(
  summary,
) {
  return escV4(
    summary,
  );
}

async function enhanceDetailV4(
  orderId,
) {
  const detailBody =
    $v4(
      '#detailBody',
    );

  const detailGrid =
    detailBody
      ?.querySelector(
        '.detail-grid',
      );

  if (
    !detailBody
    || !detailGrid
  ) {
    return;
  }

  if (
    detailBody.querySelector(
      '#productionBriefingV4',
    )
  ) {
    return;
  }

  let order;

  try {
    const data =
      await apiV4(
        `/api/admin/orders/${orderId}`,
      );

    order =
      data.order;
  } catch {
    return;
  }

  if (
    !order
    || Number(order.id)
      !== Number(orderId)
  ) {
    return;
  }

  const summary =
    buildProductionSummaryV4(
      order,
    );

  const card =
    document.createElement(
      'section',
    );

  card.id =
    'productionBriefingV4';

  card.className =
    'detail-card full';

  card.style.border =
    order.legacyCommercialIssue
      ? '1px solid #d98c92'
      : '1px solid #eadfd7';

  card.style.background =
    order.legacyCommercialIssue
      ? '#fff8f8'
      : '#fffdfb';

  card.innerHTML = `
    <div
      style="
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:16px;
        flex-wrap:wrap;
        margin-bottom:14px;
      "
    >
      <div>
        <span
          style="
            display:block;
            font-size:12px;
            font-weight:800;
            letter-spacing:.08em;
            text-transform:uppercase;
            opacity:.58;
            margin-bottom:5px;
          "
        >
          Produ\u00e7\u00e3o
        </span>

        <h3
          style="
            margin:0 0 5px;
          "
        >
          Briefing de produ\u00e7\u00e3o
        </h3>

        <p
          class="detail-card-subtitle"
          style="
            margin:0;
          "
        >
          Resumo organizado para iniciar a cria\u00e7\u00e3o sem depender de procurar as respostas pelo painel.
        </p>
      </div>

      <button
        id="copyProductionBriefingV4"
        class="btn btn-secondary btn-small"
        type="button"
      >
        Copiar briefing de produ\u00e7\u00e3o
      </button>
    </div>

    ${
      order.legacyCommercialIssue
        ? `
          <div
            style="
              margin-bottom:14px;
              padding:12px 14px;
              border-radius:12px;
              background:#fff0f1;
              color:#8f343c;
              font-weight:700;
              line-height:1.45;
            "
          >
            \u26a0\ufe0f Pedido legado com combina\u00e7\u00e3o comercial inv\u00e1lida:
            V\u00eddeo + Confirma\u00e7\u00e3o Libri.
            Confira o valor contratado antes de seguir.
          </div>
        `
        : ''
    }

    <pre
      id="productionBriefingTextV4"
      style="
        margin:0;
        white-space:pre-wrap;
        word-break:break-word;
        font:inherit;
        line-height:1.55;
        background:#fff;
        border:1px solid #eee3dc;
        border-radius:14px;
        padding:16px;
        max-height:520px;
        overflow:auto;
      "
    >${summaryPreviewHtmlV4(summary)}</pre>
  `;

  detailGrid.insertBefore(
    card,
    detailGrid.firstChild,
  );

  card
    .querySelector(
      '#copyProductionBriefingV4',
    )
    ?.addEventListener(
      'click',
      async (event) => {
        const button =
          event.currentTarget;

        try {
          await navigator
            .clipboard
            .writeText(
              summary,
            );

          const oldText =
            button.textContent;

          button.textContent =
            'Copiado \u2713';

          setTimeout(
            () => {
              button.textContent =
                oldText;
            },
            1800,
          );
        } catch {
          const area =
            document.createElement(
              'textarea',
            );

          area.value =
            summary;

          area.style.position =
            'fixed';

          area.style.opacity =
            '0';

          document.body
            .appendChild(
              area,
            );

          area.select();

          document.execCommand(
            'copy',
          );

          area.remove();

          button.textContent =
            'Copiado \u2713';
        }
      },
    );
}

function scheduleDetailEnhancementV4() {
  if (
    !activeOrderIdV4
  ) {
    return;
  }

  clearTimeout(
    detailRefreshTimerV4,
  );

  detailRefreshTimerV4 =
    setTimeout(
      () => {
        enhanceDetailV4(
          activeOrderIdV4,
        );
      },
      120,
    );
}

/* ==================================================
   EVENTOS
================================================== */

document.addEventListener(
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

    if (
      Number.isFinite(id)
    ) {
      activeOrderIdV4 =
        id;

      scheduleDetailEnhancementV4();
    }
  },
  true,
);

const ordersListV4 =
  $v4(
    '#ordersList',
  );

if (
  ordersListV4
) {
  const ordersObserverV4 =
    new MutationObserver(
      scheduleLegacyRefreshV4,
    );

  ordersObserverV4.observe(
    ordersListV4,
    {
      childList:
        true,

      subtree:
        true,
    },
  );
}

const detailBodyV4 =
  $v4(
    '#detailBody',
  );

if (
  detailBodyV4
) {
  const detailObserverV4 =
    new MutationObserver(
      scheduleDetailEnhancementV4,
    );

  detailObserverV4.observe(
    detailBodyV4,
    {
      childList:
        true,

      subtree:
        true,
    },
  );
}

scheduleLegacyRefreshV4();