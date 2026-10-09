import { syncMercadoPagoOrder } from './v2-mercadopago.js';

import {
  fail,
  nowIso,
  parseJson,
  randomToken,
} from './http.js';

import {
  createV2AdminNotification,
} from './v2-notifications.js';

import { priceWithCardProcessingFee, baseTotalFromSnapshot } from './v2-payment-pricing.js';

const TOKEN_RE =
  /^ord_[a-f0-9]{36}$/;

const MAX_IMAGE_BYTES =
  30 * 1024 * 1024;

const IMAGE_TYPES =
  new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
  ]);

const INTERACTIVE_PRODUCTS =
  new Set([
    'cinematic_interactive',
    'interactive_essential',
    'interactive_animated',
    'interactive_gif',
    'book',
    'infinite',
  ]);

const CINEMATIC_PRODUCTS =
  new Set([
    'cinematic_video',
    'cinematic_interactive',
  ]);

function cleanText(
  value,
  max = 6000,
) {
  return String(
    value ?? '',
  )
    .trim()
    .slice(
      0,
      max,
    );
}

function dateBr(
  value,
) {
  if (!value) {
    return '';
  }

  const date =
    new Date(
      `${value}T12:00:00Z`,
    );

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

function moneyBr(
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

function whatsappUrl(
  number,
  message,
) {
  const digits =
    String(number || '')
      .replace(
        /\D/g,
        '',
      );

  if (!digits) {
    return '';
  }

  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function safeName(
  value,
) {
  return String(
    value || 'arquivo',
  )
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      '',
    )
    .replace(
      /[^a-zA-Z0-9._-]+/g,
      '-',
    )
    .replace(
      /-+/g,
      '-',
    )
    .replace(
      /^[-.]+|[-.]+$/g,
      '',
    )
    .slice(
      0,
      180,
    )
    || 'arquivo';
}

function extensionFromMime(
  type,
) {
  return {
    'image/jpeg':
      '.jpg',
    'image/png':
      '.png',
    'image/webp':
      '.webp',
    'image/heic':
      '.heic',
    'image/heif':
      '.heif',
  }[type] || '';
}

function statusLabel(
  status,
) {
  return {
    awaiting_urgency_decision: 'Encaixe em análise',
    urgency_approved: 'Encaixe aprovado; pagamento disponível',
    awaiting_payment:
      'Aguardando pagamento',
    briefing_pending:
      'Dados da festa pendentes',
    ready_for_production:
      'Pronto para produção',
    in_production:
      'Em produção',
    waiting_customer:
      'Aguardando você',
    adjustments:
      'Em ajustes',
    approved:
      'Aprovado',
    balance_pending:
      'Saldo pendente',
    ready_for_delivery:
      'Pronto para entrega',
    finalized:
      'Finalizado',
    cancelled:
      'Cancelado',
  }[status] || status || '';
}

async function libriWhatsapp(
  db,
) {
  const row =
    await db
      .prepare(
        `
          SELECT value
          FROM v2_settings
          WHERE key = 'libri_whatsapp'
          LIMIT 1
        `,
      )
      .first();

  return String(
    row?.value || '',
  )
    .replace(
      /\D/g,
      '',
    );
}

async function contextByToken(
  db,
  token,
) {
  if (
    !TOKEN_RE.test(
      String(token || ''),
    )
  ) {
    return null;
  }

  const order =
    await db
      .prepare(
        `
          SELECT
            o.id,
            o.order_code,
            o.public_token,
            o.event_type,
            o.event_subtype,
            o.honoree_display_name,
            o.event_date,
            o.status,
            o.next_action,
            o.delivery_start,
            o.delivery_end,
            o.briefing_status,
            o.source,
            o.created_at,
            o.archived_at,
            (SELECT MAX(h.created_at) FROM v2_order_history h
              WHERE h.order_id = o.id AND h.action_code = 'order_unarchived') AS payment_reactivated_at,

            c.name AS customer_name,

            p.total_cents,
            p.pricing_snapshot_json,
            p.payment_method,
            p.deposit_cents,
            p.balance_cents
          FROM v2_orders o
          INNER JOIN v2_customers c
            ON c.id = o.customer_id
          INNER JOIN v2_order_pricing p
            ON p.order_id = o.id
          WHERE o.public_token = ?
          LIMIT 1
        `,
      )
      .bind(token)
      .first();

  if (!order) {
    return null;
  }

  const [
    itemsResult,
    briefing,
    uploadsResult,
  ] =
    await Promise.all([
      db
        .prepare(
          `
            SELECT
              item_type,
              item_code,
              name_snapshot,
              configuration_json
            FROM v2_order_items
            WHERE order_id = ?
            ORDER BY id
          `,
        )
        .bind(order.id)
        .all(),

      db
        .prepare(
          `
            SELECT
              schema_version,
              data_json,
              current_section,
              completion_percent,
              started_at,
              completed_at,
              updated_at
            FROM v2_briefings
            WHERE order_id = ?
            LIMIT 1
          `,
        )
        .bind(order.id)
        .first(),

      db
        .prepare(
          `
            SELECT
              id,
              category,
              field_key,
              original_filename,
              stored_filename,
              mime_type,
              size_bytes,
              note,
              sort_order,
              created_at,
              updated_at
            FROM v2_briefing_uploads
            WHERE order_id = ?
            ORDER BY
              field_key,
              sort_order,
              id
          `,
        )
        .bind(order.id)
        .all(),
    ]);

  const items =
    itemsResult.results || [];

  const productItem =
    items.find(
      (item) =>
        item.item_type === 'product',
    );

  const productConfig =
    parseJson(
      productItem?.configuration_json,
      {},
    );

  return {
    order,

    product: {
      code:
        productConfig.productCode || '',
      variantCode:
        productConfig.variantCode
        || productItem?.item_code
        || '',
      sceneCount:
        productConfig.sceneCount
        ?? null,
      name:
        productItem?.name_snapshot
        || '',
    },

    addons:
      items
        .filter(
          (item) =>
            item.item_type === 'addon',
        )
        .map(
          (item) => ({
            code:
              item.item_code,
            name:
              item.name_snapshot,
          }),
        ),

    briefing: {
      schemaVersion:
        briefing?.schema_version
        || '2.0',
      data:
        parseJson(
          briefing?.data_json,
          {},
        ),
      currentSection:
        briefing?.current_section
        || 'event',
      completionPercent:
        Number(
          briefing?.completion_percent
          || 0,
        ),
      startedAt:
        briefing?.started_at
        || null,
      completedAt:
        briefing?.completed_at
        || null,
      updatedAt:
        briefing?.updated_at
        || null,
    },

    uploads:
      (uploadsResult.results || [])
        .map(
          (row) => ({
            id:
              row.id,
            category:
              row.category,
            fieldKey:
              row.field_key,
            originalFilename:
              row.original_filename,
            storedFilename:
              row.stored_filename,
            mimeType:
              row.mime_type,
            sizeBytes:
              Number(
                row.size_bytes || 0,
              ),
            note:
              row.note || '',
            sortOrder:
              Number(
                row.sort_order || 0,
              ),
            createdAt:
              row.created_at,
            updatedAt:
              row.updated_at,
          }),
        ),
  };
}

function addonMatches(
  context,
  {
    codes = [],
    prefixes = [],
    terms = [],
  },
) {
  return context.addons.some(
    (addon) => {
      const code =
        String(
          addon.code || '',
        ).toLowerCase();

      const name =
        String(
          addon.name || '',
        )
          .toLowerCase()
          .normalize('NFD')
          .replace(
            /[\u0300-\u036f]/g,
            '',
          );

      return codes.some(
        (item) =>
          code === String(item).toLowerCase(),
      )
      || prefixes.some(
        (item) =>
          code.startsWith(
            String(item).toLowerCase(),
          ),
      )
      || terms.some(
        (item) =>
          name.includes(
            String(item)
              .toLowerCase()
              .normalize('NFD')
              .replace(
                /[\u0300-\u036f]/g,
                '',
              ),
          ),
      );
    },
  );
}

function hasMoments(
  context,
) {
  return addonMatches(
    context,
    {
      prefixes: [
        'moments_',
      ],
      terms: [
        'moments',
      ],
    },
  );
}

function hasConfirmation(
  context,
) {
  return addonMatches(
    context,
    {
      codes: [
        'libri_confirmation',
        'confirmation_libri',
        'rsvp_libri',
      ],
      terms: [
        'confirmacao de presenca libri',
        'confirmacao libri',
      ],
    },
  );
}

function hasFilter(
  context,
) {
  return addonMatches(
    context,
    {
      codes: [
        'custom_filter',
      ],
      terms: [
        'filtro personalizado',
      ],
    },
  );
}

function hasSave(
  context,
) {
  return addonMatches(
    context,
    {
      prefixes: [
        'save_',
        'save-the-date',
      ],
      terms: [
        'save the date',
      ],
    },
  );
}

function hasReminder(
  context,
) {
  return addonMatches(
    context,
    {
      prefixes: [
        'reminder_',
        'lembrete_',
      ],
      terms: [
        'lembrete',
      ],
    },
  );
}

function appearanceLabel(
  context,
) {
  switch (
    context.order.event_type
  ) {
    case 'birthday':
      return 'Você quer que o aniversariante apareça no convite?';

    case '15_years':
      return 'Você quer que a debutante apareça no convite?';

    case 'wedding':
      return 'Vocês querem aparecer no convite?';

    case 'baptism':
      return 'Você quer que a criança apareça no convite?';

    default:
      return 'Você quer que a pessoa celebrada apareça no convite?';
  }
}

function mayAppear(
  data,
) {
  return [
    'yes',
    'libri_decides',
  ].includes(
    data.appearance_choice,
  );
}

function field(
  key,
  label,
  type,
  options = {},
) {
  return {
    key,
    label,
    type,
    required:
      options.required === true,
    help:
      options.help || '',
    placeholder:
      options.placeholder || '',
    options:
      options.options || null,
    min:
      options.min ?? null,
    max:
      options.max ?? null,
    multiple:
      options.multiple === true,
  };
}

function uploadRule(
  fieldKey,
  category,
  min,
  max,
  label,
  help = '',
) {
  return {
    fieldKey,
    category,
    min,
    max,
    label,
    help,
    maxBytes:
      MAX_IMAGE_BYTES,
    accept: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ],
    notesPerFile:
      fieldKey
      === 'reference_files',
  };
}

function visualStyleOptions(
  data,
) {
  const age =
    Number.parseInt(
      data.age,
      10,
    );

  if (
    Number.isInteger(age)
    && age <= 12
  ) {
    return [
      {
        value:
          'stylized_doll',
        label:
          'Bonequinho estilizado',
      },
      {
        value:
          'realistic_detailed',
        label:
          'Realista e detalhado',
      },
      {
        value:
          'libri_decides',
        label:
          'Deixo a Libri decidir',
      },
    ];
  }

  return [
    {
      value:
        'realistic_detailed',
      label:
        'Realista e detalhado',
    },
    {
      value:
        'stylized',
      label:
        'Estilizado',
    },
    {
      value:
        'libri_decides',
      label:
        'Deixo a Libri decidir',
    },
  ];
}

function buildSchema(
  context,
  data,
) {
  const sections = [];

  const eventFields = [
    field(
      'event_time',
      'Qual é o horário da festa?',
      'time',
      {
        required:
          true,
      },
    ),

    field(
      'venue_name',
      'Qual é o nome do local?',
      'text',
      {
        required:
          true,
      },
    ),

    field(
      'venue_address',
      'Qual é o endereço do local da festa?',
      'textarea',
      {
        required:
          true,
      },
    ),

    field(
      'theme_or_style',
      'Qual é o tema ou estilo da festa?',
      'text',
      {
        required:
          true,
      },
    ),
  ];

  if (
    context.order.event_type
    === 'birthday'
  ) {
    eventFields.push(
      field(
        'age',
        'Quantos anos o aniversariante vai fazer?',
        'number',
        {
          required:
            true,
          min:
            1,
          max:
            120,
        },
      ),
    );
  }

  eventFields.push(
    field(
      'special_info',
      'Tem alguma informação especial que eu precise saber?',
      'textarea',
    ),
  );

  sections.push({
    id:
      'event',
    title:
      'Detalhes da festa',
    description:
      'Só o que ainda falta. O que você já informou não precisa ser repetido.',
    fields:
      eventFields,
  });

  const appearanceFields = [
    field(
      'appearance_choice',
      appearanceLabel(
        context,
      ),
      'choice',
      {
        required:
          true,
        options: [
          {
            value:
              'yes',
            label:
              'Sim',
          },
          {
            value:
              'no',
            label:
              'Não',
          },
          {
            value:
              'libri_decides',
            label:
              'Deixo a Libri decidir',
          },
        ],
      },
    ),
  ];

  if (
    mayAppear(data)
  ) {
    appearanceFields.push(
      field(
        'visual_style',
        'Como você prefere a representação?',
        'choice',
        {
          required:
            true,
          options:
            visualStyleOptions(data),
        },
      ),

      field(
        'outfit_choice',
        'E sobre a roupa?',
        'choice',
        {
          required:
            true,
          options: [
            {
              value:
                'send_photo',
              label:
                'Quero enviar foto da roupa',
            },
            {
              value:
                'libri_creates',
              label:
                'A Libri pode criar a roupa',
            },
            {
              value:
                'libri_decides',
              label:
                'Deixo a Libri decidir',
            },
          ],
        },
      ),
    );
  }

  sections.push({
    id:
      'appearance',
    title:
      'Quem aparece no convite',
    fields:
      appearanceFields,
  });

  sections.push({
    id:
      'visual',
    title:
      'Clima visual',
    fields: [
      field(
        'desired_colors',
        'Quais cores você gostaria de ver?',
        'text',
      ),

      field(
        'avoid_colors',
        'Tem alguma cor que você não quer?',
        'text',
      ),

      field(
        'visual_feeling',
        'Que sensação você quer para o convite?',
        'multi_choice',
        {
          required:
            true,
          multiple:
            true,
          max:
            3,
          options: [
            {
              value:
                'joyful',
              label:
                'Alegre',
            },
            {
              value:
                'delicate',
              label:
                'Delicado',
            },
            {
              value:
                'magical',
              label:
                'Mágico',
            },
            {
              value:
                'elegant',
              label:
                'Elegante',
            },
            {
              value:
                'fun',
              label:
                'Divertido',
            },
            {
              value:
                'cinematic',
              label:
                'Cinematográfico',
            },
            {
              value:
                'libri_decides',
              label:
                'Deixo a Libri decidir',
            },
          ],
        },
      ),

      field(
        'must_have',
        'Tem algo que precisa aparecer de qualquer jeito?',
        'textarea',
      ),

      field(
        'must_avoid',
        'Tem algo que você não quer no convite?',
        'textarea',
      ),

      field(
        'exact_text',
        'Existe algum texto que precisa aparecer exatamente como você escreveu?',
        'textarea',
      ),
    ],
  });

  const productFields = [];

  if (
    CINEMATIC_PRODUCTS.has(
      context.product.code,
    )
  ) {
    productFields.push(
      field(
        'speech_preference',
        'Sobre as falas do vídeo:',
        'choice',
        {
          required:
            true,
          help:
            'Você não precisa montar roteiro nem decidir cena por cena.',
          options: [
            {
              value:
                'libri_writes',
              label:
                'A Libri pode criar as falas',
            },
            {
              value:
                'customer_text',
              label:
                'Tenho uma frase ou texto que precisa ser falado',
            },
            {
              value:
                'no_speech',
              label:
                'Prefiro sem fala',
            },
          ],
        },
      ),
    );

    if (
      data.speech_preference
      === 'customer_text'
    ) {
      productFields.push(
        field(
          'speech_text',
          'Qual texto ou frase precisa ser falado?',
          'textarea',
          {
            required:
              true,
          },
        ),
      );
    }
  }

  if (
    INTERACTIVE_PRODUCTS.has(
      context.product.code,
    )
  ) {
    const paidConfirmation =
      hasConfirmation(context);

    productFields.push(
      field(
        'interactive_resources',
        paidConfirmation
          ? 'Quais opções você quer além da Confirmação de Presença Libri?'
          : 'Quais opções você quer no convite?',
        'multi_choice',
        {
          multiple:
            true,
          max:
            paidConfirmation
              ? 2
              : 3,
          help:
            paidConfirmation
              ? 'A Confirmação de Presença Libri já está incluída no pedido.'
              : 'Você pode escolher até 3. As informações normais da festa não contam como opção.',
          options: [
            {
              value:
                'location',
              label:
                'Localização',
            },

            ...(
              paidConfirmation
                ? []
                : [
                  {
                    value:
                      'simple_rsvp',
                    label:
                      'Confirmar presença simples',
                  },
                ]
            ),

            {
              value:
                'gifts',
              label:
                'Presentes',
            },
          ],
        },
      ),


    );

    const resources =
      Array.isArray(
        data.interactive_resources,
      )
        ? data.interactive_resources
        : [];

    if (
      resources.includes(
        'location',
      )
    ) {
      productFields.push(
        field(
          'location_url',
          'Cole o link da localização no Google Maps',
          'url',
          {
            required:
              true,
          },
        ),
      );
    }


  }

  if (context.product.code === 'cinematic_video') {
    productFields.push(field(
      'gift_page_video',
      'Você quer incluir uma página extra de presentes ao final do vídeo?',
      'choice',
      {
        required: true,
        help: 'Esta página aparece depois do convite em vídeo, com as sugestões e/ou os dados Pix que você escolher.',
        options: [
          { value: 'yes', label: 'Sim, quero a página de presentes' },
          { value: 'no', label: 'Não quero incluir' },
        ],
      },
    ));
  }

  const wantsGifts = (
    INTERACTIVE_PRODUCTS.has(context.product.code)
      && Array.isArray(data.interactive_resources)
      && data.interactive_resources.includes('gifts')
  ) || (
    context.product.code === 'cinematic_video'
      && data.gift_page_video === 'yes'
  );

  if (wantsGifts) {
      const wedding =
        context.order.event_type
        === 'wedding';

      productFields.push(
        field(
          'gift_mode',
          wedding
            ? 'Como vocês querem receber presentes?'
            : 'Como você quer organizar os presentes?',
          'choice',
          {
            required:
              true,
            options:
              wedding
                ? [
                  {
                    value:
                      'registry',
                    label:
                      'Lista/site de presentes',
                  },
                  {
                    value:
                      'pix',
                    label:
                      'Pix',
                  },
                  {
                    value:
                      'both',
                    label:
                      'Lista/site + Pix',
                  },
                  {
                    value:
                      'none',
                    label:
                      'Não incluir',
                  },
                ]
                : [
                  {
                    value:
                      'suggestions',
                    label:
                      'Sugestões',
                  },
                  {
                    value:
                      'pix',
                    label:
                      'Pix',
                  },
                  {
                    value:
                      'both',
                    label:
                      'Sugestões + Pix',
                  },
                ],
          },
        ),
      );

      if (
        [
          'registry',
          'both',
        ].includes(
          data.gift_mode,
        )
      ) {
        productFields.push(
          field(
            'gift_registry_url',
            'Cole o link da lista/site de presentes',
            'url',
            {
              required:
                true,
            },
          ),
        );
      }

      if (
        [
          'suggestions',
          'both',
        ].includes(
          data.gift_mode,
        )
      ) {
        const categories = Array.isArray(data.gift_categories)
          ? data.gift_categories : [];

        productFields.push(
          field(
            'gift_categories',
            'Que tipos de presentes você gostaria de sugerir?',
            'multi_choice',
            {
              multiple: true,
              required: !cleanText(data.gift_suggestions),
              help: 'Marque todas as opções que desejar. Se já enviou uma lista por escrito, ela continuará valendo.',
              options: [
                { value: 'clothes', label: 'Roupinhas' },
                { value: 'shoes', label: 'Calçados' },
                { value: 'toys', label: 'Brinquedos' },
                { value: 'books', label: 'Livros' },
                { value: 'educational', label: 'Materiais educativos' },
                { value: 'other', label: 'Outros' },
              ],
            },
          ),
        );

        if (categories.includes('clothes')) {
          productFields.push(field(
            'gift_clothing_size',
            'Qual é o tamanho das roupinhas?',
            'text',
            { required: true, help: 'Exemplo: tamanho 2 ou 3 anos.' },
          ));
        }

        if (categories.includes('shoes')) {
          productFields.push(field(
            'gift_shoe_size',
            'Qual é a numeração dos calçados?',
            'text',
            { required: true, help: 'Exemplo: 23/24.' },
          ));
        }

        if (categories.includes('other')) {
          productFields.push(field(
            'gift_other_details',
            'Que outros presentes você gostaria de sugerir?',
            'textarea',
            { required: true },
          ));
        }

        productFields.push(field(
          'gift_suggestions',
          'Quer acrescentar alguma preferência ou sugestão específica?',
          'textarea',
          {
            help: 'Opcional. Pode informar personagens, cores, modelos ou escrever uma lista livre de presentes.',
          },
        ));
      }

      if (
        [
          'pix',
          'both',
        ].includes(
          data.gift_mode,
        )
      ) {
        productFields.push(
          field(
            'pix_key_type',
            'Tipo da chave Pix',
            'choice',
            {
              required:
                true,
              options: [
                {
                  value:
                    'cpf',
                  label:
                    'CPF',
                },
                {
                  value:
                    'cnpj',
                  label:
                    'CNPJ',
                },
                {
                  value:
                    'email',
                  label:
                    'E-mail',
                },
                {
                  value:
                    'phone',
                  label:
                    'Telefone',
                },
                {
                  value:
                    'random',
                  label:
                    'Chave aleatória',
                },
              ],
            },
          ),

          field(
            'pix_key',
            'Chave Pix',
            'text',
            {
              required:
                true,
            },
          ),

          field(
            'pix_holder',
            'Nome do titular da chave',
            'text',
            {
              required:
                true,
            },
          ),

          field(
            'pix_message',
            'Quer deixar uma mensagem junto ao Pix?',
            'textarea',
          ),
        );
      }
  }

  // All produced invitations can have a musical direction, including
  // cinematic videos. Ask for a specific song only when music is requested.
  if (
    INTERACTIVE_PRODUCTS.has(context.product.code)
    || CINEMATIC_PRODUCTS.has(context.product.code)
  ) {
    productFields.push(
      field(
        'music_choice',
        'Você quer música no convite?',
        'choice',
        {
          required:
            true,
          options: [
            {
              value:
                'yes',
              label:
                'Sim',
            },
            {
              value:
                'no',
              label:
                'Não',
            },
            {
              value:
                'libri_decides',
              label:
                'Deixo a Libri decidir',
            },
          ],
        },
      ),
    );

    if (data.music_choice === 'yes') {
      productFields.push(
        field(
          'music_request',
          'Qual música você prefere? (nome ou link)',
          'text',
          {
            help: 'Escreva o nome e o artista ou cole um link. Se não tiver uma música específica, pode deixar em branco para a Libri escolher.',
          },
        ),
      );
    }
  }

  if (
    context.product.code
    === 'book'
  ) {
    productFields.push(
      field(
        'book_important_content',
        'Que conteúdos são importantes para entrar no livro?',
        'textarea',
        {
          required:
            true,
          help:
            'Conte o que precisa aparecer. Você não precisa decidir páginas, posição ou layout.',
        },
      ),
    );
  }

  if (
    context.product.code
    === 'infinite'
  ) {
    productFields.push(
      field(
        'infinite_important_content',
        'Que conteúdos são importantes nessa experiência?',
        'textarea',
        {
          required:
            true,
          help:
            'Pode citar fotos, momentos, história e informações. A Libri organiza a composição.',
        },
      ),

      field(
        'countdown_choice',
        'Você quer contagem regressiva?',
        'choice',
        {
          required:
            true,
          options: [
            {
              value:
                'yes',
              label:
                'Sim',
            },
            {
              value:
                'no',
              label:
                'Não',
            },
          ],
        },
      ),
    );
  }

  sections.push({
    id:
      'product',
    title:
      context.product.name
      || 'Seu convite',
    fields:
      productFields,
  });

  const addonFields = [];

  if (
    hasConfirmation(context)
  ) {
    addonFields.push(
      field(
        'rsvp_mode',
        'Como você quer a Confirmação de Presença Libri?',
        'choice',
        {
          required:
            true,
          options: [
            {
              value:
                'free',
              label:
                'Livre',
            },
            {
              value:
                'guest_list',
              label:
                'Lista de convidados',
            },
            {
              value:
                'unknown',
              label:
                'Ainda não sei',
            },
          ],
        },
      ),
    );

    if (
      data.rsvp_mode
      === 'guest_list'
    ) {
      addonFields.push(
        field(
          'guest_list',
          'Cole a lista de convidados',
          'textarea',
          {
            required:
              true,
            help:
              'Pode colocar uma pessoa por linha.',
          },
        ),
      );
    }
  }

  if (
    hasMoments(context)
  ) {
    addonFields.push(
      field(
        'moments_filter_text',
        'Quer alguma frase ou detalhe específico no filtro do Moments?',
        'text',
        {
          help:
            'O filtro do Álbum da Festa é usado no App Libri.',
        },
      ),
    );
  } else if (
    hasFilter(context)
  ) {
    addonFields.push(
      field(
        'filter_channel',
        'Onde você quer usar o filtro personalizado?',
        'choice',
        {
          required:
            true,
          options: [
            {
              value:
                'instagram',
              label:
                'Instagram',
            },
            {
              value:
                'libri_app',
              label:
                'App Libri',
            },
          ],
        },
      ),

      field(
        'filter_text',
        'Quer alguma frase ou detalhe específico no filtro?',
        'text',
      ),
    );
  }

  if (
    hasSave(context)
  ) {
    addonFields.push(
      field(
        'save_extra_text',
        'O Save the Date precisa de algum texto além dos dados da festa?',
        'textarea',
      ),
    );
  }

  if (
    hasReminder(context)
  ) {
    addonFields.push(
      field(
        'reminder_extra_text',
        'O Lembrete precisa de algum texto específico?',
        'textarea',
      ),
    );
  }

  if (
    addonFields.length
  ) {
    sections.push({
      id:
        'addons',
      title:
        'Adicionais do pedido',
      fields:
        addonFields,
    });
  }

  sections.push({
    id:
      'references',
    title:
      'Referências',
    description:
      'Referências ajudam a mostrar o gosto da festa. Não são modelos prontos para copiar.',
    fields: [
      field(
        'references_note',
        'Quer explicar alguma referência ou inspiração?',
        'textarea',
      ),
    ],
  });

  const uploadRules = [];

  if (
    mayAppear(data)
  ) {
    uploadRules.push(
      uploadRule(
        'person_photos',
        'person',
        2,
        5,
        'Fotos da pessoa que pode aparecer',
        'Envie de 2 a 5 fotos nítidas. Não precisa escolher uma favorita.',
      ),
    );

    if (
      data.outfit_choice
      === 'send_photo'
    ) {
      uploadRules.push(
        uploadRule(
          'outfit_photos',
          'outfit',
          1,
          2,
          'Foto da roupa',
          'Envie 1 foto. Se realmente ajudar, pode enviar uma segunda.',
        ),
      );
    }
  }

  uploadRules.push(
    uploadRule(
      'reference_files',
      'reference',
      0,
      6,
      'Referências visuais',
      'Até 6 referências. Cada uma pode receber uma observação.',
    ),
  );

  return {
    version:
      '2.0',
    sections,
    uploadRules,
  };
}

function flattenFields(
  schema,
) {
  return schema.sections.flatMap(
    (section) =>
      section.fields.map(
        (item) => ({
          ...item,
          sectionId:
            section.id,
        }),
      ),
  );
}

// Reuse the same customer-visible questions and choice labels inside the
// authenticated Admin. Do not show raw keys like "must_avoid" to staff.
export async function getV2AdminBriefingFieldMeta(db, token) {
  const context = await contextByToken(db, token);
  if (!context) return { fields: [], uploads: [] };
  const schema = buildSchema(context, context.briefing.data);
  return {
    fields: schema.sections.flatMap(section =>
      section.fields.map(definition => ({
        key: definition.key,
        label: definition.label,
        section: section.title,
        options: definition.options || [],
      })),
    ),
    uploads: schema.uploadRules.map(rule => ({
      fieldKey: rule.fieldKey, label: rule.label, min: rule.min,
    })),
  };
}

function isFilled(
  value,
) {
  if (
    Array.isArray(value)
  ) {
    return value.length > 0;
  }

  return value !== null
    && value !== undefined
    && String(value).trim() !== '';
}

function uploadCounts(
  uploads,
) {
  const result = {};

  for (
    const upload
    of uploads
  ) {
    if (
      !upload.fieldKey
    ) {
      continue;
    }

    result[
      upload.fieldKey
    ] =
      (
        result[
          upload.fieldKey
        ]
        || 0
      )
      + 1;
  }

  return result;
}

function progressFor(
  schema,
  data,
  uploads,
) {
  const requiredFields =
    flattenFields(schema)
      .filter(
        (item) =>
          item.required,
      );

  const requiredUploads =
    schema.uploadRules
      .filter(
        (rule) =>
          rule.min > 0,
      );

  const counts =
    uploadCounts(uploads);

  const total =
    requiredFields.length
    + requiredUploads.length;

  if (!total) {
    return 100;
  }

  let complete = 0;

  for (
    const item
    of requiredFields
  ) {
    if (
      isFilled(
        data[item.key],
      )
    ) {
      complete += 1;
    }
  }

  for (
    const rule
    of requiredUploads
  ) {
    if (
      Number(
        counts[rule.fieldKey]
        || 0,
      )
      >= rule.min
    ) {
      complete += 1;
    }
  }

  return Math.round(
    complete * 100 / total,
  );
}

function validationErrors(
  schema,
  data,
  uploads,
) {
  const errors = [];

  for (
    const item
    of flattenFields(schema)
      .filter(
        (entry) =>
          entry.required,
      )
  ) {
    if (
      !isFilled(
        data[item.key],
      )
    ) {
      errors.push({
        type:
          'field',
        key:
          item.key,
        section:
          item.sectionId,
        message:
          item.label,
      });
    }
  }

  const counts =
    uploadCounts(uploads);

  for (
    const rule
    of schema.uploadRules
  ) {
    const count =
      Number(
        counts[rule.fieldKey]
        || 0,
      );

    if (
      count < rule.min
    ) {
      errors.push({
        type:
          'upload',
        key:
          rule.fieldKey,
        message:
          `${rule.label}: envie pelo menos ${rule.min}.`,
      });
    }

    if (
      count > rule.max
    ) {
      errors.push({
        type:
          'upload',
        key:
          rule.fieldKey,
        message:
          `${rule.label}: máximo de ${rule.max}.`,
      });
    }
  }

  return errors;
}

function sanitizeField(
  definition,
  value,
) {
  if (
    definition.type
    === 'multi_choice'
  ) {
    const values =
      [
        ...new Set(
          (
            Array.isArray(value)
              ? value
              : []
          )
            .map(
              (item) =>
                cleanText(
                  item,
                  120,
                ),
            )
            .filter(Boolean),
        ),
      ];

    if (
      definition.max !== null
      && values.length
      > definition.max
    ) {
      throw new Error(
        `${definition.label}: escolha no máximo ${definition.max}.`,
      );
    }

    const allowed =
      new Set(
        (definition.options || [])
          .map(
            (item) =>
              item.value,
          ),
      );

    if (
      allowed.size
      && values.some(
        (item) =>
          !allowed.has(item),
      )
    ) {
      throw new Error(
        `Opção inválida em ${definition.label}.`,
      );
    }

    return values;
  }

  if (
    definition.type
    === 'choice'
  ) {
    const text =
      cleanText(
        value,
        120,
      );

    const allowed =
      new Set(
        (definition.options || [])
          .map(
            (item) =>
              item.value,
          ),
      );

    if (
      text
      && allowed.size
      && !allowed.has(text)
    ) {
      throw new Error(
        `Opção inválida em ${definition.label}.`,
      );
    }

    return text;
  }

  if (
    definition.type
    === 'number'
  ) {
    if (
      value === ''
      || value === null
      || value === undefined
    ) {
      return '';
    }

    const number =
      Number.parseInt(
        value,
        10,
      );

    if (
      !Number.isInteger(number)
      || (
        definition.min !== null
        && number < definition.min
      )
      || (
        definition.max !== null
        && number > definition.max
      )
    ) {
      throw new Error(
        `Valor inválido em ${definition.label}.`,
      );
    }

    return number;
  }

  return cleanText(
    value,
    definition.type
    === 'textarea'
      ? 12000
      : 2000,
  );
}

function cleanBranches(
  data,
) {
  if (
    data.appearance_choice
    === 'no'
  ) {
    delete data.visual_style;
    delete data.outfit_choice;
  }

  if (
    data.speech_preference
    !== 'customer_text'
  ) {
    delete data.speech_text;
  }

  if (data.music_choice !== 'yes') {
    delete data.music_request;
  }

  const resources =
    Array.isArray(
      data.interactive_resources,
    )
      ? data.interactive_resources
      : [];

  if (
    !resources.includes(
      'location',
    )
  ) {
    delete data.location_url;
  }

  const wantsGifts = resources.includes('gifts')
    || data.gift_page_video === 'yes';

  if (!wantsGifts) {
    for (
      const key
      of [
        'gift_mode',
        'gift_registry_url',
        'gift_suggestions',
        'gift_categories',
        'gift_clothing_size',
        'gift_shoe_size',
        'gift_other_details',
        'pix_key_type',
        'pix_key',
        'pix_holder',
        'pix_message',
      ]
    ) {
      delete data[key];
    }
  } else {
    if (
      ![
        'registry',
        'both',
      ].includes(
        data.gift_mode,
      )
    ) {
      delete data.gift_registry_url;
    }

    if (
      ![
        'suggestions',
        'both',
      ].includes(
        data.gift_mode,
      )
    ) {
      delete data.gift_suggestions;
      delete data.gift_categories;
      delete data.gift_clothing_size;
      delete data.gift_shoe_size;
      delete data.gift_other_details;
    } else {
      const categories = Array.isArray(data.gift_categories)
        ? data.gift_categories : [];
      if (!categories.includes('clothes')) delete data.gift_clothing_size;
      if (!categories.includes('shoes')) delete data.gift_shoe_size;
      if (!categories.includes('other')) delete data.gift_other_details;
    }

    if (
      ![
        'pix',
        'both',
      ].includes(
        data.gift_mode,
      )
    ) {
      delete data.pix_key_type;
      delete data.pix_key;
      delete data.pix_holder;
      delete data.pix_message;
    }
  }

  if (
    data.rsvp_mode
    !== 'guest_list'
  ) {
    delete data.guest_list;
  }
}

function assertEditable(
  context,
) {
  if (
    context.order.briefing_status
    === 'locked'
  ) {
    const error =
      new Error(
        'O formulário será liberado assim que o pagamento for confirmado.',
      );

    error.status =
      403;
    error.code =
      'briefing_locked';

    throw error;
  }

  if (
    context.order.briefing_status
    === 'completed'
  ) {
    const error =
      new Error(
        'Os dados deste pedido já foram enviados para a Libri.',
      );

    error.status =
      409;
    error.code =
      'briefing_completed';

    throw error;
  }

  if (
    context.order.status
    === 'cancelled'
  ) {
    const error =
      new Error(
        'Este pedido foi cancelado.',
      );

    error.status =
      409;
    error.code =
      'order_cancelled';

    throw error;
  }
}

async function moduleAvailability(
  db,
  orderId,
) {
  const [
    preview,
    contract,
  ] =
    await Promise.all([
      db
        .prepare(
          `
            SELECT id
            FROM v2_previews
            WHERE order_id = ?
            ORDER BY
              version_number DESC,
              id DESC
            LIMIT 1
          `,
        )
        .bind(orderId)
        .first(),

      db
        .prepare(
          `
            SELECT id
            FROM v2_contracts
            WHERE
              order_id = ?
              AND status IN (
                'waiting_customer',
                'signed'
              )
            ORDER BY
              version DESC,
              id DESC
            LIMIT 1
          `,
        )
        .bind(orderId)
        .first(),
    ]);

  return {
    preview:
      Boolean(preview),
    contracts:
      Boolean(contract),
  };
}

function supportMessage(
  context,
) {
  return `Oi, Ju! 💛 Estou falando sobre meu pedido ${context.order.order_code}, da ${context.order.honoree_display_name}.`;
}

function completedMessage(
  context,
) {
  return `Oi, Ju! 💛 Finalizei meu pedido ${context.order.order_code}, da ${context.order.honoree_display_name}. Já preenchi os dados do convite e enviei os arquivos.`;
}

export async function getV2CustomerArea(
  env,
  token,
) {
  let context =
    await contextByToken(
      env.DB,
      token,
    );

  if (!context) {
    return null;
  }

  if (
    env.MERCADO_PAGO_ACCESS_TOKEN
    && [
      'awaiting_payment',
      'urgency_approved',
    ].includes(
      context.order.status,
    )
  ) {
    const payment = await env.DB.prepare(`SELECT provider_order_id FROM v2_payments
      WHERE order_id = ? AND provider = 'mercado_pago' AND status IN ('pending', 'approved')
      ORDER BY id DESC LIMIT 1`).bind(context.order.id).first();
    if (payment?.provider_order_id) {
      try {
        await syncMercadoPagoOrder(env, payment.provider_order_id);
        context = await contextByToken(env.DB, token);
      } catch (error) { console.error('Customer payment sync deferred', error.message); }
    }
  }

  const schema =
    buildSchema(
      context,
      context.briefing.data,
    );

  const urgency = await env.DB.prepare(`SELECT status, decision_note, urgency_percent, decided_at
    FROM v2_urgency_requests WHERE order_id = ?`).bind(context.order.id).first();

  const termsAcceptance = await env.DB.prepare(
    'SELECT terms_version FROM v2_order_terms_acceptances WHERE order_id = ? ORDER BY id DESC LIMIT 1'
  ).bind(context.order.id).first();

  const progress =
    context.order.briefing_status
    === 'completed'
      ? 100
      : progressFor(
        schema,
        context.briefing.data,
        context.uploads,
      );

  const [
    number,
    modules,
    paymentTotals,
    balanceSettings,
  ] =
    await Promise.all([
      libriWhatsapp(env.DB),
      moduleAvailability(
        env.DB,
        context.order.id,
      ),
      env.DB
        .prepare(
          `
            SELECT
              COALESCE(
                SUM(
                  CASE
                    WHEN
                      status = 'approved'
                      AND payment_type != 'refund'
                      THEN amount_cents
                    ELSE 0
                  END
                ),
                0
              ) AS paid_cents,
              COALESCE(
                SUM(
                  CASE
                    WHEN
                      status = 'approved'
                      AND payment_type = 'refund'
                      THEN amount_cents
                    ELSE 0
                  END
                ),
                0
              ) AS refunded_cents
            FROM v2_payments
            WHERE order_id = ?
          `,
        )
        .bind(
          context.order.id,
        )
        .first(),
      env.DB
        .prepare(
          `
            SELECT
              MAX(
                CASE
                  WHEN key = 'balance_pix_key'
                    THEN value
                END
              ) AS pix_key,
              MAX(
                CASE
                  WHEN key = 'balance_pix_recipient_name'
                    THEN value
                END
              ) AS recipient_name
            FROM v2_settings
            WHERE key IN (
              'balance_pix_key',
              'balance_pix_recipient_name'
            )
          `,
        )
        .first(),
    ]);

  const paidCents =
    Math.max(
      0,
      Number(
        paymentTotals?.paid_cents
        || 0,
      )
      - Number(
        paymentTotals?.refunded_cents
        || 0,
      ),
    );

  const remainingCents =
    Math.max(
      0,
      Number(
        context.order.total_cents
        || 0,
      )
      - paidCents,
    );

  const pricingSnapshot = parseJson(context.order.pricing_snapshot_json, {});
  const baseTotalCents = baseTotalFromSnapshot(context.order, pricingSnapshot);
  const proposedCard = priceWithCardProcessingFee(baseTotalCents, 'card');
  const currentMethod = context.order.payment_method;
  // Pre-existing unpaid card orders keep the previously agreed price unless
  // the customer actively changes method.
  const currentGrandfatheredCard = currentMethod === 'card'
    && !Number(pricingSnapshot.cardFeeCents || 0);
  const cardTotalCents = currentGrandfatheredCard
    ? Number(context.order.total_cents || 0)
    : proposedCard.totalCents;
  const cardFeeCents = cardTotalCents - baseTotalCents;

  return {
    order: {
      code:
        context.order.order_code,
      honoreeName:
        context.order.honoree_display_name,
      eventType:
        context.order.event_type,
      eventSubtype:
        context.order.event_subtype,
      eventDate:
        context.order.event_date,
      eventDateLabel:
        dateBr(
          context.order.event_date,
        ),
      deliveryWindow: {
        start:
          context.order.delivery_start,
        end:
          context.order.delivery_end,
      },
      status:
        context.order.status,
      archived:
        Boolean(context.order.archived_at),
      statusLabel:
        statusLabel(
          context.order.status,
        ),
      nextAction:
        String(context.order.next_action || '').replace(/briefing/gi, 'dados do convite'),
      source:
        context.order.source,
    },

    urgency: urgency ? { status: urgency.status, note: urgency.decision_note,
      percent: Number(urgency.urgency_percent || 0) } : null,

    customer: {
      name:
        context.order.customer_name,
    },

    product: {
      ...context.product,
      addons:
        context.addons,
    },

    payment: {
      method:
        context.order.payment_method,
      baseTotalCents,
      cardTotalCents,
      cardFeeCents,
      cardFeePercent: cardFeeCents > 0 ? 4.97 : 0,
      deadlineAt: (() => {
        const candidates = [
          context.order.created_at,
          urgency?.status === 'approved' ? urgency.decided_at : null,
          context.order.payment_reactivated_at,
        ].map(value => Date.parse(value || '')).filter(Number.isFinite);
        const time = Math.max(...candidates);
        return Number.isFinite(time) ? new Date(time + 24 * 60 * 60 * 1000).toISOString() : null;
      })(),
      totalCents:
        Number(
          context.order.total_cents || 0,
        ),
      totalLabel:
        moneyBr(
          context.order.total_cents,
        ),
      depositCents:
        Number(
          context.order.deposit_cents || 0,
        ),
      balanceCents:
        Number(
          context.order.balance_cents || 0,
        ),
      paidCents,
      remainingCents,
      capacityReview:
        paidCents > 0
        && context.order.briefing_status === 'locked'
        && [
          'awaiting_payment',
          'urgency_approved',
        ].includes(
          context.order.status,
        ),
      balancePix:
        context.order.status === 'balance_pending'
        && context.order.payment_method === 'pix'
          ? {
              key:
                String(
                  balanceSettings?.pix_key
                  || '',
                ).trim(),
              recipient:
                String(
                  balanceSettings?.recipient_name
                  || '',
                ).trim(),
            }
          : null,
      termsAccepted: Boolean(termsAcceptance),
      termsVersion: termsAcceptance?.terms_version || null,
    },

    briefing: {
      status:
        context.order.briefing_status,
      locked:
        context.order.briefing_status
        === 'locked',
      completed:
        context.order.briefing_status
        === 'completed',
      schemaVersion:
        context.briefing.schemaVersion,
      currentSection:
        context.briefing.currentSection,
      progress,
      data:
        context.briefing.data,
      schema,
      uploads:
        context.uploads.map(
          (upload) => ({
            ...upload,
            contentPath:
              `/api/v2/customer-area/${token}/briefing/uploads/${upload.id}/content`,
          }),
        ),
      updatedAt:
        context.briefing.updatedAt,
      completedAt:
        context.briefing.completedAt,
    },

    modules: {
      previews: {
        available:
          modules.preview,
        apiPath:
          `/api/v2/customer-area/${token}/previews`,
      },

      contracts: {
        available:
          modules.contracts,
        apiPath:
          `/api/v2/customer-area/${token}/contracts`,
      },
    },

    support: {
      message:
        supportMessage(context),
      whatsappUrl:
        whatsappUrl(
          number,
          supportMessage(context),
        ),
    },
  };
}

export async function saveV2Briefing(
  env,
  token,
  body = {},
) {
  const context =
    await contextByToken(
      env.DB,
      token,
    );

  if (!context) {
    return null;
  }

  assertEditable(context);

  const data = {
    ...context.briefing.data,
  };

  const beforeSchema =
    buildSchema(
      context,
      data,
    );

  const known =
    new Map(
      flattenFields(
        beforeSchema,
      ).map(
        (item) => [
          item.key,
          item,
        ],
      ),
    );

  const patch =
    body.data
    && typeof body.data
    === 'object'
    && !Array.isArray(
      body.data,
    )
      ? body.data
      : {};

  for (
    const [
      key,
      value,
    ]
    of Object.entries(patch)
  ) {
    const definition =
      known.get(key);

    if (!definition) {
      continue;
    }

    data[key] =
      sanitizeField(
        definition,
        value,
      );
  }

  cleanBranches(data);

  const schema =
    buildSchema(
      context,
      data,
    );

  const sectionIds =
    new Set(
      schema.sections.map(
        (section) =>
          section.id,
      ),
    );

  const requestedSection =
    cleanText(
      body.currentSection,
      80,
    );

  const currentSection =
    sectionIds.has(
      requestedSection,
    )
      ? requestedSection
      : context.briefing.currentSection;

  const progress =
    progressFor(
      schema,
      data,
      context.uploads,
    );

  const stamp =
    nowIso();

  await env.DB.batch([
    env.DB
      .prepare(
        `
          UPDATE v2_briefings
          SET
            data_json = ?,
            current_section = ?,
            completion_percent = ?,
            started_at = COALESCE(
              started_at,
              ?
            ),
            updated_at = ?
          WHERE order_id = ?
        `,
      )
      .bind(
        JSON.stringify(data),
        currentSection,
        progress,
        stamp,
        stamp,
        context.order.id,
      ),

    env.DB
      .prepare(
        `
          UPDATE v2_orders
          SET
            briefing_status = 'in_progress',
            status = 'briefing_pending',
            next_action = 'Dados da festa em preenchimento',
            updated_at = ?
          WHERE
            id = ?
            AND briefing_status IN (
              'available',
              'in_progress'
            )
        `,
      )
      .bind(
        stamp,
        context.order.id,
      ),
  ]);

  return {
    status:
      'in_progress',
    currentSection,
    progress,
    updatedAt:
      stamp,
    data,
    schema,
  };
}

function ruleFor(
  schema,
  fieldKey,
) {
  return schema.uploadRules.find(
    (rule) =>
      rule.fieldKey === fieldKey,
  ) || null;
}

async function countFieldUploads(
  db,
  orderId,
  fieldKey,
) {
  const row =
    await db
      .prepare(
        `
          SELECT COUNT(*) AS total
          FROM v2_briefing_uploads
          WHERE
            order_id = ?
            AND field_key = ?
        `,
      )
      .bind(
        orderId,
        fieldKey,
      )
      .first();

  return Number(
    row?.total || 0,
  );
}

async function refreshProgress(
  env,
  token,
) {
  const context =
    await contextByToken(
      env.DB,
      token,
    );

  const schema =
    buildSchema(
      context,
      context.briefing.data,
    );

  const progress =
    progressFor(
      schema,
      context.briefing.data,
      context.uploads,
    );

  await env.DB
    .prepare(
      `
        UPDATE v2_briefings
        SET
          completion_percent = ?,
          updated_at = ?
        WHERE order_id = ?
      `,
    )
    .bind(
      progress,
      nowIso(),
      context.order.id,
    )
    .run();

  return progress;
}

export async function uploadV2BriefingFile(
  request,
  env,
  token,
) {
  if (!env.FILES) {
    const error =
      new Error(
        'Armazenamento de arquivos ainda não configurado.',
      );

    error.status =
      503;

    throw error;
  }

  const context =
    await contextByToken(
      env.DB,
      token,
    );

  if (!context) {
    return null;
  }

  assertEditable(context);

  const form =
    await request.formData();

  const fieldKey =
    cleanText(
      form.get('fieldKey'),
      80,
    );

  const schema =
    buildSchema(
      context,
      context.briefing.data,
    );

  const rule =
    ruleFor(
      schema,
      fieldKey,
    );

  if (!rule) {
    throw new Error(
      'Este campo de upload não está disponível.',
    );
  }

  const file =
    form.get('file');

  if (
    !file
    || typeof file.stream
      !== 'function'
  ) {
    throw new Error(
      'Selecione uma imagem.',
    );
  }

  const mime =
    String(
      file.type || '',
    ).toLowerCase();

  if (
    !IMAGE_TYPES.has(mime)
  ) {
    throw new Error(
      'Envie JPG, PNG, WebP, HEIC ou HEIF.',
    );
  }

  const size =
    Number(
      file.size || 0,
    );

  if (
    size <= 0
    || size > MAX_IMAGE_BYTES
  ) {
    throw new Error(
      'A imagem deve ter no máximo 30 MB.',
    );
  }

  const count =
    await countFieldUploads(
      env.DB,
      context.order.id,
      fieldKey,
    );

  if (
    count >= rule.max
  ) {
    throw new Error(
      `Você já enviou o máximo de ${rule.max} arquivo(s) neste campo.`,
    );
  }

  const originalFilename =
    cleanText(
      file.name,
      240,
    )
    || 'arquivo';

  const storedFilename =
    `${safeName(
      originalFilename.replace(
        /\.[^.]+$/,
        '',
      ),
    )}-${count + 1}${extensionFromMime(mime)}`;

  const r2Key =
    `orders/${context.order.id}/briefing/${rule.category}/${randomToken('file_')}${extensionFromMime(mime)}`;

  await env.FILES.put(
    r2Key,
    file.stream(),
    {
      httpMetadata: {
        contentType:
          mime,
        contentDisposition:
          'inline',
        cacheControl:
          'private, no-store',
      },
      customMetadata: {
        orderCode:
          context.order.order_code,
        fieldKey,
        category:
          rule.category,
        originalFilename,
      },
    },
  );

  let uploadId;

  try {
    const stamp =
      nowIso();

    const result =
      await env.DB
        .prepare(
          `
            INSERT INTO v2_briefing_uploads(
              order_id,
              category,
              field_key,
              original_filename,
              stored_filename,
              mime_type,
              size_bytes,
              r2_key,
              note,
              sort_order,
              created_at,
              updated_at
            )
            VALUES (
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?
            )
          `,
        )
        .bind(
          context.order.id,
          rule.category,
          fieldKey,
          originalFilename,
          storedFilename,
          mime,
          size,
          r2Key,
          cleanText(
            form.get('note'),
            1000,
          )
          || null,
          count,
          stamp,
          stamp,
        )
        .run();

    uploadId =
      Number(
        result?.meta?.last_row_id,
      );

    await env.DB
      .prepare(
        `
          UPDATE v2_orders
          SET
            briefing_status = 'in_progress',
            status = 'briefing_pending',
            next_action = 'Dados da festa em preenchimento',
            updated_at = ?
          WHERE
            id = ?
            AND briefing_status IN (
              'available',
              'in_progress'
            )
        `,
      )
      .bind(
        stamp,
        context.order.id,
      )
      .run();
  } catch (error) {
    await env.FILES.delete(
      r2Key,
    );

    throw error;
  }

  return {
    upload: {
      id:
        uploadId,
      category:
        rule.category,
      fieldKey,
      originalFilename,
      storedFilename,
      mimeType:
        mime,
      sizeBytes:
        size,
      note:
        cleanText(
          form.get('note'),
          1000,
        ),
      contentPath:
        `/api/v2/customer-area/${token}/briefing/uploads/${uploadId}/content`,
    },

    progress:
      await refreshProgress(
        env,
        token,
      ),
  };
}

async function uploadRecord(
  db,
  token,
  uploadId,
) {
  const context =
    await contextByToken(
      db,
      token,
    );

  if (!context) {
    return {
      context:
        null,
      upload:
        null,
    };
  }

  const upload =
    await db
      .prepare(
        `
          SELECT *
          FROM v2_briefing_uploads
          WHERE
            id = ?
            AND order_id = ?
          LIMIT 1
        `,
      )
      .bind(
        uploadId,
        context.order.id,
      )
      .first();

  return {
    context,
    upload,
  };
}

export async function updateV2BriefingUpload(
  env,
  token,
  uploadId,
  body = {},
) {
  const {
    context,
    upload,
  } =
    await uploadRecord(
      env.DB,
      token,
      uploadId,
    );

  if (!context) {
    return null;
  }

  if (!upload) {
    return false;
  }

  assertEditable(context);

  const note =
    cleanText(
      body.note,
      1000,
    );

  const sortOrder =
    Number.isFinite(
      Number(
        body.sortOrder,
      ),
    )
      ? Math.max(
        0,
        Math.min(
          100,
          Number.parseInt(
            body.sortOrder,
            10,
          ),
        ),
      )
      : Number(
        upload.sort_order || 0,
      );

  await env.DB
    .prepare(
      `
        UPDATE v2_briefing_uploads
        SET
          note = ?,
          sort_order = ?,
          updated_at = ?
        WHERE id = ?
      `,
    )
    .bind(
      note || null,
      sortOrder,
      nowIso(),
      upload.id,
    )
    .run();

  return {
    id:
      upload.id,
    note,
    sortOrder,
  };
}

export async function deleteV2BriefingUpload(
  env,
  token,
  uploadId,
) {
  const {
    context,
    upload,
  } =
    await uploadRecord(
      env.DB,
      token,
      uploadId,
    );

  if (!context) {
    return null;
  }

  if (!upload) {
    return false;
  }

  assertEditable(context);

  await env.DB
    .prepare(
      `
        DELETE FROM v2_briefing_uploads
        WHERE id = ?
      `,
    )
    .bind(upload.id)
    .run();

  if (
    env.FILES
    && upload.r2_key
  ) {
    await env.FILES.delete(
      upload.r2_key,
    );
  }

  return {
    deleted:
      true,
    progress:
      await refreshProgress(
        env,
        token,
      ),
  };
}

export async function streamV2BriefingUpload(
  env,
  token,
  uploadId,
) {
  if (!env.FILES) {
    return fail(
      'Armazenamento de arquivos ainda não configurado.',
      503,
    );
  }

  const {
    upload,
  } =
    await uploadRecord(
      env.DB,
      token,
      uploadId,
    );

  if (!upload) {
    return fail(
      'Arquivo não encontrado.',
      404,
    );
  }

  const object =
    await env.FILES.get(
      upload.r2_key,
    );

  if (!object) {
    return fail(
      'Arquivo não encontrado.',
      404,
    );
  }

  const headers =
    new Headers();

  object.writeHttpMetadata(
    headers,
  );

  headers.set(
    'content-type',
    upload.mime_type,
  );

  headers.set(
    'content-disposition',
    `inline; filename="${safeName(upload.original_filename)}"`,
  );

  headers.set(
    'cache-control',
    'private, no-store, max-age=0',
  );

  headers.set(
    'x-content-type-options',
    'nosniff',
  );

  return new Response(
    object.body,
    {
      headers,
    },
  );
}

export async function submitV2Briefing(
  env,
  token,
) {
  const context =
    await contextByToken(
      env.DB,
      token,
    );

  if (!context) {
    return null;
  }

  const number =
    await libriWhatsapp(
      env.DB,
    );

  if (
    context.order.briefing_status
    === 'completed'
  ) {
    const message =
      completedMessage(context);

    return {
      alreadyCompleted:
        true,
      status:
        'completed',
      whatsappUrl:
        whatsappUrl(
          number,
          message,
        ),
      whatsappMessage:
        message,
    };
  }

  assertEditable(context);

  const schema =
    buildSchema(
      context,
      context.briefing.data,
    );

  const errors =
    validationErrors(
      schema,
      context.briefing.data,
      context.uploads,
    );

  if (
    errors.length
  ) {
    const error =
      new Error(
        'Ainda faltam algumas informações antes de enviar os dados.',
      );

    error.status =
      422;
    error.code =
      'briefing_incomplete';
    error.details = {
      fields:
        errors,
    };

    throw error;
  }

  const stamp =
    nowIso();

  await env.DB.batch([
    env.DB
      .prepare(
        `
          UPDATE v2_briefings
          SET
            completion_percent = 100,
            completed_at = ?,
            updated_at = ?
          WHERE order_id = ?
        `,
      )
      .bind(
        stamp,
        stamp,
        context.order.id,
      ),

    env.DB
      .prepare(
        `
          UPDATE v2_orders
          SET
            briefing_status = 'completed',
            status = 'ready_for_production',
            next_action = 'Iniciar produção',
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        stamp,
        context.order.id,
      ),

    env.DB
      .prepare(
        `
          INSERT INTO v2_order_history(
            order_id,
            action_code,
            description,
            metadata_json,
            created_at
          )
          VALUES (
            ?,
            'briefing_completed',
            'Dados do convite preenchidos e enviados pela cliente.',
            ?,
            ?
          )
        `,
      )
      .bind(
        context.order.id,
        JSON.stringify({
          completionPercent:
            100,
          uploadCount:
            context.uploads.length,
        }),
        stamp,
      ),
  ]);

  await createV2AdminNotification(
    env,
    {
      eventCode:
        'BRIEFING_COMPLETED',
      orderId:
        context.order.id,
      title:
        'Dados da festa enviados ✓',
      body:
        `${context.order.order_code} • ${context.order.honoree_display_name} • pronto para produção`,
      actionUrl:
        `/admin-v2?order=${
          encodeURIComponent(
            context.order.order_code,
          )
        }`,
      priority:
        'high',
      pushEligible:
        true,
      dedupeKey:
        `briefing_completed:${context.order.id}`,
    },
  );

  const message =
    completedMessage(context);

  return {
    alreadyCompleted:
      false,
    status:
      'completed',
    orderStatus:
      'ready_for_production',

    success: {
      title:
        'Tudo pronto! 💛',
      message:
        'Os dados e as fotos do pedido foram enviados para a Libri e estão organizados para a produção.',
      whatsappButtonLabel:
        'Avisar a Libri no WhatsApp 💛',
      whatsappUrl:
        whatsappUrl(
          number,
          message,
        ),
      whatsappMessage:
        message,
    },
  };
}

