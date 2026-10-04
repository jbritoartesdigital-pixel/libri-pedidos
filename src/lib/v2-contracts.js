import {
  PDFDocument,
  StandardFonts,
  rgb,
} from 'pdf-lib';

import {
  fail,
  nowIso,
  parseJson,
} from './http.js';

import {
  createV2AdminNotification,
} from './v2-notifications.js';

const TOKEN_PATTERN =
  /^ord_[a-f0-9]{36}$/;

const PAGE_WIDTH =
  595.28;

const PAGE_HEIGHT =
  841.89;

const MARGIN_X =
  54;

const MARGIN_TOP =
  58;

const MARGIN_BOTTOM =
  58;

const BODY_FONT_SIZE =
  10.5;

const BODY_LINE_HEIGHT =
  15;

function cleanText(
  value,
  maxLength = 100000,
) {
  return String(
    value
    ?? '',
  )
    .trim()
    .slice(
      0,
      maxLength,
    );
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
      `${
        value
      }T12:00:00Z`,
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

function dateTimeBr(
  value,
) {
  if (!value) {
    return '';
  }

  const date =
    new Date(
      value,
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
          'America/Sao_Paulo',

        day:
          '2-digit',

        month:
          '2-digit',

        year:
          'numeric',

        hour:
          '2-digit',

        minute:
          '2-digit',
      },
    )
    .format(
      date,
    );
}

function paymentLabel(
  method,
) {
  if (
    method
    === 'pix'
  ) {
    return 'Pix';
  }

  if (
    method
    === 'card'
  ) {
    return 'Cartão';
  }

  return String(
    method
    || '',
  );
}

function normalizePdfText(
  value,
) {
  return String(
    value
    || '',
  )
    .replace(
      /\u00a0/g,
      ' ',
    )
    .replace(
      /[“”]/g,
      '"',
    )
    .replace(
      /[‘’]/g,
      "'",
    )
    .replace(
      /[–—]/g,
      '-',
    )
    .replace(
      /…/g,
      '...',
    )
    .replace(
      /[^\u0009\u000a\u000d\u0020-\u007e\u00a0-\u00ff]/g,
      '',
    );
}

async function sha256Hex(
  value,
) {
  const bytes =
    value
    instanceof Uint8Array
      ? value
      : new TextEncoder()
        .encode(
          String(
            value
            ?? '',
          ),
        );

  const digest =
    await crypto
      .subtle
      .digest(
        'SHA-256',
        bytes,
      );

  return Array.from(
    new Uint8Array(
      digest,
    ),
    (byte) =>
      byte
        .toString(
          16,
        )
        .padStart(
          2,
          '0',
        ),
  )
    .join('');
}

async function orderContractContext(
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
            o.public_token,
            o.event_type,
            o.event_subtype,
            o.honoree_display_name,
            o.event_date,
            o.delivery_start,
            o.delivery_end,
            o.status,

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

  const items =
    await db
      .prepare(
        `
          SELECT
            item_type,
            item_code,
            name_snapshot,
            quantity,
            unit_price_cents,
            configuration_json
          FROM v2_order_items
          WHERE order_id = ?
          ORDER BY id
        `,
      )
      .bind(
        order.id,
      )
      .all();

  const settingsResult =
    await db
      .prepare(
        `
          SELECT
            key,
            value
          FROM v2_settings
          WHERE key IN (
            'company_name',
            'company_legal_name',
            'company_document',
            'company_email',
            'company_instagram',
            'company_address',
            'company_city',
            'company_state',
            'libri_whatsapp'
          )
        `,
      )
      .all();

  const settings =
    Object.fromEntries(
      (
        settingsResult.results
        || []
      )
        .map(
          (row) => [
            row.key,
            row.value,
          ],
        ),
    );

  const rows =
    items.results
    || [];

  const product =
    rows.find(
      (row) =>
        row.item_type
        === 'product',
    );

  const addons =
    rows.filter(
      (row) =>
        row.item_type
        === 'addon',
    );

  return {
    order,

    product,

    addons,

    settings,
  };
}

async function orderByToken(
  db,
  token,
) {
  if (
    !TOKEN_PATTERN
      .test(
        String(
          token
          || '',
        ),
      )
  ) {
    return null;
  }

  return db
    .prepare(
      `
        SELECT
          o.id,
          o.order_code,
          o.public_token,
          o.honoree_display_name,

          c.name AS customer_name,
          c.whatsapp
        FROM v2_orders o
        INNER JOIN v2_customers c
          ON c.id = o.customer_id
        WHERE o.public_token = ?
        LIMIT 1
      `,
    )
    .bind(
      token,
    )
    .first();
}

async function activeContractTemplate(
  db,
) {
  return db
    .prepare(
      `
        SELECT
          id,
          version,
          title,
          body,
          content_hash,
          published_at
        FROM v2_contract_templates
        WHERE active = 1
        ORDER BY version DESC
        LIMIT 1
      `,
    )
    .first();
}

function placeholderValues(
  context,
) {
  const {
    order,
    product,
    addons,
    settings,
  } =
    context;

  const cityState =
    [
      settings.company_city,
      settings.company_state,
    ]
      .filter(Boolean)
      .join(
        ' - ',
      );

  return {
    ORDER_CODE:
      order.order_code,

    CUSTOMER_NAME:
      order.customer_name,

    CUSTOMER_WHATSAPP:
      order.whatsapp,

    CUSTOMER_EMAIL:
      order.email
      || '',

    HONOREE_NAME:
      order.honoree_display_name,

    EVENT_TYPE:
      order.event_type,

    EVENT_SUBTYPE:
      order.event_subtype
      || '',

    EVENT_DATE:
      dateBr(
        order.event_date,
      ),

    DELIVERY_START:
      dateBr(
        order.delivery_start,
      ),

    DELIVERY_END:
      dateBr(
        order.delivery_end,
      ),

    PRODUCT_NAME:
      product
        ?.name_snapshot
      || '',

    ADDONS:
      addons.length
        ? addons
          .map(
            (item) =>
              item.name_snapshot,
          )
          .join(
            ', ',
          )
        : 'Nenhum',

    SUBTOTAL:
      moneyBr(
        order.subtotal_cents,
      ),

    COMBO_DISCOUNT:
      moneyBr(
        order.combo_discount_cents,
      ),

    COUPON_DISCOUNT:
      moneyBr(
        order.coupon_discount_cents,
      ),

    URGENCY_PERCENT:
      String(
        Number(
          order.urgency_percent
          || 0,
        ),
      ),

    URGENCY_AMOUNT:
      moneyBr(
        order.urgency_amount_cents,
      ),

    TOTAL:
      moneyBr(
        order.total_cents,
      ),

    PAYMENT_METHOD:
      paymentLabel(
        order.payment_method,
      ),

    DEPOSIT:
      moneyBr(
        order.deposit_cents,
      ),

    BALANCE:
      moneyBr(
        order.balance_cents,
      ),

    LIBRI_NAME:
      settings.company_name
      || 'Libri Convites',

    LIBRI_LEGAL_NAME:
      settings.company_legal_name
      || settings.company_name
      || 'Libri Convites',

    LIBRI_DOCUMENT:
      settings.company_document
      || '',

    LIBRI_EMAIL:
      settings.company_email
      || '',

    LIBRI_WHATSAPP:
      settings.libri_whatsapp
      || '',

    LIBRI_INSTAGRAM:
      settings.company_instagram
      || '@libriconvites',

    LIBRI_ADDRESS:
      settings.company_address
      || '',

    LIBRI_CITY_STATE:
      cityState,

    GENERATED_DATE:
      dateBr(
        nowIso()
          .slice(
            0,
            10,
          ),
      ),
  };
}

function renderTemplate(
  template,
  context,
) {
  const values =
    placeholderValues(
      context,
    );

  const unknown =
    new Set();

  const rendered =
    String(
      template.body
      || '',
    )
      .replace(
        /\{\{([A-Z0-9_]+)\}\}/g,
        (
          match,
          key,
        ) => {
          if (
            !Object.prototype
              .hasOwnProperty
              .call(
                values,
                key,
              )
          ) {
            unknown.add(
              key,
            );

            return match;
          }

          return values[
            key
          ];
        },
      );

  if (
    unknown.size
  ) {
    const error =
      new Error(
        `O modelo de contrato usa campos não reconhecidos: ${
          [
            ...unknown,
          ]
            .join(
              ', ',
            )
        }.`,
      );

    error.code =
      'unknown_contract_placeholders';

    throw error;
  }

  return cleanText(
    rendered,
    100000,
  );
}

async function nextContractVersion(
  db,
  orderId,
) {
  const row =
    await db
      .prepare(
        `
          SELECT
            COALESCE(
              MAX(version),
              0
            ) AS max_version
          FROM v2_contracts
          WHERE order_id = ?
        `,
      )
      .bind(
        orderId,
      )
      .first();

  return Number(
    row
      ?.max_version
    || 0,
  )
  + 1;
}

async function contractById(
  db,
  id,
) {
  return db
    .prepare(
      `
        SELECT
          c.id,
          c.order_id,
          c.version,
          c.status,
          c.body_snapshot,
          c.pdf_r2_key,
          c.document_hash,
          c.template_version,
          c.sent_to_customer_at,
          c.pdf_hash,
          c.created_at,
          c.updated_at,
          c.signed_at,

          o.order_code,
          o.public_token,
          o.honoree_display_name,

          customer.name AS customer_name,
          customer.whatsapp AS customer_whatsapp
        FROM v2_contracts c
        INNER JOIN v2_orders o
          ON o.id = c.order_id
        INNER JOIN v2_customers customer
          ON customer.id = o.customer_id
        WHERE c.id = ?
        LIMIT 1
      `,
    )
    .bind(
      id,
    )
    .first();
}

async function signaturesForContract(
  db,
  contractId,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            id,
            party,
            signer_name,
            signed_at,
            evidence_json
          FROM v2_contract_signatures
          WHERE contract_id = ?
          ORDER BY
            CASE party
              WHEN 'libri' THEN 0
              ELSE 1
            END,
            signed_at,
            id
        `,
      )
      .bind(
        contractId,
      )
      .all();

  return (
    result.results
    || []
  )
    .map(
      (row) => ({
        id:
          row.id,

        party:
          row.party,

        signerName:
          row.signer_name,

        signedAt:
          row.signed_at,

        evidence:
          parseJson(
            row.evidence_json,
            {},
          ),
      }),
    );
}

function wrapLine(
  text,
  font,
  size,
  maxWidth,
) {
  const words =
    String(
      text
      || '',
    )
      .split(
        /\s+/,
      );

  const lines = [];

  let current = '';

  for (
    const word
    of words
  ) {
    const candidate =
      current
        ? `${
          current
        } ${
          word
        }`
        : word;

    const width =
      font.widthOfTextAtSize(
        candidate,
        size,
      );

    if (
      width <= maxWidth
      || !current
    ) {
      current =
        candidate;

      continue;
    }

    lines.push(
      current,
    );

    current =
      word;
  }

  if (
    current
  ) {
    lines.push(
      current,
    );
  }

  return lines.length
    ? lines
    : [
      '',
    ];
}

async function buildSignedContractPdf(
  contract,
  signatures,
) {
  const pdf =
    await PDFDocument
      .create();

  const regular =
    await pdf.embedFont(
      StandardFonts
        .TimesRoman,
    );

  const bold =
    await pdf.embedFont(
      StandardFonts
        .TimesRomanBold,
    );

  const body =
    normalizePdfText(
      contract.body_snapshot,
    );

  const maxWidth =
    PAGE_WIDTH
    - (
      MARGIN_X
      * 2
    );

  let page =
    pdf.addPage(
      [
        PAGE_WIDTH,
        PAGE_HEIGHT,
      ],
    );

  let y =
    PAGE_HEIGHT
    - MARGIN_TOP;

  const ensureRoom =
    (
      height,
    ) => {
      if (
        y - height
        >= MARGIN_BOTTOM
      ) {
        return;
      }

      page =
        pdf.addPage(
          [
            PAGE_WIDTH,
            PAGE_HEIGHT,
          ],
        );

      y =
        PAGE_HEIGHT
        - MARGIN_TOP;
    };

  const drawParagraph =
    (
      paragraph,
      {
        font =
          regular,

        size =
          BODY_FONT_SIZE,

        lineHeight =
          BODY_LINE_HEIGHT,

        after =
          7,
      } = {},
    ) => {
      const clean =
        normalizePdfText(
          paragraph,
        );

      if (!clean) {
        y -=
          lineHeight;

        return;
      }

      const lines =
        wrapLine(
          clean,
          font,
          size,
          maxWidth,
        );

      ensureRoom(
        (
          lines.length
          * lineHeight
        )
        + after,
      );

      for (
        const line
        of lines
      ) {
        page.drawText(
          line,
          {
            x:
              MARGIN_X,

            y,

            size,

            font,

            color:
              rgb(
                0.13,
                0.13,
                0.13,
              ),
          },
        );

        y -=
          lineHeight;
      }

      y -=
        after;
    };

  page.drawText(
    'LIBRI CONVITES',
    {
      x:
        MARGIN_X,

      y,

      size:
        15,

      font:
        bold,

      color:
        rgb(
          0.08,
          0.08,
          0.08,
        ),
    },
  );

  y -=
    25;

  page.drawText(
    `Contrato ${
      normalizePdfText(
        contract.order_code,
      )
    } • versão ${
      contract.version
    }`,
    {
      x:
        MARGIN_X,

      y,

      size:
        10,

      font:
        regular,
    },
  );

  y -=
    25;

  for (
    const paragraph
    of body.split(
      /\n/,
    )
  ) {
    drawParagraph(
      paragraph,
    );
  }

  ensureRoom(
    180,
  );

  y -=
    8;

  page.drawText(
    'ASSINATURAS ELETRÔNICAS',
    {
      x:
        MARGIN_X,

      y,

      size:
        12,

      font:
        bold,
    },
  );

  y -=
    22;

  for (
    const signature
    of signatures
  ) {
    const role =
      signature.party
      === 'libri'
        ? 'LIBRI CONVITES'
        : 'CLIENTE';

    drawParagraph(
      `${
        role
      }: ${
        normalizePdfText(
          signature.signerName,
        )
      }`,
      {
        font:
          bold,

        size:
          10,

        lineHeight:
          14,

        after:
          2,
      },
    );

    drawParagraph(
      `Assinado eletronicamente em ${
        dateTimeBr(
          signature.signedAt,
        )
      }.`,
      {
        size:
          9,

        lineHeight:
          13,

        after:
          8,
      },
    );
  }

  drawParagraph(
    `Hash do conteúdo contratado: ${
      contract.document_hash
    }`,
    {
      size:
        7.5,

      lineHeight:
        11,

      after:
        2,
    },
  );

  drawParagraph(
    'Documento gerado a partir do registro eletrônico de aceite armazenado pela Libri Convites.',
    {
      size:
        7.5,

      lineHeight:
        11,

      after:
        0,
    },
  );

  const pages =
    pdf.getPages();

  for (
    let index = 0;
    index < pages.length;
    index += 1
  ) {
    pages[
      index
    ]
      .drawText(
        `Página ${
          index + 1
        } de ${
          pages.length
        }`,
        {
          x:
            PAGE_WIDTH
            - MARGIN_X
            - 55,

          y:
            28,

          size:
            7,

          font:
            regular,

          color:
            rgb(
              0.45,
              0.45,
              0.45,
            ),
        },
      );
  }

  return pdf.save();
}

function whatsappUrl(
  number,
  message,
) {
  const digits =
    String(
      number
      || '',
    )
      .replace(
        /\D/g,
        '',
      );

  if (!digits) {
    return '';
  }

  return `https://wa.me/${
    digits
  }?text=${
    encodeURIComponent(
      message,
    )
  }`;
}

export async function listV2ContractsForAdmin(
  db,
  orderCode,
) {
  const context =
    await orderContractContext(
      db,
      orderCode,
    );

  if (!context) {
    return null;
  }

  const result =
    await db
      .prepare(
        `
          SELECT
            id,
            version,
            status,
            document_hash,
            template_version,
            sent_to_customer_at,
            pdf_hash,
            pdf_r2_key,
            created_at,
            updated_at,
            signed_at
          FROM v2_contracts
          WHERE order_id = ?
          ORDER BY
            version DESC,
            id DESC
        `,
      )
      .bind(
        context.order.id,
      )
      .all();

  const contracts = [];

  for (
    const row
    of result.results
    || []
  ) {
    contracts.push({
      id:
        row.id,

      version:
        row.version,

      status:
        row.status,

      templateVersion:
        row.template_version,

      documentHash:
        row.document_hash,

      pdfHash:
        row.pdf_hash,

      hasPdf:
        Boolean(
          row.pdf_r2_key,
        ),

      sentToCustomerAt:
        row.sent_to_customer_at,

      createdAt:
        row.created_at,

      updatedAt:
        row.updated_at,

      signedAt:
        row.signed_at,

      signatures:
        await signaturesForContract(
          db,
          row.id,
        ),
    });
  }

  return {
    order: {
      id:
        context.order.id,

      code:
        context.order.order_code,

      honoreeName:
        context.order.honoree_display_name,

      customerName:
        context.order.customer_name,
    },

    contracts,
  };
}

export async function generateV2Contract(
  env,
  orderCode,
) {
  const context =
    await orderContractContext(
      env.DB,
      orderCode,
    );

  if (!context) {
    return null;
  }

  const template =
    await activeContractTemplate(
      env.DB,
    );

  if (!template) {
    const error =
      new Error(
        'Publique um modelo de contrato em Loja / Configurações antes de gerar o contrato.',
      );

    error.code =
      'contract_template_missing';

    throw error;
  }

  const bodySnapshot =
    renderTemplate(
      template,
      context,
    );

  const documentHash =
    await sha256Hex(
      bodySnapshot,
    );

  const version =
    await nextContractVersion(
      env.DB,
      context.order.id,
    );

  const stamp =
    nowIso();

  await env.DB
    .prepare(
      `
        UPDATE v2_contracts
        SET
          status = 'superseded',
          updated_at = ?
        WHERE
          order_id = ?
          AND status IN (
            'draft',
            'waiting_libri',
            'waiting_customer'
          )
      `,
    )
    .bind(
      stamp,
      context.order.id,
    )
    .run();

  const result =
    await env.DB
      .prepare(
        `
          INSERT INTO v2_contracts(
            order_id,
            version,
            status,
            body_snapshot,
            document_hash,
            template_version,
            created_at,
            updated_at
          )
          VALUES (
            ?,
            ?,
            'waiting_libri',
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
        version,
        bodySnapshot,
        documentHash,
        template.version,
        stamp,
        stamp,
      )
      .run();

  const contractId =
    Number(
      result
        ?.meta
        ?.last_row_id,
    );

  await env.DB
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
          'contract_generated',
          'Contrato gerado sob solicitação administrativa.',
          ?,
          ?
        )
      `,
    )
    .bind(
      context.order.id,
      JSON.stringify({
        contractId,
        version,
        templateVersion:
          template.version,

        documentHash,
      }),
      stamp,
    )
    .run();

  return {
    id:
      contractId,

    version,

    status:
      'waiting_libri',

    templateVersion:
      template.version,

    body:
      bodySnapshot,

    documentHash,
  };
}

export async function signV2ContractByLibri(
  request,
  env,
  contractId,
) {
  const contract =
    await contractById(
      env.DB,
      contractId,
    );

  if (!contract) {
    return null;
  }

  if (
    contract.status
    === 'superseded'
    || contract.status
      === 'cancelled'
  ) {
    throw new Error(
      'Esta versão do contrato não pode mais ser assinada.',
    );
  }

  const existing =
    await env.DB
      .prepare(
        `
          SELECT id
          FROM v2_contract_signatures
          WHERE
            contract_id = ?
            AND party = 'libri'
          LIMIT 1
        `,
      )
      .bind(
        contract.id,
      )
      .first();

  const company =
    await env.DB
      .prepare(
        `
          SELECT value
          FROM v2_settings
          WHERE key = 'company_legal_name'
          LIMIT 1
        `,
      )
      .first();

  const fallback =
    await env.DB
      .prepare(
        `
          SELECT value
          FROM v2_settings
          WHERE key = 'company_name'
          LIMIT 1
        `,
      )
      .first();

  const signerName =
    cleanText(
      company
        ?.value
      || fallback
        ?.value
      || 'Libri Convites',
      180,
    );

  const stamp =
    nowIso();

  if (!existing) {
    await env.DB
      .prepare(
        `
          INSERT INTO v2_contract_signatures(
            contract_id,
            party,
            signer_name,
            signed_at,
            evidence_json
          )
          VALUES (
            ?,
            'libri',
            ?,
            ?,
            ?
          )
        `,
      )
      .bind(
        contract.id,
        signerName,
        stamp,
        JSON.stringify({
          method:
            'authenticated_admin_click',

          adminAuth:
            'passkey_session',

          userAgent:
            request.headers
              .get(
                'user-agent',
              )
            || '',

          cfRay:
            request.headers
              .get(
                'cf-ray',
              )
            || '',
        }),
      )
      .run();
  }

  await env.DB
    .prepare(
      `
        UPDATE v2_contracts
        SET
          status = 'waiting_customer',
          sent_to_customer_at = COALESCE(
            sent_to_customer_at,
            ?
          ),
          updated_at = ?
        WHERE id = ?
      `,
    )
    .bind(
      stamp,
      stamp,
      contract.id,
    )
    .run();

  await env.DB
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
          'contract_signed_libri',
          'Contrato assinado eletronicamente pela Libri e liberado para a cliente.',
          ?,
          ?
        )
      `,
    )
    .bind(
      contract.order_id,
      JSON.stringify({
        contractId:
          contract.id,

        version:
          contract.version,
      }),
      stamp,
    )
    .run();

  const privatePath =
    `/meu-pedido/${
      contract.public_token
    }`;

  const origin =
    new URL(
      request.url,
    )
      .origin;

  const privateUrl =
    `${
      origin
    }${
      privatePath
    }`;

  const message =
    `Oi, ${
      contract.customer_name
    }! 💛 O contrato do pedido ${
      contract.order_code
    } já está disponível para leitura e assinatura eletrônica na sua área privada: ${
      privateUrl
    }`;

  await createV2AdminNotification(
    env,
    {
      eventCode:
        'CONTRACT_READY_CUSTOMER',

      orderId:
        contract.order_id,

      title:
        'Contrato enviado para assinatura',

      body:
        `${
          contract.order_code
        } • ${
          contract.customer_name
        }`,

      actionUrl:
        `/admin/pedidos/${
          contract.order_code
        }`,

      priority:
        'normal',

      pushEligible:
        false,

      dedupeKey:
        `contract_ready:${
          contract.id
        }`,
    },
  );

  return {
    id:
      contract.id,

    status:
      'waiting_customer',

    customer: {
      privatePath,

      privateUrl,

      whatsappUrl:
        whatsappUrl(
          contract.customer_whatsapp,
          message,
        ),

      whatsappMessage:
        message,
    },
  };
}

export async function cancelV2Contract(
  env,
  contractId,
) {
  const contract =
    await contractById(
      env.DB,
      contractId,
    );

  if (!contract) {
    return null;
  }

  if (
    contract.status
    === 'signed'
  ) {
    throw new Error(
      'Contrato já assinado não pode ser cancelado por esta ação. Gere uma nova versão se necessário.',
    );
  }

  if (
    contract.status
    === 'cancelled'
  ) {
    return {
      id:
        contract.id,

      status:
        'cancelled',
    };
  }

  const stamp =
    nowIso();

  await env.DB.batch([
    env.DB
      .prepare(
        `
          UPDATE v2_contracts
          SET
            status = 'cancelled',
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        stamp,
        contract.id,
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
            'contract_cancelled',
            'Contrato cancelado antes da assinatura final.',
            ?,
            ?
          )
        `,
      )
      .bind(
        contract.order_id,
        JSON.stringify({
          contractId:
            contract.id,

          version:
            contract.version,
        }),
        stamp,
      ),
  ]);

  return {
    id:
      contract.id,

    status:
      'cancelled',
  };
}

export async function listV2ContractsForCustomer(
  db,
  token,
) {
  const order =
    await orderByToken(
      db,
      token,
    );

  if (!order) {
    return null;
  }

  const result =
    await db
      .prepare(
        `
          SELECT
            id,
            version,
            status,
            body_snapshot,
            document_hash,
            sent_to_customer_at,
            pdf_hash,
            pdf_r2_key,
            created_at,
            signed_at
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
        `,
      )
      .bind(
        order.id,
      )
      .all();

  const contracts = [];

  for (
    const row
    of result.results
    || []
  ) {
    contracts.push({
      id:
        row.id,

      version:
        row.version,

      status:
        row.status,

      body:
        row.body_snapshot,

      documentHash:
        row.document_hash,

      sentToCustomerAt:
        row.sent_to_customer_at,

      signedAt:
        row.signed_at,

      hasFinalPdf:
        Boolean(
          row.pdf_r2_key,
      ),

      pdfHash:
        row.pdf_hash,

      signatures:
        (
          await signaturesForContract(
            db,
            row.id,
          )
        )
          .map(
            (signature) => ({
              party:
                signature.party,

              signerName:
                signature.signerName,

              signedAt:
                signature.signedAt,
            }),
          ),
    });
  }

  return {
    order: {
      code:
        order.order_code,

      honoreeName:
        order.honoree_display_name,

      customerName:
        order.customer_name,
    },

    contracts,
  };
}

export async function signV2ContractByCustomer(
  request,
  env,
  token,
  contractId,
  body = {},
) {
  if (
    body.accepted
    !== true
  ) {
    throw new Error(
      'Confirme a assinatura para continuar.',
    );
  }

  const order =
    await orderByToken(
      env.DB,
      token,
    );

  if (!order) {
    return null;
  }

  const contract =
    await contractById(
      env.DB,
      contractId,
    );

  if (
    !contract
    || Number(
      contract.order_id,
    )
      !== Number(
        order.id,
      )
  ) {
    return null;
  }

  if (
    contract.status
    === 'signed'
  ) {
    return {
      id:
        contract.id,

      status:
        'signed',

      alreadySigned:
        true,
    };
  }

  if (
    contract.status
    !== 'waiting_customer'
  ) {
    throw new Error(
      'Este contrato não está disponível para assinatura.',
    );
  }

  const libriSignature =
    await env.DB
      .prepare(
        `
          SELECT id
          FROM v2_contract_signatures
          WHERE
            contract_id = ?
            AND party = 'libri'
          LIMIT 1
        `,
      )
      .bind(
        contract.id,
      )
      .first();

  if (!libriSignature) {
    throw new Error(
      'A Libri ainda não assinou esta versão do contrato.',
    );
  }

  const signerName =
    cleanText(
      body.signerName
      || order.customer_name,
      180,
    );

  if (!signerName) {
    throw new Error(
      'Nome da pessoa que está assinando é obrigatório.',
    );
  }

  const stamp =
    nowIso();

  await env.DB
    .prepare(
      `
        INSERT OR IGNORE INTO v2_contract_signatures(
          contract_id,
          party,
          signer_name,
          signed_at,
          evidence_json
        )
        VALUES (
          ?,
          'customer',
          ?,
          ?,
          ?
        )
      `,
    )
    .bind(
      contract.id,
      signerName,
      stamp,
      JSON.stringify({
        method:
          'private_order_link_click',

        explicitAcceptance:
          true,

        userAgent:
          request.headers
            .get(
              'user-agent',
            )
          || '',

        cfRay:
          request.headers
            .get(
              'cf-ray',
            )
          || '',

        orderTokenBound:
          true,
      }),
    )
    .run();

  const signatures =
    await signaturesForContract(
      env.DB,
      contract.id,
    );

  const hasLibri =
    signatures.some(
      (signature) =>
        signature.party
        === 'libri',
    );

  const hasCustomer =
    signatures.some(
      (signature) =>
        signature.party
        === 'customer',
    );

  if (
    !hasLibri
    || !hasCustomer
  ) {
    throw new Error(
      'Não foi possível concluir as duas assinaturas.',
    );
  }

  if (!env.FILES) {
    throw new Error(
      'Armazenamento R2 ainda não configurado.',
    );
  }

  const pdfBytes =
    await buildSignedContractPdf(
      contract,
      signatures,
    );

  const pdfHash =
    await sha256Hex(
      pdfBytes,
    );

  const r2Key =
    `orders/${
      contract.order_id
    }/documents/contract-v${
      contract.version
    }-${
      pdfHash.slice(
        0,
        16,
      )
    }.pdf`;

  await env.FILES.put(
    r2Key,
    pdfBytes,
    {
      httpMetadata: {
        contentType:
          'application/pdf',

        contentDisposition:
          'attachment',

        cacheControl:
          'private, no-store',
      },

      customMetadata: {
        orderCode:
          contract.order_code,

        contractVersion:
          String(
            contract.version,
          ),

        documentHash:
          contract.document_hash,

        pdfHash,
      },
    },
  );

  try {
    await env.DB.batch([
      env.DB
        .prepare(
          `
            UPDATE v2_contracts
            SET
              status = 'signed',
              pdf_r2_key = ?,
              pdf_hash = ?,
              signed_at = ?,
              updated_at = ?
            WHERE id = ?
          `,
        )
        .bind(
          r2Key,
          pdfHash,
          stamp,
          stamp,
          contract.id,
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
              'contract_signed_customer',
              'Contrato concluído com assinatura eletrônica da cliente.',
              ?,
              ?
            )
          `,
        )
        .bind(
          contract.order_id,
          JSON.stringify({
            contractId:
              contract.id,

            version:
              contract.version,

            pdfHash,
          }),
          stamp,
        ),
    ]);
  } catch (
    error
  ) {
    await env.FILES
      .delete(
        r2Key,
      );

    throw error;
  }

  await createV2AdminNotification(
    env,
    {
      eventCode:
        'CONTRACT_SIGNED',

      orderId:
        contract.order_id,

      title:
        'Contrato assinado ✓',

      body:
        `${
          contract.order_code
        } • ${
          contract.customer_name
        }`,

      actionUrl:
        `/admin/pedidos/${
          contract.order_code
        }`,

      priority:
        'high',

      pushEligible:
        true,

      dedupeKey:
        `contract_signed:${
          contract.id
        }`,
    },
  );

  return {
    id:
      contract.id,

    status:
      'signed',

    signedAt:
      stamp,

    pdfHash,

    pdfPath:
      `/api/v2/customer-area/${
        token
      }/contracts/${
        contract.id
      }/pdf`,
  };
}

async function contractPdfResponse(
  env,
  contract,
) {
  if (
    !contract
    || !contract.pdf_r2_key
    || contract.status
      !== 'signed'
  ) {
    return fail(
      'PDF final ainda não está disponível.',
      404,
    );
  }

  if (!env.FILES) {
    return fail(
      'Armazenamento R2 ainda não configurado.',
      503,
    );
  }

  const object =
    await env.FILES.get(
      contract.pdf_r2_key,
    );

  if (!object) {
    return fail(
      'PDF do contrato não encontrado.',
      404,
    );
  }

  const filename =
    `contrato-${
      contract.order_code
    }-v${
      contract.version
    }-assinado.pdf`;

  const headers =
    new Headers();

  object.writeHttpMetadata(
    headers,
  );

  headers.set(
    'content-type',
    'application/pdf',
  );

  headers.set(
    'content-disposition',
    `attachment; filename="${
      filename
    }"`,
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

export async function downloadV2ContractPdfForAdmin(
  env,
  contractId,
) {
  const contract =
    await contractById(
      env.DB,
      contractId,
    );

  return contractPdfResponse(
    env,
    contract,
  );
}

export async function downloadV2ContractPdfForCustomer(
  env,
  token,
  contractId,
) {
  const order =
    await orderByToken(
      env.DB,
      token,
    );

  if (!order) {
    return fail(
      'Pedido não encontrado.',
      404,
    );
  }

  const contract =
    await contractById(
      env.DB,
      contractId,
    );

  if (
    !contract
    || Number(
      contract.order_id,
    )
      !== Number(
        order.id,
      )
  ) {
    return fail(
      'Contrato não encontrado.',
      404,
    );
  }

  return contractPdfResponse(
    env,
    contract,
  );
}
