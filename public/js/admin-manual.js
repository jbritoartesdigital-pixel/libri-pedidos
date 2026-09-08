(() => {
  'use strict';

  /* ==================================================
     LIBRI CONVITES
     PEDIDO MANUAL VIA WHATSAPP
     FRONTEND V2
  ================================================== */

  const $ = (
    selector,
    root = document,
  ) => root.querySelector(
    selector,
  );

  const $$ = (
    selector,
    root = document,
  ) => Array.from(
    root.querySelectorAll(
      selector,
    ),
  );

  const money = (
    cents = 0,
  ) =>
    new Intl.NumberFormat(
      'pt-BR',
      {
        style:
          'currency',
        currency:
          'BRL',
      },
    ).format(
      (
        Number(cents)
        || 0
      )
      / 100,
    );

  function esc(
    value = '',
  ) {
    return String(
      value,
    ).replace(
      /[&<>'"]/g,
      (char) => ({
        '&':
          '&amp;',
        '<':
          '&lt;',
        '>':
          '&gt;',
        "'":
          '&#39;',
        '"':
          '&quot;',
      })[char],
    );
  }

  function text(
    value,
  ) {
    return String(
      value
      ?? '',
    ).trim();
  }

  function centsFromReais(
    value,
  ) {
    const raw =
      text(
        value,
      );

    if (!raw) {
      return null;
    }

    const normalized =
      raw.includes(',')
        ? raw
          .replace(
            /\./g,
            '',
          )
          .replace(
            ',',
            '.',
          )
        : raw;

    const number =
      Number(
        normalized,
      );

    if (
      !Number.isFinite(
        number,
      )
      || number <= 0
    ) {
      return null;
    }

    return Math.round(
      number
      * 100,
    );
  }

  async function api(
    path,
    options = {},
  ) {
    const response =
      await fetch(
        path,
        {
          ...options,

          headers: {
            'content-type':
              'application/json',

            ...(
              options.headers
              || {}
            ),
          },
        },
      );

    const data =
      await response
        .json()
        .catch(
          () => ({}),
        );

    if (
      !response.ok
    ) {
      const error =
        new Error(
          data.error
          || 'Erro ao concluir a ação.',
        );

      error.data =
        data;

      error.status =
        response.status;

      throw error;
    }

    return data;
  }

  /* ==================================================
     ESTILO
  ================================================== */

  function installStyles() {
    if (
      $('#adminManualStyles')
    ) {
      return;
    }

    const style =
      document.createElement(
        'style',
      );

    style.id =
      'adminManualStyles';

    style.textContent = `
      .manual-order-backdrop{
        position:fixed;
        inset:0;
        z-index:9800;
        background:rgba(24,20,18,.46);
        display:grid;
        place-items:center;
        padding:16px;
      }

      .manual-order-backdrop.hidden{
        display:none;
      }

      .manual-order-modal{
        width:min(980px,100%);
        max-height:calc(100vh - 32px);
        overflow:auto;
        border-radius:24px;
        background:#f7f5f2;
        box-shadow:0 28px 90px rgba(0,0,0,.22);
      }

      .manual-order-header{
        position:sticky;
        top:0;
        z-index:2;
        display:flex;
        justify-content:space-between;
        align-items:flex-start;
        gap:16px;
        padding:18px 20px;
        background:rgba(247,245,242,.96);
        backdrop-filter:blur(12px);
        border-bottom:1px solid rgba(40,30,25,.08);
      }

      .manual-order-header h2{
        margin:3px 0 0;
      }

      .manual-order-close{
        border:0;
        width:38px;
        height:38px;
        border-radius:50%;
        background:#fff;
        cursor:pointer;
        font-size:22px;
      }

      .manual-order-form{
        display:grid;
        gap:14px;
        padding:18px;
      }

      .manual-order-section{
        padding:16px;
        border:1px solid rgba(90,70,60,.12);
        border-radius:18px;
        background:rgba(255,255,255,.78);
      }

      .manual-order-section h3{
        margin:0 0 12px;
      }

      .manual-order-grid{
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:12px;
      }

      .manual-order-grid .full{
        grid-column:1 / -1;
      }

      .manual-field{
        display:grid;
        gap:6px;
      }

      .manual-field label{
        font-size:13px;
        font-weight:700;
      }

      .manual-field input,
      .manual-field select,
      .manual-field textarea{
        width:100%;
        box-sizing:border-box;
        min-height:42px;
        border:1px solid rgba(50,40,35,.14);
        border-radius:11px;
        background:#fff;
        padding:9px 11px;
        font:inherit;
      }

      .manual-field textarea{
        min-height:92px;
        resize:vertical;
      }

      .manual-hint{
        font-size:11px;
        opacity:.64;
      }

      .manual-checks{
        display:flex;
        flex-wrap:wrap;
        gap:10px 16px;
        margin-top:12px;
      }

      .manual-check{
        display:inline-flex;
        align-items:center;
        gap:8px;
        font-size:13px;
      }

      .manual-check input{
        width:auto;
      }

      .manual-scenes{
        display:grid;
        grid-template-columns:repeat(10,minmax(0,1fr));
        gap:6px;
      }

      .manual-scene-button{
        min-height:40px;
        border:1px solid rgba(50,40,35,.14);
        background:#fff;
        border-radius:10px;
        cursor:pointer;
        font-weight:700;
      }

      .manual-scene-button.active{
        background:#1f1f1f;
        color:#fff;
        border-color:#1f1f1f;
      }

      .manual-scene-note{
        margin-top:8px;
        font-size:12px;
        opacity:.68;
      }

      .manual-info{
        margin-top:10px;
        padding:10px 12px;
        border-radius:12px;
        background:#f2eef7;
        color:#614875;
        font-size:13px;
        line-height:1.45;
      }

      .manual-warning{
        margin-top:10px;
        padding:10px 12px;
        border-radius:12px;
        background:#fff7df;
        color:#70561a;
        font-size:13px;
        line-height:1.45;
      }

      .manual-hidden{
        display:none !important;
      }

      .manual-quote{
        margin-top:12px;
        padding:14px;
        border-radius:16px;
        background:#fbf7f4;
        border:1px solid rgba(90,70,60,.10);
      }

      .manual-quote-grid{
        display:grid;
        grid-template-columns:repeat(4,minmax(0,1fr));
        gap:10px;
      }

      .manual-quote-item{
        padding:10px;
        border-radius:12px;
        background:#fff;
      }

      .manual-quote-item span{
        display:block;
        margin-bottom:4px;
        font-size:11px;
        opacity:.62;
      }

      .manual-quote-item strong{
        display:block;
        font-size:15px;
      }

      .manual-actions{
        display:flex;
        justify-content:flex-end;
        gap:10px;
        flex-wrap:wrap;
        position:sticky;
        bottom:0;
        padding:14px 18px;
        background:rgba(247,245,242,.96);
        backdrop-filter:blur(12px);
        border-top:1px solid rgba(40,30,25,.08);
      }

      .manual-message{
        min-height:20px;
        font-size:13px;
        color:#8a2d2d;
        margin-right:auto;
        align-self:center;
      }

      .manual-success{
        padding:18px;
        border-radius:18px;
        background:#f3fbf6;
        border:1px solid rgba(40,120,70,.18);
      }

      @media(max-width:760px){
        .manual-order-grid,
        .manual-quote-grid{
          grid-template-columns:1fr;
        }

        .manual-scenes{
          grid-template-columns:repeat(5,minmax(0,1fr));
        }
      }
    `;

    document.head
      .appendChild(
        style,
      );
  }

  /* ==================================================
     CAMPOS
  ================================================== */

  function inputField(
    label,
    name,
    {
      type = 'text',
      placeholder = '',
      required = false,
      value = '',
      hint = '',
      full = false,
      inputmode = '',
      maxlength = '',
    } = {},
  ) {
    return `
      <div
        class="manual-field ${
          full
            ? 'full'
            : ''
        }"
      >
        <label>
          ${esc(label)}
          ${
            required
              ? ' *'
              : ''
          }
        </label>

        <input
          name="${esc(name)}"
          type="${esc(type)}"
          value="${esc(value)}"
          placeholder="${esc(placeholder)}"
          ${
            required
              ? 'required'
              : ''
          }
          ${
            inputmode
              ? `inputmode="${esc(inputmode)}"`
              : ''
          }
          ${
            maxlength
              ? `maxlength="${esc(maxlength)}"`
              : ''
          }
        >

        ${
          hint
            ? `
              <span
                class="manual-hint"
              >
                ${esc(hint)}
              </span>
            `
            : ''
        }
      </div>
    `;
  }

  function textareaField(
    label,
    name,
    {
      placeholder = '',
      full = true,
    } = {},
  ) {
    return `
      <div
        class="manual-field ${
          full
            ? 'full'
            : ''
        }"
      >
        <label>
          ${esc(label)}
        </label>

        <textarea
          name="${esc(name)}"
          placeholder="${esc(placeholder)}"
        ></textarea>
      </div>
    `;
  }

  function selectField(
    label,
    name,
    options,
    value = '',
    {
      full = false,
    } = {},
  ) {
    return `
      <div
        class="manual-field ${
          full
            ? 'full'
            : ''
        }"
      >
        <label>
          ${esc(label)}
        </label>

        <select
          name="${esc(name)}"
        >
          ${options.map(
            ([
              key,
              optionLabel,
            ]) => `
              <option
                value="${esc(key)}"
                ${
                  String(key)
                  === String(value)
                    ? 'selected'
                    : ''
                }
              >
                ${esc(optionLabel)}
              </option>
            `,
          ).join('')}
        </select>
      </div>
    `;
  }

  /* ==================================================
     MODAL
  ================================================== */

  function formHtml() {
    return `
      <div
        id="manualOrderBackdrop"
        class="manual-order-backdrop"
      >
        <section
          class="manual-order-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="manualOrderTitle"
        >
          <header
            class="manual-order-header"
          >
            <div>
              <span
                class="section-eyebrow"
              >
                WhatsApp
              </span>

              <h2
                id="manualOrderTitle"
              >
                Novo pedido manual
              </h2>
            </div>

            <button
              id="manualOrderClose"
              class="manual-order-close"
              type="button"
              aria-label="Fechar"
            >
              ×
            </button>
          </header>

          <form
            id="manualOrderForm"
            class="manual-order-form"
          >
            <section
              class="manual-order-section"
            >
              <h3>
                Cliente e evento
              </h3>

              <div
                class="manual-order-grid"
              >
                ${inputField(
                  'Nome da cliente',
                  'customerName',
                  {
                    required:
                      true,
                  },
                )}

                ${inputField(
                  'WhatsApp',
                  'whatsapp',
                  {
                    required:
                      true,
                    placeholder:
                      'Ex.: 5561999999999',
                    inputmode:
                      'numeric',
                  },
                )}

                ${inputField(
                  'Nome da criança / homenageado(a)',
                  'honoreeName',
                  {
                    required:
                      true,
                  },
                )}

                ${inputField(
                  'Nome no convite',
                  'displayName',
                )}

                ${inputField(
                  'Idade',
                  'age',
                  {
                    type:
                      'number',
                    inputmode:
                      'numeric',
                  },
                )}

                ${inputField(
                  'Tema',
                  'theme',
                  {
                    required:
                      true,
                  },
                )}

                ${inputField(
                  'Data da festa',
                  'eventDate',
                  {
                    type:
                      'date',
                  },
                )}

                ${inputField(
                  'Horário',
                  'eventTime',
                  {
                    type:
                      'text',
                    placeholder:
                      '18:30',
                    inputmode:
                      'numeric',
                    maxlength:
                      '5',
                    hint:
                      'Use HH:MM.',
                  },
                )}

                ${inputField(
                  'Local',
                  'venueName',
                )}

                ${inputField(
                  'Endereço',
                  'venueAddress',
                )}

                ${inputField(
                  'Link da localização',
                  'locationUrl',
                  {
                    type:
                      'url',
                    placeholder:
                      'https://maps.app.goo.gl/...',
                    full:
                      true,
                  },
                )}
              </div>
            </section>

            <section
              class="manual-order-section"
            >
              <h3>
                Produto contratado
              </h3>

              <div
                class="manual-order-grid"
              >
                ${selectField(
                  'Formato',
                  'format',
                  [
                    [
                      'video',
                      'Vídeo',
                    ],
                    [
                      'interactive',
                      'Vídeo Interativo',
                    ],
                  ],
                  'video',
                )}
              </div>

              <div
                class="manual-field"
                style="margin-top:12px"
              >
                <label>
                  Quantidade de cenas
                </label>

                <input
                  id="manualSceneCount"
                  name="scenes"
                  type="hidden"
                  value="6"
                >

                <div
                  class="manual-scenes"
                  id="manualScenes"
                >
                  ${Array.from(
                    {
                      length:
                        10,
                    },
                    (
                      _,
                      index,
                    ) => {
                      const value =
                        index + 1;

                      return `
                        <button
                          type="button"
                          class="manual-scene-button ${
                            value === 6
                              ? 'active'
                              : ''
                          }"
                          data-manual-scenes="${value}"
                        >
                          ${value}
                        </button>
                      `;
                    },
                  ).join('')}
                </div>

                <div
                  class="manual-scene-note"
                >
                  A abertura personalizada já está inclusa e não entra nessa contagem.
                  6 cenas é o padrão mais escolhido.
                </div>
              </div>

              <div
                class="manual-checks"
              >
                <label
                  class="manual-check"
                >
                  <input
                    name="confirmation"
                    type="checkbox"
                  >
                  Confirmação Libri
                </label>

                <label
                  class="manual-check"
                >
                  <input
                    name="filter"
                    type="checkbox"
                  >
                  Filtro personalizado avulso
                </label>

                <label
                  class="manual-check"
                >
                  <input
                    name="urgencyEnabled"
                    type="checkbox"
                  >
                  Pedido urgente
                </label>
              </div>

              <div
                class="manual-order-grid"
                style="margin-top:12px"
              >
                ${inputField(
                  'Pessoas / crianças extras',
                  'extraPerson',
                  {
                    type:
                      'number',
                    value:
                      '0',
                    inputmode:
                      'numeric',
                  },
                )}

                ${selectField(
                  'Libri Moments',
                  'photoAlbumPlan',
                  [
                    [
                      '',
                      'Sem álbum',
                    ],
                    [
                      'festa',
                      'Festa - R$ 79',
                    ],
                    [
                      'premium',
                      'Premium - R$ 119',
                    ],
                    [
                      'exclusive',
                      'Exclusive - R$ 149',
                    ],
                  ],
                  '',
                )}

                <div
                  id="manualAlbumExtraWrap"
                  class="manual-hidden"
                >
                  ${inputField(
                    'Pacotes de +100 fotos',
                    'photoAlbumExtra100',
                    {
                      type:
                        'number',
                      value:
                        '0',
                      inputmode:
                        'numeric',
                      hint:
                        'Cada pacote acrescenta 100 fotos por R$ 15.',
                    },
                  )}
                </div>

                ${inputField(
                  'Valor-base contratado (opcional)',
                  'manualSubtotalReais',
                  {
                    placeholder:
                      'Ex.: 180,00',
                    hint:
                      'Use somente quando você fechou um valor especial pelo WhatsApp.',
                  },
                )}
              </div>

              <div
                id="manualAlbumNote"
                class="manual-info manual-hidden"
              >
                Todo plano Libri Moments já inclui 1 filtro personalizado.
                O filtro avulso não será cobrado junto com o álbum.
              </div>

              <div
                id="manualConfirmationNote"
                class="manual-warning manual-hidden"
              >
                A Confirmação Libri exige Vídeo Interativo.
                O formato foi alterado automaticamente para Vídeo Interativo.
              </div>

              <div
                id="manualQuote"
                class="manual-quote"
              >
                Calculando...
              </div>
            </section>

            <section
              class="manual-order-section"
            >
              <h3>
                Presentes e confirmação
              </h3>

              <div
                class="manual-order-grid"
              >
                ${selectField(
                  'Página de sugestões de presentes',
                  'giftPage',
                  [
                    [
                      'unsure',
                      'A definir',
                    ],
                    [
                      'yes',
                      'Sim',
                    ],
                    [
                      'no',
                      'Não',
                    ],
                  ],
                  'unsure',
                )}

                ${selectField(
                  'Modo da confirmação',
                  'confirmationMode',
                  [
                    [
                      '',
                      'Não se aplica / não definido',
                    ],
                    [
                      'open',
                      'Livre',
                    ],
                    [
                      'list',
                      'Lista de convidados',
                    ],
                    [
                      'unsure',
                      'A definir',
                    ],
                  ],
                  '',
                )}

                <div
                  id="manualGiftDetailsWrap"
                  class="manual-hidden full"
                >
                  ${textareaField(
                    'Sugestões de presentes',
                    'giftDetails',
                    {
                      placeholder:
                        'Ex.: roupas tamanho 4, sapatos 26/27, brinquedos...',
                    },
                  )}
                </div>
              </div>
            </section>

            <section
              class="manual-order-section"
            >
              <h3>
                Direção criativa
              </h3>

              <div
                class="manual-order-grid"
              >
                ${inputField(
                  'Personagem específico',
                  'characterWanted',
                )}

                ${selectField(
                  'Estilo da criança',
                  'childStyle',
                  [
                    [
                      '',
                      'Não informado',
                    ],
                    [
                      'drawing',
                      'Desenho / bonequinho',
                    ],
                    [
                      'real',
                      'Mais real e detalhado',
                    ],
                    [
                      'libri',
                      'A Libri escolhe',
                    ],
                  ],
                  '',
                )}

                ${selectField(
                  'Roupa',
                  'outfitChoice',
                  [
                    [
                      '',
                      'Não informado',
                    ],
                    [
                      'party',
                      'Parecida com a roupa da festa',
                    ],
                    [
                      'specific',
                      'Roupa específica',
                    ],
                    [
                      'libri',
                      'A Libri cria',
                    ],
                  ],
                  '',
                )}

                ${selectField(
                  'Falas',
                  'speechPreference',
                  [
                    [
                      'libri',
                      'A Libri cria',
                    ],
                    [
                      'approve',
                      'Cliente quer aprovar',
                    ],
                    [
                      'own',
                      'Cliente enviou frase própria',
                    ],
                  ],
                  'libri',
                )}

                ${textareaField(
                  'Detalhes da roupa',
                  'outfitDetails',
                  {
                    full:
                      false,
                  },
                )}

                ${textareaField(
                  'Detalhes da aparência',
                  'appearanceDetails',
                  {
                    full:
                      false,
                  },
                )}

                ${textareaField(
                  'Não pode faltar',
                  'mustHave',
                  {
                    full:
                      false,
                  },
                )}

                ${textareaField(
                  'Não quer',
                  'avoid',
                  {
                    full:
                      false,
                  },
                )}

                ${textareaField(
                  'Informações especiais',
                  'specialInfo',
                  {
                    full:
                      false,
                  },
                )}

                ${textareaField(
                  'Cores desejadas',
                  'colors',
                  {
                    full:
                      false,
                  },
                )}

                ${textareaField(
                  'Cores a evitar',
                  'colorsAvoided',
                  {
                    full:
                      false,
                  },
                )}

                ${textareaField(
                  'Ideia / referência',
                  'creativeIdea',
                  {
                    full:
                      false,
                  },
                )}

                <div
                  id="manualOwnSpeechWrap"
                  class="manual-hidden full"
                >
                  ${textareaField(
                    'Frase própria enviada pela cliente',
                    'ownSpeech',
                  )}
                </div>
              </div>
            </section>

            <section
              class="manual-order-section"
            >
              <h3>
                Estado inicial e registros
              </h3>

              <div
                class="manual-order-grid"
              >
                ${selectField(
                  'Fotos',
                  'photosStatus',
                  [
                    [
                      'waiting',
                      'Aguardando',
                    ],
                    [
                      'received',
                      'Recebidas',
                    ],
                    [
                      'approved',
                      'Aprovadas',
                    ],
                    [
                      'needs_new',
                      'Precisa enviar novas',
                    ],
                  ],
                  'waiting',
                )}

                ${selectField(
                  'Entrada',
                  'entryStatus',
                  [
                    [
                      'waiting',
                      'Aguardando',
                    ],
                    [
                      'confirmed',
                      'Confirmada',
                    ],
                  ],
                  'waiting',
                )}

                ${textareaField(
                  'Observações internas',
                  'manualNotes',
                  {
                    full:
                      true,
                    placeholder:
                      'Anotações sobre o fechamento pelo WhatsApp.',
                  },
                )}
              </div>

              <div
                class="manual-checks"
              >
                <label
                  class="manual-check"
                >
                  <input
                    name="termsAcceptedOnWhatsapp"
                    type="checkbox"
                    required
                  >
                  A cliente aceitou os termos no WhatsApp *
                </label>

                <label
                  class="manual-check"
                >
                  <input
                    name="portfolioConsent"
                    type="checkbox"
                  >
                  Cliente autorizou divulgação no portfólio
                </label>
              </div>
            </section>

            <div
              class="manual-actions"
            >
              <div
                id="manualOrderMessage"
                class="manual-message"
              ></div>

              <button
                id="manualOrderCancel"
                type="button"
                class="btn btn-secondary"
              >
                Cancelar
              </button>

              <button
                id="manualOrderSubmit"
                type="submit"
                class="btn btn-primary"
              >
                Criar pedido
              </button>
            </div>
          </form>
        </section>
      </div>
    `;
  }

  function closeModal() {
    $('#manualOrderBackdrop')
      ?.remove();
  }

  function openModal() {
    closeModal();

    document.body
      .insertAdjacentHTML(
        'beforeend',
        formHtml(),
      );

    bindForm();

    scheduleQuote();
  }

  /* ==================================================
     QUOTE
  ================================================== */

  let quoteTimer =
    null;

  function selectionFromForm(
    form,
  ) {
    const data =
      new FormData(
        form,
      );

    const plan =
      text(
        data.get(
          'photoAlbumPlan',
        ),
      );

    return {
      scenes:
        Math.max(
          1,
          Math.min(
            10,
            Number(
              data.get(
                'scenes',
              ),
            )
            || 6,
          ),
        ),

      format:
        text(
          data.get(
            'format',
          ),
        )
        || 'video',

      addons: {
        confirmation:
          data.get(
            'confirmation',
          )
          === 'on',

        filter:
          plan
            ? false
            : data.get(
              'filter',
            )
            === 'on',

        extraPerson:
          Math.max(
            0,
            Number(
              data.get(
                'extraPerson',
              ),
            )
            || 0,
          ),

        photoAlbumPlan:
          plan,

        photoAlbumExtra100:
          plan
            ? Math.max(
              0,
              Number(
                data.get(
                  'photoAlbumExtra100',
                ),
              )
              || 0,
            )
            : 0,
      },
    };
  }

  async function refreshQuote() {
    const form =
      $('#manualOrderForm');

    const box =
      $('#manualQuote');

    if (
      !form
      || !box
    ) {
      return;
    }

    try {
      const selection =
        selectionFromForm(
          form,
        );

      const result =
        await api(
          '/api/quote',
          {
            method:
              'POST',

            body:
              JSON.stringify({
                selection,
              }),
          },
        );

      const quote =
        result.quote
        || {};

      const manual =
        centsFromReais(
          new FormData(
            form,
          ).get(
            'manualSubtotalReais',
          ),
        );

      box.innerHTML = `
        <div
          class="manual-quote-grid"
        >
          <div
            class="manual-quote-item"
          >
            <span>
              Produto
            </span>

            <strong>
              ${money(
                quote.productCents
                || 0,
              )}
            </strong>
          </div>

          <div
            class="manual-quote-item"
          >
            <span>
              Adicionais
            </span>

            <strong>
              ${money(
                quote.addonsCents
                || 0,
              )}
            </strong>
          </div>

          <div
            class="manual-quote-item"
          >
            <span>
              Total padrão
            </span>

            <strong>
              ${money(
                quote.totalCents
                || 0,
              )}
            </strong>
          </div>

          <div
            class="manual-quote-item"
          >
            <span>
              Valor especial
            </span>

            <strong>
              ${
                manual
                  ? money(
                    manual,
                  )
                  : 'Não usado'
              }
            </strong>
          </div>
        </div>

        ${
          quote.formatAdjusted
            ? `
              <div
                class="manual-warning"
              >
                Confirmação Libri exige Vídeo Interativo.
              </div>
            `
            : ''
        }
      `;
    } catch (
      error
    ) {
      box.textContent =
        error.message;
    }
  }

  function scheduleQuote() {
    clearTimeout(
      quoteTimer,
    );

    quoteTimer =
      setTimeout(
        refreshQuote,
        160,
      );
  }

  /* ==================================================
     HORA HH:MM
  ================================================== */

  function maskTime(
    input,
  ) {
    const digits =
      input.value
        .replace(
          /\D/g,
          '',
        )
        .slice(
          0,
          4,
        );

    if (
      digits.length <= 2
    ) {
      input.value =
        digits;
    } else {
      input.value =
        `${digits.slice(0, 2)}:${digits.slice(2)}`;
    }
  }

  function validTime(
    value,
  ) {
    if (!value) {
      return true;
    }

    if (
      !/^\d{2}:\d{2}$/
        .test(
          value,
        )
    ) {
      return false;
    }

    const [
      hour,
      minute,
    ] =
      value
        .split(':')
        .map(Number);

    return (
      hour >= 0
      && hour <= 23
      && minute >= 0
      && minute <= 59
    );
  }

  /* ==================================================
     INTERAÇÕES
  ================================================== */

  function bindForm() {
    const form =
      $('#manualOrderForm');

    if (!form) {
      return;
    }

    $('#manualOrderClose')
      ?.addEventListener(
        'click',
        closeModal,
      );

    $('#manualOrderCancel')
      ?.addEventListener(
        'click',
        closeModal,
      );

    $$(
      '[data-manual-scenes]',
      form,
    ).forEach(
      (button) => {
        button.addEventListener(
          'click',
          () => {
            const value =
              Number(
                button.dataset
                  .manualScenes,
              );

            $('#manualSceneCount')
              .value =
                String(
                  value,
                );

            $$(
              '[data-manual-scenes]',
              form,
            ).forEach(
              (item) => {
                item.classList
                  .toggle(
                    'active',
                    item === button,
                  );
              },
            );

            scheduleQuote();
          },
        );
      },
    );

    const timeInput =
      $('[name="eventTime"]', form);

    timeInput
      ?.addEventListener(
        'input',
        () => {
          maskTime(
            timeInput,
          );
        },
      );

    const confirmation =
      $('[name="confirmation"]', form);

    const format =
      $('[name="format"]', form);

    confirmation
      ?.addEventListener(
        'change',
        () => {
          const note =
            $('#manualConfirmationNote');

          if (
            confirmation.checked
            && format
            && format.value
              === 'video'
          ) {
            format.value =
              'interactive';

            note
              ?.classList
              .remove(
                'manual-hidden',
              );
          } else {
            note
              ?.classList
              .add(
                'manual-hidden',
              );
          }

          scheduleQuote();
        },
      );

    const plan =
      $('[name="photoAlbumPlan"]', form);

    const filter =
      $('[name="filter"]', form);

    plan
      ?.addEventListener(
        'change',
        () => {
          const active =
            Boolean(
              plan.value,
            );

          $('#manualAlbumExtraWrap')
            ?.classList
            .toggle(
              'manual-hidden',
              !active,
            );

          $('#manualAlbumNote')
            ?.classList
            .toggle(
              'manual-hidden',
              !active,
            );

          if (
            active
            && filter
          ) {
            filter.checked =
              false;

            filter.disabled =
              true;
          } else if (
            filter
          ) {
            filter.disabled =
              false;
          }

          scheduleQuote();
        },
      );

    const giftPage =
      $('[name="giftPage"]', form);

    giftPage
      ?.addEventListener(
        'change',
        () => {
          $('#manualGiftDetailsWrap')
            ?.classList
            .toggle(
              'manual-hidden',
              giftPage.value
              !== 'yes',
            );
        },
      );

    const speech =
      $('[name="speechPreference"]', form);

    speech
      ?.addEventListener(
        'change',
        () => {
          $('#manualOwnSpeechWrap')
            ?.classList
            .toggle(
              'manual-hidden',
              speech.value
              !== 'own',
            );
        },
      );

    form.addEventListener(
      'input',
      (
        event,
      ) => {
        if (
          event.target
            ?.name
          !== 'eventTime'
        ) {
          scheduleQuote();
        }
      },
    );

    form.addEventListener(
      'change',
      scheduleQuote,
    );

    form.addEventListener(
      'submit',
      submitManualOrder,
    );
  }

  /* ==================================================
     SUBMIT
  ================================================== */

  async function submitManualOrder(
    event,
  ) {
    event.preventDefault();

    const form =
      event.currentTarget;

    const data =
      new FormData(
        form,
      );

    const message =
      $('#manualOrderMessage');

    const button =
      $('#manualOrderSubmit');

    const eventTime =
      text(
        data.get(
          'eventTime',
        ),
      );

    if (
      !validTime(
        eventTime,
      )
    ) {
      if (message) {
        message.textContent =
          'Confira o horário. Use HH:MM, por exemplo 18:30.';
      }

      return;
    }

    if (
      data.get(
        'termsAcceptedOnWhatsapp',
      )
      !== 'on'
    ) {
      if (message) {
        message.textContent =
          'Marque que a cliente aceitou os termos no WhatsApp.';
      }

      return;
    }

    const selection =
      selectionFromForm(
        form,
      );

    const giftPage =
      text(
        data.get(
          'giftPage',
        ),
      )
      || 'unsure';

    const manualSubtotalCents =
      centsFromReais(
        data.get(
          'manualSubtotalReais',
        ),
      );

    const payload = {
      customerName:
        text(
          data.get(
            'customerName',
          ),
        ),

      whatsapp:
        text(
          data.get(
            'whatsapp',
          ),
        ),

      honoreeName:
        text(
          data.get(
            'honoreeName',
          ),
        ),

      displayName:
        text(
          data.get(
            'displayName',
          ),
        ),

      age:
        data.get(
          'age',
        ),

      eventDate:
        text(
          data.get(
            'eventDate',
          ),
        ),

      eventTime,

      venueName:
        text(
          data.get(
            'venueName',
          ),
        ),

      venueAddress:
        text(
          data.get(
            'venueAddress',
          ),
        ),

      locationUrl:
        text(
          data.get(
            'locationUrl',
          ),
        ),

      theme:
        text(
          data.get(
            'theme',
          ),
        ),

      scenes:
        selection.scenes,

      sceneCount:
        selection.scenes,

      format:
        selection.format,

      addons:
        selection.addons,

      urgencyEnabled:
        data.get(
          'urgencyEnabled',
        )
        === 'on',

      manualSubtotalCents,

      giftPage,

      giftDetails:
        giftPage
        === 'yes'
          ? text(
            data.get(
              'giftDetails',
            ),
          )
          : '',

      confirmationMode:
        text(
          data.get(
            'confirmationMode',
          ),
        ),

      characterWanted:
        text(
          data.get(
            'characterWanted',
          ),
        ),

      childStyle:
        text(
          data.get(
            'childStyle',
          ),
        ),

      outfitChoice:
        text(
          data.get(
            'outfitChoice',
          ),
        ),

      outfitDetails:
        text(
          data.get(
            'outfitDetails',
          ),
        ),

      appearanceDetails:
        text(
          data.get(
            'appearanceDetails',
          ),
        ),

      mustHave:
        text(
          data.get(
            'mustHave',
          ),
        ),

      avoid:
        text(
          data.get(
            'avoid',
          ),
        ),

      specialInfo:
        text(
          data.get(
            'specialInfo',
          ),
        ),

      colors:
        text(
          data.get(
            'colors',
          ),
        ),

      colorsAvoided:
        text(
          data.get(
            'colorsAvoided',
          ),
        ),

      creativeIdea:
        text(
          data.get(
            'creativeIdea',
          ),
        ),

      speechPreference:
        text(
          data.get(
            'speechPreference',
          ),
        )
        || 'libri',

      ownSpeech:
        text(
          data.get(
            'ownSpeech',
          ),
        ),

      photosStatus:
        text(
          data.get(
            'photosStatus',
          ),
        )
        || 'waiting',

      entryStatus:
        text(
          data.get(
            'entryStatus',
          ),
        )
        || 'waiting',

      manualNotes:
        text(
          data.get(
            'manualNotes',
          ),
        ),

      termsAcceptedOnWhatsapp:
        true,

      portfolioConsent:
        data.get(
          'portfolioConsent',
        )
        === 'on',
    };

    if (button) {
      button.disabled =
        true;

      button.textContent =
        'Criando...';
    }

    if (message) {
      message.textContent =
        '';
    }

    try {
      const result =
        await api(
          '/api/admin/orders/manual',
          {
            method:
              'POST',

            body:
              JSON.stringify(
                payload,
              ),
          },
        );

      const order =
        result.order
        || {};

      const modal =
        $('.manual-order-modal');

      if (modal) {
        modal.innerHTML = `
          <div
            style="padding:24px"
          >
            <div
              class="manual-success"
            >
              <strong>
                Pedido criado com sucesso
              </strong>

              <p>
                ${esc(
                  order.orderCode
                  || '',
                )}
                ${
                  order.honoreeName
                    ? ` • ${esc(order.honoreeName)}`
                    : ''
                }
              </p>

              <p>
                ${esc(
                  order.format
                  === 'interactive'
                    ? 'Vídeo Interativo'
                    : 'Vídeo',
                )}
                •
                ${Number(
                  order.scenes
                  || order.sceneCount
                  || 0,
                )}
                cena(s)
              </p>

              <p>
                Total:
                <strong
                  style="display:inline"
                >
                  ${money(
                    order.totalCents
                    || 0,
                  )}
                </strong>
              </p>

              <button
                id="manualOrderDone"
                type="button"
                class="btn btn-primary"
              >
                Fechar
              </button>
            </div>
          </div>
        `;

        $('#manualOrderDone')
          ?.addEventListener(
            'click',
            closeModal,
          );
      }

      /*
       * Atualiza tanto o admin antigo
       * quanto o V5 novo.
       */
      setTimeout(
        () => {
          $('#refreshOrders')
            ?.click();
        },
        100,
      );
    } catch (
      error
    ) {
      if (message) {
        const missing =
          error.data
            ?.details
            ?.missing
          || error.data
            ?.missing
          || [];

        message.textContent =
          missing.length
            ? `${error.message} ${missing.join(', ')}`
            : error.message;
      }

      if (button) {
        button.disabled =
          false;

        button.textContent =
          'Criar pedido';
      }
    }
  }

  /* ==================================================
     BOTÃO
  ================================================== */

  function installButton() {
    if (
      $('#newManualOrderButton')
    ) {
      return;
    }

    const refresh =
      $('#refreshOrders');

    if (!refresh) {
      return;
    }

    const button =
      document.createElement(
        'button',
      );

    button.id =
      'newManualOrderButton';

    button.type =
      'button';

    button.className =
      'btn btn-primary btn-small btn-new-order';

    button.textContent =
      'Novo pedido manual';

    button.addEventListener(
      'click',
      openModal,
    );

    refresh.insertAdjacentElement(
      'beforebegin',
      button,
    );
  }

  /* ==================================================
     INIT
  ================================================== */

  function init() {
    installStyles();

    installButton();

    /*
     * O botão pode aparecer depois,
     * caso scripts antigos ainda
     * estejam inicializando a aba.
     */
    setTimeout(
      installButton,
      250,
    );

    setTimeout(
      installButton,
      900,
    );
  }

  if (
    document.readyState
    === 'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      init,
      {
        once:
          true,
      },
    );
  } else {
    init();
  }
})();

