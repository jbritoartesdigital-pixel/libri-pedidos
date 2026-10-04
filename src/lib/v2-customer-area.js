import {
  fail,
  nowIso,
  parseJson,
  randomToken,
} from './http.js';

import {
  createV2AdminNotification,
} from './v2-notifications.js';

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
    awaiting_payment:
      'Aguardando pagamento',
    briefing_pending:
      'Briefing pendente',
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

            c.name AS customer_name,

            p.total_cents,
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
      'Qual é o endereço que deve aparecer no convite?',
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
          ? 'Quais recursos você quer além da Confirmação de Presença Libri?'
          : 'Quais recursos você quer no convite?',
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
              : 'Você pode escolher até 3. As informações normais da festa não contam como recurso.',
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

    c