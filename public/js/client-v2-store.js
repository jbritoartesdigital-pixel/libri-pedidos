import {
  api,
  app,
  dateBr,
  esc,
  loading,
  modal,
  money,
  randomId,
  setSubtitle,
  showToast,
} from './client-v2-core.js';

const EVENT_TYPES = [
  {
    value:
      'birthday',
    label:
      'Aniversário',
  },
  {
    value:
      '15_years',
    label:
      '15 Anos',
  },
  {
    value:
      'wedding',
    label:
      'Casamento',
  },
  {
    value:
      'celebration',
    label:
      'Chá / Celebração',
  },
  {
    value:
      'other',
    label:
      'Outro',
  },
];

const ADDON_GROUP_LABELS = {
  confirmation: 'Confirmação de presença',
  filter: 'Filtro personalizado',
  save_the_date: 'Save the Date',
  reminder: 'Lembrete',
  moments: 'Álbum da Festa',
  extras: 'Outros adicionais',
};

const STORE_KEY =
  'libriV2StoreState';

const STORE_KEY_SIMULATION =
  'libriV2StoreStateSimulation';

function simulationModeFromUrl() {
  return new URLSearchParams(
    window.location.search,
  ).get('simular') === '1';
}

function storeKeyFor(
  simulationMode = false,
) {
  return simulationMode
    ? STORE_KEY_SIMULATION
    : STORE_KEY;
}

function emptyState(
  productSlug,
) {
  const params =
    new URLSearchParams(
      window.location.search,
    );

  const simulationMode =
    params.get('simular')
    === '1';

  return {
    simulationMode,

    simulationUrgency:
      false,

    step:
      productSlug
        ? 1
        : 0,

    deepProductSlug:
      productSlug || '',

    catalog:
      null,

    terms:
      null,

    event: {
      type:
        params.get('evento')
        || '',
      subtype:
        '',
      honoreeName:
        '',
      date:
        '',
    },

    customer: {
      name:
        '',
      whatsapp:
        '',
      email:
        '',
    },

    selection: {
      productSlug:
        productSlug || '',
      productCode:
        '',
      variantCode:
        '',
      addonCodes: [],
      comboCode:
        '',
      couponCode:
        '',
      paymentMethod:
        'pix',
    },

    deliveryWindow:
      null,

    delivery:
      null,

    quote:
      null,

    activeAddonGroup:
      '',

    termsAccepted:
      false,

    clientRequestId:
      randomId(
        'checkout_',
      ),
  };
}

function readSaved(
  productSlug,
) {
  try {
    const simulationMode =
      simulationModeFromUrl();

    const raw =
      localStorage.getItem(
        storeKeyFor(
          simulationMode,
        ),
      );

    if (!raw) {
      return emptyState(
        productSlug,
      );
    }

    const saved =
      JSON.parse(raw);

    if (
      productSlug
      && saved.deepProductSlug
      !== productSlug
    ) {
      return emptyState(
        productSlug,
      );
    }

    return {
      ...emptyState(
        productSlug,
      ),
      ...saved,

      simulationMode,
      deepProductSlug:
        productSlug
        || saved.deepProductSlug
        || '',
      selection: {
        ...emptyState(
          productSlug,
        ).selection,
        ...(saved.selection || {}),
        productSlug:
          productSlug
          || saved.selection
            ?.productSlug
          || '',
      },
    };
  } catch {
    return emptyState(
      productSlug,
    );
  }
}

function persist(
  state,
) {
  const {
    catalog,
    terms,
    quote,
    delivery,
    ...save
  } =
    state;

  localStorage.setItem(
    storeKeyFor(
      state.simulationMode,
    ),
    JSON.stringify(
      save,
    ),
  );
}

function productFor(
  state,
) {
  return state.catalog
    ?.products
    ?.find(
      (product) =>
        product.code
        === state.selection.productCode
        || product.slug
        === state.selection.productSlug,
    )
    || null;
}

function variantFor(
  state,
) {
  const product =
    productFor(state);

  if (!product) {
    return null;
  }

  return product.variants
    ?.find(
      (variant) =>
        variant.code
        === state.selection.variantCode,
    )
    || product.variants
      ?.find(
        (variant) =>
          variant.isDefault,
      )
    || product.variants
      ?.[0]
    || null;
}

function selectProduct(
  state,
  product,
) {
  state.selection.productCode =
    product.code;

  state.selection.productSlug =
    product.slug;

  const shortDefault =
    Number(
      product.config
        ?.recommendedShortScenes
      || 3,
    );

  const variant =
    (
      product.pricingMode
      === 'scene_count'
        ? product.variants
          ?.find(
            (item) =>
              Number(
                item.sceneCount,
              )
              === shortDefault,
          )
        : null
    )
    || product.variants
      ?.find(
        (item) =>
          item.isDefault,
      )
    || product.variants
      ?.[0];

  state.selection.variantCode =
    variant?.code || '';

  state.quote =
    null;

  state.delivery =
    null;

  state.deliveryWindow =
    null;
}

function actionRow(
  {
    back = true,
    nextLabel = 'Continuar',
    nextId = 'nextBtn',
  } = {},
) {
  return `
    <div class="action-row">
      ${
        back
          ? `
            <button
              id="backBtn"
              class="btn btn-ghost"
              type="button"
            >
              Voltar
            </button>
          `
          : '<span></span>'
      }

      <button
        id="${esc(nextId)}"
        class="btn btn-primary btn-large"
        type="button"
      >
        ${esc(nextLabel)}
      </button>
    </div>
  `;
}

function progress(
  state,
) {
  const total = 11;
  const current =
    Math.min(
      total,
      state.step + 1,
    );

  return `
    ${
      state.simulationMode
        ? `
          <div class="simulation-banner">
            <strong>Modo de teste</strong>
            <span>Nenhum pedido, cobrança, agenda ou lançamento financeiro será criado.</span>
          </div>
        `
        : ''
    }

    <div class="progress-shell">
      <div class="progress-top">
        <strong>Seu pedido</strong>
        <span class="progress-label">
          ${current} de ${total}
        </span>
      </div>

      <div class="progress-track">
        <span style="width:${(current / total) * 100}%"></span>
      </div>
    </div>
  `;
}

function bindBack(
  state,
  render,
) {
  document
    .getElementById(
      'backBtn',
    )
    ?.addEventListener(
      'click',
      () => {
        state.step =
          Math.max(
            0,
            state.step - 1,
          );

        persist(state);
        render();
      },
    );
}

function eventLabel(
  value,
) {
  return EVENT_TYPES.find(
    (item) =>
      item.value === value,
  )?.label
  || value
  || '';
}

function addonGroupLabel(value) {
  const key = String(value || 'extras').trim();
  if (ADDON_GROUP_LABELS[key]) return ADDON_GROUP_LABELS[key];
  return key.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function addonByCode(
  state,
  code,
) {
  return (
    state.catalog?.addons
    || []
  ).find(
    (addon) =>
      addon.code
      === code,
  )
  || null;
}

function comboByCode(
  state,
  code,
) {
  return (
    state.catalog?.combos
    || []
  ).find(
    (combo) =>
      combo.code
      === code,
  )
  || null;
}

function comboMatchesSelection(
  state,
  combo,
) {
  const selectedCodes =
    new Set(
      state.selection.addonCodes
      || [],
    );

  const selectedGroups =
    new Set(
      [
        ...selectedCodes,
      ]
        .map(
          (code) =>
            addonByCode(
              state,
              code,
            )
              ?.group,
        )
        .filter(
          Boolean,
        ),
    );

  const product =
    productFor(
      state,
    );

  return (
    combo?.items
    || []
  )
    .filter(
      (item) =>
        item.required
        !== false,
    )
    .every(
      (item) => {
        if (
          item.itemType
          === 'main_product'
        ) {
          return item.itemCode
            === product?.code;
        }

        if (
          item.itemType
          === 'addon'
        ) {
          return selectedCodes.has(
            item.itemCode,
          );
        }

        if (
          item.itemType
          === 'addon_group'
        ) {
          return selectedGroups.has(
            item.itemCode,
          );
        }

        return false;
      },
    );
}

function sceneVariantsHtml(
  product,
  currentVariant,
) {
  if (
    product.pricingMode
    !== 'scene_count'
  ) {
    return (
      product.variants
      || []
    )
      .map(
        (variant) => `
          <label class="choice-card ${currentVariant?.code === variant.code ? 'selected' : ''}">
            <input
              type="radio"
              name="variant"
              value="${esc(variant.code)}"
              ${currentVariant?.code === variant.code ? 'checked' : ''}
            >
            <span class="choice-main">
              <strong>${esc(variant.label)}</strong>
              <small>${money(variant.priceCents)}</small>
            </span>
          </label>
        `,
      )
      .join('');
  }

  const groups = [
    {
      label:
        'Mais curto',
      min:
        1,
      max:
        4,
      defaultScene:
        Number(
          product.config
            ?.recommendedShortScenes
          || 3,
        ),
    },
    {
      label:
        'Mais completo',
      min:
        5,
      max:
        8,
      defaultScene:
        Number(
          product.config
            ?.recommendedCompleteScenes
          || 6,
        ),
    },
  ];

  return groups
    .map(
      (group) => `
        <div class="section-block">
          <span class="muted">
            ${esc(group.label)}
          </span>

          <div class="grid two" style="margin-top:8px">
            ${(product.variants || [])
              .filter(
                (variant) =>
                  Number(
                    variant.sceneCount,
                  )
                  >= group.min
                  && Number(
                    variant.sceneCount,
                  )
                  <= group.max,
              )
              .map(
                (variant) => `
                  <label class="choice-card ${currentVariant?.code === variant.code ? 'selected' : ''}">
                    <input
                      type="radio"
                      name="variant"
                      value="${esc(variant.code)}"
                      ${currentVariant?.code === variant.code ? 'checked' : ''}
                    >

                    <span class="choice-main">
                      <strong>${esc(variant.label)}</strong>
                      <small>
                        ${money(variant.priceCents)}
                        ${Number(variant.sceneCount) === group.defaultScene ? ' • padrão desta faixa' : ''}
                      </small>
                    </span>
                  </label>
                `,
              )
              .join('')}
          </div>
        </div>
      `,
    )
    .join('');
}

function selectedAddonGroups(
  state,
) {
  return new Set(
    (state.selection.addonCodes || [])
      .map(
        (code) =>
          addonByCode(
            state,
            code,
          )
            ?.group,
      )
      .filter(
        Boolean,
      ),
  );
}

function comboMissingGroups(
  state,
  combo,
) {
  const selectedCodes =
    new Set(
      state.selection.addonCodes
      || [],
    );

  const groups =
    selectedAddonGroups(
      state,
    );

  const missing = [];

  for (
    const item
    of combo?.items
    || []
  ) {
    if (
      item.required
      === false
    ) {
      continue;
    }

    if (
      item.itemType
      === 'addon'
      && !selectedCodes.has(
        item.itemCode,
      )
    ) {
      missing.push({
        type:
          'addon',
        code:
          item.itemCode,
      });
    }

    if (
      item.itemType
      === 'addon_group'
      && !groups.has(
        item.itemCode,
      )
    ) {
      missing.push({
        type:
          'group',
        code:
          item.itemCode,
      });
    }
  }

  return missing;
}

function interactiveUpgradeOffer(
  state,
) {
  const currentProduct =
    productFor(
      state,
    );

  if (
    currentProduct?.code
    !== 'cinematic_video'
  ) {
    return null;
  }

  const currentVariant =
    variantFor(
      state,
    );

  const interactiveProduct =
    (
      state.catalog.products
      || []
    )
      .find(
        (product) =>
          product.code
          === 'cinematic_interactive',
      );

  if (
    !currentVariant
    || !interactiveProduct
  ) {
    return null;
  }

  const interactiveVariant =
    (
      interactiveProduct.variants
      || []
    )
      .find(
        (variant) =>
          Number(
            variant.sceneCount,
          )
          === Number(
            currentVariant.sceneCount,
          ),
      );

  if (!interactiveVariant) {
    return null;
  }

  return {
    kind:
      'product_upgrade',
    product:
      interactiveProduct,
    variant:
      interactiveVariant,
    priceDeltaCents:
      Math.max(
        0,
        Number(
          interactiveVariant.priceCents
          || 0,
        )
        - Number(
          currentVariant.priceCents
          || 0,
        ),
      ),
  };
}

function progressiveAddonOffer(
  state,
  group,
  configuredCombos = [],
) {
  const choices =
    (
      state.catalog.addons
      || []
    )
      .filter(
        (addon) =>
          addon.group
          === group,
      );

  if (!choices.length) {
    return null;
  }

  const comboEntry =
    configuredCombos
      .find(
        (entry) =>
          entry.missing
            .some(
              (missing) =>
                (
                  missing.type
                  === 'group'
                  && missing.code
                    === group
                )
                || (
                  missing.type
                  === 'addon'
                  && choices
                    .some(
                      (choice) =>
                        choice.code
                        === missing.code,
                    )
                ),
            ),
      );

  return {
    kind:
      'addon',
    group,
    choices,
    combo:
      comboEntry
        ?.combo
      || null,
  };
}

function finalRecommendation(
  state,
) {
  /*
   * Se as escolhas já formaram um combo com desconto,
   * oferecemos primeiro o benefício já conquistado.
   */
  if (
    state.quote
      ?.suggestedCombo
  ) {
    return {
      kind:
        'combo',
      combo:
        state.quote
          .suggestedCombo,
    };
  }

  const groups =
    selectedAddonGroups(
      state,
    );

  const configuredCombos =
    (
      state.catalog.combos
      || []
    )
      .filter(
        (combo) =>
          Number(
            combo.discountValue
            || 0,
          )
          > 0,
      )
      .map(
        (combo) => ({
          combo,
          missing:
            comboMissingGroups(
              state,
              combo,
            ),
        }),
      )
      .filter(
        (entry) =>
          entry.missing.length
          === 1,
      )
      .sort(
        (
          left,
          right,
        ) =>
          (
            right.combo.items
              ?.filter(
                item =>
                  item.required
                  !== false,
              )
              .length
            || 0
          )
          - (
            left.combo.items
              ?.filter(
                item =>
                  item.required
                  !== false,
              )
              .length
            || 0
          ),
      );

  /*
   * FUNIL PROGRESSIVO
   *
   * 1. Vídeo básico sem adicionais -> tornar interativo.
   * 2. Produto interativo sem confirmação -> Confirmação.
   * 3. Interativo + Confirmação sem Álbum -> Álbum da Festa.
   * 4. Só depois, completar outro combo que esteja a uma peça.
   *
   * Uma única oferta é mostrada no fim da configuração.
   */
  if (
    productFor(state)
      ?.code
    === 'cinematic_video'
    && groups.size
      === 0
  ) {
    const upgrade =
      interactiveUpgradeOffer(
        state,
      );

    if (upgrade) {
      return upgrade;
    }
  }

  const interactive =
    [
      'cinematic_interactive',
      'interactive_essential',
      'interactive_animated',
      'interactive_gif',
      'book',
      'infinite',
    ].includes(
      productFor(state)
        ?.code,
    );

  if (
    interactive
    && !groups.has(
      'confirmation',
    )
  ) {
    return progressiveAddonOffer(
      state,
      'confirmation',
      configuredCombos,
    );
  }

  if (
    interactive
    && groups.has(
      'confirmation',
    )
    && !groups.has(
      'moments',
    )
  ) {
    return progressiveAddonOffer(
      state,
      'moments',
      configuredCombos,
    );
  }

  if (
    state.quote?.combo
  ) {
    return null;
  }

  if (
    configuredCombos.length
  ) {
    const entry =
      configuredCombos[0];

    const missing =
      entry.missing[0];

    const choices =
      missing.type
      === 'addon'
        ? [
          addonByCode(
            state,
            missing.code,
          ),
        ]
          .filter(Boolean)
        : (
          state.catalog.addons
          || []
        )
          .filter(
            addon =>
              addon.group
              === missing.code,
          );

    if (
      choices.length
    ) {
      return {
        kind:
          'addon',
        group:
          missing.type
          === 'group'
            ? missing.code
            : choices[0].group,
        choices,
        combo:
          entry.combo,
      };
    }
  }

  return null;
}

function recommendationTitle(
  offer,
) {
  if (
    offer?.kind
    === 'product_upgrade'
  ) {
    return 'Quer deixar seu convite interativo?';
  }

  if (
    offer?.kind
    === 'combo'
  ) {
    return `Suas escolhas formam o combo ${offer.combo.name}`;
  }

  if (
    offer?.combo
  ) {
    return `Falta só um item para o combo ${offer.combo.name}`;
  }

  return {
    save_the_date:
      'Uma sugestão para avisar com antecedência',
    reminder:
      'Uma sugestão para perto da festa',
    confirmation:
      'Quer organizar as confirmações também?',
    moments:
      'Quer guardar as fotos dos convidados?',
  }[
    offer?.group
  ]
  || 'Uma última sugestão';
}

function recommendationReason(
  state,
  offer,
) {
  if (
    offer?.kind
    === 'product_upgrade'
  ) {
    return 'Você escolheu a versão em vídeo. O próximo degrau é transformar a experiência em interativa sem mudar a quantidade de cenas.';
  }

  if (
    offer?.kind
    === 'combo'
  ) {
    return 'As escolhas que você já fez formam um combo com desconto. Vale aplicar o benefício antes de seguir.';
  }

  if (
    offer?.group
    === 'confirmation'
  ) {
    return 'Seu convite já é interativo. A confirmação ajuda você a organizar quem realmente vai à festa sem depender de respostas espalhadas no WhatsApp.';
  }

  if (
    offer?.group
    === 'moments'
  ) {
    return 'Você já adicionou organização ao convite. O Álbum da Festa é o próximo passo para reunir as fotos enviadas pelos convidados.';
  }

  if (
    offer?.group
    === 'save_the_date'
  ) {
    return 'Seu pedido já está bem encaminhado e este item completa uma combinação com benefício, ajudando a avisar a data com antecedência.';
  }

  if (
    offer?.group
    === 'reminder'
  ) {
    return 'Este item completa uma combinação útil para reforçar o evento perto da data da festa.';
  }

  if (
    offer?.combo
  ) {
    return `Falta só este item para o combo ${offer.combo.name}. Por isso ele aparece como a última sugestão.`;
  }

  return 'Esta é a próxima melhoria mais útil para a configuração que você montou.';
}

function comboSavingsForOffer(
  state,
  offer,
  promoAddon,
) {
  if (!offer?.combo) {
    return 0;
  }

  if (
    offer.kind
    === 'combo'
  ) {
    return Number(
      offer.combo
        .discountCents
      || 0,
    );
  }

  const baseCents =
    Number(
      state.quote
        ?.productCents
      || 0,
    )
    + Number(
      state.quote
        ?.addonsCents
      || 0,
    )
    + Number(
      promoAddon
        ?.priceCents
      || 0,
    );

  if (
    offer.combo
      .discountType
    === 'percent'
  ) {
    return Math.max(
      0,
      Math.round(
        baseCents
        * Number(
          offer.combo
            .discountValue
          || 0,
        )
        / 100,
      ),
    );
  }

  return Math.max(
    0,
    Math.min(
      baseCents,
      Number(
        offer.combo
          .discountValue
        || 0,
      ),
    ),
  );
}

function showDeliveryChangeNotice(
  state,
  render,
  message =
    'Esse adicional aumentou a produção necessária para o seu pedido.',
) {
  const close =
    modal(
      'Seu prazo precisa ser ajustado',
      `
        <div class="notice info">
          <strong>${esc(message)}</strong>
          <p style="margin:8px 0 0">
            A faixa que você escolheu antes não comporta mais essa configuração.
            Seu pedido continua salvo. Escolha uma nova faixa disponível para seguir.
          </p>
        </div>

        <div class="action-row">
          <span></span>
          <button
            id="chooseNewDeliveryWindow"
            class="btn btn-primary"
            type="button"
          >
            Escolher nova faixa
          </button>
        </div>
      `,
    );

  document
    .getElementById(
      'chooseNewDeliveryWindow',
    )
    ?.addEventListener(
      'click',
      () => {
        close();
        state.step = 4;
        persist(state);
        render();
      },
    );
}

async function refreshDeliveryForSelection(
  state,
) {
  const data =
    await api(
      '/api/v2/delivery-options',
      {
        method:
          'POST',
        body:
          JSON.stringify({
            selection:
              state.selection,
            eventType:
              state.event.type
              || null,
            eventDate:
              state.event.date,
            limit:
              6,
          }),
      },
    );

  state.delivery =
    data.delivery;

  const stillAvailable =
    (
      data.delivery.options
      || []
    )
      .find(
        option =>
          option.start
          === state.deliveryWindow
            ?.start
          && option.end
          === state.deliveryWindow
            ?.end,
      );

  if (
    stillAvailable
  ) {
    state.deliveryWindow =
      stillAvailable;
    return true;
  }

  state.deliveryWindow =
    data.delivery.options
      ?.find(
        option =>
          option.recommended,
      )
    || data.delivery.options
      ?.[0]
    || null;

  return false;
}

async function continueAfterRecommendation(
  state,
  render,
) {
  state.step =
    7;

  persist(state);
  render();
}

function addonGroups(
  state,
) {
  const groups =
    new Map();

  const selected =
    new Set(
      state.selection.addonCodes
      || [],
    );

  const hasMoments =
    [
      ...selected,
    ]
      .some(
        (code) =>
          addonByCode(
            state,
            code,
          )
            ?.group
          === 'moments',
      );

  for (
    const addon
    of state.catalog.addons
    || []
  ) {
    if (
      addon.group
      === 'moments_extra'
      && !hasMoments
    ) {
      continue;
    }

    if (
      addon.group
      === 'filter'
      && hasMoments
    ) {
      continue;
    }

    const key =
      addon.group
      === 'moments_extra'
        ? 'moments'
        : (
          addon.group
          || 'extras'
        );

    if (!groups.has(key)) {
      groups.set(
        key,
        [],
      );
    }

    groups.get(key).push(
      addon,
    );
  }

  return [
    ...groups.entries(),
  ];
}

function addonExplanation(
  addon,
) {
  if (!addon) {
    return null;
  }

  const config =
    addon.config
    || {};

  if (
    addon.group
    === 'confirmation'
  ) {
    return {
      intro:
        'Confirmação de presença vinculada ao seu convite.',
      items: [
        'Depois da compra, você escolhe se a confirmação será livre ou por lista de convidados.',
        'Se escolher lista, os nomes são informados no briefing.',
      ],
    };
  }

  if (
    addon.group
    === 'filter'
  ) {
    return {
      intro:
        'Filtro personalizado para o seu evento.',
      items: [
        'Pode ser preparado para Instagram ou para o App Libri.',
        'No Álbum da Festa, o filtro do App Libri já está incluído e não é cobrado separado.',
      ],
    };
  }

  if (
    addon.group
    === 'save_the_date'
  ) {
    return {
      intro:
        'Uma peça extra para avisar a data da festa com antecedência.',
      items: [
        addon.code
          .includes(
            'animated',
          )
          ? 'Versão animada.'
          : 'Versão estática.',
        'É entregue separadamente do convite principal para você enviar antes.',
      ],
    };
  }

  if (
    addon.group
    === 'reminder'
  ) {
    return {
      intro:
        'Uma peça extra para lembrar os convidados quando a festa estiver mais perto.',
      items: [
        addon.code
          .includes(
            'animated',
          )
          ? 'Versão animada.'
          : 'Versão estática.',
        'É entregue separadamente para facilitar o reenvio próximo ao evento.',
      ],
    };
  }

  if (
    addon.group
    === 'moments'
  ) {
    const items = [];

    if (
      Number(
        config.photoLimit,
      ) > 0
    ) {
      items.push(
        `Até ${Number(config.photoLimit)} fotos.`,
      );
    }

    if (
      Number(
        config.availabilityDays,
      ) > 0
    ) {
      items.push(
        `Período de disponibilidade: ${Number(config.availabilityDays)} dias.`,
      );
    }

    if (
      config.filterIncluded
    ) {
      items.push(
        'Filtro personalizado para o App Libri incluído.',
      );
    }

    return {
      intro:
        'Álbum digital da festa para guardar as fotos enviadas pelos convidados.',
      items,
    };
  }

  if (
    addon.group
    === 'moments_extra'
  ) {
    return {
      intro:
        'Complemento do Álbum da Festa.',
      items: [
        `Acrescenta ${Number(config.extraPhotos || 100)} fotos ao limite do plano escolhido.`,
      ],
    };
  }

  return null;
}

function addonExplanationHtml(
  addon,
) {
  const explanation =
    addonExplanation(
      addon,
    );

  if (!explanation) {
    return '';
  }

  return `
    <div class="addon-explanation">
      <strong>O que você leva</strong>
      <p>${esc(explanation.intro)}</p>
      ${
        explanation.items
          ?.length
          ? `
            <ul>
              ${explanation.items
                .map(
                  (item) =>
                    `<li>${esc(item)}</li>`,
                )
                .join('')}
            </ul>
          `
          : ''
      }
    </div>
  `;
}

function addonFamilySummary(
  state,
  addons,
) {
  const selected =
    addons.filter(
      (addon) =>
        (
          state.selection.addonCodes
          || []
        ).includes(
          addon.code,
        ),
    );

  if (
    selected.length
  ) {
    return selected
      .map(
        (addon) =>
          addon.name,
      )
      .join(' + ');
  }

  const prices =
    addons
      .filter(
        (addon) =>
          addon.group
          !== 'moments_extra',
      )
      .map(
        (addon) =>
          Number(
            addon.priceCents
            || 0,
          ),
      )
      .filter(
        (value) =>
          value > 0,
      );

  if (!prices.length) {
    return 'Ver opções';
  }

  return `A partir de ${
    money(
      Math.min(
        ...prices,
      ),
    )
  }`;
}

async function updateQuote(
  state,
) {
  const data =
    await api(
      '/api/v2/quote',
      {
        method:
          'POST',
        body:
          JSON.stringify({
            selection:
              state.selection,

            eventType:
              state.event.type
              || null,
          }),
      },
    );

  state.quote =
    data.quote;
}

async function refreshConfigurationQuote(
  state,
) {
  try {
    await updateQuote(
      state,
    );
  } catch {
    state.quote =
      null;
  }
}

function totalOnlyHtml(
  quote,
) {
  if (!quote) {
    return '';
  }

  return `
    <div class="quote-card">
      <div class="quote-row total">
        <span>Total</span>
        <strong>${money(quote.totalCents)}</strong>
      </div>
    </div>
  `;
}

function quoteHtml(
  quote,
) {
  if (!quote) {
    return '';
  }

  return `
    <div class="quote-card">
      <div class="quote-row total">
        <span>Total</span>
        <strong>${money(quote.totalCents)}</strong>
      </div>

      ${
        quote.payment?.method
        === 'pix'
          ? `
            <div class="quote-row">
              <span>Entrada agora</span>
              <strong>${money(quote.payment.depositCents)}</strong>
            </div>

            <div class="quote-row">
              <span>Saldo depois da aprovação</span>
              <strong>${money(quote.payment.balanceCents)}</strong>
            </div>
          `
          : `
            <div class="quote-row">
              <span>Pagamento</span>
              <strong>100% no cartão</strong>
            </div>
          `
      }
    </div>
  `;
}

async function openExamples(
  product,
) {
  try {
    const data =
      await api(
        `/api/v2/gallery?productCode=${
          encodeURIComponent(
            product.code,
          )
        }`,
      );

    const items =
      data.items
      || data.gallery
      || [];

    if (!items.length) {
      modal(
        'Exemplos',
        `
          <div class="empty-state">
            Ainda não há exemplos publicados para este formato.
          </div>
        `,
      );

      return;
    }

    modal(
      `Exemplos • ${product.name}`,
      `
        <div class="gallery-grid">
          ${items.map(
            (item) => {
              const interactiveLink =
                item.externalUrl
                || '';

              const visual =
                item.mediaType
                === 'video'
                && item.mediaPath
                  ? `
                    <video
                      controls
                      playsinline
                      preload="metadata"
                      src="${esc(item.mediaPath)}"
                    ></video>
                  `
                  : (
                    item.previewPath
                    || item.mediaPath
                  )
                    ? `
                      <img
                        loading="lazy"
                        alt="${esc(item.themeLabel || product.name)}"
                        src="${esc(item.previewPath || item.mediaPath)}"
                      >
                    `
                    : `
                      <div class="gallery-interactive-placeholder">
                        <span>Experiência interativa</span>
                        <strong>Abra o convite para testar como ele funciona.</strong>
                      </div>
                    `;

              return `
                <article class="gallery-item">
                  ${visual}

                  <div class="gallery-copy">
                    <strong>${esc(item.themeLabel || 'Inspiração Libri')}</strong>

                    ${
                      item.eventType
                        ? `<small>${esc(item.eventType)}</small>`
                        : ''
                    }

                    ${
                      item.caption
                        ? `<p>${esc(item.caption)}</p>`
                        : ''
                    }

                    ${
                      interactiveLink
                        ? `
                          <a
                            class="btn btn-secondary gallery-open-demo"
                            href="${esc(interactiveLink)}"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Abrir convite interativo
                          </a>
                        `
                        : ''
                    }
                  </div>
                </article>
              `;
            },
          ).join('')}
        </div>
      `,
      {
        wide:
          true,
      },
    );
  } catch {
    modal(
      'Exemplos',
      `
        <div class="empty-state">
          Ainda não há exemplos publicados para este formato.
        </div>
      `,
    );
  }
}

function renderEventGate(
  state,
  render,
) {
  app.innerHTML = `
    <section class="hero-card">
      <span class="eyebrow">Comece por aqui ✦</span>

      <h1>Qual é o seu evento?</h1>

      <p>
        Essa escolha só ajuda a mostrar o caminho certo.
        O convite continua sendo criado do zero para você.
      </p>

      <div class="grid two section-block">
        ${EVENT_TYPES.map(
          (item) => `
            <label class="choice-card ${
              state.event.type
              === item.value
                ? 'selected'
                : ''
            }">
              <input
                type="radio"
                name="eventType"
                value="${item.value}"
                ${
                  state.event.type
                  === item.value
                    ? 'checked'
                    : ''
                }
              >

              <span class="choice-main">
                <strong>${esc(item.label)}</strong>
              </span>
            </label>
          `,
        ).join('')}
      </div>

      ${actionRow({
        back:
          false,
        nextLabel:
          'Ver convites',
      })}
    </section>
  `;

  app
    .querySelectorAll(
      '[name="eventType"]',
    )
    .forEach(
      (input) =>
        input.addEventListener(
          'change',
          async () => {
            state.event.type =
              input.value;

            persist(state);
            renderEventGate(
              state,
              render,
            );
          },
        ),
    );

  document
    .getElementById(
      'nextBtn',
    )
    .addEventListener(
      'click',
      () => {
        if (
          !state.event.type
        ) {
          showToast(
            'Escolha o tipo de evento.',
          );

          return;
        }

        state.step = 1;
        persist(state);
        render();
      },
    );
}

function renderProducts(
  state,
  render,
) {
  const products =
    state.catalog.products
    || [];

  const current =
    productFor(state);

  app.innerHTML = `
    <section class="page-card">
      ${progress(state)}

      <div class="page-head">
        <span class="eyebrow">Formato</span>
        <h1 class="page-title">
          Escolha a experiência
        </h1>
        <p class="page-subtitle">
          Todos os convites são personalizados.
          Os exemplos servem só como inspiração.
        </p>
      </div>

      <div class="product-grid">
        ${products.map(
          (product) => {
            const starting =
              product.variants?.length
                ? Math.min(
                  ...product.variants.map(
                    (variant) =>
                      Number(
                        variant.priceCents
                        || 0,
                      ),
                  ),
                )
                : 0;

            return `
              <article
                class="product-card ${
                  current?.code
                  === product.code
                    ? 'selected'
                    : ''
                }"
                data-product="${esc(product.code)}"
              >
                <span class="tag">
                  ${esc(product.pricingMode === 'scene_count'
                    ? 'Narrativa'
                    : 'Experiência')}
                </span>

                <h3>${esc(product.name)}</h3>

                <p>${esc(product.shortDescription || '')}</p>

                <span class="price">
                  ${
                    starting
                      ? `a partir de ${money(starting)}`
                      : ''
                  }
                </span>

                <button
                  class="btn btn-link examples-btn"
                  type="button"
                  data-examples="${esc(product.code)}"
                >
                  Ver exemplos
                </button>
              </article>
            `;
          },
        ).join('')}
      </div>

      ${actionRow({
        back:
          !state.deepProductSlug,
        nextLabel:
          'Continuar',
      })}
    </section>
  `;

  app
    .querySelectorAll(
      '[data-product]',
    )
    .forEach(
      (card) => {
        card.addEventListener(
          'click',
          (event) => {
            if (
              event.target.closest(
                '.examples-btn',
              )
            ) {
              return;
            }

            const product =
              products.find(
                (item) =>
                  item.code
                  === card.dataset.product,
              );

            if (!product) {
              return;
            }

            selectProduct(
              state,
              product,
            );

            persist(state);
            renderProducts(
              state,
              render,
            );
          },
        );
      },
    );

  app
    .querySelectorAll(
      '[data-examples]',
    )
    .forEach(
      (button) => {
        button.addEventListener(
          'click',
          (event) => {
            event.stopPropagation();

            const product =
              products.find(
                (item) =>
                  item.code
                  === button.dataset.examples,
              );

            if (product) {
              openExamples(
                product,
              );
            }
          },
        );
      },
    );

  bindBack(
    state,
    render,
  );

  document
    .getElementById(
      'nextBtn',
    )
    .addEventListener(
      'click',
      async () => {
        if (
          !productFor(state)
        ) {
          showToast(
            'Escolha o formato do convite.',
          );

          return;
        }

        await refreshConfigurationQuote(
          state,
        );

        state.step = 2;
        persist(state);
        render();
      },
    );
}

function renderConfiguration(
  state,
  render,
) {
  const product =
    productFor(state);

  const currentVariant =
    variantFor(state);

  app.innerHTML = `
    <section class="page-card">
      ${progress(state)}

      <div class="page-head">
        <span class="eyebrow">Configuração</span>
        <h1 class="page-title">
          ${esc(product.name)}
        </h1>
        <p class="page-subtitle">
          Primeiro, escolha a versão do seu convite.
          Os adicionais vêm depois da janela de entrega.
        </p>
      </div>

      ${
        product.variants?.length
          ? `
            <div class="section-block">
              <h2 class="section-title">
                ${
                  product.pricingMode
                  === 'scene_count'
                    ? 'Quantidade de cenas'
                    : 'Configuração'
                }
              </h2>

              ${product.pricingMode === 'scene_count' ? `
                <p class="muted" style="margin-top:-4px">
                  Cada cena é um momento diferente da história. A abertura está incluída e fica fora da contagem de cenas.
                </p>
              ` : ''}

              <div>
                ${sceneVariantsHtml(
                  product,
                  currentVariant,
                )}
              </div>
            </div>
          `
          : ''
      }

      ${actionRow()}
    </section>
  `;

  app
    .querySelectorAll(
      '[name="variant"]',
    )
    .forEach(
      (input) => {
        input.addEventListener(
          'change',
          async () => {
            state.selection.variantCode =
              input.value;

            state.selection.comboCode =
              '';

            await refreshConfigurationQuote(
              state,
            );

            persist(state);
            renderConfiguration(
              state,
              render,
            );
          },
        );
      },
    );

  bindBack(
    state,
    render,
  );

  document
    .getElementById(
      'nextBtn',
    )
    .addEventListener(
      'click',
      async () => {
        loading(
          'Calculando seu pedido...',
        );

        try {
          await updateQuote(state);
          state.step = 3;
          persist(state);
          render();
        } catch (error) {
          showToast(
            error.message,
          );

          renderConfiguration(
            state,
            render,
          );
        }
      },
    );
}

function renderDetails(
  state,
  render,
) {
  const eventKnown =
    Boolean(
      state.event.type,
    );

  app.innerHTML = `
    <section class="page-card">
      ${progress(state)}

      <div class="page-head">
        <span class="eyebrow">Data da festa</span>
        <h1 class="page-title">
          Quando vai acontecer?
        </h1>
        <p class="page-subtitle">
          Com a data, eu consigo mostrar apenas as janelas de entrega que realmente cabem na agenda.
        </p>
      </div>

      <div class="form-grid">
        ${
          !eventKnown
            ? `
              <div class="field">
                <label for="eventType">Tipo de evento</label>
                <select id="eventType" class="select">
                  <option value="">Selecione</option>
                  ${EVENT_TYPES.map(
                    (item) => `
                      <option
                        value="${item.value}"
                        ${
                          state.event.type
                          === item.value
                            ? 'selected'
                            : ''
                        }
                      >
                        ${esc(item.label)}
                      </option>
                    `,
                  ).join('')}
                </select>
              </div>
            `
            : ''
        }

        <div class="field">
          <label for="honoreeName">
            Nome da criança, casal ou evento
          </label>
          <input
            id="honoreeName"
            class="input"
            value="${esc(state.event.honoreeName)}"
          >
        </div>

        <div class="field">
          <label for="eventDate">Data da festa</label>
          <input
            id="eventDate"
            class="input"
            type="date"
            value="${esc(state.event.date)}"
          >
        </div>

        <div class="field full">
          <label for="eventSubtype">
            Algum subtipo ou observação do evento?
            <span class="muted">(opcional)</span>
          </label>
          <input
            id="eventSubtype"
            class="input"
            placeholder="Ex.: chá revelação, bodas..."
            value="${esc(state.event.subtype)}"
          >
        </div>
      </div>

      ${actionRow({
        nextLabel:
          'Ver datas de entrega',
      })}
    </section>
  `;

  const capture = () => {
    if (
      !eventKnown
    ) {
      state.event.type =
        document
          .getElementById(
            'eventType',
          )
          .value;
    }

    state.event.honoreeName =
      document
        .getElementById(
          'honoreeName',
        )
        .value
        .trim();

    state.event.date =
      document
        .getElementById(
          'eventDate',
        )
        .value;

    state.event.subtype =
      document
        .getElementById(
          'eventSubtype',
        )
        .value
        .trim();

    persist(state);
  };

  app
    .querySelectorAll(
      'input,select',
    )
    .forEach((element) => {
      const update = () => {
        element.classList.remove('input-error');
        element.removeAttribute('aria-invalid');
        capture();
      };
      element.addEventListener('input', update);
      element.addEventListener('change', update);
    });

  bindBack(
    state,
    render,
  );

  document
    .getElementById(
      'nextBtn',
    )
    .addEventListener(
      'click',
      async () => {
        capture();

        const requiredFields = [
          { value: state.event.type, label: 'Tipo de evento', id: 'eventType' },
          { value: state.event.honoreeName, label: 'Nome da criança, casal ou evento', id: 'honoreeName' },
          { value: state.event.date, label: 'Data da festa', id: 'eventDate' },
        ];
        const missing = requiredFields.filter(field => !String(field.value || '').trim());
        if (missing.length) {
          for (const field of missing) {
            const element = document.getElementById(field.id);
            element?.classList.add('input-error');
            element?.setAttribute('aria-invalid', 'true');
          }
          const first = document.getElementById(missing[0].id);
          first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          first?.focus();
          showToast(`Preencha: ${missing.map(field => field.label).join(', ')}.`);
          return;
        }

        loading(
          'Procurando a melhor janela...',
          'A agenda está sendo calculada.',
        );

        try {
          const data =
            await api(
              '/api/v2/delivery-options',
              {
                method:
                  'POST',
                body:
                  JSON.stringify({
                    selection:
                      state.selection,

                    eventType:
                      state.event.type
                      || null,

                    eventDate:
                      state.event.date,

                    limit:
                      6,
                  }),
              },
            );

          state.delivery =
            data.delivery;

          state.deliveryWindow =
            data.delivery.options
              ?.find(
                (option) =>
                  option.recommended,
              )
            || data.delivery.options
              ?.[0]
            || null;

          state.step = 4;
          persist(state);
          render();
        } catch (error) {
          showToast(
            error.message,
          );

          renderDetails(
            state,
            render,
          );
        }
      },
    );
}

function renderDelivery(
  state,
  render,
) {
  const options =
    state.delivery?.options
    || [];

  const urgencyPercent = Math.max(1, Math.min(100,
    Number(state.catalog?.rules?.urgencyPercent || 30)));
  const urgencyBaseCents = Number(state.quote?.subtotalCents ?? state.quote?.totalCents ?? 0);
  const urgencyAmountCents = Math.round(urgencyBaseCents * urgencyPercent / 100);
  const urgencyTotalCents = urgencyBaseCents + urgencyAmountCents;

  app.innerHTML = `
    <section class="page-card">
      ${progress(state)}

      <div class="page-head">
        <span class="eyebrow">Entrega</span>
        <h1 class="page-title">
          Escolha uma janela
        </h1>
        <p class="page-subtitle">
          Escolha uma faixa de 3 dias para o prazo de entrega.
          A produção pode ser concluída em menos dias dentro dessa faixa.
        </p>
      </div>

      ${
        options.length
          ? `
            <div class="delivery-grid">
              ${options.map(
                (option) => {
                  const selected =
                    state.deliveryWindow?.start
                    === option.start
                    && state.deliveryWindow?.end
                    === option.end;

                  return `
                    <label class="delivery-card ${
                      selected
                        ? 'selected'
                        : ''
                    }">
                      <input
                        type="radio"
                        name="delivery"
                        value="${esc(option.start)}|${esc(option.end)}"
                        ${
                          selected
                            ? 'checked'
                            : ''
                        }
                      >

                      <span class="delivery-copy">
                        <strong>
                          ${dateBr(option.start)}
                          a
                          ${dateBr(option.end)}
                        </strong>

                        <small>
                          ${
                            option.recommended
                              ? '⭐ Recomendado para sua data'
                              : 'Disponível'
                          }
                        </small>
                      </span>
                    </label>
                  `;
                },
              ).join('')}
            </div>
          `
          : `
            <div class="notice info">
              <strong>Esta data precisa de análise de encaixe.</strong>
              <div style="margin-top:6px">Se for aprovado, será aplicado um adicional de <strong>${urgencyPercent}%</strong> após os descontos. Nenhuma cobrança é feita agora.</div>
            </div>
            <div class="quote-card urgency-preview">
              <div class="quote-row"><span>Adicional de urgência</span><strong>+ ${money(urgencyAmountCents)}</strong></div>
              <div class="quote-row total"><span>Total se aprovado</span><strong>${money(urgencyTotalCents)}</strong></div>
            </div>
          `
      }

      ${actionRow({
        nextLabel:
          options.length
            ? 'Continuar'
            : 'Solicitar análise de encaixe',
      })}
    </section>
  `;

  app
    .querySelectorAll(
      '[name="delivery"]',
    )
    .forEach(
      (input) => {
        input.addEventListener(
          'change',
          () => {
            const [
              start,
              end,
            ] =
              input.value.split('|');

            state.deliveryWindow = {
              start,
              end,
            };

            persist(state);
            renderDelivery(
              state,
              render,
            );
          },
        );
      },
    );

  bindBack(
    state,
    render,
  );

  document
    .getElementById(
      'nextBtn',
    )
    .addEventListener(
      'click',
      async () => {
        if (!options.length) {
          state.step =
            5;

          persist(state);
          render();
          return;
        }

        if (
          !state.deliveryWindow
        ) {
          showToast(
            'Escolha uma janela de entrega.',
          );

          return;
        }

        state.step = 5;
        persist(state);
        render();
      },
    );
}

function renderAddons(
  state,
  render,
) {
  const normalizedSelection =
    new Set(
      state.selection.addonCodes
      || [],
    );

  const hasMomentsBase =
    [
      ...normalizedSelection,
    ]
      .some(
        (code) =>
          addonByCode(
            state,
            code,
          )
            ?.group
          === 'moments',
      );

  if (!hasMomentsBase) {
    normalizedSelection.delete(
      'moments_extra_100',
    );
  } else {
    normalizedSelection.delete(
      'custom_filter',
    );
  }

  state.selection.addonCodes =
    [
      ...normalizedSelection,
    ];

  const selectedAddons =
    new Set(
      state.selection.addonCodes
      || [],
    );

  const groups =
    addonGroups(
      state,
    );

  const activeGroup =
    state.activeAddonGroup
    || '';

  app.innerHTML = `
    <section class="page-card">
      ${progress(state)}

      <div class="page-head">
        <span class="eyebrow">Adicionais</span>
        <h1 class="page-title">
          Quer adicionar algo?
        </h1>
        <p class="page-subtitle">
          Se houver mais de uma opção, abra para escolher. Adicionais simples podem ser marcados direto.
        </p>
      </div>

      ${
        groups.length
          ? `
            <div class="addon-families">
              ${groups.map(
                ([groupName, addons]) => {
                  const open =
                    activeGroup
                    === groupName;

                  const familySelected =
                    addons.some(
                      (addon) =>
                        selectedAddons.has(
                          addon.code,
                        ),
                    );

                  if (
                    addons.length
                    === 1
                  ) {
                    const addon =
                      addons[0];

                    return `
                      <label class="choice-card addon-single ${
                        selectedAddons.has(addon.code)
                          ? 'selected'
                          : ''
                      }">
                        <input
                          type="checkbox"
                          name="addon"
                          value="${esc(addon.code)}"
                          ${
                            selectedAddons.has(addon.code)
                              ? 'checked'
                              : ''
                          }
                        >

                        <span class="choice-main">
                          <strong>${esc(addon.name)}</strong>
                          <small>+ ${money(addon.priceCents)}</small>
                          ${addonExplanationHtml(addon)}
                        </span>
                      </label>
                    `;
                  }

                  return `
                    <div class="addon-family ${
                      open
                        ? 'open'
                        : ''
                    } ${
                      familySelected
                        ? 'selected'
                        : ''
                    }">
                      <button
                        class="addon-family-toggle"
                        type="button"
                        data-addon-family="${esc(groupName)}"
                      >
                        <span class="addon-family-copy">
                          <strong>${esc(addonGroupLabel(groupName))}</strong>
                          <small>${esc(addonFamilySummary(state, addons))}</small>
                        </span>

                        <span class="addon-family-action">
                          ${open ? 'Fechar' : 'Ver opções'}
                        </span>
                      </button>

                      ${
                        open
                          ? `
                            <div class="addon-family-options grid two">
                              ${addons.map(
                                (addon) => `
                                  <label class="choice-card ${
                                    selectedAddons.has(addon.code)
                                      ? 'selected'
                                      : ''
                                  }">
                                    <input
                                      type="checkbox"
                                      name="addon"
                                      value="${esc(addon.code)}"
                                      ${
                                        selectedAddons.has(addon.code)
                                          ? 'checked'
                                          : ''
                                      }
                                    >

                                    <span class="choice-main">
                                      <strong>${esc(addon.name)}</strong>
                                      <small>+ ${money(addon.priceCents)}</small>
                                      ${addonExplanationHtml(addon)}
                                    </span>
                                  </label>
                                `,
                              ).join('')}
                            </div>
                          `
                          : ''
                      }
                    </div>
                  `;
                },
              ).join('')}
            </div>
          `
          : `
            <div class="muted">
              Nenhum adicional disponível no momento.
            </div>
          `
      }

      ${totalOnlyHtml(state.quote)}

      ${actionRow()}
    </section>
  `;

  app
    .querySelectorAll(
      '[data-addon-family]',
    )
    .forEach(
      (button) => {
        button.addEventListener(
          'click',
          () => {
            state.activeAddonGroup =
              state.activeAddonGroup
              === button.dataset.addonFamily
                ? ''
                : button.dataset.addonFamily;

            persist(state);
            renderAddons(
              state,
              render,
            );
          },
        );
      },
    );

  app
    .querySelectorAll(
      '[name="addon"]',
    )
    .forEach(
      (input) => {
        input.addEventListener(
          'change',
          async () => {
            const set =
              new Set(
                state.selection.addonCodes,
              );

            const changedAddon =
              addonByCode(
                state,
                input.value,
              );

            if (
              input.checked
            ) {
              if (
                changedAddon?.group
              ) {
                for (
                  const code
                  of [
                    ...set,
                  ]
                ) {
                  const current =
                    addonByCode(
                      state,
                      code,
                    );

                  if (
                    current?.group
                    === changedAddon.group
                  ) {
                    set.delete(
                      code,
                    );
                  }
                }
              }

              if (
                changedAddon?.group
                === 'moments'
              ) {
                set.delete(
                  'custom_filter',
                );
              }

              set.add(
                input.value,
              );
            } else {
              set.delete(
                input.value,
              );
            }

            const hasMoments =
              [
                ...set,
              ]
                .some(
                  (code) =>
                    addonByCode(
                      state,
                      code,
                    )
                      ?.group
                    === 'moments',
                );

            if (!hasMoments) {
              set.delete(
                'moments_extra_100',
              );
            }

            state.selection.addonCodes =
              [
                ...set,
              ];

            const combo =
              comboByCode(
                state,
                state.selection.comboCode,
              );

            if (
              combo
              && !comboMatchesSelection(
                state,
                combo,
              )
            ) {
              state.selection.comboCode =
                '';
            }

            await refreshConfigurationQuote(
              state,
            );

            persist(state);
            renderAddons(
              state,
              render,
            );
          },
        );
      },
    );

  bindBack(
    state,
    render,
  );

  document
    .getElementById(
      'nextBtn',
    )
    .addEventListener(
      'click',
      async () => {
        loading(
          'Conferindo a agenda...',
        );

        try {
          await updateQuote(state);

          if (
            (state.delivery?.options || [])
              .length
          ) {
            const sameWindow =
              await refreshDeliveryForSelection(
                state,
              );

            if (!sameWindow) {
              persist(state);

              showDeliveryChangeNotice(
                state,
                render,
                'Os adicionais escolhidos aumentaram a carga de produção do pedido.',
              );

              return;
            }
          }

          state.step = 6;
          persist(state);
          render();
        } catch (error) {
          showToast(
            error.message,
          );

          renderAddons(
            state,
            render,
          );
        }
      },
    );
}

function renderRecommendation(
  state,
  render,
) {
  const offer =
    finalRecommendation(
      state,
    );

  if (!offer) {
    continueAfterRecommendation(
      state,
      render,
    )
      .catch(
        error =>
          showToast(
            error.message,
          ),
      );

    return;
  }

  const promoAddon =
    offer.kind
    === 'addon'
      ? (
        offer.choices
        || []
      )
        .slice()
        .sort(
          (a, b) =>
            Number(
              a.priceCents
              || 0,
            )
            - Number(
              b.priceCents
              || 0,
            ),
        )
        [0]
      : null;

  const comboSavingsCents =
    comboSavingsForOffer(
      state,
      offer,
      promoAddon,
    );

  const reason =
    recommendationReason(
      state,
      offer,
    );

  app.innerHTML = `
    <section class="page-card promo-stage">
      ${progress(state)}

      <div class="page-head">
        <span class="eyebrow">Pedido configurado</span>
        <h1 class="page-title">
          Está quase pronto
        </h1>
        <p class="page-subtitle">
          Antes de seguir para seus dados, há só uma oferta opcional para este pedido.
        </p>
      </div>

      ${totalOnlyHtml(state.quote)}

      <div class="promo-sheet" role="dialog" aria-label="Oferta opcional">
        <span class="promo-kicker">Oferta para adicionar agora</span>

        <strong class="promo-title">
          ${esc(recommendationTitle(offer))}
        </strong>

        ${
          offer.kind
          === 'product_upgrade'
            ? `
              <p class="promo-copy">
                Transforme seu convite em
                <strong>${esc(offer.product.name)}</strong>
                mantendo a mesma quantidade de cenas
                por mais
                <strong>${money(offer.priceDeltaCents)}</strong>.
              </p>
            `
            : offer.kind
              === 'combo'
                ? `
                  <p class="promo-copy">
                    Suas escolhas já liberaram
                    <strong>${esc(offer.combo.name)}</strong>.
                    Aplique agora e economize
                    <strong>${money(offer.combo.discountCents || 0)}</strong>.
                  </p>
                `
                : promoAddon
                  ? `
                <p class="promo-copy">
                  Leve
                  <strong>${esc(promoAddon.name)}</strong>
                  por mais
                  <strong>${money(promoAddon.priceCents)}</strong>
                  neste pedido.
                  ${
                    offer.combo
                      ? ` Ao adicionar, você completa o combo <strong>${esc(offer.combo.name)}</strong>.`
                      : ''
                  }
                </p>
              `
              : ''
        }

        <div class="promo-why">
          <strong>Por que estou te sugerindo isso?</strong>
          <p>${esc(reason)}</p>
        </div>

        ${
          offer.combo
          && comboSavingsCents > 0
            ? `
              <div class="promo-saving">
                Com esta escolha, seu pedido entra no
                <strong>${esc(offer.combo.name)}</strong>
                e você economiza
                <strong>${money(comboSavingsCents)}</strong>.
              </div>
            `
            : ''
        }

        ${
          promoAddon
            ? addonExplanationHtml(
              promoAddon,
            )
            : offer.kind
              === 'product_upgrade'
                ? `
                  <div class="addon-explanation">
                    <strong>O que muda no seu pedido</strong>
                    <p>${esc(
                      offer.product.shortDescription
                      || 'Seu convite passa para a versão interativa correspondente.',
                    )}</p>
                    <ul>
                      <li>Você mantém a mesma quantidade de cenas.</li>
                      <li>O valor exibido é somente a diferença para o upgrade.</li>
                    </ul>
                  </div>
                `
                : ''
        }

        <div class="promo-actions">
          <button
            id="skipFinalOffer"
            class="btn btn-ghost"
            type="button"
          >
            Agora não
          </button>

          <button
            id="acceptFinalOffer"
            class="btn btn-primary"
            type="button"
          >
            ${
              offer.kind
              === 'product_upgrade'
                ? `Deixar interativo por + ${money(offer.priceDeltaCents)}`
                : offer.kind
                  === 'combo'
                    ? `Aplicar e economizar ${money(offer.combo.discountCents || 0)}`
                    : promoAddon
                      ? `Adicionar por ${money(promoAddon.priceCents)}`
                      : 'Adicionar'
            }
          </button>
        </div>
      </div>
    </section>
  `;

  bindBack(
    state,
    render,
  );

  document
    .getElementById(
      'skipFinalOffer',
    )
    .addEventListener(
      'click',
      async () => {
        loading(
          'Continuando...',
        );

        try {
          await continueAfterRecommendation(
            state,
            render,
          );
        } catch (error) {
          showToast(
            error.message,
          );

          renderRecommendation(
            state,
            render,
          );
        }
      },
    );

  document
    .getElementById(
      'acceptFinalOffer',
    )
    .addEventListener(
      'click',
      async () => {
        const button =
          document
            .getElementById(
              'acceptFinalOffer',
            );

        button.disabled =
          true;

        try {
          if (
            offer.kind
            === 'product_upgrade'
          ) {
            state.selection.productCode =
              offer.product.code;

            state.selection.productSlug =
              offer.product.slug;

            state.selection.variantCode =
              offer.variant.code;

            if (
              state.deepProductSlug
            ) {
              state.deepProductSlug =
                offer.product.slug;

              const nextUrl =
                new URL(
                  window.location.href,
                );

              nextUrl.pathname =
                `/pedido/${offer.product.slug}`;

              window.history
                .replaceState(
                  {},
                  '',
                  nextUrl,
                );
            }

            state.selection.comboCode =
              '';

            await updateQuote(
              state,
            );

            const sameWindow =
              await refreshDeliveryForSelection(
                state,
              );

            if (
              (state.delivery?.options || [])
                .length
              && !sameWindow
            ) {
              persist(state);

              showDeliveryChangeNotice(
                state,
                render,
                'O upgrade para Interativo aumentou a carga de produção do pedido.',
              );

              return;
            }

            await continueAfterRecommendation(
              state,
              render,
            );

            return;
          }

          if (
            offer.kind
            === 'combo'
          ) {
            state.selection.comboCode =
              offer.combo.code;

            await updateQuote(
              state,
            );

            await continueAfterRecommendation(
              state,
              render,
            );

            return;
          }

          const selected =
            promoAddon
              ?.code;

          if (!selected) {
            await continueAfterRecommendation(
              state,
              render,
            );
            return;
          }

          const addon =
            addonByCode(
              state,
              selected,
            );

          const set =
            new Set(
              state.selection.addonCodes,
            );

          if (
            addon?.group
          ) {
            for (
              const code
              of [
                ...set,
              ]
            ) {
              if (
                addonByCode(
                  state,
                  code,
                )
                  ?.group
                === addon.group
              ) {
                set.delete(
                  code,
                );
              }
            }
          }

          if (
            addon?.group
            === 'moments'
          ) {
            set.delete(
              'custom_filter',
            );
          }

          set.add(
            selected,
          );

          state.selection.addonCodes =
            [
              ...set,
            ];

          if (
            offer.combo
          ) {
            state.selection.comboCode =
              offer.combo.code;
          }

          await updateQuote(
            state,
          );

          const sameWindow =
            await refreshDeliveryForSelection(
              state,
            );

          if (
            (state.delivery?.options || [])
              .length
            && !sameWindow
          ) {
            persist(state);

            showDeliveryChangeNotice(
              state,
              render,
              offer.kind === 'product_upgrade'
                ? 'O upgrade para Interativo aumentou a carga de produção do pedido.'
                : 'Essa oferta aumentou a carga de produção do pedido.',
            );

            return;
          }

          await continueAfterRecommendation(
            state,
            render,
          );
        } catch (error) {
          button.disabled =
            false;

          showToast(
            error.message,
          );
        }
      },
    );
}

function renderCustomer(
  state,
  render,
) {
  app.innerHTML = `
    <section class="page-card">
      ${progress(state)}

      <div class="page-head">
        <span class="eyebrow">Seus dados</span>
        <h1 class="page-title">
          Agora, só o essencial
        </h1>
        <p class="page-subtitle">
          O briefing criativo completo vem somente depois da confirmação do pagamento.
        </p>
      </div>

      <div class="form-grid">
        <div class="field">
          <label for="customerName">Seu nome</label>
          <input
            id="customerName"
            class="input"
            autocomplete="name"
            value="${esc(state.customer.name)}"
          >
        </div>

        <div class="field">
          <label for="whatsapp">WhatsApp</label>
          <input
            id="whatsapp"
            class="input"
            inputmode="tel"
            autocomplete="tel"
            value="${esc(state.customer.whatsapp)}"
          >
        </div>

        <div class="field">
          <label for="email">E-mail <span class="muted">(opcional)</span></label>
          <input
            id="email"
            class="input"
            type="email"
            autocomplete="email"
            value="${esc(state.customer.email)}"
          >
        </div>
      </div>

      <div class="section-block">
        <button
          id="toggleCoupon"
          class="btn btn-link"
          type="button"
        >
          Adicionar cupom
        </button>

        <div
          id="couponBox"
          class="field ${
            state.selection.couponCode
              ? ''
              : 'hidden'
          }"
          style="max-width:360px"
        >
          <label for="couponCode">Cupom</label>
          <input
            id="couponCode"
            class="input"
            value="${esc(state.selection.couponCode || '')}"
            autocomplete="off"
          >
        </div>
      </div>

      ${totalOnlyHtml(state.quote)}

      ${actionRow({
        nextLabel:
          (state.delivery?.options || []).length
            ? 'Revisar pedido'
            : 'Enviar para análise de encaixe',
      })}
    </section>
  `;

  const capture = () => {
    state.customer.name =
      document
        .getElementById(
          'customerName',
        )
        .value
        .trim();

    state.customer.whatsapp =
      document
        .getElementById(
          'whatsapp',
        )
        .value
        .trim();

    state.customer.email =
      document
        .getElementById(
          'email',
        )
        .value
        .trim();

    state.selection.couponCode =
      document
        .getElementById(
          'couponCode',
        )
        ?.value
        .trim()
        .toUpperCase()
      || '';

    persist(state);
  };

  app
    .querySelectorAll(
      'input',
    )
    .forEach((element) => {
      const update = () => {
        element.classList.remove('input-error');
        element.removeAttribute('aria-invalid');
        capture();
      };
      element.addEventListener('input', update);
      element.addEventListener('change', update);
    });

  document
    .getElementById(
      'toggleCoupon',
    )
    .addEventListener(
      'click',
      () => {
        document
          .getElementById(
            'couponBox',
          )
          .classList
          .remove(
            'hidden',
          );

        document
          .getElementById(
            'couponCode',
          )
          .focus();
      },
    );

  document
    .getElementById(
      'backBtn',
    )
    ?.addEventListener(
      'click',
      () => {
        state.step = 5;
        persist(state);
        render();
      },
    );

  document
    .getElementById(
      'nextBtn',
    )
    .addEventListener(
      'click',
      async () => {
        capture();

        const requiredFields = [
          { value: state.customer.name, label: 'Seu nome', id: 'customerName' },
          { value: state.customer.whatsapp, label: 'WhatsApp', id: 'whatsapp' },
        ];
        const missing = requiredFields.filter(field => !String(field.value || '').trim());

        if (missing.length) {
          for (const field of missing) {
            const element = document.getElementById(field.id);
            element?.classList.add('input-error');
            element?.setAttribute('aria-invalid', 'true');
          }

          const first = document.getElementById(missing[0].id);
          first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          first?.focus();

          showToast(
            `Preencha: ${missing.map(field => field.label).join(', ')}.`,
          );

          return;
        }

        loading(
          (state.delivery?.options || []).length
            ? 'Atualizando seu pedido...'
            : 'Enviando para análise...',
        );

        try {
          await updateQuote(state);

          if (
            !(state.delivery?.options || [])
              .length
          ) {
            if (
              state.simulationMode
            ) {
              state.simulationUrgency =
                true;
              state.step = 8;
              persist(state);
              render();
              return;
            }

            const result =
              await api(
                '/api/v2/urgency/request',
                {
                  method:
                    'POST',
                  body:
                    JSON.stringify({
                      clientRequestId:
                        state.clientRequestId,
                      customer:
                        state.customer,
                      event:
                        state.event,
                      selection:
                        state.selection,
                    }),
                },
              );

            localStorage.removeItem(
              storeKeyFor(
                state.simulationMode,
              ),
            );

            window.location.href =
              result.order
                .customerAreaPath;

            return;
          }

          state.step = 8;
          persist(state);
          render();
        } catch (error) {
          showToast(
            error.message,
          );

          renderCustomer(
            state,
            render,
          );
        }
      },
    );
}

function renderReview(
  state,
  render,
) {
  const product =
    productFor(state);

  const variant =
    variantFor(state);

  const addons =
    state.catalog.addons
      ?.filter(
        (addon) =>
          state.selection.addonCodes
            .includes(
              addon.code,
            ),
      )
    || [];

  app.innerHTML = `
    <section class="page-card">
      ${progress(state)}

      <div class="page-head">
        <span class="eyebrow">Revisão</span>
        <h1 class="page-title">
          Confira seu pedido
        </h1>
        <p class="page-subtitle">
          Depois desta revisão você escolhe a forma de pagamento.
          O briefing criativo continua para depois da confirmação.
        </p>
      </div>

      <dl class="review-list">
        <div class="review-line">
          <dt>Cliente</dt>
          <dd>
            ${esc(state.customer.name)}
            •
            ${esc(state.customer.whatsapp)}
          </dd>
        </div>

        <div class="review-line">
          <dt>Evento</dt>
          <dd>
            ${esc(eventLabel(state.event.type))}
            •
            ${esc(state.event.honoreeName)}
            •
            ${esc(dateBr(state.event.date))}
          </dd>
        </div>

        <div class="review-line">
          <dt>Convite</dt>
          <dd>
            ${esc(product?.name || '')}
            ${
              variant?.label
                ? ` • ${esc(variant.label)}`
                : ''
            }
          </dd>
        </div>

        <div class="review-line">
          <dt>Adicionais</dt>
          <dd>
            ${
              addons.length
                ? addons.map(
                  (addon) =>
                    esc(addon.name),
                ).join(', ')
                : 'Nenhum'
            }
          </dd>
        </div>

        <div class="review-line">
          <dt>Entrega</dt>
          <dd>
            ${
              state.simulationUrgency
                ? 'Em uma compra real: análise de encaixe'
                : `${esc(dateBr(state.deliveryWindow?.start))} a ${esc(dateBr(state.deliveryWindow?.end))}`
            }
          </dd>
        </div>

        ${
          state.selection.couponCode
            ? `
              <div class="review-line">
                <dt>Cupom</dt>
                <dd>${esc(state.selection.couponCode)}</dd>
              </div>
            `
            : ''
        }
      </dl>

      <div class="section-block">
        ${totalOnlyHtml(state.quote)}
      </div>

      ${actionRow({
        nextLabel:
          'Escolher pagamento',
      })}
    </section>
  `;

  bindBack(
    state,
    render,
  );

  document
    .getElementById(
      'nextBtn',
    )
    .addEventListener(
      'click',
      () => {
        state.step = 9;
        persist(state);
        render();
      },
    );
}

async function renderPayment(
  state,
  render,
) {
  try {
    await updateQuote(state);
  } catch {
    // mantém último quote válido
  }

  app.innerHTML = `
    <section class="page-card">
      ${progress(state)}

      <div class="page-head">
        <span class="eyebrow">Pagamento</span>
        <h1 class="page-title">
          Como você prefere pagar?
        </h1>
        <p class="page-subtitle">
          ${
            state.simulationMode
              ? 'Escolha uma forma de pagamento apenas para conferir como o pedido ficaria. Nenhuma cobrança será aberta.'
              : 'Na próxima etapa você lê e aceita as condições antes de abrir o Mercado Pago.'
          }
        </p>
      </div>

      <div class="grid two">
        <label class="choice-card ${
          state.selection.paymentMethod
          === 'pix'
            ? 'selected'
            : ''
        }">
          <input
            type="radio"
            name="paymentMethod"
            value="pix"
            ${
              state.selection.paymentMethod
              === 'pix'
                ? 'checked'
                : ''
            }
          >

          <span class="choice-main">
            <strong>Pix</strong>
            <small>
              50% para confirmar o pedido.
              O saldo é pago diretamente à Libri após a aprovação.
            </small>
          </span>
        </label>

        <label class="choice-card ${
          state.selection.paymentMethod
          === 'card'
            ? 'selected'
            : ''
        }">
          <input
            type="radio"
            name="paymentMethod"
            value="card"
            ${
              state.selection.paymentMethod
              === 'card'
                ? 'checked'
                : ''
            }
          >

          <span class="choice-main">
            <strong>Cartão</strong>
            <small>
              100% pelo Mercado Pago.
              Parcelamento disponível conforme o checkout.
            </small>
          </span>
        </label>
      </div>

      <div class="section-block">
        ${quoteHtml(state.quote)}
      </div>

      ${actionRow()}
    </section>
  `;

  app
    .querySelectorAll(
      '[name="paymentMethod"]',
    )
    .forEach(
      (input) => {
        input.addEventListener(
          'change',
          async () => {
            state.selection.paymentMethod =
              input.value;

            persist(state);

            loading(
              'Atualizando o valor...',
            );

            try {
              await updateQuote(state);
            } finally {
              renderPayment(
                state,
                render,
              );
            }
          },
        );
      },
    );

  bindBack(
    state,
    render,
  );

  document
    .getElementById(
      'nextBtn',
    )
    .addEventListener(
      'click',
      () => {
        state.step = 10;
        persist(state);
        render();
      },
    );
}

function renderTerms(
  state,
  render,
) {
  app.innerHTML = `
    <section class="page-card">
      ${progress(state)}

      <div class="page-head">
        <span class="eyebrow">Condições</span>
        <h1 class="page-title">
          Só falta confirmar
        </h1>
        <p class="page-subtitle">
          ${
            state.simulationMode
              ? 'Esta é a última tela da simulação. Você pode conferir as condições, mas nada será contratado.'
              : 'Leia as condições do pedido e, depois do aceite, siga para o pagamento.'
          }
        </p>
      </div>

      <div class="section-block">
        ${quoteHtml(state.quote)}
      </div>

      <div class="terms-box">
        <strong>Condições do pedido</strong>

        <p class="muted">
          Versão ${esc(state.terms?.version || '')}
        </p>

        <button
          id="readTerms"
          class="btn btn-ghost"
          type="button"
        >
          Ler todas as condições
        </button>

        ${
          state.simulationMode
            ? `
              <div class="notice info" style="margin-top:14px">
                No modo de teste, o aceite não é registrado e nenhuma cobrança é criada.
              </div>
            `
            : `
              <label class="checkline">
                <input
                  id="termsAccepted"
                  type="checkbox"
                  ${state.termsAccepted ? 'checked' : ''}
                >

                <span>
                  Li e concordo com as Condições do Pedido.
                </span>
              </label>
            `
        }
      </div>

      ${actionRow({
        nextId:
          'payBtn',
        nextLabel:
          state.simulationMode
            ? 'Concluir simulação'
            : 'Ir para o pagamento',
      })}
    </section>
  `;

  document
    .getElementById(
      'readTerms',
    )
    .addEventListener(
      'click',
      () => {
        modal(
          `Condições • ${state.terms.version}`,
          `<pre>${esc(state.terms.body)}</pre>`,
        );
      },
    );

  document
    .getElementById(
      'termsAccepted',
    )
    ?.addEventListener(
      'change',
      (event) => {
        state.termsAccepted =
          event.target.checked;

        persist(state);
      },
    );

  bindBack(
    state,
    render,
  );

  document
    .getElementById(
      'payBtn',
    )
    .addEventListener(
      'click',
      async () => {
        if (
          state.simulationMode
        ) {
          localStorage.removeItem(
            storeKeyFor(
              true,
            ),
          );

          modal(
            'Simulação concluída',
            `
              <div class="notice success">
                <strong>Nenhum pedido foi criado.</strong>
                <p style="margin:8px 0 0">
                  Nenhuma cobrança foi aberta, nenhum espaço da agenda foi reservado e nada entrou no Financeiro.
                </p>
              </div>

              <div class="action-row">
                <button
                  id="restartSimulation"
                  class="btn btn-primary"
                  type="button"
                >
                  Simular outro pedido
                </button>
              </div>
            `,
          );

          document
            .getElementById(
              'restartSimulation',
            )
            ?.addEventListener(
              'click',
              () => {
                window.location.href =
                  '/pedido?simular=1';
              },
            );

          return;
        }

        state.termsAccepted =
          document
            .getElementById(
              'termsAccepted',
            )
            .checked;

        if (
          !state.termsAccepted
        ) {
          showToast(
            'Leia e aceite as condições para continuar.',
          );

          return;
        }

        const button =
          document
            .getElementById(
              'payBtn',
            );

        button.disabled =
          true;

        button.textContent =
          'Abrindo pagamento...';

        try {
          const result =
            await api(
              '/api/v2/checkout/start',
              {
                method:
                  'POST',
                body:
                  JSON.stringify({
                    clientRequestId:
                      state.clientRequestId,
                    customer:
                      state.customer,
                    event:
                      state.event,
                    selection:
                      state.selection,
                    deliveryWindow:
                      state.deliveryWindow,
                    termsAccepted:
                      true,
                    termsVersion:
                      state.terms.version,
                  }),
              },
            );

          if (
            !result.payment
              ?.checkoutUrl
          ) {
            if (result.order?.customerAreaPath) {
              localStorage.removeItem(
                storeKeyFor(
                  state.simulationMode,
                ),
              );
              window.location.href = result.order.customerAreaPath;
              return;
            }
            throw new Error(
              'O pagamento não ficou disponível. Tente novamente.',
            );
          }

          localStorage.removeItem(
            storeKeyFor(
              state.simulationMode,
            ),
          );

          window.location.href =
            result.payment
              .checkoutUrl;
        } catch (error) {
          button.disabled =
            false;

          button.textContent =
            'Ir para o pagamento';

          if (
            error.data?.code
            === 'terms_changed'
          ) {
            const termsData =
              await api(
                '/api/v2/terms/current',
              );

            state.terms =
              termsData.terms;

            state.termsAccepted =
              false;

            persist(state);
            renderTerms(
              state,
              render,
            );

            showToast(
              'As condições foram atualizadas. Leia a nova versão.',
            );

            return;
          }

          if (
            error.data?.code
            === 'delivery_window_unavailable'
          ) {
            state.step = 4;
            state.deliveryWindow =
              null;
            persist(state);
            render();

            showToast(
              'Essa janela acabou de ficar indisponível. Escolha outra.',
            );

            return;
          }

          showToast(
            error.message,
          );
        }
      },
    );
}

export async function startStore(
  productSlug = '',
) {
  setSubtitle(
    'Faça seu pedido',
  );

  const state =
    readSaved(
      productSlug,
    );

  loading(
    'Carregando os convites...',
  );

  const [
    catalogData,
    termsData,
  ] =
    await Promise.all([
      api(
        '/api/v2/catalog',
      ),
      api(
        '/api/v2/terms/current',
      ),
    ]);

  state.catalog =
    catalogData.catalog;

  state.terms =
    termsData.terms;

  if (
    productSlug
  ) {
    const product =
      state.catalog.products
        .find(
          (item) =>
            item.slug
            === productSlug,
        );

    if (!product) {
      throw new Error(
        'Este formato de convite não foi encontrado.',
      );
    }

    selectProduct(
      state,
      product,
    );

    await refreshConfigurationQuote(
      state,
    );

    state.step =
      Math.max(
        2,
        state.step,
      );
  }

  const render = () => {
    persist(state);

    if (
      state.step === 0
    ) {
      renderEventGate(
        state,
        render,
      );

      return;
    }

    if (
      state.step === 1
    ) {
      renderProducts(
        state,
        render,
      );

      return;
    }

    if (
      state.step === 2
    ) {
      renderConfiguration(
        state,
        render,
      );

      return;
    }

    if (
      state.step === 3
    ) {
      renderDetails(
        state,
        render,
      );

      return;
    }

    if (
      state.step === 4
    ) {
      renderDelivery(
        state,
        render,
      );

      return;
    }

    if (
      state.step === 5
    ) {
      renderAddons(
        state,
        render,
      );

      return;
    }

    if (
      state.step === 6
    ) {
      renderRecommendation(
        state,
        render,
      );

      return;
    }

    if (
      state.step === 7
    ) {
      renderCustomer(
        state,
        render,
      );

      return;
    }

    if (
      state.step === 8
    ) {
      renderReview(
        state,
        render,
      );

      return;
    }

    if (
      state.step === 9
    ) {
      renderPayment(
        state,
        render,
      );

      return;
    }

    renderTerms(
      state,
      render,
    );
  };

  render();
}

function manualTerms(
  order,
) {
  return `
    <div class="terms-box">
      <strong>
        Condições do pedido
      </strong>

      <p class="muted">
        Versão ${esc(order.terms?.version || '')}
      </p>

      <button
        id="manualReadTerms"
        class="btn btn-ghost"
        type="button"
      >
        Ler condições
      </button>

      <label class="checkline">
        <input
          id="manualAcceptTerms"
          type="checkbox"
        >

        <span>
          Li e concordo com as Condições do Pedido.
        </span>
      </label>
    </div>
  `;
}

export async function startManualOrder(
  token,
) {
  setSubtitle(
    'Pedido preparado para você',
  );

  loading(
    'Abrindo seu pedido...',
  );

  const data =
    await api(
      `/api/v2/manual-order/${
        token
      }`,
    );

  const order =
    data.order;

  const render = () => {
    const paymentPending =
      order.payment
      && order.payment.status
      !== 'approved'
      && order.payment.checkoutUrl;

    app.innerHTML = `
      <section class="page-card">
        <div class="manual-hero">
          <span class="eyebrow">
            Pedido preparado pela Libri
          </span>

          <h1 class="page-title">
            Oi, ${esc(order.customerName)} 💛
          </h1>

          <p class="page-subtitle">
            Confira o que combinamos antes de seguir para o pagamento.
          </p>

          <span class="manual-code">
            ${esc(order.code)}
          </span>
        </div>

        <dl class="review-list">
          <div class="review-line">
            <dt>Evento</dt>
            <dd>
              ${esc(order.event.honoreeName)}
              •
              ${esc(dateBr(order.event.date))}
            </dd>
          </div>

          <div class="review-line">
            <dt>Itens</dt>
            <dd>
              ${order.items.map(
                (item) =>
                  esc(item.name_snapshot),
              ).join(', ')}
            </dd>
          </div>

          <div class="review-line">
            <dt>Entrega</dt>
            <dd>
              ${esc(dateBr(order.deliveryWindow.start))}
              a
              ${esc(dateBr(order.deliveryWindow.end))}
            </dd>
          </div>

          <div class="review-line">
            <dt>Total</dt>
            <dd>${money(order.pricing.totalCents)}</dd>
          </div>

          <div class="review-line">
            <dt>Pagamento</dt>
            <dd>
              ${
                order.pricing.paymentMethod
                === 'pix'
                  ? `Pix • ${money(order.pricing.depositCents)} agora`
                  : 'Cartão • pagamento integral'
              }
            </dd>
          </div>
        </dl>

        ${
          order.alreadyPaid
            ? `
              <div class="notice success section-block">
                Pagamento confirmado ✓
              </div>

              <div class="action-row">
                <span></span>

                <a
                  class="btn btn-primary btn-large"
                  href="${esc(order.customerAreaPath)}"
                >
                  Abrir meu pedido
                </a>
              </div>
            `
            : paymentPending
              ? `
                <div class="notice info section-block">
                  Seu checkout já foi criado.
                </div>

                <div class="action-row">
                  <span></span>

                  <a
                    class="btn btn-primary btn-large"
                    href="${esc(order.payment.checkoutUrl)}"
                  >
                    Continuar pagamento
                  </a>
                </div>
              `
              : `
                ${manualTerms(order)}

                <div class="action-row">
                  <span></span>

                  <button
                    id="manualPay"
                    class="btn btn-primary btn-large"
                    type="button"
                  >
                    Ir para o pagamento
                  </button>
                </div>
              `
        }
      </section>
    `;

    document
      .getElementById(
        'manualReadTerms',
      )
      ?.addEventListener(
        'click',
        () => {
          modal(
            `Condições • ${order.terms.version}`,
            `<pre>${esc(order.terms.body)}</pre>`,
          );
        },
      );

    document
      .getElementById(
        'manualPay',
      )
      ?.addEventListener(
        'click',
        async () => {
          if (
            !document
              .getElementById(
                'manualAcceptTerms',
              )
              .checked
          ) {
            showToast(
              'Leia e aceite as condições para continuar.',
            );

            return;
          }

          const button =
            document
              .getElementById(
                'manualPay',
              );

          button.disabled =
            true;

          button.textContent =
            'Abrindo pagamento...';

          try {
            const result =
              await api(
                `/api/v2/manual-order/${
                  token
                }/start-payment`,
                {
                  method:
                    'POST',
                  body:
                    JSON.stringify({
                      termsAccepted:
                        true,
                      termsVersion:
                        order.terms.version,
                    }),
                },
              );

            const checkoutUrl =
              result.result
                ?.payment
                ?.checkoutUrl
              || result.result
                ?.checkoutUrl
              || result.payment
                ?.checkoutUrl;

            if (!checkoutUrl) {
              throw new Error(
                'O pagamento não ficou disponível.',
              );
            }

            window.location.href =
              checkoutUrl;
          } catch (error) {
            button.disabled =
              false;

            button.textContent =
              'Ir para o pagamento';

            showToast(
              error.message,
            );
          }
        },
      );
  };

  render();
}

