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
                    ${esc(groupName)}
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
          