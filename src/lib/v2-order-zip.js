import {
  fail,
  nowIso,
  parseJson,
} from './http.js';

const UTF8_FLAG =
  0x0800;

const DATA_DESCRIPTOR_FLAG =
  0x0008;

const ZIP_FLAGS =
  UTF8_FLAG
  | DATA_DESCRIPTOR_FLAG;

const ZIP_VERSION =
  20;

const encoder =
  new TextEncoder();

const CRC_TABLE =
  (() => {
    const table =
      new Uint32Array(
        256,
      );

    for (
      let index = 0;
      index < 256;
      index += 1
    ) {
      let value =
        index;

      for (
        let bit = 0;
        bit < 8;
        bit += 1
      ) {
        value =
          (
            value
            & 1
          )
            ? (
              0xedb88320
              ^ (
                value
                >>> 1
              )
            )
            : (
              value
              >>> 1
            );
      }

      table[
        index
      ] =
        value
        >>> 0;
    }

    return table;
  })();

function updateCrc32(
  crc,
  bytes,
) {
  let value =
    crc
    >>> 0;

  for (
    let index = 0;
    index < bytes.length;
    index += 1
  ) {
    value =
      CRC_TABLE[
        (
          value
          ^ bytes[
            index
          ]
        )
        & 0xff
      ]
      ^ (
        value
        >>> 8
      );
  }

  return value
    >>> 0;
}

function finalizedCrc32(
  runningCrc,
) {
  return (
    runningCrc
    ^ 0xffffffff
  )
    >>> 0;
}

function u16(
  value,
) {
  const bytes =
    new Uint8Array(
      2,
    );

  new DataView(
    bytes.buffer,
  )
    .setUint16(
      0,
      value
      & 0xffff,
      true,
    );

  return bytes;
}

function u32(
  value,
) {
  const bytes =
    new Uint8Array(
      4,
    );

  new DataView(
    bytes.buffer,
  )
    .setUint32(
      0,
      Number(
        value,
      )
      >>> 0,
      true,
    );

  return bytes;
}

function concatBytes(
  ...parts
) {
  const length =
    parts.reduce(
      (
        total,
        part,
      ) =>
        total
        + part.length,
      0,
    );

  const output =
    new Uint8Array(
      length,
    );

  let offset = 0;

  for (
    const part
    of parts
  ) {
    output.set(
      part,
      offset,
    );

    offset +=
      part.length;
  }

  return output;
}

function zipDosDateTime(
  date = new Date(),
) {
  const year =
    Math.max(
      1980,
      Math.min(
        2107,
        date.getUTCFullYear(),
      ),
    );

  const month =
    date.getUTCMonth()
    + 1;

  const day =
    date.getUTCDate();

  const hours =
    date.getUTCHours();

  const minutes =
    date.getUTCMinutes();

  const seconds =
    Math.floor(
      date.getUTCSeconds()
      / 2,
    );

  const dosDate =
    (
      (
        year - 1980
      )
      << 9
    )
    | (
      month
      << 5
    )
    | day;

  const dosTime =
    (
      hours
      << 11
    )
    | (
      minutes
      << 5
    )
    | seconds;

  return {
    dosDate,
    dosTime,
  };
}

function localFileHeader(
  filenameBytes,
  dosDate,
  dosTime,
) {
  return concatBytes(
    u32(
      0x04034b50,
    ),

    u16(
      ZIP_VERSION,
    ),

    u16(
      ZIP_FLAGS,
    ),

    u16(
      0,
    ),

    u16(
      dosTime,
    ),

    u16(
      dosDate,
    ),

    u32(
      0,
    ),

    u32(
      0,
    ),

    u32(
      0,
    ),

    u16(
      filenameBytes.length,
    ),

    u16(
      0,
    ),

    filenameBytes,
  );
}

function dataDescriptor(
  crc32,
  size,
) {
  return concatBytes(
    u32(
      0x08074b50,
    ),

    u32(
      crc32,
    ),

    u32(
      size,
    ),

    u32(
      size,
    ),
  );
}

function centralDirectoryHeader(
  {
    filenameBytes,
    dosDate,
    dosTime,
    crc32,
    size,
    localOffset,
  },
) {
  return concatBytes(
    u32(
      0x02014b50,
    ),

    u16(
      ZIP_VERSION,
    ),

    u16(
      ZIP_VERSION,
    ),

    u16(
      ZIP_FLAGS,
    ),

    u16(
      0,
    ),

    u16(
      dosTime,
    ),

    u16(
      dosDate,
    ),

    u32(
      crc32,
    ),

    u32(
      size,
    ),

    u32(
      size,
    ),

    u16(
      filenameBytes.length,
    ),

    u16(
      0,
    ),

    u16(
      0,
    ),

    u16(
      0,
    ),

    u16(
      0,
    ),

    u32(
      0,
    ),

    u32(
      localOffset,
    ),

    filenameBytes,
  );
}

function endOfCentralDirectory(
  {
    entries,
    centralSize,
    centralOffset,
  },
) {
  return concatBytes(
    u32(
      0x06054b50,
    ),

    u16(
      0,
    ),

    u16(
      0,
    ),

    u16(
      entries,
    ),

    u16(
      entries,
    ),

    u32(
      centralSize,
    ),

    u32(
      centralOffset,
    ),

    u16(
      0,
    ),
  );
}

function safeNamePart(
  value,
  {
    fallback =
      'PEDIDO',
    uppercase =
      false,
  } = {},
) {
  const normalized =
    String(
      value
      || '',
    )
      .normalize(
        'NFD',
      )
      .replace(
        /[\u0300-\u036f]/g,
        '',
      )
      .replace(
        /[^a-zA-Z0-9._ -]+/g,
        ' ',
      )
      .trim()
      .replace(
        /[ ._-]+/g,
        '_',
      )
      .replace(
        /^_+|_+$/g,
        '',
      );

  const result =
    normalized
    || fallback;

  return uppercase
    ? result
      .toUpperCase()
    : result;
}

function safeZipPath(
  value,
) {
  const parts = String(value || '').split('/');
  return parts.map((part, index) => {
    // safeNamePart replaces periods with underscores. Preserve a file's
    // real extension so ZIP tools and image readers recognize its contents.
    // Never treat dots in intermediate folder names as file extensions.
    const extension = index === parts.length - 1
      ? extensionFromFilename(part)
      : '';
    const stem = extension ? part.slice(0, -extension.length) : part;
    return safeNamePart(stem, { fallback: 'ARQUIVO' }) + extension;
  }).join('/');
}

function extensionFromFilename(
  filename,
) {
  const match =
    String(
      filename
      || '',
    )
      .toLowerCase()
      .match(
        /(\.[a-z0-9]{1,12})$/,
      );

  return match
    ? match[1]
    : '';
}

function extensionFromMime(
  mimeType,
) {
  const map = {
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

    'application/pdf':
      '.pdf',
  };

  return map[
    String(
      mimeType
      || '',
    )
      .toLowerCase()
  ]
    || '';
}

function cleanExtension(
  upload,
) {
  return extensionFromFilename(
    upload.original_filename,
  )
  || extensionFromFilename(
    upload.stored_filename,
  )
  || extensionFromMime(
    upload.mime_type,
  )
  || '.bin';
}

function personBaseName(
  eventType,
) {
  if (
    eventType
    === 'birthday'
  ) {
    return 'aniversariante';
  }

  if (
    eventType
    === '15_years'
  ) {
    return 'debutante';
  }

  if (
    eventType
    === 'wedding'
  ) {
    return 'casal';
  }

  return 'homenageado';
}

function labelFromKey(
  key,
) {
  const labels = {
    event_time: 'Horário da festa',
    venue_name: 'Nome do local',
    venue_address: 'Endereço da festa',
    theme_or_style: 'Tema ou estilo da festa',
    special_info: 'Informações especiais',
    age: 'Idade',
    appearance_choice: 'Quem deve aparecer no convite?',
    visual_style: 'Estilo da pessoa no convite',
    outfit_choice: 'Preferência de roupa',
    desired_colors: 'Quais cores deseja ver?',
    avoid_colors: 'Quais cores não deseja ver?',
    visual_feeling: 'Que sensação deseja transmitir?',
    music_choice: 'Quer música no convite?',
    music_request: 'Música escolhida (nome ou link)',
    must_have: 'O que não pode faltar?',
    must_avoid: 'O que evitar no convite?',
    exact_text: 'Texto que deve aparecer exatamente',
    references_note: 'Observações sobre as referências',
  };
  if (labels[key]) return labels[key];
  return String(
    key
    || '',
  )
    .replace(
      /([a-z0-9])([A-Z])/g,
      '$1 $2',
    )
    .replace(
      /_/g,
      ' ',
    )
    .replace(
      /\b\w/g,
      (character) =>
        character
          .toUpperCase(),
    );
}

function textValue(
  value,
) {
  const options = {
    yes: 'Sim', no: 'Não', libri_decides: 'Deixo a Libri decidir',
    joyful: 'Alegre', delicate: 'Delicado', magical: 'Mágico',
    elegant: 'Elegante', fun: 'Divertido', cinematic: 'Cinematográfico',
    stylized_doll: 'Bonequinho estilizado', realistic_detailed: 'Realista e detalhado',
  };
  const translate = item => options[item] || item;
  if (
    value === null
    || value === undefined
    || value === ''
  ) {
    return '';
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    return value.map(translate).join(', ');
  }

  if (
    typeof value
    === 'object'
  ) {
    return JSON.stringify(
      value,
      null,
      2,
    );
  }

  return String(translate(value));
}

function moneyBr(
  cents,
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
      Number(
        cents
        || 0,
      )
      / 100,
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

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return String(
      value,
    );
  }

  return new Intl
    .DateTimeFormat(
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
    )
    .format(
      date,
    );
}

async function orderBundleData(
  db,
  orderCode,
) {
  const order =
    await db
      .prepare(
        `
          SELECT
            o.id,
            o.order_code,
            o.event_type,
            o.event_subtype,
            o.honoree_display_name,
            o.event_date,
            o.delivery_start,
            o.delivery_end,
            o.status,
            o.source,
            o.created_at,

            c.name AS customer_name,
            c.whatsapp,
            c.email,

            p.subtotal_cents,
            p.combo_discount_cents,
            p.coupon_discount_cents,
            p.urgency_percent,
            p.urgency_amount_cents,
            p.total_cents,
            p.payment_method,
            p.deposit_cents,
            p.balance_cents
          FROM v2_orders o
          INNER JOIN v2_customers c
            ON c.id = o.customer_id
          INNER JOIN v2_order_pricing p
            ON p.order_id = o.id
          WHERE o.order_code = ?
          LIMIT 1
        `,
      )
      .bind(
        orderCode,
      )
      .first();

  if (!order) {
    return null;
  }

  const [
    itemsResult,
    briefing,
    uploadsResult,
    paymentsResult,
    contractsResult,
    termsResult,
  ] =
    await Promise.all([
      db
        .prepare(
          `
            SELECT
              item_type,
              item_code,
              name_snapshot,
              quantity,
              unit_price_cents,
              points_units,
              configuration_json
            FROM v2_order_items
            WHERE order_id = ?
            ORDER BY id
          `,
        )
        .bind(
          order.id,
        )
        .all(),

      db
        .prepare(
          `
            SELECT
              schema_version,
              data_json,
              completion_percent,
              started_at,
              completed_at,
              updated_at
            FROM v2_briefings
            WHERE order_id = ?
            LIMIT 1
          `,
        )
        .bind(
          order.id,
        )
        .first(),

      db
        .prepare(
          `
            SELECT
              id,
              category,
              original_filename,
              stored_filename,
              mime_type,
              size_bytes,
              r2_key,
              note,
              created_at
            FROM v2_briefing_uploads
            WHERE order_id = ?
            ORDER BY
              category,
              id
          `,
        )
        .bind(
          order.id,
        )
        .all(),

      db
        .prepare(
          `
            SELECT
              provider,
              payment_type,
              method,
              status,
              amount_cents,
              fee_cents,
              net_cents,
              installments,
              paid_at,
              created_at
            FROM v2_payments
            WHERE order_id = ?
            ORDER BY
              COALESCE(
                paid_at,
                created_at
              ),
              id
          `,
        )
        .bind(
          order.id,
        )
        .all(),

      db
        .prepare(
          `
            SELECT
              id,
              version,
              status,
              pdf_r2_key,
              document_hash,
              created_at,
              updated_at,
              signed_at
            FROM v2_contracts
            WHERE
              order_id = ?
              AND pdf_r2_key IS NOT NULL
            ORDER BY
              version,
              id
          `,
        )
        .bind(
          order.id,
        )
        .all(),

      db
        .prepare(
          `
            SELECT
              a.terms_version,
              a.terms_hash,
              a.accepted_at,
              a.evidence_json,
              v.body
            FROM v2_order_terms_acceptances a
            INNER JOIN v2_terms_versions v
              ON v.version = a.terms_version
            WHERE a.order_id = ?
            ORDER BY
              a.accepted_at,
              a.id
          `,
        )
        .bind(
          order.id,
        )
        .all(),
    ]);

  return {
    order,

    items:
      itemsResult.results
      || [],

    briefing: {
      schemaVersion:
        briefing
          ?.schema_version
        || '2.0',

      data:
        parseJson(
          briefing
            ?.data_json,
          {},
        ),

      completionPercent:
        Number(
          briefing
            ?.completion_percent
          || 0,
        ),

      startedAt:
        briefing
          ?.started_at
        || null,

      completedAt:
        briefing
          ?.completed_at
        || null,

      updatedAt:
        briefing
          ?.updated_at
        || null,
    },

    uploads:
      uploadsResult.results
      || [],

    payments:
      paymentsResult.results
      || [],

    contracts:
      contractsResult.results
      || [],

    terms:
      termsResult.results
      || [],
  };
}

function briefingText(
  bundle,
) {
  const {
    order,
    items,
    briefing,
  } =
    bundle;

  const product =
    items.find(
      (item) =>
        item.item_type
        === 'product',
    );

  const addons =
    items
      .filter(
        (item) =>
          item.item_type
          === 'addon',
      );

  const lines = [
    `PEDIDO ${order.order_code}`,
    `Homenageado/evento: ${order.honoree_display_name}`,
    `Data do evento: ${dateBr(order.event_date)}`,
    `Produto: ${product?.name_snapshot || 'Não identificado'}`,
    `Adicionais: ${
      addons.length
        ? addons
          .map(
            (item) =>
              item.name_snapshot,
          )
          .join(
            ', ',
          )
        : 'Nenhum'
    }`,
    '',
    'DADOS DO CONVITE',
  ];

  for (
    const [
      key,
      value,
    ]
    of Object.entries(
      briefing.data
      || {},
    )
  ) {
    const rendered =
      textValue(
        value,
      );

    if (!rendered) {
      continue;
    }

    lines.push(
      `${
        labelFromKey(
          key,
        )
      }: ${
        rendered
      }`,
    );
  }

  return lines
    .join(
      '\n',
    );
}

function summaryText(
  bundle,
) {
  const {
    order,
    items,
    payments,
    briefing,
    uploads,
  } =
    bundle;

  const product =
    items.find(
      (item) =>
        item.item_type
        === 'product',
    );

  const addons =
    items
      .filter(
        (item) =>
          item.item_type
          === 'addon',
      );

  const approvedPayments =
    payments.filter(
      (payment) =>
        payment.status
        === 'approved',
    );

  const paidCents =
    approvedPayments.reduce(
      (
        total,
        payment,
      ) =>
        total
        + Number(
          payment.amount_cents
          || 0,
        ),
      0,
    );

  const feeCents =
    approvedPayments.reduce(
      (
        total,
        payment,
      ) =>
        total
        + Number(
          payment.fee_cents
          || 0,
        ),
      0,
    );

  const uploadCounts =
    uploads.reduce(
      (
        accumulator,
        upload,
      ) => {
        accumulator[
          upload.category
        ] =
          (
            accumulator[
              upload.category
            ]
            || 0
          )
          + 1;

        return accumulator;
      },
      {},
    );

  return [
    `RESUMO DO PEDIDO ${order.order_code}`,
    '',
    'CLIENTE',
    `Nome: ${order.customer_name}`,
    `WhatsApp: ${order.whatsapp}`,
    `E-mail: ${order.email || ''}`,
    '',
    'EVENTO',
    `Homenageado/evento: ${order.honoree_display_name}`,
    `Tipo: ${order.event_type}${order.event_subtype ? ` / ${order.event_subtype}` : ''}`,
    `Data: ${dateBr(order.event_date)}`,
    `Janela de entrega: ${dateBr(order.delivery_start)} a ${dateBr(order.delivery_end)}`,
    '',
    'PRODUTO',
    `Principal: ${product?.name_snapshot || 'Não identificado'}`,
    `Adicionais: ${
      addons.length
        ? addons
          .map(
            (item) =>
              item.name_snapshot,
          )
          .join(
            ', ',
          )
        : 'Nenhum'
    }`,
    '',
    'COMERCIAL',
    `Subtotal: ${moneyBr(order.subtotal_cents)}`,
    `Desconto de combo: ${moneyBr(order.combo_discount_cents)}`,
    `Desconto de cupom: ${moneyBr(order.coupon_discount_cents)}`,
    `Urgência: ${Number(order.urgency_percent || 0)}% (${moneyBr(order.urgency_amount_cents)})`,
    `Total: ${moneyBr(order.total_cents)}`,
    `Forma: ${order.payment_method || ''}`,
    `Pago: ${moneyBr(paidCents)}`,
    `Taxas registradas: ${moneyBr(feeCents)}`,
    `Saldo estimado: ${moneyBr(Math.max(0, Number(order.total_cents || 0) - paidCents))}`,
    '',
    'DADOS DO CONVITE',
    `Versão: ${briefing.schemaVersion}`,
    `Conclusão: ${briefing.completionPercent}%`,
    `Finalizado em: ${briefing.completedAt || ''}`,
    '',
    'ARQUIVOS',
    `Fotos pessoais: ${uploadCounts.person || 0}`,
    `Roupa: ${uploadCounts.outfit || 0}`,
    `Referências: ${uploadCounts.reference || 0}`,
    `Adicionais: ${uploadCounts.addon || 0}`,
    `Outros: ${uploadCounts.other || 0}`,
    '',
    `Gerado em: ${nowIso()}`,
  ].join(
    '\n',
  );
}

function termsText(
  bundle,
) {
  if (
    !bundle.terms.length
  ) {
    return '';
  }

  const blocks =
    bundle.terms.map(
      (
        term,
        index,
      ) => [
        `ACEITE ${
          index + 1
        }`,
        `Versão: ${term.terms_version}`,
        `Aceito em: ${term.accepted_at}`,
        `Hash: ${term.terms_hash || ''}`,
        '',
        term.body,
      ].join(
        '\n',
      ),
    );

  return [
    `TERMOS ACEITOS • ${bundle.order.order_code}`,
    '',
    ...blocks,
  ].join(
    '\n\n========================================\n\n',
  );
}

function uploadEntries(
  bundle,
) {
  const counters = {
    person: 0,
    outfit: 0,
    reference: 0,
    addon: 0,
    other: 0,
  };

  const personName =
    personBaseName(
      bundle.order
        .event_type,
    );

  const definitions = {
    person: {
      folder:
        'FOTOS',

      base:
        personName,
    },

    outfit: {
      folder:
        'ROUPA',

      base:
        'roupa',
    },

    reference: {
      folder:
        'REFERENCIAS',

      base:
        'referencia',
    },

    addon: {
      folder:
        'ADICIONAIS',

      base:
        'adicional',
    },

    other: {
      folder:
        'ADICIONAIS/OUTROS',

      base:
        'outro',
    },
  };

  return bundle.uploads
    .map(
      (upload) => {
        const definition =
          definitions[
            upload.category
          ]
          || definitions.other;

        counters[
          upload.category
        ] =
          (
            counters[
              upload.category
            ]
            || 0
          )
          + 1;

        const number =
          String(
            counters[
              upload.category
            ],
          )
            .padStart(
              2,
              '0',
            );

        const extension =
          cleanExtension(
            upload,
          );

        return {
          path:
            `${
              definition.folder
            }/${
              definition.base
            }-${
              number
            }${
              extension
            }`,

          kind:
            'r2',

          r2Key:
            upload.r2_key,

          expectedSize:
            Number(
              upload.size_bytes
              || 0,
            ),
        };
      },
    );
}

function contractEntries(
  bundle,
) {
  return bundle.contracts
    .map(
      (contract) => {
        const signed =
          contract.status
          === 'signed';

        const filename =
          signed
            ? (
              bundle.contracts
                .filter(
                  (item) =>
                    item.status
                    === 'signed',
                )
                .length
              === 1
                ? 'contrato-assinado.pdf'
                : `contrato-assinado-v${contract.version}.pdf`
            )
            : `contrato-v${contract.version}.pdf`;

        return {
          path:
            `DOCUMENTOS/${filename}`,

          kind:
            'r2',

          r2Key:
            contract.pdf_r2_key,
        };
      },
    );
}

function buildEntries(
  bundle,
) {
  const entries = [
    {
      path:
        'DADOS_DO_CONVITE/dados-do-convite.txt',

      kind:
        'text',

      text:
        briefingText(
          bundle,
        ),
    },

    {
      path:
        'DADOS_DO_CONVITE/resumo-pedido.txt',

      kind:
        'text',

      text:
        summaryText(
          bundle,
        ),
    },

    ...uploadEntries(
      bundle,
    ),

    ...contractEntries(
      bundle,
    ),
  ];

  const acceptedTerms =
    termsText(
      bundle,
    );

  if (
    acceptedTerms
  ) {
    entries.push({
      path:
        'DOCUMENTOS/termos-aceitos.txt',

      kind:
        'text',

      text:
        acceptedTerms,
    });
  }

  return entries;
}

async function prepareR2Entries(
  env,
  entries,
) {
  const prepared = [];

  for (
    const entry
    of entries
  ) {
    if (
      entry.kind
      !== 'r2'
    ) {
      prepared.push(
        entry,
      );

      continue;
    }

    const object =
      await env.FILES
        .get(
          entry.r2Key,
        );

    if (!object) {
      /*
       * Um arquivo ausente no R2 não derruba
       * a pasta inteira. Ele entra no relatório
       * de ausências, que será adicionado depois.
       */
      prepared.push({
        ...entry,

        missing:
          true,
      });

      continue;
    }

    prepared.push({
      ...entry,

      object,
    });
  }

  return prepared;
}

function missingFilesReport(
  entries,
) {
  const missing =
    entries.filter(
      (entry) =>
        entry.missing
        === true,
    );

  if (!missing.length) {
    return null;
  }

  return {
    path:
      'DOCUMENTOS/arquivos-ausentes.txt',

    kind:
      'text',

    text: [
      'ATENÇÃO',
      '',
      'Os seguintes arquivos estavam registrados no pedido, mas não foram encontrados no armazenamento no momento da geração do ZIP:',
      '',
      ...missing.map(
        (entry) =>
          `- ${entry.path}`,
      ),
      '',
      'O ZIP foi gerado com todos os demais arquivos disponíveis.',
    ].join(
      '\n',
    ),
  };
}

async function streamEntryBytes(
  entry,
  onChunk,
) {
  if (
    entry.kind
    === 'text'
  ) {
    const bytes =
      encoder.encode(
        entry.text
        || '',
      );

    await onChunk(
      bytes,
    );

    return {
      size:
        bytes.length,
    };
  }

  if (
    entry.missing
  ) {
    return {
      size:
        0,
    };
  }

  const reader =
    entry.object
      .body
      .getReader();

  let size = 0;

  try {
    while (true) {
      const {
        done,
        value,
      } =
        await reader
          .read();

      if (done) {
        break;
      }

      const bytes =
        value
        instanceof Uint8Array
          ? value
          : new Uint8Array(
            value,
          );

      size +=
        bytes.length;

      if (
        size
        > 0xffffffff
      ) {
        throw new Error(
          'Um dos arquivos ultrapassa o limite ZIP de 4 GB.',
        );
      }

      await onChunk(
        bytes,
      );
    }
  } finally {
    reader.releaseLock();
  }

  return {
    size,
  };
}

function createZipStream(
  entries,
) {
  const stream =
    new TransformStream();

  const writer =
    stream.writable
      .getWriter();

  const central = [];

  let offset = 0;

  const write =
    async (
      bytes,
    ) => {
      await writer.write(
        bytes,
      );

      offset +=
        bytes.length;

      if (
        offset
        > 0xffffffff
      ) {
        throw new Error(
          'A pasta ultrapassa o limite ZIP de 4 GB.',
        );
      }
    };

  (
    async () => {
      try {
        for (
          const entry
          of entries
        ) {
          if (
            entry.missing
          ) {
            continue;
          }

          const path =
            safeZipPath(
              entry.path,
            );

          const filenameBytes =
            encoder.encode(
              path,
            );

          const {
            dosDate,
            dosTime,
          } =
            zipDosDateTime(
              new Date(),
            );

          const localOffset =
            offset;

          await write(
            localFileHeader(
              filenameBytes,
              dosDate,
              dosTime,
            ),
          );

          let runningCrc =
            0xffffffff;

          let size = 0;

          await streamEntryBytes(
            entry,
            async (
              chunk,
            ) => {
              runningCrc =
                updateCrc32(
                  runningCrc,
                  chunk,
                );

              size +=
                chunk.length;

              await write(
                chunk,
              );
            },
          );

          const crc32 =
            finalizedCrc32(
              runningCrc,
            );

          await write(
            dataDescriptor(
              crc32,
              size,
            ),
          );

          central.push({
            filenameBytes,
            dosDate,
            dosTime,
            crc32,
            size,
            localOffset,
          });
        }

        const centralOffset =
          offset;

        for (
          const record
          of central
        ) {
          await write(
            centralDirectoryHeader(
              record,
            ),
          );
        }

        const centralSize =
          offset
          - centralOffset;

        await write(
          endOfCentralDirectory({
            entries:
              central.length,

            centralSize,

            centralOffset,
          }),
        );

        await writer
          .close();
      } catch (
        error
      ) {
        await writer
          .abort(
            error,
          );
      }
    }
  )();

  return stream.readable;
}

export async function downloadV2OrderFolder(
  env,
  orderCode,
) {
  if (!env.FILES) {
    return fail(
      'Armazenamento R2 ainda não configurado.',
      503,
    );
  }

  const bundle =
    await orderBundleData(
      env.DB,
      orderCode,
    );

  if (!bundle) {
    return fail(
      'Pedido não encontrado.',
      404,
    );
  }

  let entries =
    buildEntries(
      bundle,
    );

  entries =
    await prepareR2Entries(
      env,
      entries,
    );

  const missingReport =
    missingFilesReport(
      entries,
    );

  if (
    missingReport
  ) {
    entries.push(
      missingReport,
    );
  }

  const folderName =
    `${
      safeNamePart(
        bundle.order
          .honoree_display_name,
        {
          fallback:
            'PEDIDO',

          uppercase:
            true,
        },
      )
    }_${
      safeNamePart(
        bundle.order
          .order_code,
        {
          fallback:
            'LIBRI',

          uppercase:
            true,
        },
      )
    }`;

  entries =
    entries.map(
      (entry) => ({
        ...entry,

        path:
          `${
            folderName
          }/${
            entry.path
          }`,
      }),
    );

  const stream =
    createZipStream(
      entries,
    );

  return new Response(
    stream,
    {
      status:
        200,

      headers: {
        'content-type':
          'application/zip',

        'content-disposition':
          `attachment; filename="${folderName}.zip"`,

        'cache-control':
          'private, no-store, max-age=0',

        'x-content-type-options':
          'nosniff',

        'x-libri-generated-at':
          nowIso(),
      },
    },
  );
}
