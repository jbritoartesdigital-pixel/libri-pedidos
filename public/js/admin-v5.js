(() => {
  'use strict';

  /* ==================================================
     LIBRI CONVITES
     PAINEL ADMIN V5 | WORKFLOW SIMPLIFICADO
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

  const state = {
    authenticated:
      false,

    authConfigured:
      false,

    dashboard:
      null,

    orders:
      [],

    activeFilter:
      '',

    search:
      '',

    currentOrder:
      null,
  };

  const LEGACY_STATUS_MAP = Object.freeze({
    new:
      'new',

    ready:
      'new',

    producing:
      'producing',

    waiting_client:
      'producing',

    revisions:
      'revisions',

    waiting_balance:
      'finished',

    finished:
      'finished',

    cancelled:
      'cancelled',
  });

  const STATUS_LABELS = Object.freeze({
    new:
      'Novo',

    producing:
      'Produção',

    revisions:
      'Ajustes',

    finished:
      'Finalizado',

    cancelled:
      'Cancelado',
  });

  const PAYMENT_LABELS = Object.freeze({
    pending:
      'Pagamento pendente',

    paid:
      'Pago',
  });

  const FILTERS = [
    [
      '',
      'Todos',
    ],

    [
      'new',
      'Novos',
    ],

    [
      'today',
      'Hoje',
    ],

    [
      'week',
      'Esta semana',
    ],

    [
      'producing',
      'Em produção',
    ],

    [
      'revisions',
      'Ajustes',
    ],

    [
      'payment_pending',
      'Pendentes de pagamento',
    ],

    [
      'finished',
      'Finalizados',
    ],

    [
      'cancelled',
      'Cancelados',
    ],
  ];

  /* ==================================================
     HELPERS
  ================================================== */

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

  function normalizeText(
    value,
  ) {
    return String(
      value
      ?? '',
    ).trim();
  }

  function money(
    cents = 0,
  ) {
    return new Intl
      .NumberFormat(
        'pt-BR',
        {
          style:
            'currency',

          currency:
            'BRL',
        },
      )
      .format(
        (
          Number(
            cents,
          )
          || 0
        )
        / 100,
      );
  }

  function formatDate(
    value,
  ) {
    if (!value) {
      return 'Não informado';
    }

    const parts =
      String(
        value,
      ).split('-');

    if (
      parts.length
      !== 3
    ) {
      return String(
        value,
      );
    }

    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  function todaySaoPaulo() {
    const parts =
      new Intl
        .DateTimeFormat(
          'en-US',
          {
            timeZone:
              'America/Sao_Paulo',

            year:
              'numeric',

            month:
              '2-digit',

            day:
              '2-digit',
          },
        )
        .formatToParts(
          new Date(),
        );

    const map =
      Object.fromEntries(
        parts.map(
          (part) => [
            part.type,
            part.value,
          ],
        ),
      );

    return (
      `${map.year}-`
      + `${map.month}-`
      + `${map.day}`
    );
  }

  function statusOf(
    order,
  ) {
    return LEGACY_STATUS_MAP[
      order.workflowStatus
      || order.status
      || 'new'
    ]
    || 'new';
  }

  function paymentOf(
    order,
  ) {
    if (
      order.paymentStatus
    ) {
      return order.paymentStatus;
    }

    /*
     * Compatibilidade visual:
     * waiting_balance representa
     * pagamento pendente em pedido antigo.
     */
    if (
      order.status
      === 'waiting_balance'
    ) {
      return 'pending';
    }

    return 'pending';
  }

  function statusLabel(
    order,
  ) {
    return STATUS_LABELS[
      statusOf(
        order,
      )
    ]
    || 'Novo';
  }

  function paymentLabel(
    order,
  ) {
    return PAYMENT_LABELS[
      paymentOf(
        order,
      )
    ]
    || 'Pagamento pendente';
  }

  function formatLabel(
    value,
  ) {
    return value
      === 'interactive'
      ? 'Vídeo Interativo'
      : 'Vídeo';
  }

  function sceneCount(
    order,
  ) {
    const direct =
      Number(
        order.sceneCount
        ?? order.scenes
        ?? order.scene_count
        ?? 0,
      );

    if (
      Number.isInteger(
        direct,
      )
      && direct >= 1
      && direct <= 10
    ) {
      return direct;
    }

    /*
     * Só para pedidos antigos,
     * enquanto scene_count ainda
     * não estiver preenchido.
     */
    return order.experience
      === 'reduced'
      ? 3
      : 6;
  }

  function productLabel(
    order,
  ) {
    const scenes =
      sceneCount(
        order,
      );

    return (
      `${formatLabel(order.format)}`
      + ` • ${scenes} `
      + `${scenes === 1 ? 'cena' : 'cenas'}`
    );
  }

  function sameDay(
    order,
    dateKey,
  ) {
    return (
      order.eventDate
      || order.event_date
    ) === dateKey;
  }

  function eventDateOf(
    order,
  ) {
    return (
      order.eventDate
      || order.event_date
      || ''
    );
  }

  function eventTimestamp(
    order,
  ) {
    const date =
      eventDateOf(
        order,
      );

    if (!date) {
      return Number
        .MAX_SAFE_INTEGER;
    }

    const time =
      new Date(
        `${date}T12:00:00`,
      ).getTime();

    return Number.isFinite(
      time,
    )
      ? time
      : Number
        .MAX_SAFE_INTEGER;
  }

  function startOfWeekWindow() {
    const today =
      todaySaoPaulo();

    const [
      year,
      month,
      day,
    ] =
      today
        .split('-')
        .map(Number);

    const start =
      new Date(
        Date.UTC(
          year,
          month - 1,
          day,
        ),
      );

    const end =
      new Date(
        start,
      );

    end.setUTCDate(
      end.getUTCDate()
      + 6,
    );

    const key = (
      date
    ) => [
      date
        .getUTCFullYear(),

      String(
        date.getUTCMonth()
        + 1,
      ).padStart(
        2,
        '0',
      ),

      String(
        date.getUTCDate(),
      ).padStart(
        2,
        '0',
      ),
    ].join('-');

    return [
      key(
        start,
      ),
      key(
        end,
      ),
    ];
  }

  function nextAction(
    order,
  ) {
    const status =
      statusOf(
        order,
      );

    if (
      status
      === 'cancelled'
    ) {
      return 'Pedido cancelado';
    }

    if (
      status
      === 'finished'
    ) {
      return paymentOf(order)
        === 'paid'
        ? 'Pedido concluído'
        : 'Confirmar pagamento';
    }

    if (
      status
      === 'revisions'
    ) {
      return 'Fazer ajustes';
    }

    if (
      status
      === 'producing'
    ) {
      return 'Continuar produção';
    }

    return 'Conferir pedido e iniciar produção';
  }


  function parseJsonObject(
    value,
  ) {
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
    ) {
      return value;
    }

    if (
      typeof value !== 'string'
      || !value.trim()
    ) {
      return {};
    }

    try {
      const parsed =
        JSON.parse(
          value,
        );

      return (
        parsed
        && typeof parsed === 'object'
        && !Array.isArray(parsed)
      )
        ? parsed
        : {};
    } catch {
      return {};
    }
  }

  function firstValue(
    ...values
  ) {
    for (
      const value
      of values
    ) {
      const normalized =
        normalizeText(
          value,
        );

      if (
        normalized
      ) {
        return normalized;
      }
    }

    return '';
  }

  function valueOr(
    value,
    fallback = 'Não informado',
  ) {
    return firstValue(
      value,
    )
    || fallback;
  }

  function childStyleLabel(
    value,
  ) {
    return ({
      drawing:
        'Desenho / bonequinho',

      real:
        'Mais real e detalhado',

      libri:
        'A Libri escolhe',
    })[value]
    || value
    || 'Não informado';
  }

  function outfitLabel(
    value,
  ) {
    return ({
      party:
        'Parecida com a roupa da festa',

      specific:
        'Roupa específica',

      libri:
        'A Libri cria',
    })[value]
    || value
    || 'Não informado';
  }

  function speechLabel(
    value,
  ) {
    return ({
      libri:
        'A Libri cria',

      approve:
        'Cliente quer aprovar antes',

      own:
        'Cliente enviou frase própria',
    })[value]
    || value
    || 'Não informado';
  }

  function confirmationModeLabel(
    value,
  ) {
    return ({
      open:
        'Livre',

      list:
        'Lista de convidados',

      unsure:
        'Ainda não definido',
    })[value]
    || value
    || 'Não informado';
  }

  function portfolioConsentLabel(
    order,
  ) {
    const value =
      order.portfolio_consent
      ?? order.portfolioConsent;

    return (
      value === 1
      || value === true
      || value === '1'
    )
      ? 'Autorizada'
      : 'Não autorizada';
  }

  function momentsLabel(
    plan,
  ) {
    return ({
      festa:
        'Festa',

      premium:
        'Premium',

      exclusive:
        'Exclusive',
    })[plan]
    || '';
  }

  async function copyText(
    value,
  ) {
    if (!value) {
      return;
    }

    if (
      navigator
        .clipboard
        ?.writeText
    ) {
      await navigator
        .clipboard
        .writeText(
          value,
        );

      return;
    }

    const area =
      document.createElement(
        'textarea',
      );

    area.value =
      value;

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
  }

  function buildProjectBriefing(
    order,
  ) {
    const briefing =
      parseJsonObject(
        order.briefing
        || order.briefing_json,
      );

    const addons =
      parseJsonObject(
        order.addons
        || order.addons_json,
      );

    const code =
      valueOr(
        order.order_code,
        `LIBRI-${order.id}`,
      );

    const honoree =
      valueOr(
        order.honoree_name
        || briefing.honoreeName,
      );

    const displayName =
      valueOr(
        order.display_name
        || briefing.displayName
        || order.honoree_name
        || briefing.honoreeName,
      );

    const customer =
      valueOr(
        order.customer_name
        || briefing.customerName,
      );

    const whatsapp =
      valueOr(
        order.whatsapp
        || briefing.whatsapp,
      );

    const age =
      valueOr(
        order.age
        ?? briefing.age,
      );

    const eventDate =
      order.event_date
      || briefing.eventDate
      || '';

    const eventTime =
      valueOr(
        order.event_time
        || briefing.eventTime,
      );

    const venueName =
      valueOr(
        order.venue_name
        || briefing.venueName,
      );

    const venueAddress =
      valueOr(
        order.venue_address
        || briefing.venueAddress,
      );

    const locationUrl =
      firstValue(
        briefing.locationUrl,
        order.location_url,
      )
      || 'Não informada';

    const theme =
      valueOr(
        order.theme
        || briefing.theme,
      );

    const scenes =
      sceneCount(
        order,
      );

    const confirmation =
      addons.confirmation
      === true;

    const filter =
      addons.filter
      === true;

    const momentsPlan =
      firstValue(
        addons.photoAlbumPlan,
      );

    const momentsExtra =
      Number(
        addons.photoAlbumExtra100
        || 0,
      );

    const lines = [
      `${code} | ${displayName}`,

      '',

      'CLIENTE',
      `${customer} | WhatsApp: ${whatsapp}`,

      '',

      'CRIANÇA / HOMENAGEADO(A)',
      `Nome: ${honoree}`,
      `Nome no convite: ${displayName}`,
      `Idade: ${age}`,

      '',

      'EVENTO',
      `Data: ${formatDate(eventDate)}`,
      `Horário: ${eventTime}`,
      `Local: ${venueName}`,
      `Endereço: ${venueAddress}`,
      `Localização: ${locationUrl}`,

      '',

      'CONTRATAÇÃO',
      `Formato: ${formatLabel(order.format)}`,
      `Cenas: ${scenes}`,
      'Abertura: Inclusa e fora da contagem de cenas',
      `Confirmação Libri: ${confirmation ? 'Sim' : 'Não'}`,
      `Filtro personalizado: ${filter ? 'Sim' : 'Não'}`,
    ];

    if (
      momentsPlan
    ) {
      lines.push(
        `Libri Moments: ${momentsLabel(momentsPlan)}${
          momentsExtra > 0
            ? ` + ${momentsExtra} pacote(s) de +100 fotos`
            : ''
        }`,
      );
    }

    lines.push(
      `TOTAL CONTRATADO: ${money(
        order.total_cents
        ?? order.totalCents
        ?? 0,
      )}`,

      `DIVULGAÇÃO DO CONVITE: ${portfolioConsentLabel(
        order,
      )}`,
    );

    lines.push(
      '',
      'TEMA',
      theme,

      '',
      'PERSONAGEM ESPECÍFICO',
      valueOr(
        briefing.characterWanted,
        'Nenhum informado',
      ),

      '',
      'NÃO PODE FALTAR',
      valueOr(
        briefing.mustHave,
        'Nada específico informado',
      ),

      '',
      'NÃO QUER',
      valueOr(
        briefing.avoid,
        'Nada específico informado',
      ),

      '',
      'INFORMAÇÕES ESPECIAIS',
      valueOr(
        briefing.specialInfo,
        'Nenhuma',
      ),

      '',
      'DIREÇÃO VISUAL',
      `Estilo da criança: ${childStyleLabel(
        briefing.childStyle,
      )}`,
      `Roupa: ${outfitLabel(
        briefing.outfitChoice,
      )}`,
      `Detalhes da roupa: ${valueOr(
        briefing.outfitDetails,
        'Nenhum detalhe extra informado',
      )}`,
      `Detalhes da aparência: ${valueOr(
        briefing.appearanceDetails,
        'Nenhum detalhe extra informado',
      )}`,
      `Cores desejadas: ${valueOr(
        briefing.colors,
        'Sem preferência informada',
      )}`,
      `Cores a evitar: ${valueOr(
        briefing.colorsAvoided,
        'Nenhuma',
      )}`,
      `Ideia / referência: ${valueOr(
        briefing.creativeIdea,
        'Nenhuma',
      )}`,

      '',
      'FALAS',
      speechLabel(
        briefing.speechPreference,
      ),
    );

    if (
      briefing.speechPreference
      === 'own'
      && firstValue(
        briefing.ownSpeech,
      )
    ) {
      lines.push(
        `Frase enviada: ${briefing.ownSpeech}`,
      );
    }

    if (
      confirmation
    ) {
      lines.push(
        '',
        'CONFIRMAÇÃO DE PRESENÇA',
        `Modo: ${confirmationModeLabel(
          briefing.confirmationMode,
        )}`,
      );
    }

    if (
      firstValue(
        briefing.giftPage,
      )
    ) {
      const giftPage =
        briefing.giftPage;

      lines.push(
        '',
        'SUGESTÕES DE PRESENTES',
        giftPage === 'yes'
          ? valueOr(
            briefing.giftDetails,
            'Sim, sem detalhes informados',
          )
          : giftPage === 'no'
            ? 'Não'
            : 'A definir',
      );
    }

    return lines.join(
      '\n',
    );
  }


  /* ==================================================
     CONFIGURAÇÕES V2 | PREÇOS POR CENA
  ================================================== */

  const CONFIG_DEFAULT_SCENE_PRICES =
    Object.freeze({
      video: {
        1: 3500,
        2: 5000,
        3: 6500,
        4: 8000,
        5: 10500,
        6: 13000,
        7: 15500,
        8: 18000,
        9: 20500,
        10: 23000,
      },

      interactive: {
        1: 5000,
        2: 7000,
        3: 9500,
        4: 12000,
        5: 15000,
        6: 18000,
        7: 21000,
        8: 24000,
        9: 27000,
        10: 30000,
      },
    });

  const CONFIG_DEFAULT_MOMENTS =
    Object.freeze({
      festa:
        7900,

      premium:
        11900,

      exclusive:
        14900,

      extra100:
        1500,
    });

  function configReaisFromCents(
    value,
  ) {
    return (
      (Number(value) || 0)
      / 100
    )
      .toFixed(2)
      .replace(
        '.',
        ',',
      );
  }

  function configCentsFromReais(
    value,
  ) {
    const raw =
      String(
        value || '',
      ).trim();

    if (!raw) {
      return 0;
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

    return Math.round(
      (Number(normalized) || 0)
      * 100,
    );
  }

  function configCentsValue(
    settings,
    key,
    fallback,
  ) {
    const value =
      Number.parseInt(
        settings?.[key],
        10,
      );

    return (
      Number.isInteger(value)
      && value > 0
    )
      ? value
      : fallback;
  }

  function configField({
    label,
    key,
    value,
    type = 'text',
    hint = '',
  }) {
    return `
      <div
        class="field"
      >
        <label>
          ${esc(label)}
        </label>

        <input
          data-config-v2="${esc(key)}"
          type="${esc(type)}"
          value="${esc(value)}"
        >

        ${
          hint
            ? `
              <span
                class="hint"
              >
                ${esc(hint)}
              </span>
            `
            : ''
        }
      </div>
    `;
  }

  function configSceneFields(
    settings,
    format,
    label,
  ) {
    return Array
      .from(
        {
          length:
            10,
        },
        (
          _,
          index,
        ) => {
          const scenes =
            index + 1;

          const key =
            `price_${format}_scene_${scenes}_cents`;

          const fallback =
            CONFIG_DEFAULT_SCENE_PRICES
              [format]
              [scenes];

          return configField({
            label:
              `${label} • ${scenes} ${
                scenes === 1
                  ? 'cena'
                  : 'cenas'
              }`,

            key,

            value:
              configReaisFromCents(
                configCentsValue(
                  settings,
                  key,
                  fallback,
                ),
              ),
          });
        },
      )
      .join('');
  }

  function ensureConfigV2Form() {
    const current =
      $('#settingsForm');

    if (!current) {
      return null;
    }

    if (
      current.dataset
        .configV2Form
      === 'true'
    ) {
      return current;
    }

    const replacement =
      document.createElement(
        'form',
      );

    replacement.id =
      'settingsForm';

    replacement.className =
      current.className
      || 'settings-card';

    replacement.dataset
      .configV2Form =
        'true';

    current.replaceWith(
      replacement,
    );

    return replacement;
  }

  function showSettingsV2Tab() {
    $('#ordersTab')
      ?.classList
      .add(
        'hidden',
      );

    $('#settingsTab')
      ?.classList
      .remove(
        'hidden',
      );

    $('#termsTab')
      ?.classList
      .add(
        'hidden',
      );

    $$(
      '[data-tab]',
    ).forEach(
      (button) => {
        button.classList
          .toggle(
            'active',
            button.dataset
              .tab
            === 'settings',
          );
      },
    );
  }

  function renderSettingsV2(
    settings,
  ) {
    const form =
      ensureConfigV2Form();

    if (!form) {
      return;
    }

    const confirmation =
      configCentsValue(
        settings,
        'addon_confirmation_cents',
        2500,
      );

    const filter =
      configCentsValue(
        settings,
        'addon_filter_cents',
        3900,
      );

    const extraPerson =
      configCentsValue(
        settings,
        'addon_extra_person_cents',
        3000,
      );

    const momentsFesta =
      configCentsValue(
        settings,
        'moments_festa_cents',
        CONFIG_DEFAULT_MOMENTS
          .festa,
      );

    const momentsPremium =
      configCentsValue(
        settings,
        'moments_premium_cents',
        CONFIG_DEFAULT_MOMENTS
          .premium,
      );

    const momentsExclusive =
      configCentsValue(
        settings,
        'moments_exclusive_cents',
        CONFIG_DEFAULT_MOMENTS
          .exclusive,
      );

    const momentsExtra100 =
      configCentsValue(
        settings,
        'moments_extra_100_cents',
        CONFIG_DEFAULT_MOMENTS
          .extra100,
      );

    form.innerHTML = `
      <section
        class="settings-section"
      >
        <h3>
          Preços do Vídeo
        </h3>

        <p
          class="hint"
          style="margin-bottom:12px"
        >
          A abertura personalizada já está incluída
          e não entra na contagem.
        </p>

        <div
          class="settings-grid"
        >
          ${configSceneFields(
            settings,
            'video',
            'Vídeo',
          )}
        </div>
      </section>

      <section
        class="settings-section"
      >
        <h3>
          Preços do Vídeo Interativo
        </h3>

        <p
          class="hint"
          style="margin-bottom:12px"
        >
          O Vídeo Interativo também inclui
          o vídeo personalizado.
        </p>

        <div
          class="settings-grid"
        >
          ${configSceneFields(
            settings,
            'interactive',
            'Vídeo Interativo',
          )}
        </div>
      </section>

      <section
        class="settings-section"
      >
        <h3>
          Opcionais
        </h3>

        <div
          class="settings-grid"
        >
          ${configField({
            label:
              'Confirmação Libri',

            key:
              'addon_confirmation_cents',

            value:
              configReaisFromCents(
                confirmation,
              ),
          })}

          ${configField({
            label:
              'Filtro personalizado',

            key:
              'addon_filter_cents',

            value:
              configReaisFromCents(
                filter,
              ),
          })}
        </div>
      </section>

      <section
        class="settings-section"
      >
        <h3>
          Libri Moments
        </h3>

        <div
          class="settings-grid"
        >
          ${configField({
            label:
              'Festa • 200 fotos / 30 dias',

            key:
              'moments_festa_cents',

            value:
              configReaisFromCents(
                momentsFesta,
              ),
          })}

          ${configField({
            label:
              'Premium • 400 fotos / 60 dias',

            key:
              'moments_premium_cents',

            value:
              configReaisFromCents(
                momentsPremium,
              ),
          })}

          ${configField({
            label:
              'Exclusive • 700 fotos / 90 dias',

            key:
              'moments_exclusive_cents',

            value:
              configReaisFromCents(
                momentsExclusive,
              ),
          })}

          ${configField({
            label:
              '+100 fotos',

            key:
              'moments_extra_100_cents',

            value:
              configReaisFromCents(
                momentsExtra100,
              ),
          })}
        </div>
      </section>

      <section
        class="settings-section"
      >
        <h3>
          Regras e uso interno
        </h3>

        <div
          class="settings-grid"
        >
          ${configField({
            label:
              'Entrada (%)',

            key:
              'deposit_percent',

            type:
              'number',

            value:
              settings.deposit_percent
              || '50',
          })}

          ${configField({
            label:
              'Prazo padrão (dias úteis)',

            key:
              'deadline_business_days',

            type:
              'number',

            value:
              settings
                .deadline_business_days
              || '5',
          })}

          ${configField({
            label:
              'Urgência (%) • uso interno',

            key:
              'urgency_percent',

            type:
              'number',

            value:
              settings.urgency_percent
              || '30',

            hint:
              'Não aparece no portal da cliente.',
          })}

          ${configField({
            label:
              'Pessoa extra • uso manual',

            key:
              'addon_extra_person_cents',

            value:
              configReaisFromCents(
                extraPerson,
              ),

            hint:
              'Não aparece no portal da cliente.',
          })}
        </div>
      </section>

      <section
        class="settings-section"
      >
        <h3>
          Pagamento e contato
        </h3>

        <div
          class="settings-grid"
        >
          ${configField({
            label:
              'Chave Pix',

            key:
              'pix_key',

            value:
              settings.pix_key
              || '',
          })}

          ${configField({
            label:
              'Nome do recebedor',

            key:
              'pix_recipient_name',

            value:
              settings
                .pix_recipient_name
              || '',
          })}

          ${configField({
            label:
              'WhatsApp da Libri',

            key:
              'libri_whatsapp',

            value:
              settings.libri_whatsapp
              || '',

            hint:
              'Use DDI + DDD + número.',
          })}
        </div>
      </section>

      <section
        class="settings-section"
      >
        <h3>
          Links de exemplos
        </h3>

        <div
          class="settings-grid"
        >
          ${configField({
            label:
              'Vídeo • até 3 cenas',

            key:
              'example_video_reduced_url',

            value:
              settings
                .example_video_reduced_url
              || '',
          })}

          ${configField({
            label:
              'Vídeo • 4 a 10 cenas',

            key:
              'example_video_full_url',

            value:
              settings
                .example_video_full_url
              || '',
          })}

          ${configField({
            label:
              'Interativo • até 3 cenas',

            key:
              'example_interactive_reduced_url',

            value:
              settings
                .example_interactive_reduced_url
              || '',
          })}

          ${configField({
            label:
              'Interativo • 4 a 10 cenas',

            key:
              'example_interactive_full_url',

            value:
              settings
                .example_interactive_full_url
              || '',
          })}

          ${configField({
            label:
              'Exemplo da confirmação',

            key:
              'example_confirmation_url',

            value:
              settings
                .example_confirmation_url
              || '',
          })}

          ${configField({
            label:
              'Exemplo do filtro',

            key:
              'example_filter_url',

            value:
              settings
                .example_filter_url
              || '',
          })}
        </div>
      </section>

      <div
        class="form-actions"
      >
        <button
          class="btn btn-primary"
          type="submit"
        >
          Salvar configurações
        </button>
      </div>
    `;

    form.addEventListener(
      'submit',
      saveSettingsV2,
      {
        once:
          true,
      },
    );
  }

  async function loadSettingsV2() {
    const form =
      ensureConfigV2Form();

    if (!form) {
      return;
    }

    form.innerHTML = `
      <div
        class="empty-state"
      >
        Carregando configurações...
      </div>
    `;

    try {
      const data =
        await api(
          '/api/admin/settings',
        );

      renderSettingsV2(
        data.settings
        || {},
      );
    } catch (
      error
    ) {
      form.innerHTML = `
        <div
          class="empty-state"
        >
          Não foi possível carregar as configurações.
          <br>
          ${esc(error.message)}
        </div>
      `;
    }
  }

  async function saveSettingsV2(
    event,
  ) {
    event.preventDefault();

    const form =
      event.currentTarget;

    const settings = {};

    $$(
      '[data-config-v2]',
      form,
    ).forEach(
      (input) => {
        const key =
          input.dataset
            .configV2;

        settings[key] =
          key.endsWith(
            '_cents',
          )
            ? configCentsFromReais(
              input.value,
            )
            : input.value;
      },
    );

    const button =
      $('button[type="submit"]', form);

    if (button) {
      button.disabled =
        true;

      button.textContent =
        'Salvando...';
    }

    try {
      const data =
        await api(
          '/api/admin/settings',
          {
            method:
              'PUT',

            body:
              JSON.stringify({
                settings,
              }),
          },
        );

      renderSettingsV2(
        data.settings
        || settings,
      );

      toast(
        'Configurações salvas.',
      );
    } catch (
      error
    ) {
      toast(
        error.message,
        'error',
      );

      /*
       * Reinstala o listener se o save falhar.
       */
      form.addEventListener(
        'submit',
        saveSettingsV2,
        {
          once:
            true,
        },
      );

      if (button) {
        button.disabled =
          false;

        button.textContent =
          'Salvar configurações';
      }
    }
  }

  function installSettingsV2() {
    const tabButton =
      $('[data-tab="settings"]');

    if (!tabButton) {
      return;
    }

    tabButton.addEventListener(
      'click',
      (
        event,
      ) => {
        /*
         * Intercepta apenas a aba Configurações.
         * O admin antigo continua responsável
         * por Pedidos/Termos legados.
         */
        event.preventDefault();
        event.stopImmediatePropagation();

        showSettingsV2Tab();
        loadSettingsV2();
      },
      true,
    );
  }


  function closeBriefingPreview() {
    $('#v5BriefingBackdrop')
      ?.remove();
  }

  async function openBriefingPreview(
    order,
  ) {
    closeBriefingPreview();

    const briefing =
      buildProjectBriefing(
        order,
      );

    document.body
      .insertAdjacentHTML(
        'beforeend',
        `
          <div
            id="v5BriefingBackdrop"
            class="v5-briefing-backdrop"
          >
            <section
              class="v5-briefing-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="v5BriefingTitle"
            >
              <header
                class="v5-briefing-head"
              >
                <div>
                  <h3
                    id="v5BriefingTitle"
                  >
                    Briefing completo
                  </h3>

                  <p>
                    Confira tudo antes de copiar ou iniciar o projeto.
                  </p>
                </div>

                <button
                  type="button"
                  class="v5-briefing-close"
                  id="v5BriefingClose"
                  aria-label="Fechar"
                >
                  ×
                </button>
              </header>

              <div
                class="v5-briefing-body"
              >
                <pre
                  class="v5-briefing-pre"
                >${esc(briefing)}</pre>
              </div>

              <div
                class="v5-briefing-actions"
              >
                <button
                  type="button"
                  class="btn btn-secondary"
                  id="v5BriefingCopy"
                >
                  Copiar briefing
                </button>

                <button
                  type="button"
                  class="btn btn-primary"
                  id="v5BriefingDone"
                >
                  Fechar
                </button>
              </div>
            </section>
          </div>
        `,
      );

    $('#v5BriefingClose')
      ?.addEventListener(
        'click',
        closeBriefingPreview,
      );

    $('#v5BriefingDone')
      ?.addEventListener(
        'click',
        closeBriefingPreview,
      );

    $('#v5BriefingBackdrop')
      ?.addEventListener(
        'click',
        (
          event,
        ) => {
          if (
            event.target?.id
            === 'v5BriefingBackdrop'
          ) {
            closeBriefingPreview();
          }
        },
      );

    $('#v5BriefingCopy')
      ?.addEventListener(
        'click',
        async (
          event,
        ) => {
          const button =
            event.currentTarget;

          try {
            await copyText(
              briefing,
            );

            button.textContent =
              'Briefing copiado ✓';

            toast(
              'Briefing copiado. Agora é só colar no ChatGPT.',
            );

            setTimeout(
              () => {
                button.textContent =
                  'Copiar briefing';
              },
              2200,
            );
          } catch (
            error
          ) {
            toast(
              'Não foi possível copiar o briefing.',
              'error',
            );
          }
        },
      );
  }

  /* ==================================================
     API
  ================================================== */

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
      if (
        response.status
        === 401
      ) {
        showAuthGate();
      }

      const error =
        new Error(
          data.error
          || 'Não foi possível concluir a ação.',
        );

      error.status =
        response.status;

      error.data =
        data;

      throw error;
    }

    return data;
  }

  /* ==================================================
     FEEDBACK
  ================================================== */

  function toast(
    message,
    type = 'success',
  ) {
    const element =
      $('#adminToast');

    if (!element) {
      return;
    }

    element.textContent =
      message;

    element.className =
      `admin-toast ${
        type === 'error'
          ? 'v5-error'
          : 'v5-success'
      }`;

    element.classList
      .remove(
        'hidden',
      );

    setTimeout(
      () => {
        element.classList
          .add(
            'hidden',
          );
      },
      2800,
    );
  }

  /* ==================================================
     CSS LOCAL DA CAMADA V5
  ================================================== */

  function installStyles() {
    if (
      $('#adminWorkflowV5Styles')
    ) {
      return;
    }

    const style =
      document.createElement(
        'style',
      );

    style.id =
      'adminWorkflowV5Styles';

    style.textContent = `
      #kpis[style*="display: none"],
      #ordersList[style*="display: none"]{
        display:none !important;
      }

      .v5-dashboard-grid{
        display:grid;
        grid-template-columns:repeat(5,minmax(0,1fr));
        gap:12px;
        margin:0 0 18px;
      }

      .v5-dashboard-card{
        appearance:none;
        border:1px solid rgba(25,25,25,.09);
        background:#fff;
        border-radius:18px;
        padding:16px;
        text-align:left;
        cursor:pointer;
        box-shadow:0 8px 24px rgba(0,0,0,.04);
      }

      .v5-dashboard-card span{
        display:block;
        font-size:12px;
        opacity:.68;
        margin-bottom:6px;
      }

      .v5-dashboard-card strong{
        display:block;
        font-size:28px;
        line-height:1;
      }

      .v5-dashboard-card small{
        display:block;
        margin-top:7px;
        opacity:.62;
      }

      .v5-filter-row{
        display:flex;
        gap:8px;
        flex-wrap:wrap;
        margin:12px 0 18px;
      }

      .v5-filter-chip{
        border:1px solid rgba(25,25,25,.12);
        background:#fff;
        border-radius:999px;
        padding:9px 12px;
        cursor:pointer;
        font:inherit;
      }

      .v5-filter-chip.active{
        border-color:#1f1f1f;
        background:#1f1f1f;
        color:#fff;
      }

      .v5-orders-grid{
        display:grid;
        gap:12px;
      }

      .v5-order-card{
        border:1px solid rgba(25,25,25,.09);
        background:#fff;
        border-radius:18px;
        padding:16px;
        box-shadow:0 8px 24px rgba(0,0,0,.035);
      }

      .v5-order-card.is-today{
        outline:2px solid rgba(206,90,60,.22);
      }

      .v5-card-head{
        display:flex;
        gap:12px;
        justify-content:space-between;
        align-items:flex-start;
      }

      .v5-card-head h3{
        margin:0 0 4px;
        font-size:18px;
      }

      .v5-card-code{
        font-size:12px;
        opacity:.58;
      }

      .v5-card-badges{
        display:flex;
        gap:6px;
        flex-wrap:wrap;
        justify-content:flex-end;
      }

      .v5-badge{
        display:inline-flex;
        align-items:center;
        border-radius:999px;
        padding:6px 9px;
        font-size:11px;
        font-weight:700;
        background:#f2f2f2;
      }

      .v5-badge.status-new{background:#eef4ff}
      .v5-badge.status-producing{background:#fff4dc}
      .v5-badge.status-revisions{background:#f8eefe}
      .v5-badge.status-finished{background:#eaf7ee}
      .v5-badge.status-cancelled{background:#f4eeee}
      .v5-badge.payment-pending{background:#fff2e9}
      .v5-badge.payment-paid{background:#e9f7ef}
      .v5-badge.portfolio-yes{background:#e9f7ef}
      .v5-badge.portfolio-no{background:#f4eeee}

      .v5-card-grid{
        display:grid;
        grid-template-columns:repeat(3,minmax(0,1fr));
        gap:10px 16px;
        margin:15px 0;
      }

      .v5-card-field span{
        display:block;
        font-size:11px;
        opacity:.58;
        margin-bottom:3px;
      }

      .v5-card-field strong{
        display:block;
        font-size:13px;
      }

      .v5-next-action{
        border-radius:12px;
        background:#f7f5f2;
        padding:11px 12px;
        margin-top:8px;
        font-size:13px;
      }

      .v5-next-action span{
        opacity:.62;
      }

      .v5-card-actions{
        display:flex;
        gap:8px;
        flex-wrap:wrap;
        margin-top:12px;
      }

      .v5-card-actions select{
        min-height:38px;
        border-radius:10px;
        border:1px solid rgba(25,25,25,.12);
        padding:0 9px;
        background:#fff;
      }

      .v5-empty{
        border:1px dashed rgba(25,25,25,.18);
        padding:28px;
        border-radius:16px;
        text-align:center;
        opacity:.65;
      }

      .v5-detail-grid{
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:12px;
      }

      .v5-detail-block{
        border:1px solid rgba(25,25,25,.09);
        border-radius:14px;
        padding:12px;
      }

      .v5-detail-block span{
        display:block;
        font-size:11px;
        opacity:.58;
        margin-bottom:4px;
      }

      .v5-detail-actions{
        display:flex;
        gap:8px;
        flex-wrap:wrap;
        margin-top:16px;
      }

      .v5-copy-briefing{
        min-width:170px;
      }

      .v5-view-briefing{
        min-width:160px;
      }

      .v5-dashboard-card.is-new-orders{
        border-color:rgba(55,95,180,.20);
        background:#f7f9ff;
      }

      .v5-briefing-backdrop{
        position:fixed;
        inset:0;
        z-index:9998;
        background:rgba(20,16,14,.48);
        display:grid;
        place-items:center;
        padding:16px;
      }

      .v5-briefing-modal{
        width:min(920px,100%);
        max-height:calc(100vh - 32px);
        overflow:auto;
        border-radius:22px;
        background:#fffaf6;
        box-shadow:0 24px 80px rgba(0,0,0,.22);
        border:1px solid rgba(55,42,36,.08);
      }

      .v5-briefing-head{
        position:sticky;
        top:0;
        z-index:2;
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:14px;
        padding:18px 20px;
        background:rgba(255,250,246,.96);
        border-bottom:1px solid rgba(55,42,36,.08);
        backdrop-filter:blur(10px);
      }

      .v5-briefing-head h3{
        margin:0;
      }

      .v5-briefing-head p{
        margin:6px 0 0;
        color:#6e6158;
        font-size:13px;
      }

      .v5-briefing-close{
        width:38px;
        height:38px;
        border:none;
        border-radius:999px;
        background:#f0e7df;
        cursor:pointer;
        font-size:22px;
        line-height:1;
      }

      .v5-briefing-body{
        padding:18px 20px 20px;
      }

      .v5-briefing-pre{
        margin:0;
        white-space:pre-wrap;
        word-break:break-word;
        background:#fff;
        border:1px solid rgba(55,42,36,.08);
        border-radius:16px;
        padding:16px;
        font:500 13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
        color:#332a24;
      }

      .v5-briefing-actions{
        display:flex;
        justify-content:flex-end;
        gap:10px;
        flex-wrap:wrap;
        padding:0 20px 20px;
      }

      .v5-cancel-box{
        margin-top:16px;
        border-top:1px solid rgba(25,25,25,.09);
        padding-top:14px;
      }

      .v5-cancel-box select,
      .v5-cancel-box textarea{
        width:100%;
        margin-top:8px;
      }

      .v5-cancel-box textarea{
        min-height:80px;
      }

      .admin-auth-gate{
        position:fixed;
        inset:0;
        z-index:9999;
        display:grid;
        place-items:center;
        padding:20px;
        background:rgba(247,245,242,.97);
      }

      .admin-auth-gate.hidden{
        display:none;
      }

      .admin-auth-card{
        width:min(420px,100%);
        background:#fff;
        border-radius:24px;
        padding:24px;
        box-shadow:0 24px 70px rgba(0,0,0,.10);
      }

      .admin-auth-mark{
        width:46px;
        height:46px;
        border-radius:14px;
        display:grid;
        place-items:center;
        background:#1f1f1f;
        color:#fff;
        font-weight:800;
      }

      .admin-auth-form{
        display:grid;
        gap:10px;
        margin-top:18px;
      }

      .admin-auth-form input{
        min-height:44px;
      }

      .admin-auth-message{
        margin-top:10px;
        font-size:13px;
      }

      @media(max-width:900px){
        .v5-dashboard-grid{
          grid-template-columns:repeat(2,minmax(0,1fr));
        }

        .v5-card-grid{
          grid-template-columns:repeat(2,minmax(0,1fr));
        }
      }

      @media(max-width:620px){
        .v5-dashboard-grid,
        .v5-card-grid,
        .v5-detail-grid{
          grid-template-columns:1fr;
        }

        .v5-card-head{
          display:block;
        }

        .v5-card-badges{
          justify-content:flex-start;
          margin-top:10px;
        }
      }
    `;

    document.head
      .appendChild(
        style,
      );
  }

  /* ==================================================
     LOGIN
  ================================================== */

  function authGateHtml() {
    return `
      <div
        id="adminAuthGate"
        class="admin-auth-gate"
      >
        <section
          class="admin-auth-card"
        >
          <div
            class="admin-auth-mark"
            aria-hidden="true"
          >
            L
          </div>

          <span
            class="section-eyebrow"
          >
            Libri Convites
          </span>

          <h1>
            Central de Produção
          </h1>

          <p>
            Digite a senha administrativa para acessar os pedidos.
          </p>

          <form
            id="adminAuthForm"
            class="admin-auth-form"
          >
            <label
              for="adminPassword"
            >
              Senha
            </label>

            <input
              id="adminPassword"
              type="password"
              autocomplete="current-password"
              required
              autofocus
            >

            <button
              id="adminLoginButton"
              class="btn btn-primary"
              type="submit"
            >
              Entrar
            </button>
          </form>

          <div
            id="adminAuthMessage"
            class="admin-auth-message"
            aria-live="polite"
          ></div>
        </section>
      </div>
    `;
  }

  function installAuthGate() {
    if (
      $('#adminAuthGate')
    ) {
      return;
    }

    document.body
      .insertAdjacentHTML(
        'afterbegin',
        authGateHtml(),
      );

    $('#adminAuthForm')
      ?.addEventListener(
        'submit',
        login,
      );
  }

  function showAuthGate() {
    installAuthGate();

    $('#adminAuthGate')
      ?.classList
      .remove(
        'hidden',
      );

    document.body
      .classList
      .add(
        'admin-locked',
      );

    state.authenticated =
      false;
  }

  function hideAuthGate() {
    $('#adminAuthGate')
      ?.classList
      .add(
        'hidden',
      );

    document.body
      .classList
      .remove(
        'admin-locked',
      );

    state.authenticated =
      true;
  }

  async function login(
    event,
  ) {
    event.preventDefault();

    const password =
      $('#adminPassword')
        ?.value
      || '';

    const button =
      $('#adminLoginButton');

    const message =
      $('#adminAuthMessage');

    if (!password) {
      if (message) {
        message.textContent =
          'Digite a senha.';
      }

      return;
    }

    if (button) {
      button.disabled =
        true;

      button.textContent =
        'Entrando...';
    }

    try {
      await api(
        '/api/admin/auth/login',
        {
          method:
            'POST',

          body:
            JSON.stringify({
              password,
            }),
        },
      );

      hideAuthGate();

      installSessionControls();

      await refreshAll();

      toast(
        'Painel liberado.',
      );
    } catch (
      error
    ) {
      if (message) {
        message.textContent =
          error.message;
      }
    } finally {
      if (button) {
        button.disabled =
          false;

        button.textContent =
          'Entrar';
      }
    }
  }

  async function logout() {
    try {
      await api(
        '/api/admin/auth/logout',
        {
          method:
            'POST',

          body:
            '{}',
        },
      );
    } catch {
      // Sessão já pode ter expirado.
    }

    showAuthGate();
  }

  async function checkAuth() {
    installAuthGate();

    try {
      const data =
        await api(
          '/api/admin/auth/status',
        );

      state.authConfigured =
        data.configured
        === true;

      if (
        data.authenticated
        === true
      ) {
        hideAuthGate();

        installSessionControls();

        await refreshAll();

        return;
      }

      showAuthGate();

      if (
        data.configured
        !== true
      ) {
        const message =
          $('#adminAuthMessage');

        if (message) {
          message.textContent =
            'A senha administrativa ainda precisa ser configurada no Cloudflare.';
        }
      }
    } catch (
      error
    ) {
      showAuthGate();

      const message =
        $('#adminAuthMessage');

      if (message) {
        message.textContent =
          error.message;
      }
    }
  }

  function installSessionControls() {
    if (
      $('#adminLogoutV5')
    ) {
      return;
    }

    const top =
      $('.admin-top');

    if (!top) {
      return;
    }

    const wrap =
      document.createElement(
        'div',
      );

    wrap.className =
      'admin-session-actions';

    wrap.innerHTML = `
      <span
        class="admin-session-badge"
      >
        Sessão ativa
      </span>

      <button
        id="adminLogoutV5"
        class="btn btn-secondary btn-small"
        type="button"
      >
        Sair
      </button>
    `;

    top.appendChild(
      wrap,
    );

    $('#adminLogoutV5')
      ?.addEventListener(
        'click',
        logout,
      );
  }

  /* ==================================================
     DASHBOARD
  ================================================== */

  function renderDashboard() {
    const kpis =
      $('#v5Kpis');

    if (!kpis) {
      return;
    }

    const dashboard =
      state.dashboard
      || {};

    kpis.className =
      'v5-dashboard-grid';

    kpis.innerHTML = `
      <button
        type="button"
        class="v5-dashboard-card is-new-orders"
        data-dashboard-filter="new"
      >
        <span>
          Novos pedidos
        </span>

        <strong>
          ${Number(
            dashboard.newOrders
            || 0,
          )}
        </strong>

        <small>
          Mais recentes primeiro
        </small>
      </button>

      <button
        type="button"
        class="v5-dashboard-card"
        data-dashboard-filter="today"
      >
        <span>
          Festas hoje
        </span>

        <strong>
          ${Number(
            dashboard.partiesToday
            || 0,
          )}
        </strong>

        <small>
          ${
            Number(
              dashboard.partiesTodayAttention
              || 0,
            )
          } precisam de atenção
        </small>
      </button>

      <button
        type="button"
        class="v5-dashboard-card"
        data-dashboard-upcoming
      >
        <span>
          Próximas festas
        </span>

        <strong>
          ${Number(
            dashboard.upcomingParties
            || 0,
          )}
        </strong>

        <small>
          Ordenadas pela data da festa
        </small>
      </button>

      <button
        type="button"
        class="v5-dashboard-card"
        data-dashboard-filter="payment_pending"
      >
        <span>
          Pagamentos pendentes
        </span>

        <strong>
          ${Number(
            dashboard.pendingPayments
            || 0,
          )}
        </strong>

        <small>
          Controle separado da produção
        </small>
      </button>

      <button
        type="button"
        class="v5-dashboard-card"
        data-dashboard-filter="producing"
      >
        <span>
          Em produção
        </span>

        <strong>
          ${
            state.orders.filter(
              (order) =>
                statusOf(order)
                === 'producing',
            ).length
          }
        </strong>

        <small>
          Festa mais próxima primeiro
        </small>
      </button>
    `;

    $$(
      '[data-dashboard-filter]',
      kpis,
    ).forEach(
      (button) => {
        button.addEventListener(
          'click',
          () => {
            setFilter(
              button.dataset
                .dashboardFilter
              || '',
            );
          },
        );
      },
    );

    $('[data-dashboard-upcoming]', kpis)
      ?.addEventListener(
        'click',
        () => {
          state.activeFilter =
            'upcoming';

          renderFilters();

          renderOrders();
        },
      );
  }

  /* ==================================================
     CONTAINERS EXCLUSIVOS DO V5

     O admin.js antigo continua carregado para
     Configurações, Termos e funções legadas.
     Por isso ele mantém #kpis e #ordersList.

     O V5 NÃO escreve nesses elementos.
  ================================================== */

  function installV5Containers() {
    const legacyKpis =
      $('#kpis');

    const legacyOrders =
      $('#ordersList');

    if (
      legacyKpis
      && !$('#v5Kpis')
    ) {
      legacyKpis.style
        .display =
          'none';

      const v5Kpis =
        document.createElement(
          'div',
        );

      v5Kpis.id =
        'v5Kpis';

      v5Kpis.className =
        'v5-dashboard-grid';

      v5Kpis.setAttribute(
        'aria-live',
        'polite',
      );

      legacyKpis
        .insertAdjacentElement(
          'afterend',
          v5Kpis,
        );
    }

    if (
      legacyOrders
      && !$('#v5OrdersList')
    ) {
      legacyOrders.style
        .display =
          'none';

      const v5Orders =
        document.createElement(
          'div',
        );

      v5Orders.id =
        'v5OrdersList';

      v5Orders.className =
        'v5-orders-grid';

      v5Orders.setAttribute(
        'aria-live',
        'polite',
      );

      legacyOrders
        .insertAdjacentElement(
          'afterend',
          v5Orders,
        );
    }
  }

  /* ==================================================
     TOOLBAR
  ================================================== */

  function installToolbar() {
    const toolbar =
      $('.orders-toolbar');

    if (!toolbar) {
      return;
    }

    $('#statusFilter')
      ?.classList
      .add(
        'hidden',
      );

    toolbar.classList
      .add(
        'production-toolbar',
      );

    if (
      !$('#v5Filters')
    ) {
      toolbar
        .insertAdjacentHTML(
          'afterend',
          `
            <div
              id="v5Filters"
              class="v5-filter-row"
            ></div>
          `,
        );
    }

    const search =
      $('#search');

    if (search) {
      search.placeholder =
        'Buscar criança, cliente, telefone, tema ou pedido';

      search.addEventListener(
        'input',
        () => {
          state.search =
            normalizeText(
              search.value,
            )
              .toLowerCase();

          renderOrders();
        },
      );
    }

    renderFilters();
  }

  function renderFilters() {
    const wrap =
      $('#v5Filters');

    if (!wrap) {
      return;
    }

    wrap.innerHTML =
      FILTERS.map(
        ([
          value,
          label,
        ]) => `
          <button
            type="button"
            class="v5-filter-chip ${
              state.activeFilter
              === value
                ? 'active'
                : ''
            }"
            data-v5-filter="${esc(
              value,
            )}"
          >
            ${esc(label)}
          </button>
        `,
      ).join('');

    $$(
      '[data-v5-filter]',
      wrap,
    ).forEach(
      (button) => {
        button.addEventListener(
          'click',
          async () => {
            const value =
              button.dataset
                .v5Filter
              || '';

            await setFilter(
              value,
            );
          },
        );
      },
    );
  }

  async function setFilter(
    value,
  ) {
    state.activeFilter =
      value;

    renderFilters();

    if (
      value === 'cancelled'
      || value === 'new'
    ) {
      await loadOrders(
        value,
      );
    } else {
      await loadOrders(
        '',
      );
    }

    renderOrders();
  }

  /* ==================================================
     CARDS
  ================================================== */

  function matchesSearch(
    order,
  ) {
    if (
      !state.search
    ) {
      return true;
    }

    const haystack = [
      order.orderCode,
      order.order_code,
      order.customerName,
      order.customer_name,
      order.whatsapp,
      order.childName,
      order.honoreeName,
      order.honoree_name,
      order.theme,
    ]
      .map(
        normalizeText,
      )
      .join(' ')
      .toLowerCase();

    return haystack
      .includes(
        state.search,
      );
  }

  function matchesFilter(
    order,
  ) {
    const filter =
      state.activeFilter;

    if (!filter) {
      return statusOf(order)
        !== 'cancelled';
    }

    if (
      filter === 'cancelled'
    ) {
      return statusOf(order)
        === 'cancelled';
    }

    if (
      filter === 'new'
    ) {
      return statusOf(order)
        === 'new';
    }

    if (
      filter === 'today'
    ) {
      return sameDay(
        order,
        todaySaoPaulo(),
      );
    }

    if (
      filter === 'week'
    ) {
      const [
        start,
        end,
      ] =
        startOfWeekWindow();

      const date =
        eventDateOf(
          order,
        );

      return (
        date
        && date >= start
        && date <= end
      );
    }

    if (
      filter === 'upcoming'
    ) {
      const date =
        eventDateOf(
          order,
        );

      return (
        date
        && date > todaySaoPaulo()
        && statusOf(order)
          !== 'cancelled'
      );
    }

    if (
      filter
      === 'payment_pending'
    ) {
      return (
        paymentOf(order)
        === 'pending'
        && statusOf(order)
          !== 'cancelled'
      );
    }

    if (
      filter === 'producing'
      || filter === 'revisions'
      || filter === 'finished'
    ) {
      return statusOf(order)
        === filter;
    }

    return true;
  }

  function sortOrders(
    orders,
  ) {
    const filter =
      state.activeFilter;

    if (
      filter === 'producing'
      || filter === 'revisions'
      || filter === 'today'
      || filter === 'week'
      || filter === 'upcoming'
    ) {
      return orders.sort(
        (
          a,
          b,
        ) =>
          eventTimestamp(a)
          - eventTimestamp(b),
      );
    }

    return orders;
  }

  function cardHtml(
    order,
  ) {
    const status =
      statusOf(
        order,
      );

    const payment =
      paymentOf(
        order,
      );

    const child =
      order.childName
      || order.displayName
      || order.display_name
      || order.honoreeName
      || order.honoree_name
      || 'Sem nome';

    const customer =
      order.customerName
      || order.customer_name
      || 'Não informado';

    const date =
      eventDateOf(
        order,
      );

    const isToday =
      sameDay(
        order,
        todaySaoPaulo(),
      );

    const id =
      Number(
        order.id,
      );

    return `
      <article
        class="v5-order-card ${
          isToday
          && status
            !== 'finished'
          && status
            !== 'cancelled'
            ? 'is-today'
            : ''
        }"
        data-v5-order="${id}"
      >
        <div
          class="v5-card-head"
        >
          <div>
            <h3>
              ${esc(child)}
            </h3>

            <div
              class="v5-card-code"
            >
              ${esc(
                order.orderCode
                || order.order_code
                || '',
              )}
            </div>
          </div>

          <div
            class="v5-card-badges"
          >
            ${
              isToday
              && status
                !== 'finished'
              && status
                !== 'cancelled'
                ? `
                  <span
                    class="v5-badge"
                  >
                    Festa hoje
                  </span>
                `
                : ''
            }

            <span
              class="v5-badge status-${esc(status)}"
            >
              ${esc(
                STATUS_LABELS[status]
                || status,
              )}
            </span>

            <span
              class="v5-badge payment-${esc(payment)}"
            >
              ${esc(
                PAYMENT_LABELS[payment]
                || payment,
              )}
            </span>

            <span
              class="v5-badge ${
                portfolioConsentLabel(order)
                === 'Autorizada'
                  ? 'portfolio-yes'
                  : 'portfolio-no'
              }"
            >
              ${
                portfolioConsentLabel(order)
                === 'Autorizada'
                  ? 'Divulgação autorizada'
                  : 'Sem divulgação'
              }
            </span>
          </div>
        </div>

        <div
          class="v5-card-grid"
        >
          <div
            class="v5-card-field"
          >
            <span>
              Cliente
            </span>

            <strong>
              ${esc(customer)}
            </strong>
          </div>

          <div
            class="v5-card-field"
          >
            <span>
              Festa
            </span>

            <strong>
              ${esc(
                formatDate(
                  date,
                ),
              )}
            </strong>
          </div>

          <div
            class="v5-card-field"
          >
            <span>
              Tema
            </span>

            <strong>
              ${esc(
                order.theme
                || 'Não informado',
              )}
            </strong>
          </div>

          <div
            class="v5-card-field"
          >
            <span>
              Produto
            </span>

            <strong>
              ${esc(
                productLabel(
                  order,
                ),
              )}
            </strong>
          </div>

          <div
            class="v5-card-field"
          >
            <span>
              Total
            </span>

            <strong>
              ${esc(
                money(
                  order.totalCents
                  ?? order.total_cents
                  ?? 0,
                ),
              )}
            </strong>
          </div>

          <div
            class="v5-card-field"
          >
            <span>
              WhatsApp
            </span>

            <strong>
              ${esc(
                order.whatsapp
                || 'Não informado',
              )}
            </strong>
          </div>
        </div>

        <div
          class="v5-next-action"
        >
          <span>
            Próxima ação:
          </span>

          <strong>
            ${esc(
              nextAction(
                order,
              ),
            )}
          </strong>
        </div>

        <div
          class="v5-card-actions"
        >
          <button
            type="button"
            class="btn btn-primary btn-small"
            data-v5-open="${id}"
          >
            Abrir pedido
          </button>

          ${
            status
            !== 'cancelled'
              ? `
                <select
                  data-v5-status="${id}"
                  aria-label="Status de produção"
                >
                  ${[
                    [
                      'new',
                      'Novo',
                    ],
                    [
                      'producing',
                      'Produção',
                    ],
                    [
                      'revisions',
                      'Ajustes',
                    ],
                    [
                      'finished',
                      'Finalizado',
                    ],
                  ].map(
                    ([
                      value,
                      label,
                    ]) => `
                      <option
                        value="${value}"
                        ${
                          status
                          === value
                            ? 'selected'
                            : ''
                        }
                      >
                        ${label}
                      </option>
                    `,
                  ).join('')}
                </select>

                <select
                  data-v5-payment="${id}"
                  aria-label="Status de pagamento"
                >
                  <option
                    value="pending"
                    ${
                      payment
                      === 'pending'
                        ? 'selected'
                        : ''
                    }
                  >
                    Pagamento pendente
                  </option>

                  <option
                    value="paid"
                    ${
                      payment
                      === 'paid'
                        ? 'selected'
                        : ''
                    }
                  >
                    Pago
                  </option>
                </select>

                <button
                  type="button"
                  class="btn btn-secondary btn-small"
                  data-v5-cancel="${id}"
                >
                  Cancelar pedido
                </button>
              `
              : ''
          }
        </div>
      </article>
    `;
  }

  function renderOrders() {
    const list =
      $('#v5OrdersList');

    if (!list) {
      return;
    }

    const filtered =
      sortOrders(
        state.orders
          .filter(
            matchesSearch,
          )
          .filter(
            matchesFilter,
          ),
      );

    list.className =
      'v5-orders-grid';

    if (
      !filtered.length
    ) {
      list.innerHTML = `
        <div
          class="v5-empty"
        >
          Nenhum pedido encontrado neste filtro.
        </div>
      `;

      return;
    }

    list.innerHTML =
      filtered
        .map(
          cardHtml,
        )
        .join('');

    bindCardActions();
  }

  function bindCardActions() {
    $$(
      '[data-v5-open]',
    ).forEach(
      (button) => {
        button.addEventListener(
          'click',
          () => {
            openOrder(
              Number(
                button.dataset
                  .v5Open,
              ),
            );
          },
        );
      },
    );

    $$(
      '[data-v5-status]',
    ).forEach(
      (select) => {
        select.addEventListener(
          'change',
          async () => {
            const id =
              Number(
                select.dataset
                  .v5Status,
              );

            const status =
              select.value;

            try {
              await api(
                `/api/admin/orders/${id}/workflow`,
                {
                  method:
                    'PATCH',

                  body:
                    JSON.stringify({
                      status,
                    }),
                },
              );

              toast(
                'Status atualizado.',
              );

              await refreshAll();
            } catch (
              error
            ) {
              toast(
                error.message,
                'error',
              );

              await refreshAll();
            }
          },
        );
      },
    );

    $$(
      '[data-v5-payment]',
    ).forEach(
      (select) => {
        select.addEventListener(
          'change',
          async () => {
            const id =
              Number(
                select.dataset
                  .v5Payment,
              );

            try {
              await api(
                `/api/admin/orders/${id}/payment`,
                {
                  method:
                    'PATCH',

                  body:
                    JSON.stringify({
                      paymentStatus:
                        select.value,
                    }),
                },
              );

              toast(
                'Pagamento atualizado.',
              );

              await refreshAll();
            } catch (
              error
            ) {
              toast(
                error.message,
                'error',
              );

              await refreshAll();
            }
          },
        );
      },
    );

    $$(
      '[data-v5-cancel]',
    ).forEach(
      (button) => {
        button.addEventListener(
          'click',
          () => {
            openCancel(
              Number(
                button.dataset
                  .v5Cancel,
              ),
            );
          },
        );
      },
    );
  }

  /* ==================================================
     DETALHE
  ================================================== */

  function detailField(
    label,
    value,
  ) {
    return `
      <div
        class="v5-detail-block"
      >
        <span>
          ${esc(label)}
        </span>

        <strong>
          ${esc(
            value
            || 'Não informado',
          )}
        </strong>
      </div>
    `;
  }

  async function openOrder(
    id,
  ) {
    try {
      const data =
        await api(
          `/api/admin/orders/${id}`,
        );

      const order =
        data.order;

      state.currentOrder =
        order;

      const modal =
        $('#adminModal');

      const title =
        $('#detailTitle');

      const body =
        $('#detailBody');

      if (
        !modal
        || !title
        || !body
      ) {
        return;
      }

      title.textContent =
        order.order_code
        || `Pedido ${id}`;

      const status =
        statusOf(
          order,
        );

      const payment =
        paymentOf(
          order,
        );

      body.innerHTML = `
        <div
          class="v5-detail-grid"
        >
          ${detailField(
            'Criança / homenageado(a)',
            order.display_name
            || order.honoree_name,
          )}

          ${detailField(
            'Cliente',
            order.customer_name,
          )}

          ${detailField(
            'WhatsApp',
            order.whatsapp,
          )}

          ${detailField(
            'Festa',
            formatDate(
              order.event_date,
            )
            + (
              order.event_time
                ? ` às ${order.event_time}`
                : ''
            ),
          )}

          ${detailField(
            'Tema',
            order.theme,
          )}

          ${detailField(
            'Produto',
            productLabel(
              order,
            ),
          )}

          ${detailField(
            'Produção',
            STATUS_LABELS[status]
            || status,
          )}

          ${detailField(
            'Pagamento',
            PAYMENT_LABELS[payment]
            || payment,
          )}

          ${detailField(
            'Divulgação',
            portfolioConsentLabel(
              order,
            ),
          )}

          ${detailField(
            'Local',
            order.venue_name,
          )}

          ${detailField(
            'Endereço',
            order.venue_address,
          )}

          ${detailField(
            'Total',
            money(
              order.total_cents,
            ),
          )}

          ${detailField(
            'Próxima ação',
            nextAction(
              order,
            ),
          )}
        </div>

        <div
          class="v5-next-action"
          style="margin-top:16px"
        >
          <strong>
            Checklist disponível hoje
          </strong>

          <div
            style="margin-top:6px"
          >
            Briefing ${
              order.briefing_json
                ? '✓'
                : '○'
            }
            &nbsp;•&nbsp;
            Fotos ${
              order.photos_status
              === 'approved'
                ? '✓'
                : '○'
            }
            &nbsp;•&nbsp;
            Entrada ${
              order.entry_status
              === 'confirmed'
                ? '✓'
                : '○'
            }
            &nbsp;•&nbsp;
            Convite ${
              order.invitation_status
              === 'approved'
                ? '✓'
                : '○'
            }
            &nbsp;•&nbsp;
            Final ${
              status
              === 'finished'
                ? '✓'
                : '○'
            }
          </div>
        </div>

        <div
          class="v5-detail-actions"
        >
          <button
            type="button"
            class="btn btn-primary v5-copy-briefing"
            data-detail-copy-briefing="${id}"
          >
            Copiar briefing
          </button>

          <button
            type="button"
            class="btn btn-secondary v5-view-briefing"
            data-detail-view-briefing="${id}"
          >
            Ver briefing
          </button>

          ${
            status
            !== 'cancelled'
              ? `
                <button
                  type="button"
                  class="btn btn-secondary"
                  data-detail-payment="${id}"
                >
                  ${
                    payment
                    === 'paid'
                      ? 'Marcar pagamento pendente'
                      : 'Marcar como pago'
                  }
                </button>

                <button
                  type="button"
                  class="btn btn-secondary"
                  data-detail-cancel="${id}"
                >
                  Cancelar pedido
                </button>
              `
              : `
                <span>
                  Motivo do cancelamento:
                  <strong>
                    ${esc(
                      order.cancel_reason
                      || 'Não informado',
                    )}
                  </strong>
                </span>
              `
          }
        </div>
      `;

      modal.classList
        .remove(
          'hidden',
        );

      $('[data-detail-view-briefing]', body)
        ?.addEventListener(
          'click',
          async () => {
            await openBriefingPreview(
              order,
            );
          },
        );

      $('[data-detail-copy-briefing]', body)
        ?.addEventListener(
          'click',
          async (
            event,
          ) => {
            const button =
              event.currentTarget;

            try {
              await copyText(
                buildProjectBriefing(
                  order,
                ),
              );

              button.textContent =
                'Briefing copiado ✓';

              toast(
                'Briefing copiado. Agora é só colar no ChatGPT.',
              );

              setTimeout(
                () => {
                  button.textContent =
                    'Copiar briefing';
                },
                2200,
              );
            } catch (
              error
            ) {
              toast(
                'Não foi possível copiar o briefing.',
                'error',
              );

              console.error(
                error,
              );
            }
          },
        );

      $('[data-detail-payment]', body)
        ?.addEventListener(
          'click',
          async () => {
            try {
              await api(
                `/api/admin/orders/${id}/payment`,
                {
                  method:
                    'PATCH',

                  body:
                    JSON.stringify({
                      paymentStatus:
                        payment
                        === 'paid'
                          ? 'pending'
                          : 'paid',
                    }),
                },
              );

              modal.classList
                .add(
                  'hidden',
                );

              toast(
                'Pagamento atualizado.',
              );

              await refreshAll();
            } catch (
              error
            ) {
              toast(
                error.message,
                'error',
              );
            }
          },
        );

      $('[data-detail-cancel]', body)
        ?.addEventListener(
          'click',
          () => {
            modal.classList
              .add(
                'hidden',
              );

            openCancel(
              id,
            );
          },
        );
    } catch (
      error
    ) {
      toast(
        error.message,
        'error',
      );
    }
  }

  /* ==================================================
     CANCELAMENTO
  ================================================== */

  function openCancel(
    id,
  ) {
    const modal =
      $('#infoModal');

    const title =
      $('#infoModalTitle');

    const body =
      $('#infoModalBody');

    if (
      !modal
      || !title
      || !body
    ) {
      return;
    }

    title.textContent =
      'Cancelar pedido';

    body.innerHTML = `
      <div
        class="v5-cancel-box"
      >
        <label>
          Motivo
        </label>

        <select
          id="v5CancelReason"
        >
          <option value="">
            Selecione
          </option>

          <option value="Não realizou pagamento">
            Não realizou pagamento
          </option>

          <option value="Cliente desistiu">
            Cliente desistiu
          </option>

          <option value="Outro">
            Outro
          </option>
        </select>

        <textarea
          id="v5CancelNote"
          class="hidden"
          placeholder="Descreva o motivo"
        ></textarea>

        <div
          class="form-actions"
          style="margin-top:14px"
        >
          <button
            id="v5CancelBack"
            type="button"
            class="btn btn-secondary"
          >
            Voltar
          </button>

          <button
            id="v5CancelConfirm"
            type="button"
            class="btn btn-primary"
          >
            Confirmar cancelamento
          </button>
        </div>
      </div>
    `;

    modal.classList
      .remove(
        'hidden',
      );

    const reason =
      $('#v5CancelReason');

    const note =
      $('#v5CancelNote');

    reason
      ?.addEventListener(
        'change',
        () => {
          note
            ?.classList
            .toggle(
              'hidden',
              reason.value
              !== 'Outro',
            );
        },
      );

    $('#v5CancelBack')
      ?.addEventListener(
        'click',
        () => {
          modal.classList
            .add(
              'hidden',
            );
        },
      );

    $('#v5CancelConfirm')
      ?.addEventListener(
        'click',
        async () => {
          const cancelReason =
            reason?.value
            || '';

          const cancelNote =
            note?.value
            || '';

          try {
            await api(
              `/api/admin/orders/${id}/cancel`,
              {
                method:
                  'PATCH',

                body:
                  JSON.stringify({
                    cancelReason,
                    cancelNote,
                  }),
              },
            );

            modal.classList
              .add(
                'hidden',
              );

            toast(
              'Pedido cancelado.',
            );

            await refreshAll();
          } catch (
            error
          ) {
            toast(
              error.message,
              'error',
            );
          }
        },
      );
  }

  /* ==================================================
     DADOS
  ================================================== */

  async function loadDashboard() {
    const data =
      await api(
        '/api/admin/dashboard-v2',
      );

    state.dashboard =
      data.dashboard
      || {};

    renderDashboard();
  }

  async function loadOrders(
    filter = '',
  ) {
    const params =
      new URLSearchParams();

    if (
      filter
    ) {
      params.set(
        'filter',
        filter,
      );
    }

    const query =
      params.toString();

    const url =
      `/api/admin/orders-v2${
        query
          ? `?${query}`
          : ''
      }`;

    const data =
      await api(
        url,
      );

    state.orders =
      data.orders
      || [];

    renderOrders();
  }

  async function refreshAll() {
    if (
      !state.authenticated
    ) {
      return;
    }

    try {
      await Promise.all([
        loadDashboard(),
        loadOrders(
          state.activeFilter
          === 'cancelled'
          || state.activeFilter
          === 'new'
            ? state.activeFilter
            : '',
        ),
      ]);
    } catch (
      error
    ) {
      if (
        error.status
        !== 401
      ) {
        toast(
          error.message,
          'error',
        );
      }
    }
  }

  /* ==================================================
     EVENTOS
  ================================================== */

  function installEvents() {
    $('#refreshOrders')
      ?.addEventListener(
        'click',
        () => {
          refreshAll();
        },
      );

    $('#closeAdminModal')
      ?.addEventListener(
        'click',
        () => {
          $('#adminModal')
            ?.classList
            .add(
              'hidden',
            );
        },
      );

    $('#closeInfoModal')
      ?.addEventListener(
        'click',
        () => {
          $('#infoModal')
            ?.classList
            .add(
              'hidden',
            );
        },
      );
  }

  /* ==================================================
     INIT
  ================================================== */

  function init() {
    installStyles();

    installAuthGate();

    installV5Containers();

    installToolbar();

    installSettingsV2();

    installEvents();

    /*
     * O admin antigo continua
     * responsável por Configurações,
     * Termos e funções legadas.
     * A aba Pedidos passa a ser
     * renderizada por este V5.
     */
    checkAuth();
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
