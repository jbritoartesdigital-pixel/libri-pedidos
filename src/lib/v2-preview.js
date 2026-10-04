import {
  fail,
  json,
  nowIso,
  randomToken,
} from './http.js';

const CUSTOMER_TOKEN_PATTERN =
  /^ord_[a-f0-9]{36}$/;

const MAX_PREVIEW_BYTES =
  60
  * 1024
  * 1024;

const ALLOWED_PREVIEW_TYPES =
  new Set([
    'video/mp4',
    'video/webm',
    'image/jpeg',
    'image/png',
    'image/webp',
  ]);

function cleanText(
  value,
  maxLength = 500,
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

function validCustomerToken(
  token,
) {
  return CUSTOMER_TOKEN_PATTERN
    .test(
      String(
        token
        || '',
      ),
    );
}

function mediaTypeFromMime(
  mimeType,
) {
  return String(
    mimeType
    || '',
  )
    .startsWith(
      'video/',
    )
      ? 'video'
      : 'image';
}

function extensionFromMime(
  mimeType,
) {
  const map = {
    'video/mp4':
      '.mp4',

    'video/webm':
      '.webm',

    'image/jpeg':
      '.jpg',

    'image/png':
      '.png',

    'image/webp':
      '.webp',
  };

  return map[
    mimeType
  ]
    || '';
}

async function previewExpiryHours(
  db,
) {
  const row =
    await db
      .prepare(
        `
          SELECT value
          FROM v2_settings
          WHERE key = 'preview_expiry_hours'
          LIMIT 1
        `,
      )
      .first();

  const hours =
    Number.parseInt(
      row
        ?.value,
      10,
    );

  if (
    Number.isInteger(
      hours,
    )
    && hours > 0
    && hours <= 168
  ) {
    return hours;
  }

  return 24;
}

async function libriWhatsapp(
  db,
) {
  const v2 =
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

  const v2Digits =
    String(
      v2
        ?.value
      || '',
    )
      .replace(
        /\D/g,
        '',
      );

  if (v2Digits) {
    return v2Digits;
  }

  const legacy =
    await db
      .prepare(
        `
          SELECT value
          FROM settings
          WHERE key = 'libri_whatsapp'
          LIMIT 1
        `,
      )
      .first();

  return String(
    legacy
      ?.value
    || '',
  )
    .replace(
      /\D/g,
      '',
    );
}

function whatsappUrl(
  number,
  message,
) {
  if (!number) {
    return '';
  }

  return `https://wa.me/${
    encodeURIComponent(
      number,
    )
  }?text=${
    encodeURIComponent(
      message,
    )
  }`;
}

async function orderByCode(
  db,
  orderCode,
) {
  return db
    .prepare(
      `
        SELECT
          o.id,
          o.order_code,
          o.public_token,
          o.honoree_display_name,
          o.status,
          o.next_action,

          p.payment_method,
          p.balance_cents
        FROM v2_orders o
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
}

async function orderByToken(
  db,
  token,
) {
  if (
    !validCustomerToken(
      token,
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
          o.status,
          o.next_action,

          p.payment_method,
          p.balance_cents
        FROM v2_orders o
        INNER JOIN v2_order_pricing p
          ON p.order_id = o.id
        WHERE o.public_token = ?
        LIMIT 1
      `,
    )
    .bind(
      token,
    )
    .first();
}

async function previewById(
  db,
  previewId,
) {
  return db
    .prepare(
      `
        SELECT
          id,
          order_id,
          version_number,
          media_type,
          preview_r2_key,
          watermark_label,
          status,
          expires_at,
          created_at
        FROM v2_previews
        WHERE id = ?
        LIMIT 1
      `,
    )
    .bind(
      previewId,
    )
    .first();
}

async function latestPreviewForOrder(
  db,
  orderId,
) {
  return db
    .prepare(
      `
        SELECT
          id,
          order_id,
          version_number,
          media_type,
          preview_r2_key,
          watermark_label,
          status,
          expires_at,
          created_at
        FROM v2_previews
        WHERE order_id = ?
        ORDER BY
          version_number DESC,
          id DESC
        LIMIT 1
      `,
    )
    .bind(
      orderId,
    )
    .first();
}

function isExpired(
  preview,
) {
  const time =
    Date.parse(
      preview
        ?.expires_at
      || '',
    );

  return (
    Number.isFinite(
      time,
    )
    && time <= Date.now()
  );
}

async function markExpiredIfNeeded(
  db,
  preview,
) {
  if (
    !preview
    || preview.status
      !== 'active'
    || !isExpired(
      preview,
    )
  ) {
    return preview;
  }

  await db
    .prepare(
      `
        UPDATE v2_previews
        SET status = 'expired'
        WHERE
          id = ?
          AND status = 'active'
      `,
    )
    .bind(
      preview.id,
    )
    .run();

  return {
    ...preview,
    status:
      'expired',
  };
}

async function nextVersionNumber(
  db,
  orderId,
) {
  const row =
    await db
      .prepare(
        `
          SELECT
            COALESCE(
              MAX(version_number),
              0
            ) AS max_version
          FROM v2_previews
          WHERE order_id = ?
        `,
      )
      .bind(
        orderId,
      )
      .first();

  return (
    Number(
      row
        ?.max_version
      || 0,
    )
    + 1
  );
}

export async function createV2Preview(
  request,
  env,
  orderCode,
) {
  if (!env.FILES) {
    return fail(
      'R2 ainda não está configurado.',
      503,
    );
  }

  const order =
    await orderByCode(
      env.DB,
      orderCode,
    );

  if (!order) {
    return fail(
      'Pedido não encontrado.',
      404,
    );
  }

  const form =
    await request
      .formData();

  const file =
    form.get(
      'file',
    );

  if (
    !file
    || typeof file
      .stream
      !== 'function'
  ) {
    return fail(
      'Selecione a prévia.',
      422,
    );
  }

  const mimeType =
    String(
      file.type
      || '',
    )
      .toLowerCase();

  if (
    !ALLOWED_PREVIEW_TYPES
      .has(
        mimeType,
      )
  ) {
    return fail(
      'Envie uma prévia MP4, WebM, JPG, PNG ou WebP.',
      422,
    );
  }

  const size =
    Number(
      file.size
      || 0,
    );

  if (
    size <= 0
    || size
      > MAX_PREVIEW_BYTES
  ) {
    return fail(
      'A prévia deve ter no máximo 60 MB.',
      422,
    );
  }

  /*
   * Este módulo recebe SOMENTE a cópia já preparada
   * para prévia: menor qualidade + marca d'água.
   * Worker/R2 protegem e entregam o arquivo, mas não
   * transcodificam vídeo nem queimam watermark.
   */
  const watermarkConfirmed =
    String(
      form.get(
        'watermarkConfirmed',
      )
      || '',
    )
      .toLowerCase();

  if (
    ![
      '1',
      'true',
      'yes',
      'sim',
    ].includes(
      watermarkConfirmed,
    )
  ) {
    return fail(
      'Confirme que este arquivo já é a cópia de prévia com marca d’água.',
      422,
    );
  }

  const watermarkLabel =
    cleanText(
      form.get(
        'watermarkLabel',
      ),
      120,
    )
    || `PRÉVIA • ${
      order.order_code
    }`;

  const hours =
    await previewExpiryHours(
      env.DB,
    );

  const expiresAt =
    new Date(
      Date.now()
      + (
        hours
        * 60
        * 60
        * 1000
      ),
    )
      .toISOString();

  const version =
    await nextVersionNumber(
      env.DB,
      order.id,
    );

  const mediaType =
    mediaTypeFromMime(
      mimeType,
    );

  const extension =
    extensionFromMime(
      mimeType,
    );

  const objectKey =
    `orders/${
      order.id
    }/previews/v${
      version
    }/${
      randomToken(
        'preview_',
      )
    }${
      extension
    }`;

  await env.FILES
    .put(
      objectKey,
      file.stream(),
      {
        httpMetadata: {
          contentType:
            mimeType,

          contentDisposition:
            'inline',

          cacheControl:
            'private, no-store',
        },

        customMetadata: {
          orderCode:
            order.order_code,

          version:
            String(
              version,
            ),

          mediaType,

          watermarkLabel,
        },
      },
    );

  let previewId;

  try {
    const stamp =
      nowIso();

    await env.DB
      .prepare(
        `
          UPDATE v2_previews
          SET status = 'replaced'
          WHERE
            order_id = ?
            AND status = 'active'
        `,
      )
      .bind(
        order.id,
      )
      .run();

    const result =
      await env.DB
        .prepare(
          `
            INSERT INTO v2_previews(
              order_id,
              version_number,
              media_type,
              original_r2_key,
              preview_r2_key,
              watermark_label,
              status,
              expires_at,
              created_at
            )
            VALUES (
              ?,
              ?,
              ?,
              NULL,
              ?,
              ?,
              'active',
              ?,
              ?
            )
          `,
        )
        .bind(
          order.id,
          version,
          mediaType,
          objectKey,
          watermarkLabel,
          expiresAt,
          stamp,
        )
        .run();

    previewId =
      Number(
        result
          ?.meta
          ?.last_row_id,
      );

    await env.DB.batch([
      env.DB
        .prepare(
          `
            UPDATE v2_orders
            SET
              status = 'waiting_customer',
              next_action = 'Aguardando aprovação da prévia',
              updated_at = ?
            WHERE id = ?
          `,
        )
        .bind(
          stamp,
          order.id,
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
              'preview_published',
              'Prévia protegida publicada para aprovação.',
              ?,
              ?
            )
          `,
        )
        .bind(
          order.id,
          JSON.stringify({
            previewId,
            version,
            expiresAt,
            mediaType,
          }),
          stamp,
        ),
    ]);
  } catch (
    error
  ) {
    await env.FILES
      .delete(
        objectKey,
      );

    throw error;
  }

  const number =
    await libriWhatsapp(
      env.DB,
    );

  const clientPath =
    `/meu-pedido/${
      order.public_token
    }`;

  const origin =
    new URL(
      request.url,
    )
      .origin;

  const clientUrl =
    `${origin}${clientPath}`;

  const message =
    `Oi! 💛 A prévia do pedido ${
      order.order_code
    }, ${
      order.honoree_display_name
    }, já está disponível para aprovação: ${
      clientUrl
    }`;

  return json(
    {
      ok: true,

      preview: {
        id:
          previewId,

        version,

        mediaType,

        status:
          'active',

        expiresAt,

        watermarkLabel,
      },

      client: {
        path:
          clientPath,

        url:
          clientUrl,

        whatsappUrl:
          whatsappUrl(
            number,
            message,
          ),

        whatsappMessage:
          message,
      },
    },
    201,
  );
}

export async function listV2PreviewsForAdmin(
  env,
  orderCode,
) {
  const order =
    await orderByCode(
      env.DB,
      orderCode,
    );

  if (!order) {
    return fail(
      'Pedido não encontrado.',
      404,
    );
  }

  const result =
    await env.DB
      .prepare(
        `
          SELECT
            p.id,
            p.version_number,
            p.media_type,
            p.watermark_label,
            p.status,
            p.expires_at,
            p.created_at,

            a.approved_at
          FROM v2_previews p
          LEFT JOIN v2_preview_approvals a
            ON a.preview_id = p.id
          WHERE p.order_id = ?
          ORDER BY
            p.version_number DESC,
            p.id DESC
        `,
      )
      .bind(
        order.id,
      )
      .all();

  const previews = [];

  for (
    const row
    of result.results
    || []
  ) {
    const normalized =
      await markExpiredIfNeeded(
        env.DB,
        row,
      );

    previews.push({
      id:
        normalized.id,

      version:
        normalized.version_number,

      mediaType:
        normalized.media_type,

      watermarkLabel:
        normalized.watermark_label,

      status:
        normalized.status,

      expiresAt:
        normalized.expires_at,

      createdAt:
        normalized.created_at,

      approvedAt:
        row.approved_at
        || null,
    });
  }

  return json({
    ok: true,

    order: {
      code:
        order.order_code,

      honoreeName:
        order.honoree_display_name,
    },

    previews,
  });
}

export async function reactivateV2Preview(
  env,
  previewId,
) {
  const preview =
    await previewById(
      env.DB,
      previewId,
    );

  if (!preview) {
    return fail(
      'Prévia não encontrada.',
      404,
    );
  }

  if (
    ![
      'active',
      'expired',
    ].includes(
      preview.status,
    )
  ) {
    return fail(
      'Esta versão não pode ser reativada.',
      409,
    );
  }

  const latest =
    await latestPreviewForOrder(
      env.DB,
      preview.order_id,
    );

  if (
    !latest
    || Number(
      latest.id,
    )
      !== Number(
        preview.id,
      )
  ) {
    return fail(
      'Existe uma versão mais recente desta prévia.',
      409,
    );
  }

  const hours =
    await previewExpiryHours(
      env.DB,
    );

  const expiresAt =
    new Date(
      Date.now()
      + (
        hours
        * 60
        * 60
        * 1000
      ),
    )
      .toISOString();

  const stamp =
    nowIso();

  await env.DB.batch([
    env.DB
      .prepare(
        `
          UPDATE v2_previews
          SET
            status = 'active',
            expires_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        expiresAt,
        preview.id,
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
            'preview_reactivated',
            'Prévia reativada por mais um período de aprovação.',
            ?,
            ?
          )
        `,
      )
      .bind(
        preview.order_id,
        JSON.stringify({
          previewId:
            preview.id,

          expiresAt,
        }),
        stamp,
      ),
  ]);

  return json({
    ok: true,

    preview: {
      id:
        preview.id,

      status:
        'active',

      expiresAt,
    },
  });
}

export async function revokeV2Preview(
  env,
  previewId,
) {
  const preview =
    await previewById(
      env.DB,
      previewId,
    );

  if (!preview) {
    return fail(
      'Prévia não encontrada.',
      404,
    );
  }

  if (
    preview.status
    === 'approved'
  ) {
    return fail(
      'Uma prévia já aprovada não pode ser revogada por esta ação.',
      409,
    );
  }

  const stamp =
    nowIso();

  await env.DB.batch([
    env.DB
      .prepare(
        `
          UPDATE v2_previews
          SET status = 'revoked'
          WHERE id = ?
        `,
      )
      .bind(
        preview.id,
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
            'preview_revoked',
            'Prévia retirada da área da cliente.',
            ?,
            ?
          )
        `,
      )
      .bind(
        preview.order_id,
        JSON.stringify({
          previewId:
            preview.id,
        }),
        stamp,
      ),
  ]);

  return json({
    ok: true,
  });
}

async function authorizedCustomerPreview(
  db,
  token,
  previewId,
) {
  const order =
    await orderByToken(
      db,
      token,
    );

  if (!order) {
    return {
      order:
        null,

      preview:
        null,
    };
  }

  let preview =
    await db
      .prepare(
        `
          SELECT
            id,
            order_id,
            version_number,
            media_type,
            preview_r2_key,
            watermark_label,
            status,
            expires_at,
            created_at
          FROM v2_previews
          WHERE
            id = ?
            AND order_id = ?
          LIMIT 1
        `,
      )
      .bind(
        previewId,
        order.id,
      )
      .first();

  preview =
    await markExpiredIfNeeded(
      db,
      preview,
    );

  return {
    order,
    preview,
  };
}

export async function getV2CustomerPreviewStatus(
  env,
  token,
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

  let preview =
    await latestPreviewForOrder(
      env.DB,
      order.id,
    );

  preview =
    await markExpiredIfNeeded(
      env.DB,
      preview,
    );

  const number =
    await libriWhatsapp(
      env.DB,
    );

  const adjustmentMessage =
    preview
      ? `Oi, Ju! Vi a prévia do pedido ${
        order.order_code
      }, ${
        order.honoree_display_name
      }, e preciso te falar sobre um ajuste.`
      : '';

  if (!preview) {
    return json({
      ok: true,

      preview:
        null,

      adjustmentWhatsappUrl:
        '',
    });
  }

  const approval =
    await env.DB
      .prepare(
        `
          SELECT approved_at
          FROM v2_preview_approvals
          WHERE preview_id = ?
          LIMIT 1
        `,
      )
      .bind(
        preview.id,
      )
      .first();

  return json({
    ok: true,

    preview: {
      id:
        preview.id,

      version:
        preview.version_number,

      mediaType:
        preview.media_type,

      status:
        preview.status,

      expiresAt:
        preview.expires_at,

      createdAt:
        preview.created_at,

      approvedAt:
        approval
          ?.approved_at
        || null,

      contentPath:
        preview.status
        === 'active'
        || preview.status
          === 'approved'
          ? `/api/v2/customer-area/${
            token
          }/previews/${
            preview.id
          }/content`
          : null,
    },

    adjustmentWhatsappUrl:
      whatsappUrl(
        number,
        adjustmentMessage,
      ),
  });
}

export async function streamV2CustomerPreview(
  request,
  env,
  token,
  previewId,
) {
  if (!env.FILES) {
    return fail(
      'Armazenamento de arquivos ainda não configurado.',
      503,
    );
  }

  const {
    preview,
  } =
    await authorizedCustomerPreview(
      env.DB,
      token,
      previewId,
    );

  if (!preview) {
    return fail(
      'Prévia não encontrada.',
      404,
    );
  }

  if (
    preview.status
    === 'expired'
  ) {
    return fail(
      'Esta prévia expirou.',
      410,
      {
        code:
          'preview_expired',
      },
    );
  }

  if (
    ![
      'active',
      'approved',
    ].includes(
      preview.status,
    )
  ) {
    return fail(
      'Esta prévia não está mais disponível.',
      410,
    );
  }

  const object =
    await env.FILES
      .get(
        preview.preview_r2_ke