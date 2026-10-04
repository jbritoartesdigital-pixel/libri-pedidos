import {
  nowIso,
  parseJson,
  randomToken,
} from './http.js';

const SETTINGS_ALLOWLIST =
  new Set([
    'company_name',
    'company_legal_name',
    'company_document',
    'company_email',
    'company_instagram',
    'company_address',
    'company_city',
    'company_state',

    'libri_whatsapp',
    'balance_pix_key',
    'balance_pix_recipient_name',

    'default_sellable_points_per_day_units',
    'default_internal_buffer_points_per_day_units',
    'recommended_delivery_days_before_event',
    'urgency_percent',
    'pix_deposit_percent',
    'preview_expiry_hours',
    'checkout_hold_minutes',

    'mercado_pago_max_installments',
    'gallery_max_upload_mb',
  ]);

const INTEGER_SETTINGS =
  new Map([
    [
      'default_sellable_points_per_day_units',
      {
        min: 0,
        max: 5000,
      },
    ],

    [
      'default_internal_buffer_points_per_day_units',
      {
        min: 0,
        max: 5000,
      },
    ],

    [
      'recommended_delivery_days_before_event',
      {
        min: 1,
        max: 365,
      },
    ],

    [
      'urgency_percent',
      {
        min: 0,
        max: 200,
      },
    ],

    [
      'pix_deposit_percent',
      {
        min: 1,
        max: 100,
      },
    ],

    [
      'preview_expiry_hours',
      {
        min: 1,
        max: 168,
      },
    ],

    [
      'checkout_hold_minutes',
      {
        min: 5,
        max: 180,
      },
    ],

    [
      'mercado_pago_max_installments',
      {
        min: 1,
        max: 24,
      },
    ],

    [
      'gallery_max_upload_mb',
      {
        min: 1,
        max: 200,
      },
    ],
  ]);

const GALLERY_MIME_TYPES =
  new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
  ]);

const GALLERY_PREVIEW_MIME_TYPES =
  new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
  ]);

function cleanText(
  value,
  maxLength = 1000,
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

function integer(
  value,
  {
    min = 0,
    max = Number.MAX_SAFE_INTEGER,
    label = 'Valor',
  } = {},
) {
  const parsed =
    Number.parseInt(
      value,
      10,
    );

  if (
    !Number.isInteger(
      parsed,
    )
    || parsed < min
    || parsed > max
  ) {
    throw new Error(
      `${label} inválido.`,
    );
  }

  return parsed;
}

function booleanValue(
  value,
) {
  return value === true
    || value === 1
    || value === '1'
    || value === 'true';
}

function safeCode(
  value,
  label = 'Código',
) {
  const code =
    cleanText(
      value,
      80,
    );

  if (
    !/^[a-z0-9][a-z0-9_-]*$/i
      .test(
        code,
      )
  ) {
    throw new Error(
      `${label} inválido.`,
    );
  }

  return code;
}

function mimeExtension(
  mimeType,
) {
  return {
    'image/jpeg':
      '.jpg',

    'image/png':
      '.png',

    'image/webp':
      '.webp',

    'video/mp4':
      '.mp4',

    'video/webm':
      '.webm',
  }[
    mimeType
  ]
  || '';
}

async function sha256Hex(
  value,
) {
  const digest =
    await crypto
      .subtle
      .digest(
        'SHA-256',
        new TextEncoder()
          .encode(
            String(
              value
              ?? '',
            ),
          ),
      );

  return Array.from(
    new Uint8Array(
      digest,
    ),
    (byte) =>
      byte
        .toString(16)
        .padStart(
          2,
          '0',
        ),
  )
    .join('');
}

async function allSettings(
  db,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            key,
            value,
            updated_at
          FROM v2_settings
          ORDER BY key
        `,
      )
      .all();

  return Object.fromEntries(
    (
      result.results
      || []
    )
      .map(
        (row) => [
          row.key,
          row.value,
        ],
      ),
  );
}

async function productsConfig(
  db,
) {
  const [
    productsResult,
    variantsResult,
  ] =
    await Promise.all([
      db
        .prepare(
          `
            SELECT
              id,
              code,
              slug,
              name,
              short_description,
              pricing_mode,
              active,
              sort_order,
              config_json,
              updated_at
            FROM v2_products
            ORDER BY
              sort_order,
              id
          `,
        )
        .all(),

      db
        .prepare(
          `
            SELECT
              pv.id,
              pv.product_id,
              pv.code,
              pv.label,
              pv.scene_count,
              pv.price_cents,
              pv.points_units,
              pv.is_default,
              pv.active,
              pv.sort_order,
              pv.config_json,
              pv.updated_at
            FROM v2_product_variants pv
            ORDER BY
              pv.product_id,
              pv.sort_order,
              pv.id
          `,
        )
        .all(),
    ]);

  const variantsByProduct =
    new Map();

  for (
    const row
    of variantsResult.results
    || []
  ) {
    if (
      !variantsByProduct
        .has(
          row.product_id,
        )
    ) {
      variantsByProduct
        .set(
          row.product_id,
          [],
        );
    }

    variantsByProduct
      .get(
        row.product_id,
      )
      .push({
        id:
          row.id,

        code:
          row.code,

        label:
          row.label,

        sceneCount:
          row.scene_count,

        priceCents:
          row.price_cents,

        pointsUnits:
          row.points_units,

        isDefault:
          row.is_default
          === 1,

        active:
          row.active
          === 1,

        sortOrder:
          row.sort_order,

        config:
          parseJson(
            row.config_json,
            {},
          ),

        updatedAt:
          row.updated_at,
      });
  }

  return (
    productsResult.results
    || []
  )
    .map(
      (row) => ({
        id:
          row.id,

        code:
          row.code,

        slug:
          row.slug,

        name:
          row.name,

        shortDescription:
          row.short_description
          || '',

        pricingMode:
          row.pricing_mode,

        active:
          row.active
          === 1,

        sortOrder:
          row.sort_order,

        config:
          parseJson(
            row.config_json,
            {},
          ),

        updatedAt:
          row.updated_at,

        variants:
          variantsByProduct
            .get(
              row.id,
            )
          || [],
      }),
    );
}

async function addonsConfig(
  db,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            id,
            code,
            name,
            addon_group,
            price_cents,
            points_units,
            active,
            sort_order,
            config_json,
            updated_at
          FROM v2_addons
          ORDER BY
            sort_order,
            id
        `,
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

        code:
          row.code,

        name:
          row.name,

        group:
          row.addon_group,

        priceCents:
          row.price_cents,

        pointsUnits:
          row.points_units,

        active:
          row.active
          === 1,

        sortOrder:
          row.sort_order,

        config:
          parseJson(
            row.config_json,
            {},
          ),

        updatedAt:
          row.updated_at,
      }),
    );
}

async function combosConfig(
  db,
) {
  const [
    combosResult,
    itemsResult,
  ] =
    await Promise.all([
      db
        .prepare(
          `
            SELECT
              id,
              code,
              name,
              description,
              discount_type,
              discount_value,
              active,
              config_json,
              updated_at
            FROM v2_combos
            ORDER BY
              active DESC,
              id
          `,
        )
        .all(),

      db
        .prepare(
          `
            SELECT
              id,
              combo_id,
              item_type,
              item_code,
              required
            FROM v2_combo_items
            ORDER BY id
          `,
        )
        .all(),
    ]);

  const byCombo =
    new Map();

  for (
    const row
    of itemsResult.results
    || []
  ) {
    if (
      !byCombo
        .has(
          row.combo_id,
        )
    ) {
      byCombo
        .set(
          row.combo_id,
          [],
        );
    }

    byCombo
      .get(
        row.combo_id,
      )
      .push({
        id:
          row.id,

        itemType:
          row.item_type,

        itemCode:
          row.item_code,

        required:
          row.required
          === 1,
      });
  }

  return (
    combosResult.results
    || []
  )
    .map(
      (row) => ({
        id:
          row.id,

        code:
          row.code,

        name:
          row.name,

        description:
          row.description
          || '',

        discountType:
          row.discount_type,

        discountValue:
          row.discount_value,

        active:
          row.active
          === 1,

        config:
          parseJson(
            row.config_json,
            {},
          ),

        updatedAt:
          row.updated_at,

        includesInvitation:
          true,

        items:
          byCombo
            .get(
              row.id,
            )
          || [],
      }),
    );
}

async function couponsConfig(
  db,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            c.id,
            c.code,
            c.discount_type,
            c.discount_value,
            c.min_order_cents,
            c.max_uses,
            c.max_uses_per_customer,
            c.valid_from,
            c.valid_until,
            c.active,
            c.restrictions_json,
            c.created_at,
            c.updated_at,

            COUNT(u.id) AS use_count,

            COALESCE(
              SUM(u.discount_cents),
              0
            ) AS used_discount_cents
          FROM v2_coupons c
          LEFT JOIN v2_coupon_uses u
            ON u.coupon_id = c.id
          GROUP BY
            c.id
          ORDER BY
            c.active DESC,
            c.created_at DESC,
            c.id DESC
        `,
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

        code:
          row.code,

        discountType:
          row.discount_type,

        discountValue:
          row.discount_value,

        minOrderCents:
          row.min_order_cents,

        maxUses:
          row.max_uses,

        maxUsesPerCustomer:
          row.max_uses_per_customer,

        validFrom:
          row.valid_from,

        validUntil:
          row.valid_until,

        active:
          row.active
          === 1,

        restrictions:
          parseJson(
            row.restrictions_json,
            {},
          ),

        useCount:
          Number(
            row.use_count
            || 0,
          ),

        usedDiscountCents:
          Number(
            row.used_discount_cents
            || 0,
          ),

        createdAt:
          row.created_at,

        updatedAt:
          row.updated_at,
      }),
    );
}

async function galleryConfig(
  db,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            id,
            product_code,
            event_type,
            theme_label,
            preview_r2_key,
            media_r2_key,
            external_url,
            active,
            sort_order,
            media_type,
            original_filename,
            mime_type,
            size_bytes,
            caption,
            created_at,
            updated_at
          FROM v2_gallery_items
          ORDER BY
            product_code,
            sort_order,
            id
        `,
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

        productCode:
          row.product_code,

        eventType:
          row.event_type,

        themeLabel:
          row.theme_label,

        hasPreview:
          Boolean(
            row.preview_r2_key,
          ),

        hasMedia:
          Boolean(
            row.media_r2_key,
          ),

        externalUrl:
          row.external_url,

        active:
          row.active
          === 1,

        sortOrder:
          row.sort_order,

        mediaType:
          row.media_type,

        originalFilename:
          row.original_filename,

        mimeType:
          row.mime_type,

        sizeBytes:
          row.size_bytes,

        caption:
          row.caption
          || '',

        createdAt:
          row.created_at,

        updatedAt:
          row.updated_at,
      }),
    );
}

async function termsConfig(
  db,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            version,
            content_hash,
            active,
            published_at,
            created_at
          FROM v2_terms_versions
          ORDER BY
            published_at DESC,
            version DESC
        `,
      )
      .all();

  return (
    result.results
    || []
  )
    .map(
      (row) => ({
        version:
          row.version,

        contentHash:
          row.content_hash,

        active:
          row.active
          === 1,

        publishedAt:
          row.published_at,

        createdAt:
          row.created_at,

        immutable:
          true,
      }),
    );
}

async function contractTemplatesConfig(
  db,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            id,
            version,
            title,
            content_hash,
            active,
            published_at,
            created_at
          FROM v2_contract_templates
          ORDER BY
            version DESC
        `,
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

        version:
          row.version,

        title:
          row.title,

        contentHash:
          row.content_hash,

        active:
          row.active
          === 1,

        publishedAt:
          row.published_at,

        createdAt:
          row.created_at,

        immutable:
          true,
      }),
    );
}

export async function getV2StoreConfig(
  env,
) {
  const [
    products,
    addons,
    combos,
    coupons,
    gallery,
    settings,
    terms,
    contractTemplates,
  ] =
    await Promise.all([
      productsConfig(
        env.DB,
      ),

      addonsConfig(
        env.DB,
      ),

      combosConfig(
        env.DB,
      ),

      couponsConfig(
        env.DB,
      ),

      galleryConfig(
        env.DB,
      ),

      allSettings(
        env.DB,
      ),

      termsConfig(
        env.DB,
      ),

      contractTemplatesConfig(
        env.DB,
      ),
    ]);

  return {
    products,
    addons,
    combos,
    coupons,
    gallery,
    terms,
    contractTemplates,

    settings: {
      company: {
        name:
          settings.company_name
          || '',

        legalName:
          settings.company_legal_name
          || '',

        document:
          settings.company_document
          || '',

        email:
          settings.company_email
          || '',

        instagram:
          settings.company_instagram
          || '',

        address:
          settings.company_address
          || '',

        city:
          settings.company_city
          || '',

        state:
          settings.company_state
          || '',

        whatsapp:
          settings.libri_whatsapp
          || '',
      },

      payments: {
        balancePixKey:
          settings.balance_pix_key
          || '',

        balancePixRecipientName:
          settings.balance_pix_recipient_name
          || '',

        mercadoPagoConfigured:
          Boolean(
            String(
              env.MERCADO_PAGO_ACCESS_TOKEN
              || '',
            )
              .trim(),
          ),

        mercadoPagoWebhookSecretConfigured:
          Boolean(
            String(
              env.MERCADO_PAGO_WEBHOOK_SECRET
              || '',
            )
              .trim(),
          ),

        maxInstallments:
          Number.parseInt(
            settings.mercado_pago_max_installments,
            10,
          )
          || 12,

        installmentsCost:
          'buyer',

        installmentsCostEditable:
          false,
      },

      agenda: {
        sellableUnitsPerDay:
          Number.parseInt(
            settings.default_sellable_points_per_day_units,
            10,
          )
          || 400,

        internalBufferUnitsPerDay:
          Number.parseInt(
            settings.default_internal_buffer_points_per_day_units,
            10,
          )
          || 100,

        recommendedDeliveryDaysBeforeEvent:
          Number.parseInt(
            settings.recommended_delivery_days_before_event,
            10,
          )
          || 40,

        urgencyPercent:
          Number.parseInt(
            settings.urgency_percent,
            10,
          )
          || 30,

        checkoutHoldMinutes:
          Number.parseInt(
            settings.checkout_hold_minutes,
            10,
          )
          || 30,
      },

      experience: {
        previewExpiryHours:
          Number.parseInt(
            settings.preview_expiry_hours,
            10,
          )
          || 24,

        galleryMaxUploadMb:
          Number.parseInt(
            settings.gallery_max_upload_mb,
            10,
          )
          || 80,
      },

      checkout: {
        pixDepositPercent:
          Number.parseInt(
            settings.pix_deposit_percent,
            10,
          )
          || 50,
      },
    },
  };
}

export async function updateV2Product(
  db,
  code,
  body = {},
) {
  const productCode =
    safeCode(
      code,
      'Produto',
    );

  const existing =
    await db
      .prepare(
        `
          SELECT *
          FROM v2_products
          WHERE code = ?
          LIMIT 1
        `,
      )
      .bind(
        productCode,
      )
      .first();

  if (!existing) {
    return null;
  }

  const name =
    body.name
    === undefined
      ? existing.name
      : cleanText(
        body.name,
        160,
      );

  if (!name) {
    throw new Error(
      'Nome do produto é obrigatório.',
    );
  }

  const description =
    body.shortDescription
    === undefined
      ? existing.short_description
      : cleanText(
        body.shortDescription,
        1000,
      );

  const active =
    body.active
    === undefined
      ? existing.active
      : (
        booleanValue(
          body.active,
        )
          ? 1
          : 0
      );

  const sortOrder =
    body.sortOrder
    === undefined
      ? existing.sort_order
      : integer(
        body.sortOrder,
        {
          min:
            0,

          max:
            10000,

          label:
            'Ordem',
        },
      );

  await db
    .prepare(
      `
        UPDATE v2_products
        SET
          name = ?,
          short_description = ?,
          active = ?,
          sort_order = ?,
          updated_at = ?
        WHERE code = ?
      `,
    )
    .bind(
      name,
      description,
      active,
      sortOrder,
      nowIso(),
      productCode,
    )
    .run();

  return {
    code:
      productCode,

    slug:
      existing.slug,