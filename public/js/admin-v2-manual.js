import {
  api,
  dateBr,
  esc,
  money,
  setViewMeta,
  showToast,
  viewRoot,
} from './admin-v2-core.js';

const EVENT_TYPES = [
  ['birthday', 'Aniversário'],
  ['15_years', '15 Anos'],
  ['wedding', 'Casamento'],
  ['celebration', 'Chá / Celebração'],
  ['other', 'Outro'],
];

function selectedProduct(config) {
  const code =
    document
      .getElementById('manualProduct')
      ?.value
    || '';

  return (config.products || [])
    .find(
      (item) =>
        item.code === code,
    )
    || null;
}

function currentSelection(config) {
  const product =
    selectedProduct(config);

  return {
    productCode:
      product?.code
      || '',
    productSlug:
      product?.slug
      || '',
    variantCode:
      document
        .getElementById('manualVariant')
        ?.value
      || '',
    addonCodes:
      [
        ...document
          .querySelectorAll(
            '[name="manualAddon"]:checked',
          ),
      ]
        .map(
          (input) =>
            input.value,
        ),
    comboCode:
      document
        .getElementById('manualCombo')
        ?.value
      || '',
    couponCode:
      document
        .getElementById('manualCoupon')
        ?.value
        .trim()
      || '',
    paymentMethod:
      document
        .querySelector(
          '[name="manualPayment"]:checked',
        )
        ?.value
      || 'pix',
  };
}

function currentCustomer() {
  return {
    name:
      document
        .getElementById('manualCustomerName')
        .value
        .trim(),
    whatsapp:
      document
        .getElementById('manualWhatsapp')
        .value
        .trim(),
    email:
      document
        .getElementById('manualEmail')
        .value
        .trim(),
  };
}

function currentEvent() {
  return {
    type:
      document
        .getElementById('manualEventType')
        .value,
    subtype:
      document
        .getElementById('manualEventSubtype')
        .value
        .trim(),
    honoreeName:
      document
        .getElementById('manualHonoree')
        .value
        .trim(),
    date:
      document
        .getElementById('manualEventDate')
        .value,
  };
}

function renderVariants(
  config,
) {
  const product =
    selectedProduct(config);

  const select =
    document
      .getElementById(
        'manualVariant',
      );

  const variants =
    (product?.variants || [])
      .filter(
        (item) =>
          item.active !== false,
      );

  select.innerHTML =
    variants.map(
      (variant) => `
        <option value="${esc(variant.code)}">
          ${esc(variant.label)}
          • ${money(variant.priceCents)}
        </option>
      `,
    ).join('');

  const addons =
    document
      .getElementById(
        'manualAddons',
      );

  addons.innerHTML =
    (config.addons || [])
      .filter(
        (item) =>
          item.active !== false,
      )
      .map(
        (addon) => `
          <label class="checkline">
            <input
              type="checkbox"
              name="manualAddon"
              value="${esc(addon.code)}"
            >
            <span>
              <strong>${esc(addon.name)}</strong>
              • ${money(addon.priceCents)}
            </span>
          </label>
        `,
      ).join('')
    || '<div class="empty">Nenhum adicional ativo.</div>';
}

function quoteHtml(
  result,
) {
  const quote =
    result.quote;

  const delivery =
    result.delivery;

  return `
    <section class="card" style="margin-top:14px">
      <div class="section-title">
        <h2>Revisão comercial</h2>
        <span class="status">
          ${money(quote.totalCents)}
        </span>
      </div>

      <div class="kpi-grid">
        <div class="kpi">
          <span>Total</span>
          <strong>${money(quote.totalCents)}</strong>
        </div>
        <div class="kpi">
          <span>Agora</span>
          <strong>${money(quote.payment?.depositCents || quote.totalCents)}</strong>
        </div>
        <div class="kpi">
          <span>Saldo</span>
          <strong>${money(quote.payment?.balanceCents || 0)}</strong>
        </div>
        <div class="kpi">
          <span>Pontos</span>
          <strong>${(Number(quote.pointsUnits || 0) / 100).toFixed(1)}</strong>
        </div>
      </div>

      <div class="section-title" style="margin-top:16px">
        <h3>Janela de entrega</h3>
      </div>

      <div class="list">
        ${(delivery.options || []).map(
          (option, index) => `
            <label class="row-card" style="cursor:pointer">
              <input
                type="radio"
                name="manualDelivery"
                value="${esc(option.start)}|${esc(option.end)}"
                ${index === 0 ? 'checked' : ''}
              >
              <strong>
                ${dateBr(option.start)}
                a
                ${dateBr(option.end)}
              </strong>
              <small>
                ${option.recommended ? '⭐ Recomendada' : 'Disponível'}
              </small>
            </label>
          `,
        ).join('') || '<div class="empty">Sem janela regular. Marque encaixe aprovado e informe a janela manualmente.</div>'}
      </div>

      <div class="form-grid" style="margin-top:12px">
        <div class="field">
          <label for="manualDeliveryStart">Início manual</label>
          <input
            id="manualDeliveryStart"
            class="input"
            type="date"
          >
        </div>
        <div class="field">
          <label for="manualDeliveryEnd">Fim manual</label>
          <input
            id="manualDeliveryEnd"
            class="input"
            type="date"
          >
        </div>
      </div>

      <button
        id="createManualOrder"
        class="btn btn-primary"
        type="button"
        style="margin-top:12px"
      >
        Criar link para a cliente
      </button>
    </section>
  `;
}

export async function renderManualOrder() {
  setViewMeta(
    'Novo pedido',
    'Atendimento por WhatsApp',
  );

  const data =
    await api(
      '/api/admin/v2/store-config',
    );

  const config =
    data.config;

  const products =
    (config.products || [])
      .filter(
        (item) =>
          item.active !== false,
      );

  viewRoot.innerHTML = `
    <section class="card">
      <div class="section-title">
        <h2>Preparar pedido</h2>
        <span class="status">Link privado</span>
      </div>

      <p class="muted">
        Use quando a cliente já escolheu pelo WhatsApp. O link final abre somente o pedido preparado.
      </p>

      <div class="form-grid">
        <div class="field">
          <label for="manualCustomerName">Cliente</label>
          <input id="manualCustomerName" class="input" autocomplete="name">
        </div>

        <div class="field">
          <label for="manualWhatsapp">WhatsApp</label>
          <input id="manualWhatsapp" class="input" inputmode="tel">
          <div id="returningCustomerNotice" class="notice info hidden" aria-live="polite"></div>
        </div>

        <div class="field">
          <label for="manualEmail">E-mail <span class="muted">(opcional)</span></label>
          <input id="manualEmail" class="input" type="email">
        </div>

        <div class="field">
          <label for="manualEventType">Evento</label>
          <select id="manualEventType" class="select">
            ${EVENT_TYPES.map(
              ([value, label]) =>
                `<option value="${esc(value)}">${esc(label)}</option>`,
            ).join('')}
          </select>
        </div>

        <div class="field">
          <label for="manualHonoree">Nome da criança, casal ou evento</label>
          <input id="manualHonoree" class="input">
        </div>

        <div class="field">
          <label for="manualEventDate">Data da festa</label>
          <input id="manualEventDate" class="input" type="date">
        </div>

        <div class="field full">
          <label for="manualEventSubtype">Observação do evento <span class="muted">(opcional)</span></label>
          <input id="manualEventSubtype" class="input">
        </div>

        <div class="field">
          <label for="manualProduct">Formato</label>
          <select id="manualProduct" class="select">
            ${products.map(
              (product) =>
                `<option value="${esc(product.code)}">${esc(product.name)}</option>`,
            ).join('')}
          </select>
        </div>

        <div class="field">
          <label for="manualVariant">Configuração</label>
          <select id="manualVariant" class="select"></select>
        </div>

        <div class="field">
          <label for="manualCombo">Combo</label>
          <select id="manualCombo" class="select">
            <option value="">Sem combo</option>
            ${(config.combos || [])
              .filter(
                (item) =>
                  item.active !== false,
              )
              .map(
                (combo) =>
                  `<option value="${esc(combo.code)}">${esc(combo.name)}</option>`,
              ).join('')}
          </select>
        </div>

        <div class="field">
          <label for="manualCoupon">Cupom <span class="muted">(opcional)</span></label>
          <input id="manualCoupon" class="input">
        </div>
      </div>

      <div class="section-title" style="margin-top:18px">
        <h3>Adicionais</h3>
      </div>
      <div id="manualAddons" class="list"></div>

      <div class="section-title" style="margin-top:18px">
        <h3>Pagamento</h3>
      </div>

      <div style="display:flex;gap:14px;flex-wrap:wrap">
        <label class="checkline">
          <input type="radio" name="manualPayment" value="pix" checked>
          <span>Pix • 50% agora</span>
        </label>

        <label class="checkline">
          <input type="radio" name="manualPayment" value="card">
          <span>Cartão • 100%</span>
        </label>

        <label class="checkline">
          <input id="manualUrgency" type="checkbox">
          <span>Encaixe urgente já aprovado por mim</span>
        </label>
      </div>

      <button
        id="manualQuote"
        class="btn btn-primary"
        type="button"
        style="margin-top:16px"
      >
        Calcular e buscar janelas
      </button>
    </section>

    <div id="manualQuoteArea"></div>
  `;

  let lookupTimer = null;
  const phone = document.getElementById('manualWhatsapp');
  const notice = document.getElementById('returningCustomerNotice');
  phone.addEventListener('input', () => {
    clearTimeout(lookupTimer);
    notice.classList.add('hidden');
    const queried = phone.value.replace(/\D/g, '');
    if (queried.length < 10) return;
    lookupTimer = setTimeout(async () => {
      try {
        const data = await api('/api/admin/v2/customers/lookup?whatsapp=' + encodeURIComponent(queried));
        if (phone.value.replace(/\D/g, '') !== queried || !data.customer) return;
        const customer = data.customer;
        notice.classList.remove('hidden');
        notice.innerHTML = `Cliente já atendida: <strong>${esc(customer.name)}</strong>
          (${Number(customer.previousOrders || 0)} pedido(s)).
          <button class="btn btn-secondary btn-small" type="button" id="applyPreviousCustomer">Usar dados anteriores</button>`;
        document.getElementById('applyPreviousCustomer')?.addEventListener('click', () => {
          if (!confirm('Usar nome e e-mail cadastrados anteriormente?')) return;
          document.getElementById('manualCustomerName').value = customer.name;
          document.getElementById('manualEmail').value = customer.email || '';
          notice.textContent = 'Dados anteriores preenchidos. Confira antes de criar o pedido.';
        });
      } catch { notice.classList.add('hidden'); }
    }, 400);
  });

  renderVariants(
    config,
  );

  document
    .getElementById('manualProduct')
    .addEventListener(
      'change',
      () =>
        renderVariants(
          config,
        ),
    );

  document
    .getElementById('manualQuote')
    .addEventListener(
      'click',
      async (event) => {
        const customer =
          currentCustomer();

        const eventData =
          currentEvent();

        if (
          !customer.name
          || !customer.whatsapp
          || !eventData.honoreeName
          || !eventData.date
        ) {
          showToast('Preencha cliente, WhatsApp, nome do evento e data.');
          return;
        }

        const button =
          event.currentTarget;

        button.disabled =
          true;

        try {
          const result =
            await api(
              '/api/admin/v2/orders/manual/quote',
              {
                method: 'POST',
                body:
                  JSON.stringify({
                    customer,
                    event:
                      eventData,
                    selection:
                      currentSelection(
                        config,
                      ),
                    urgencyApproved:
                      document
                        .getElementById('manualUrgency')
                        .checked,
                  }),
              },
            );

          document
            .getElementById('manualQuoteArea')
            .innerHTML =
              quoteHtml(
                result.result,
              );

          document
            .getElementById('createManualOrder')
            .addEventListener(
              'click',
              async (createEvent) => {
                const createButton =
                  createEvent.currentTarget;

                const selectedWindow =
                  document
                    .querySelector(
                      '[name="manualDelivery"]:checked',
                    )
                    ?.value
                    ?.split('|')
                  || [];

                const start =
                  document
                    .getElementById('manualDeliveryStart')
                    .value
                  || selectedWindow[0]
                  || '';

                const end =
                  document
                    .getElementById('manualDeliveryEnd')
                    .value
                  || selectedWindow[1]
                  || '';

                if (
                  !start
                  || !end
                ) {
                  showToast('Escolha ou informe uma janela de entrega.');
                  return;
                }

                createButton.disabled =
                  true;

                try {
                  const created =
                    await api(
                      '/api/admin/v2/orders/manual',
                      {
                        method: 'POST',
                        body:
                          JSON.stringify({
                            customer:
                              currentCustomer(),
                            event:
                              currentEvent(),
                            selection:
                              currentSelection(
                                config,
                              ),
                            urgencyApproved:
                              document
                                .getElementById('manualUrgency')
                                .checked,
                            deliveryWindow: {
                              start,
                              end,
                            },
                          }),
                      },
                    );

                  const url =
                    created.result
                      .client
                      .url;

                  const whatsapp =
                    currentCustomer()
                      .whatsapp
                      .replace(
                        /\D/g,
                        '',
                      );

                  const message =
                    `Oi! 💛 Preparei seu pedido na Libri Convites. Você pode revisar e concluir o pagamento aqui: ${url}`;

                  document
                    .getElementById('manualQuoteArea')
                    .innerHTML = `
                      <section class="card" style="margin-top:14px">
                        <div class="section-title">
                          <h2>Pedido preparado ✓</h2>
                          <span class="status">${esc(created.result.order.code)}</span>
                        </div>

                        <div class="field">
                          <label>Link da cliente</label>
                          <input
                            id="manualCreatedLink"
                            class="input"
                            readonly
                            value="${esc(url)}"
                          >
                        </div>

                        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
                          <button
                            id="copyManualLink"
                            class="btn btn-secondary"
                            type="button"
                          >
                            Copiar link
                          </button>

                          <a
                            class="btn btn-primary"
                            href="https://wa.me/${esc(whatsapp)}?text=${encodeURIComponent(message)}"
                            target="_blank"
                            rel="noopener"
                          >
                            Enviar no WhatsApp
                          </a>
                        </div>
                      </section>
                    `;

                  document
                    .getElementById('copyManualLink')
                    .addEventListener(
                      'click',
                      async () => {
                        try {
                          await navigator
                            .clipboard
                            .writeText(
                              url,
                            );

                          showToast('Link copiado ✓');
                        } catch {
                          const input =
                            document
                              .getElementById('manualCreatedLink');

                          input.focus();
                          input.select();

                          document.execCommand(
                            'copy',
                          );

                          showToast('Link copiado ✓');
                        }
                      },
                    );
                } catch (error) {
                  createButton.disabled =
                    false;

                  showToast(
                    error.message,
                  );
                }
              },
            );
        } catch (error) {
          showToast(
            error.message,
          );
        } finally {
          button.disabled =
            false;
        }
      },
    );
}
