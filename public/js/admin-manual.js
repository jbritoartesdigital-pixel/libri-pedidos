(() => {
  'use strict';

  const qs = (selector, root = document) =>
    root.querySelector(selector);

  const money = (cents = 0) =>
    new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format((Number(cents) || 0) / 100);

  function centsFromReais(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const normalized = raw.includes(',')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw;

    const number = Number(normalized);
    if (!Number.isFinite(number) || number <= 0) return null;

    return Math.round(number * 100);
  }

  function esc(value = '') {
    return String(value).replace(
      /[&<>'"]/g,
      (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[char],
    );
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(
        data.error || 'Erro ao concluir a ação.',
      );

      error.data = data;
      error.status = response.status;
      throw error;
    }

    return data;
  }

  /* ==================================================
     ESTILO ADITIVO
  ================================================== */

  function installStyles() {
    if (document.getElementById('adminManualStyles')) return;

    const style = document.createElement('style');
    style.id = 'adminManualStyles';

    style.textContent = `
      .manual-order-modal {
        width: min(980px, calc(100vw - 28px));
        max-height: calc(100vh - 32px);
        overflow: auto;
      }

      .manual-order-form {
        display: grid;
        gap: 16px;
      }

      .manual-order-section {
        padding: 16px;
        border: 1px solid rgba(90, 70, 60, .12);
        border-radius: 18px;
        background: rgba(255, 255, 255, .72);
      }

      .manual-order-section h3 {
        margin: 0 0 12px;
      }

      .manual-order-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .manual-order-checks {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 14px;
      }

      .manual-order-check {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 36px;
      }

      .manual-order-check input {
        width: auto;
      }

      .manual-order-pricebox {
        margin-top: 12px;
        padding: 14px;
        border-radius: 16px;
        background: #fbf7f4;
        border: 1px solid rgba(90, 70, 60, .1);
      }

      .manual-order-price-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }

      .manual-order-price-item {
        padding: 10px;
        border-radius: 12px;
        background: #fff;
      }

      .manual-order-price-item span {
        display: block;
        margin-bottom: 4px;
        color: #7e716c;
        font-size: 12px;
      }

      .manual-order-price-item strong {
        font-size: 15px;
      }

      .manual-order-note,
      .manual-order-info {
        margin-top: 10px;
        padding: 10px 12px;
        border-radius: 12px;
        font-size: 13px;
        line-height: 1.45;
      }

      .manual-order-note {
        background: #fff7df;
        color: #70561a;
      }

      .manual-order-info {
        background: #f2eef7;
        color: #614875;
      }

      .manual-order-success {
        padding: 18px;
        border-radius: 18px;
        background: #f3fbf6;
        border: 1px solid rgba(40, 120, 70, .18);
      }

      .manual-order-success strong {
        display: block;
        margin-bottom: 6px;
        font-size: 18px;
      }

      .manual-order-hidden {
        display: none !important;
      }

      @media (max-width: 760px) {
        .manual-order-grid,
        .manual-order-price-grid {
          grid-template-columns: 1fr;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /* ==================================================
     ESTADO
  ================================================== */

  let modalEl = null;
  let currentQuote = null;
  let currentSettings = {};
  let quoteTimer = null;

  function closeModal() {
    if (!modalEl) return;

    modalEl.remove();
    modalEl = null;
    currentQuote = null;
  }

  /* ==================================================
     CAMPOS
  ================================================== */

  function field(
    label,
    name,
    {
      type = 'text',
      placeholder = '',
      required = false,
      value = '',
      hint = '',
      min = '',
      max = '',
    } = {},
  ) {
    return `
      <div class="field">
        <label>
          ${esc(label)}
          ${required ? ' *' : ''}
        </label>

        <input
          name="${esc(name)}"
          type="${esc(type)}"
          value="${esc(value)}"
          placeholder="${esc(placeholder)}"
          ${required ? 'required' : ''}
          ${min !== '' ? `min="${esc(min)}"` : ''}
          ${max !== '' ? `max="${esc(max)}"` : ''}
        >

        ${
          hint
            ? `<span class="hint">${esc(hint)}</span>`
            : ''
        }
      </div>
    `;
  }

  function textarea(
    label,
    name,
    {
      placeholder = '',
      hint = '',
      rows = 3,
    } = {},
  ) {
    return `
      <div class="field">
        <label>${esc(label)}</label>

        <textarea
          name="${esc(name)}"
          rows="${rows}"
          placeholder="${esc(placeholder)}"
        ></textarea>

        ${
          hint
            ? `<span class="hint">${esc(hint)}</span>`
            : ''
        }
      </div>
    `;
  }

  function selectField(
    label,
    name,
    options,
    value = '',
  ) {
    return `
      <div class="field">
        <label>${esc(label)}</label>

        <select name="${esc(name)}">
          ${options.map(
            ([key, text]) => `
              <option
                value="${esc(key)}"
                ${key === value ? 'selected' : ''}
              >
                ${esc(text)}
              </option>
            `,
          ).join('')}
        </select>
      </div>
    `;
  }

  /* ==================================================
     FORMULÁRIO
  ================================================== */

  function formHtml() {
    return `
      <form
        id="manualOrderForm"
        class="manual-order-form"
      >
        <section class="manual-order-section">
          <h3>Cliente e evento</h3>

          <div class="manual-order-grid">
            ${field('Nome da cliente', 'customerName', {
              required: true,
            })}

            ${field('WhatsApp', 'whatsapp', {
              required: true,
              placeholder: 'Ex.: 5561999999999',
            })}

            ${field(
              'Nome da criança / homenageado(a)',
              'honoreeName',
              {
                required: true,
              },
            )}

            ${field(
              'Nome que aparece no convite',
              'displayName',
            )}

            ${field('Idade', 'age', {
              type: 'number',
              min: '0',
              max: '120',
            })}

            ${field('Tema', 'theme', {
              required: true,
            })}

            ${field('Data da festa', 'eventDate', {
              type: 'date',
            })}

            ${field('Horário', 'eventTime', {
              type: 'time',
            })}

            ${field('Local', 'venueName')}
            ${field('Endereço', 'venueAddress')}
          </div>

          ${field('Link da localização', 'locationUrl', {
            type: 'url',
            placeholder: 'https://maps.app.goo.gl/...',
          })}
        </section>

        <section class="manual-order-section">
          <h3>Produto contratado</h3>

          <div class="manual-order-grid">
            ${selectField(
              'Experiência',
              'experience',
              [
                ['full', 'Completa'],
                ['reduced', 'Reduzida'],
              ],
              'full',
            )}

            ${selectField(
              'Formato',
              'format',
              [
                ['video', 'Vídeo'],
                ['interactive', 'Interativo'],
              ],
              'video',
            )}
          </div>

          <div class="manual-order-checks">
            <label class="manual-order-check">
              <input
                name="confirmation"
                type="checkbox"
              >
              Confirmação Libri
            </label>

            <label class="manual-order-check">
              <input
                name="filter"
                type="checkbox"
              >
              Filtro personalizado avulso
            </label>

            <label class="manual-order-check">
              <input
                name="urgencyEnabled"
                type="checkbox"
              >
              Pedido urgente
            </label>
          </div>

          <div class="manual-order-grid">
            ${field('Cenas extras', 'extraScene', {
              type: 'number',
              value: '0',
              min: '0',
              max: '10',
            })}

            ${field(
              'Pessoas / crianças extras',
              'extraPerson',
              {
                type: 'number',
                value: '0',
                min: '0',
                max: '10',
              },
            )}

            ${selectField(
              'Libri Moments',
              'photoAlbumPlan',
              [
                ['', 'Sem álbum'],
                ['festa', 'Festa - R$ 79'],
                ['premium', 'Premium - R$ 119'],
                ['exclusive', 'Exclusive - R$ 149'],
              ],
              '',
            )}

            <div
              id="manualAlbumExtraWrap"
              class="manual-order-hidden"
            >
              ${field(
                'Pacotes de +100 fotos',
                'photoAlbumExtra100',
                {
                  type: 'number',
                  value: '0',
                  min: '0',
                  hint:
                    'Cada pacote acrescenta 100 fotos por R$ 15.',
                },
              )}
            </div>
          </div>

          <div
            id="manualAlbumNote"
            class="manual-order-info manual-order-hidden"
          >
            Todo plano Libri Moments já inclui 1 filtro personalizado.
            O filtro avulso não será cobrado junto com o álbum.
          </div>

          <div class="manual-order-grid">
            ${field(
              'Valor-base contratado (opcional)',
              'manualSubtotalReais',
              {
                placeholder: 'Ex.: 170,00',
                hint:
                  'Deixe vazio para usar o preço atual do portal. Use apenas quando você fechou um valor especial pelo WhatsApp.',
              },
            )}

            ${selectField(
              'Confirmação Libri',
              'confirmationMode',
              [
                ['', 'Não se aplica / não definido'],
                ['open', 'Livre'],
                ['list', 'Lista de convidados'],
                ['unsure', 'Ainda não definido'],
              ],
              '',
            )}
          </div>

          <div
            id="manualQuote"
            class="manual-order-pricebox"
          >
            Calculando...
          </div>
        </section>

        <section class="manual-order-section">
          <h3>Sugestões de presentes</h3>

          <div class="manual-order-grid">
            ${selectField(
              'Incluir página de sugestões?',
              'giftPage',
              [
                ['unsure', 'Ainda não sei'],
                ['yes', 'Sim'],
                ['no', 'Não'],
              ],
              'unsure',
            )}
          </div>

          <div
            id="manualGiftDetailsWrap"
            class="manual-order-hidden"
          >
            ${textarea(
              'O que gostaria de sugerir aos convidados?',
              'giftDetails',
              {
                rows: 4,
                placeholder:
                  'Ex.: roupas tamanho 4, sapatos 26/27, brinquedos, perfume, Pix ou outras preferências.',
              },
            )}
          </div>
        </section>

        <section class="manual-order-section">
          <h3>Direção criativa</h3>

          <div class="manual-order-grid">
            ${field(
              'Personagem específico',
              'characterWanted',
            )}

            ${selectField(
              'Estilo da criança',
              'childStyle',
              [
                ['', 'Não informado'],
                ['drawing', 'Desenho / bonequinho'],
                ['real', 'Mais real e detalhado'],
                ['libri', 'A Libri escolhe'],
              ],
              '',
            )}

            ${selectField(
              'Roupa',
              'outfitChoice',
              [
                ['', 'Não informado'],
                ['party', 'Parecida com a roupa da festa'],
                ['specific', 'Roupa específica'],
                ['libri', 'A Libri cria'],
              ],
              '',
            )}

            ${selectField(
              'Falas',
              'speechPreference',
              [
                ['libri', 'A Libri cria'],
                ['approve', 'Cliente quer aprovar'],
                ['own', 'Cliente enviou frase própria'],
              ],
              'libri',
            )}
          </div>

          ${textarea(
            'Detalhes da roupa',
            'outfitDetails',
          )}

          ${textarea(
            'Detalhes da aparência',
            'appearanceDetails',
          )}

          <div class="manual-order-grid">
            ${field('Cores desejadas', 'colors')}
            ${field('Cores a evitar', 'colorsAvoided')}
          </div>

          ${textarea('Não pode faltar', 'mustHave')}
          ${textarea('Não quer no convite', 'avoid')}

          ${textarea(
            'Informações especiais',
            'specialInfo',
          )}

          ${textarea(
            'Ideia / referência',
            'creativeIdea',
          )}

          ${textarea('Frase própria', 'ownSpeech', {
            hint:
              'Use quando a cliente enviou uma fala obrigatória.',
          })}
        </section>

        <section class="manual-order-section">
          <h3>Materiais e pagamento</h3>

          <div class="manual-order-grid">
            ${selectField(
              'Fotos',
              'photosStatus',
              [
                ['waiting', 'Aguardando'],
                ['received', 'Recebidas'],
                ['approved', 'Aprovadas'],
                ['needs_new', 'Precisa de novas fotos'],
              ],
              'waiting',
            )}

            ${selectField(
              'Entrada',
              'entryStatus',
              [
                ['waiting', 'Aguardando'],
                ['confirmed', 'Confirmada'],
              ],
              'waiting',
            )}
          </div>

          ${textarea(
            'Observação sobre as fotos',
            'photosNote',
          )}

          ${textarea(
            'Observações internas do WhatsApp',
            'manualNotes',
            {
              placeholder:
                'Ex.: cliente pediu vestido rosa; foto principal enviada no WhatsApp; combinamos entrega após...',
              rows: 4,
            },
          )}
        </section>

        <section class="manual-order-section">
          <h3>Autorizações</h3>

          <div class="manual-order-checks">
            <label class="manual-order-check">
              <input
                name="termsAcceptedOnWhatsapp"
                type="checkbox"
                required
              >
              A cliente aceitou os termos pelo WhatsApp
            </label>

            <label class="manual-order-check">
              <input
                name="portfolioConsent"
                type="checkbox"
              >
              Cliente autorizou divulgação
            </label>
          </div>

          <div class="manual-order-note">
            O pedido manual será criado como pedido oficial
            e receberá um número LIBRI-XXXX.
          </div>
        </section>

        <div class="form-actions">
          <button
            type="button"
            class="btn btn-secondary"
            id="cancelManualOrder"
          >
            Cancelar
          </button>

          <button
            type="submit"
            class="btn btn-primary"
            id="saveManualOrder"
          >
            Criar pedido manual
          </button>
        </div>
      </form>
    `;
  }

  /* ==================================================
     ABERTURA
  ================================================== */

  async function openModal() {
    installStyles();

    modalEl = document.createElement('div');
    modalEl.className = 'admin-modal-backdrop';

    modalEl.innerHTML = `
      <section
        class="admin-modal manual-order-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manualOrderTitle"
      >
        <header class="admin-modal-header">
          <div class="modal-title-group">
            <span class="section-eyebrow">
              Pedido via WhatsApp
            </span>

            <h2 id="manualOrderTitle">
              Novo pedido manual
            </h2>
          </div>

          <button
            class="modal-close"
            id="closeManualOrder"
            type="button"
            aria-label="Fechar"
          >
            ×
          </button>
        </header>

        <div class="admin-modal-body">
          ${formHtml()}
        </div>
      </section>
    `;

    document.body.appendChild(modalEl);

    qs('#closeManualOrder', modalEl).onclick =
      closeModal;

    qs('#cancelManualOrder', modalEl).onclick =
      closeModal;

    modalEl.addEventListener(
      'click',
      (event) => {
        if (event.target === modalEl) {
          closeModal();
        }
      },
    );

    bindForm();

    try {
      currentSettings =
        (
          await api(
            '/api/admin/settings',
          )
        ).settings || {};
    } catch {
      currentSettings = {};
    }

    await refreshQuote();
  }

  /* ==================================================
     UI DINÂMICA
  ================================================== */

  function syncAlbumUi(form) {
    const hasAlbum = Boolean(
      form.elements.photoAlbumPlan.value,
    );

    qs(
      '#manualAlbumExtraWrap',
      form,
    )?.classList.toggle(
      'manual-order-hidden',
      !hasAlbum,
    );

    qs(
      '#manualAlbumNote',
      form,
    )?.classList.toggle(
      'manual-order-hidden',
      !hasAlbum,
    );

    form.elements.filter.disabled =
      hasAlbum;

    if (hasAlbum) {
      form.elements.filter.checked =
        false;
    } else {
      form.elements.photoAlbumExtra100.value =
        '0';
    }
  }

  function syncGiftUi(form) {
    const wantsGiftPage =
      form.elements.giftPage.value
      === 'yes';

    qs(
      '#manualGiftDetailsWrap',
      form,
    )?.classList.toggle(
      'manual-order-hidden',
      !wantsGiftPage,
    );

    if (!wantsGiftPage) {
      form.elements.giftDetails.value =
        '';
    }
  }

  /* ==================================================
     ORÇAMENTO
  ================================================== */

  function selectionFromForm(form) {
    const data = new FormData(form);

    const photoAlbumPlan =
      data.get('photoAlbumPlan') || '';

    return {
      experience: data.get('experience'),
      format: data.get('format'),

      addons: {
        confirmation:
          data.has('confirmation'),

        filter:
          photoAlbumPlan
            ? false
            : data.has('filter'),

        extraScene:
          Number(
            data.get('extraScene')
            || 0,
          ),

        extraPerson:
          Number(
            data.get('extraPerson')
            || 0,
          ),

        photoAlbumPlan,

        photoAlbumExtra100:
          photoAlbumPlan
            ? Number(
              data.get(
                'photoAlbumExtra100',
              )
              || 0,
            )
            : 0,
      },
    };
  }

  function previewPrice(form) {
    const root =
      qs('#manualQuote', form);

    if (!root || !currentQuote) {
      return;
    }

    const manual =
      centsFromReais(
        form.elements
          .manualSubtotalReais
          .value,
      );

    const base =
      manual
      ?? currentQuote.subtotalCents;

    const urgent =
      form.elements
        .urgencyEnabled
        .checked;

    const urgencyPercent =
      urgent
        ? Number(
          currentSettings
            ?.urgency_percent
          ?? currentQuote
            ?.urgencyPercent
          ?? 30,
        )
        : 0;

    const urgencyAmount =
      urgent
        ? Math.round(
          base
          * urgencyPercent
          / 100,
        )
        : 0;

    const total =
      base + urgencyAmount;

    const depositPercent =
      Number(
        currentQuote.depositPercent
        || currentSettings
          ?.deposit_percent
        || 50,
      );

    const deposit =
      Math.round(
        total
        * depositPercent
        / 100,
      );

    const balance =
      total - deposit;

    root.innerHTML = `
      <div class="manual-order-price-grid">
        <div class="manual-order-price-item">
          <span>Preço padrão</span>

          <strong>
            ${money(currentQuote.subtotalCents)}
          </strong>
        </div>

        <div class="manual-order-price-item">
          <span>Valor-base usado</span>

          <strong>
            ${money(base)}
          </strong>
        </div>

        <div class="manual-order-price-item">
          <span>Total</span>

          <strong>
            ${money(total)}
          </strong>
        </div>

        <div class="manual-order-price-item">
          <span>Entrada / saldo</span>

          <strong>
            ${money(deposit)}
            /
            ${money(balance)}
          </strong>
        </div>
      </div>

      ${
        currentQuote.photoAlbum
          ? `
            <div class="manual-order-info">
              Libri Moments ${esc(
                currentQuote.photoAlbum.name,
              )}:
              até ${esc(
                currentQuote.photoAlbum.photos,
              )} fotos,
              ${esc(
                currentQuote.photoAlbum.days,
              )} dias
              e 1 filtro personalizado incluído.
            </div>
          `
          : ''
      }

      ${
        manual !== null
          ? `
            <div class="manual-order-note">
              Valor especial aplicado manualmente.
              O preço padrão continua registrado
              internamente para conferência.
            </div>
          `
          : ''
      }

      ${
        currentQuote.formatAdjusted
          ? `
            <div class="manual-order-note">
              Confirmação Libri exige convite Interativo.
              O formato foi ajustado automaticamente.
            </div>
          `
          : ''
      }

      ${
        urgent
          ? `
            <div class="manual-order-note">
              Urgência:
              +${esc(urgencyPercent)}%
              sobre o valor-base contratado.
            </div>
          `
          : ''
      }
    `;
  }

  async function refreshQuote() {
    if (!modalEl) return;

    const form =
      qs('#manualOrderForm', modalEl);

    const root =
      qs('#manualQuote', modalEl);

    try {
      root.textContent =
        'Calculando...';

      const data =
        await api(
          '/api/quote',
          {
            method: 'POST',

            body: JSON.stringify({
              selection:
                selectionFromForm(form),
            }),
          },
        );

      currentQuote = data.quote;

      if (
        currentQuote.formatAdjusted
        && form.elements.format.value
          !== 'interactive'
      ) {
        form.elements.format.value =
          'interactive';
      }

      previewPrice(form);
    } catch (error) {
      root.textContent =
        `Não foi possível calcular: ${error.message}`;
    }
  }

  function scheduleQuote() {
    clearTimeout(quoteTimer);

    quoteTimer = setTimeout(
      refreshQuote,
      180,
    );
  }

  /* ==================================================
     PAYLOAD
  ================================================== */

  function payloadFromForm(form) {
    const data = new FormData(form);

    const photoAlbumPlan =
      data.get('photoAlbumPlan') || '';

    const giftPage =
      data.get('giftPage') || 'unsure';

    return {
      customerName:
        data.get('customerName'),

      whatsapp:
        data.get('whatsapp'),

      honoreeName:
        data.get('honoreeName'),

      displayName:
        data.get('displayName'),

      age:
        data.get('age'),

      eventDate:
        data.get('eventDate'),

      eventTime:
        data.get('eventTime'),

      venueName:
        data.get('venueName'),

      venueAddress:
        data.get('venueAddress'),

      locationUrl:
        data.get('locationUrl'),

      theme:
        data.get('theme'),

      experience:
        data.get('experience'),

      format:
        data.get('format'),

      addons: {
        confirmation:
          data.has('confirmation'),

        filter:
          photoAlbumPlan
            ? false
            : data.has('filter'),

        extraScene:
          Number(
            data.get('extraScene')
            || 0,
          ),

        extraPerson:
          Number(
            data.get('extraPerson')
            || 0,
          ),

        photoAlbumPlan,

        photoAlbumExtra100:
          photoAlbumPlan
            ? Number(
              data.get(
                'photoAlbumExtra100',
              )
              || 0,
            )
            : 0,
      },

      urgencyEnabled:
        data.has('urgencyEnabled'),

      manualSubtotalCents:
        centsFromReais(
          data.get(
            'manualSubtotalReais',
          ),
        ),

      giftPage,

      giftDetails:
        giftPage === 'yes'
          ? data.get('giftDetails')
          : '',

      characterWanted:
        data.get('characterWanted'),

      childStyle:
        data.get('childStyle'),

      outfitChoice:
        data.get('outfitChoice'),

      outfitDetails:
        data.get('outfitDetails'),

      appearanceDetails:
        data.get('appearanceDetails'),

      colors:
        data.get('colors'),

      colorsAvoided:
        data.get('colorsAvoided'),

      mustHave:
        data.get('mustHave'),

      avoid:
        data.get('avoid'),

      specialInfo:
        data.get('specialInfo'),

      creativeIdea:
        data.get('creativeIdea'),

      speechPreference:
        data.get('speechPreference'),

      ownSpeech:
        data.get('ownSpeech'),

      confirmationMode:
        data.get('confirmationMode'),

      photosStatus:
        data.get('photosStatus'),

      entryStatus:
        data.get('entryStatus'),

      photosNote:
        data.get('photosNote'),

      manualNotes:
        data.get('manualNotes'),

      termsAcceptedOnWhatsapp:
        data.has(
          'termsAcceptedOnWhatsapp',
        ),

      portfolioConsent:
        data.has('portfolioConsent'),
    };
  }

  /* ==================================================
     EVENTOS DO FORM
  ================================================== */

  function bindForm() {
    const form =
      qs('#manualOrderForm', modalEl);

    const commercialFields = [
      'experience',
      'format',
      'confirmation',
      'filter',
      'extraScene',
      'extraPerson',
      'photoAlbumPlan',
      'photoAlbumExtra100',
    ];

    commercialFields.forEach(
      (name) => {
        form.elements[name]
          ?.addEventListener(
            'change',
            () => {
              if (
                name === 'confirmation'
                && form.elements
                  .confirmation
                  .checked
              ) {
                form.elements.format.value =
                  'interactive';
              }

              if (
                name === 'photoAlbumPlan'
              ) {
                syncAlbumUi(form);
              }

              scheduleQuote();
            },
          );
      },
    );

    form.elements.giftPage
      .addEventListener(
        'change',
        () => syncGiftUi(form),
      );

    form.elements.manualSubtotalReais
      .addEventListener(
        'input',
        () => previewPrice(form),
      );

    form.elements.urgencyEnabled
      .addEventListener(
        'change',
        () => previewPrice(form),
      );

    syncAlbumUi(form);
    syncGiftUi(form);

    form.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();

        const button =
          qs('#saveManualOrder', form);

        const originalText =
          button.textContent;

        button.disabled = true;
        button.textContent =
          'Criando pedido...';

        try {
          const result =
            await api(
              '/api/admin/orders/manual',
              {
                method: 'POST',

                body: JSON.stringify(
                  payloadFromForm(form),
                ),
              },
            );

          const body =
            qs(
              '.admin-modal-body',
              modalEl,
            );

          const moments =
            result.order
              ?.photoAlbum
              ?.name
              ? `
                <p>
                  Libri Moments:
                  <strong>
                    ${esc(
                      result.order
                        .photoAlbum
                        .name,
                    )}
                  </strong>
                </p>
              `
              : '';

          body.innerHTML = `
            <div class="manual-order-success">
              <strong>
                ${esc(
                  result.order.orderCode,
                )}
                criado ✅
              </strong>

              <p>
                Pedido de
                ${esc(
                  result.order.displayName
                  || result.order.honoreeName,
                )}
                registrado como
                <b>
                  ${
                    result.order.format
                    === 'interactive'
                      ? 'Interativo'
                      : 'Vídeo'
                  }
                  ${
                    result.order.experience
                    === 'reduced'
                      ? 'Reduzido'
                      : 'Completo'
                  }
                </b>.
              </p>

              ${moments}

              <p>
                Total contratado:

                <strong>
                  ${money(
                    result.order.totalCents,
                  )}
                </strong>
              </p>

              <button
                class="btn btn-primary"
                type="button"
                id="finishManualOrder"
              >
                Voltar aos pedidos
              </button>
            </div>
          `;

          qs(
            '#finishManualOrder',
            modalEl,
          ).onclick = () => {
            closeModal();
            location.reload();
          };
        } catch (error) {
          const missing =
            error.data
              ?.details
              ?.missing
            || [];

          const message =
            missing.length
              ? `${error.message} ${missing.join(', ')}.`
              : error.message;

          window.alert(message);

          button.disabled = false;
          button.textContent =
            originalText;
        }
      },
    );
  }

  /* ==================================================
     BOTÃO NO PAINEL
  ================================================== */

  function installButton() {
    const refresh =
      document.getElementById(
        'refreshOrders',
      );

    if (
      !refresh
      || document.getElementById(
        'newManualOrder',
      )
    ) {
      return;
    }

    const button =
      document.createElement(
        'button',
      );

    button.id = 'newManualOrder';

    button.className =
      'btn btn-primary btn-small';

    button.type = 'button';

    button.textContent =
      '+ Novo pedido manual';

    refresh.insertAdjacentElement(
      'beforebegin',
      button,
    );

    button.addEventListener(
      'click',
      openModal,
    );
  }

  document.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key === 'Escape'
        && modalEl
      ) {
        closeModal();
      }
    },
  );

  installStyles();
  installButton();
})();
