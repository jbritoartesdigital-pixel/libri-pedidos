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
  moments: 'Libri Moments',
  extras: 'Outros adicionais',
};

const STORE_KEY =
  'libriV2StoreState';

function emptyState(
  productSlug,
) {
  const params =
    new URLSearchParams(
      window.location.search,
    );

  return {
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
    const raw =
      localStorage.getItem(
        STORE_KEY,
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
    STORE_KEY,
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

  const variant =
    product.variants
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
  const total = 7;
  const current =
    Math.min(
      total,
      state.step + 1,
    );

  return `
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

function addonGroups(
  addons,
) {
  const groups =
    new Map();

  for (
    const addon
    of addons || []
  ) {
    const key =
      addon.group || 'extras';

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
            (item) => `
              <article class="gallery-item">
                ${
                  item.mediaType
                  === 'video'
                    ? `
                      <video
                        controls
                        playsinline
                        preload="metadata"
                        src="${esc(item.mediaPath || item.url || '')}"
                      ></video>
                    `
                    : `
                      <img
                        loading="lazy"
                        alt="${esc(item.themeLabel || product.name)}"
                        src="${esc(item.previewPath || item.mediaPath || item.url || '')}"
                      >
                    `
                }

                <div class="gallery-copy">
                  <strong>${esc(item.themeLabel || 'Inspiração Libri')}</strong>
                  <small>${esc(item.eventType || '')}</small>
                </div>
              </article>
            `,
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
          () => {
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
      () => {
        if (
          !productFor(state)
        ) {
          showToast(
            'Escolha o formato do convite.',
          );

          return;
        }

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

  const selectedAddons =
    new Set(
      state.selection.addonCodes
      || [],
    );

  const groups =
    addonGroups(
      state.catalog.addons,
    );

  app.innerHTML = `
    <section class="page-card">
      ${progress(state)}

      <div class="page-head">
        <span class="eyebrow">Monte seu pedido</span>
        <h1 class="page-title">
          ${esc(product.name)}
        </h1>
        <p class="page-subtitle">
          Escolha apenas o que faz sentido para a sua festa.
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

              <div class="grid two">
                ${product.variants.map(
                  (variant) => `
                    <label class="choice-card ${
                      currentVariant?.code
                      === variant.code
                        ? 'selected'
                        : ''
                    }">
                      <input
                        type="radio"
                        name="variant"
                        value="${esc(variant.code)}"
                        ${
                          currentVariant?.code
                          === variant.code
                            ? 'checked'
                            : ''
                        }
                      >

                      <span class="choice-main">
                        <strong>
                          ${esc(variant.label)}
                        </strong>

                        <small>
                          ${money(variant.priceCents)}
                          ${
                            variant.sceneCount
                              ? ` • ${variant.sceneCount} cena${variant.sceneCount === 1 ? '' : 's'}`
                              : ''
                          }
                        </small>
                      </span>
                    </label>
                  `,
                ).join('')}
              </div>
            </div>
          `
          : ''
      }

      <div class="section-block">
        <h2 class="section-title">
          Quer adicionar algo?
        </h2>

        ${
          groups.length
            ? groups.map(
              ([groupName, addons]) => `
                <div class="section-block">
                  <span class="muted">
                    ${esc(addonGroupLabel(groupName))}
                  </span>

                  <div class="grid two" style="margin-top:8px">
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
                          </span>
                        </label>
                      `,
                    ).join('')}
                  </div>
                </div>
              `,
            ).join('')
            : `
              <div class="muted">
                Nenhum adicional disponível no momento.
              </div>
            `
        }
      </div>

      ${
        Array.isArray(
          state.catalog.combos,
        )
        && state.catalog.combos.length
          ? `
            <div class="section-block">
              <h2 class="section-title">
                Combos
              </h2>

              <div class="grid two">
                ${state.catalog.combos.map(
                  (combo) => `
                    <label class="choice-card ${
                      state.selection.comboCode
                      === combo.code
                        ? 'selected'
                        : ''
                    }">
                      <input
                        type="radio"
                        name="combo"
                        value="${esc(combo.code)}"
                        ${
                          state.selection.comboCode
                          === combo.code
                            ? 'checked'
                            : ''
                        }
                      >

                      <span class="choice-main">
                        <strong>${esc(combo.name)}</strong>
                        <small>${esc(combo.description || '')}</small>
                      </span>
                    </label>
                  `,
                ).join('')}
              </div>
            </div>
          `
          : ''
      }

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
          () => {
            state.selection.variantCode =
              input.value;

            persist(state);
            renderConfiguration(
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
          () => {
            const set =
              new Set(
                state.selection.addonCodes,
              );

            if (
              input.checked
            ) {
              set.add(
                input.value,
              );
            } else {
              set.delete(
                input.value,
              );
            }

            state.selection.addonCodes =
              [
                ...set,
              ];

            persist(state);
            renderConfiguration(
              state,
              render,
            );
          },
        );
      },
    );

  app
    .querySelectorAll(
      '[name="combo"]',
    )
    .forEach(
      (input) => {
        input.addEventListener(
          'change',
          () => {
            state.selection.comboCode =
              input.value;

            persist(state);
          },
        );
      },
    );

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
      'couponCode',
    )
    ?.addEventListener(
      'input',
      (event) => {
        state.selection.couponCode =
          event.target.value
            .trim()
            .toUpperCase();

        persist(state);
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
        <span class="eyebrow">Seus dados</span>
        <h1 class="page-title">
          Agora, só o essencial
        </h1>
        <p class="page-subtitle">
          O briefing criativo completo vem depois do pagamento.
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

      ${quoteHtml(state.quote)}

      ${actionRow({
        nextLabel:
          'Ver datas de entrega',
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
          { value: state.customer.name, label: 'Seu nome', id: 'customerName' },
          { value: state.customer.whatsapp, label: 'WhatsApp', id: 'whatsapp' },
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
          A janela é o período prometido para entrega.
          A produção pode começar antes.
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
          const button = document.getElementById('nextBtn');
          button.disabled = true;
          try {
            const result = await api('/api/v2/urgency/request', {
              method: 'POST', body: JSON.stringify({ clientRequestId: state.clientRequestId,
                customer: state.customer, event: state.event, selection: state.selection }),
            });
            localStorage.removeItem(STORE_KEY);
            window.location.href = result.order.customerAreaPath;
          } catch (error) {
            button.disabled = false;
            showToast(error.message);
            if (error.data?.code === 'regular_delivery_available') {
              state.delivery = error.data.details.delivery;
              renderDelivery(state, render);
            }
          }
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

      ${actionRow({
        nextLabel:
          'Revisar pedido',
      })}
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
        state.step = 6;
        persist(state);
        render();
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
          Tudo certo?
        </h1>
        <p class="page-subtitle">
          Depois desta etapa você vai para o Mercado Pago.
          O briefing criativo fica para depois da confirmação.
        </p>
      </div>

      <dl class="review-list">
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
            ${esc(dateBr(state.deliveryWindow?.start))}
            a
            ${esc(dateBr(state.deliveryWindow?.end))}
          </dd>
        </div>

        <div class="review-line">
          <dt>Pagamento</dt>
          <dd>
            ${
              state.selection.paymentMethod
              === 'pix'
                ? 'Pix • entrada de 50%'
                : 'Cartão • pagamento integral'
            }
          </dd>
        </div>
      </dl>

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

        <label class="checkline">
          <input
            id="termsAccepted"
            type="checkbox"
            ${
              state.termsAccepted
                ? 'checked'
                : ''
            }
          >

          <span>
            Li e concordo com as Condições do Pedido.
          </span>
        </label>
      </div>

      ${actionRow({
        nextId:
          'payBtn',
        nextLabel:
          'Ir para o pagamento',
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
    .addEventListener(
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
              localStorage.removeItem(STORE_KEY);
              window.location.href = result.order.customerAreaPath;
              return;
            }
            throw new Error(
              'O pagamento não ficou disponível. Tente novamente.',
            );
          }

          localStorage.removeItem(
            STORE_KEY,
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
            renderReview(
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
            state.step = 3;
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
      renderPayment(
        state,
        render,
      );

      return;
    }

    renderReview(
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

