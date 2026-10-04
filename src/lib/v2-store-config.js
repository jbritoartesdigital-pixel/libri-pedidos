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

    pricingMode:
      existing.pricing_mode,

    name,

    shortDescription:
      description,

    active:
      active
      === 1,

    sortOrder,
  };
}

export async function updateV2Variant(
  db,
  code,
  body = {},
) {
  const variantCode =
    safeCode(
      code,
      'Variante',
    );

  const existing =
    await db
      .prepare(
        `
          SELECT
            pv.*,
            p.code AS product_code
          FROM v2_product_variants pv
          INNER JOIN v2_products p
            ON p.id = pv.product_id
          WHERE pv.code = ?
          LIMIT 1
        `,
      )
      .bind(
        variantCode,
      )
      .first();

  if (!existing) {
    return null;
  }

  const label =
    body.label
    === undefined
      ? existing.label
      : cleanText(
        body.label,
        120,
      );

  if (!label) {
    throw new Error(
      'Nome da configuração é obrigatório.',
    );
  }

  const priceCents =
    body.priceCents
    === undefined
      ? existing.price_cents
      : integer(
        body.priceCents,
        {
          min:
            0,

          max:
            100000000,

          label:
            'Preço',
        },
      );

  const pointsUnits =
    body.pointsUnits
    === undefined
      ? existing.points_units
      : integer(
        body.pointsUnits,
        {
          min:
            0,

          max:
            100000,

          label:
            'Points Libri',
        },
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

  const makeDefault =
    body.isDefault
    === undefined
      ? existing.is_default
      === 1
      : booleanValue(
        body.isDefault,
      );

  const statements = [];

  if (
    makeDefault
  ) {
    statements.push(
      db
        .prepare(
          `
            UPDATE v2_product_variants
            SET
              is_default = 0,
              updated_at = ?
            WHERE product_id = ?
          `,
        )
        .bind(
          nowIso(),
          existing.product_id,
        ),
    );
  }

  statements.push(
    db
      .prepare(
        `
          UPDATE v2_product_variants
          SET
            label = ?,
            price_cents = ?,
            points_units = ?,
            is_default = ?,
            active = ?,
            sort_order = ?,
            updated_at = ?
          WHERE code = ?
        `,
      )
      .bind(
        label,
        priceCents,
        pointsUnits,
        makeDefault
          ? 1
          : 0,
        active,
        sortOrder,
        nowIso(),
        variantCode,
      ),
  );

  await db.batch(
    statements,
  );

  return {
    code:
      variantCode,

    productCode:
      existing.product_code,

    label,

    sceneCount:
      existing.scene_count,

    priceCents,

    pointsUnits,

    isDefault:
      makeDefault,

    active:
      active
      === 1,

    sortOrder,
  };
}

export async function updateV2Addon(
  db,
  code,
  body = {},
) {
  const addonCode =
    safeCode(
      code,
      'Adicional',
    );

  const existing =
    await db
      .prepare(
        `
          SELECT *
          FROM v2_addons
          WHERE code = ?
          LIMIT 1
        `,
      )
      .bind(
        addonCode,
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
      'Nome do adicional é obrigatório.',
    );
  }

  const priceCents =
    body.priceCents
    === undefined
      ? existing.price_cents
      : integer(
        body.priceCents,
        {
          min:
            0,

          max:
            100000000,

          label:
            'Preço',
        },
      );

  const pointsUnits =
    body.pointsUnits
    === undefined
      ? existing.points_units
      : integer(
        body.pointsUnits,
        {
          min:
            0,

          max:
            100000,

          label:
            'Points Libri',
        },
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
        UPDATE v2_addons
        SET
          name = ?,
          price_cents = ?,
          points_units = ?,
          active = ?,
          sort_order = ?,
          updated_at = ?
        WHERE code = ?
      `,
    )
    .bind(
      name,
      priceCents,
      pointsUnits,
      active,
      sortOrder,
      nowIso(),
      addonCode,
    )
    .run();

  return {
    code:
      addonCode,

    group:
      existing.addon_group,

    name,

    priceCents,

    pointsUnits,

    active:
      active
      === 1,

    sortOrder,
  };
}

async function validateComboItem(
  db,
  item,
) {
  const itemType =
    cleanText(
      item.itemType,
      40,
    );

  const itemCode =
    safeCode(
      item.itemCode,
      'Item do combo',
    );

  if (
    itemType
    === 'addon'
  ) {
    const row =
      await db
        .prepare(
          `
            SELECT code
            FROM v2_addons
            WHERE code = ?
            LIMIT 1
          `,
        )
        .bind(
          itemCode,
        )
        .first();

    if (!row) {
      throw new Error(
        `Adicional do combo não encontrado: ${itemCode}.`,
      );
    }
  } else if (
    itemType
    === 'addon_group'
  ) {
    const row =
      await db
        .prepare(
          `
            SELECT addon_group
            FROM v2_addons
            WHERE addon_group = ?
            LIMIT 1
          `,
        )
        .bind(
          itemCode,
        )
        .first();

    if (!row) {
      throw new Error(
        `Grupo do combo não encontrado: ${itemCode}.`,
      );
    }
  } else if (
    itemType
    === 'main_product'
  ) {
    const row =
      await db
        .prepare(
          `
            SELECT code
            FROM v2_products
            WHERE code = ?
            LIMIT 1
          `,
        )
        .bind(
          itemCode,
        )
        .first();

    if (!row) {
      throw new Error(
        `Produto do combo não encontrado: ${itemCode}.`,
      );
    }
  } else {
    throw new Error(
      'Tipo de item do combo inválido.',
    );
  }

  return {
    itemType,

    itemCode,

    required:
      item.required
      !== false,
  };
}

export async function saveV2Combo(
  db,
  code,
  body = {},
) {
  const comboCode =
    safeCode(
      code,
      'Combo',
    );

  const existing =
    await db
      .prepare(
        `
          SELECT *
          FROM v2_combos
          WHERE code = ?
          LIMIT 1
        `,
      )
      .bind(
        comboCode,
      )
      .first();

  const name =
    requiredComboText(
      body.name
      ?? existing
        ?.name,
      'Nome do combo',
      160,
    );

  const description =
    cleanText(
      body.description
      ?? existing
        ?.description,
      1000,
    );

  const discountType =
    cleanText(
      body.discountType
      ?? existing
        ?.discount_type,
      20,
    );

  if (
    ![
      'fixed',
      'percent',
    ].includes(
      discountType,
    )
  ) {
    throw new Error(
      'Tipo de desconto do combo inválido.',
    );
  }

  const discountValue =
    integer(
      body.discountValue
      ?? existing
        ?.discount_value,
      {
        min:
          0,

        max:
          discountType
          === 'percent'
            ? 100
            : 100000000,

        label:
          'Desconto do combo',
      },
    );

  const active =
    body.active
    === undefined
      ? (
        existing
          ? existing.active
          : 1
      )
      : (
        booleanValue(
          body.active,
        )
          ? 1
          : 0
      );

  const rawItems =
    Array.isArray(
      body.items,
    )
      ? body.items
      : null;

  let items;

  if (
    rawItems
  ) {
    items = [];

    for (
      const item
      of rawItems
    ) {
      items.push(
        await validateComboItem(
          db,
          item,
        ),
      );
    }

    if (
      !items.length
    ) {
      throw new Error(
        'O combo precisa ter pelo menos um adicional além do convite.',
      );
    }
  } else if (
    existing
  ) {
    const result =
      await db
        .prepare(
          `
            SELECT
              item_type,
              item_code,
              required
            FROM v2_combo_items
            WHERE combo_id = ?
            ORDER BY id
          `,
        )
        .bind(
          existing.id,
        )
        .all();

    items =
      (
        result.results
        || []
      )
        .map(
          (row) => ({
            itemType:
              row.item_type,

            itemCode:
              row.item_code,

            required:
              row.required
              === 1,
          }),
        );
  } else {
    throw new Error(
      'Defina os adicionais que fazem parte do combo.',
    );
  }

  const stamp =
    nowIso();

  let comboId =
    existing
      ?.id;

  if (
    existing
  ) {
    await db
      .prepare(
        `
          UPDATE v2_combos
          SET
            name = ?,
            description = ?,
            discount_type = ?,
            discount_value = ?,
            active = ?,
            config_json = ?,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        name,
        description,
        discountType,
        discountValue,
        active,
        JSON.stringify({
          includesInvitation:
            true,
        }),
        stamp,
        existing.id,
      )
      .run();
  } else {
    const result =
      await db
        .prepare(
          `
            INSERT INTO v2_combos(
              code,
              name,
              description,
              discount_type,
              discount_value,
              active,
              config_json,
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
              ?
            )
          `,
        )
        .bind(
          comboCode,
          name,
          description,
          discountType,
          discountValue,
          active,
          JSON.stringify({
            includesInvitation:
              true,
          }),
          stamp,
          stamp,
        )
        .run();

    comboId =
      Number(
        result
          ?.meta
          ?.last_row_id,
      );
  }

  if (
    rawItems
  ) {
    await db
      .prepare(
        `
          DELETE FROM v2_combo_items
          WHERE combo_id = ?
        `,
      )
      .bind(
        comboId,
      )
      .run();

    if (
      items.length
    ) {
      await db.batch(
        items.map(
          (item) =>
            db
              .prepare(
                `
                  INSERT INTO v2_combo_items(
                    combo_id,
                    item_type,
                    item_code,
                    required,
                    created_at
                  )
                  VALUES (
                    ?,
                    ?,
                    ?,
                    ?,
                    ?
                  )
                `,
              )
              .bind(
                comboId,
                item.itemType,
                item.itemCode,
                item.required
                  ? 1
                  : 0,
                stamp,
              ),
        ),
      );
    }
  }

  return {
    code:
      comboCode,

    name,

    description,

    discountType,

    discountValue,

    active:
      active
      === 1,

    includesInvitation:
      true,

    items,
  };
}

function requiredComboText(
  value,
  label,
  maxLength,
) {
  const text =
    cleanText(
      value,
      maxLength,
    );

  if (!text) {
    throw new Error(
      `${label} é obrigatório.`,
    );
  }

  return text;
}

export async function saveV2Coupon(
  db,
  code,
  body = {},
) {
  const couponCode =
    cleanText(
      code,
      80,
    )
      .toUpperCase();

  if (
    !/^[A-Z0-9][A-Z0-9_-]*$/
      .test(
        couponCode,
      )
  ) {
    throw new Error(
      'Código do cupom inválido.',
    );
  }

  const existing =
    await db
      .prepare(
        `
          SELECT *
          FROM v2_coupons
          WHERE code = ?
          COLLATE NOCASE
          LIMIT 1
        `,
      )
      .bind(
        couponCode,
      )
      .first();

  const discountType =
    cleanText(
      body.discountType
      ?? existing
        ?.discount_type,
      20,
    );

  if (
    ![
      'fixed',
      'percent',
    ].includes(
      discountType,
    )
  ) {
    throw new Error(
      'Tipo de desconto inválido.',
    );
  }

  const discountValue =
    integer(
      body.discountValue
      ?? existing
        ?.discount_value,
      {
        min:
          0,

        max:
          discountType
          === 'percent'
            ? 100
            : 100000000,

        label:
          'Desconto',
      },
    );

  const minOrderCents =
    integer(
      body.minOrderCents
      ?? existing
        ?.min_order_cents
      ?? 0,
      {
        min:
          0,

        max:
          100000000,

        label:
          'Pedido mínimo',
      },
    );

  const nullablePositiveInt =
    (
      value,
      fallback,
      label,
    ) => {
      if (
        value === null
      ) {
        return null;
      }

      if (
        value === undefined
      ) {
        return fallback;
      }

      return integer(
        value,
        {
          min:
            1,

          max:
            1000000,

          label,
        },
      );
    };

  const maxUses =
    nullablePositiveInt(
      body.maxUses,
      existing
        ?.max_uses
      ?? null,
      'Limite de usos',
    );

  const maxUsesPerCustomer =
    nullablePositiveInt(
      body.maxUsesPerCustomer,
      existing
        ?.max_uses_per_customer
      ?? null,
      'Limite por cliente',
    );

  const active =
    body.active
    === undefined
      ? (
        existing
          ? existing.active
          : 1
      )
      : (
        booleanValue(
          body.active,
        )
          ? 1
          : 0
      );

  const validFrom =
    body.validFrom
    === undefined
      ? existing
        ?.valid_from
      ?? null
      : cleanText(
        body.validFrom,
        40,
      )
      || null;

  const validUntil =
    body.validUntil
    === undefined
      ? existing
        ?.valid_until
      ?? null
      : cleanText(
        body.validUntil,
        40,
      )
      || null;

  const restrictions =
    body.restrictions
    === undefined
      ? parseJson(
        existing
          ?.restrictions_json,
        {},
      )
      : (
        body.restrictions
        && typeof body.restrictions
        === 'object'
        && !Array.isArray(
          body.restrictions,
        )
          ? body.restrictions
          : {}
      );

  const stamp =
    nowIso();

  if (
    existing
  ) {
    await db
      .prepare(
        `
          UPDATE v2_coupons
          SET
            discount_type = ?,
            discount_value = ?,
            min_order_cents = ?,
            max_uses = ?,
            max_uses_per_customer = ?,
            valid_from = ?,
            valid_until = ?,
            active = ?,
            restrictions_json = ?,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        discountType,
        discountValue,
        minOrderCents,
        maxUses,
        maxUsesPerCustomer,
        validFrom,
        validUntil,
        active,
        JSON.stringify(
          restrictions,
        ),
        stamp,
        existing.id,
      )
      .run();
  } else {
    await db
      .prepare(
        `
          INSERT INTO v2_coupons(
            code,
            discount_type,
            discount_value,
            min_order_cents,
            max_uses,
            max_uses_per_customer,
            valid_from,
            valid_until,
            active,
            restrictions_json,
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
        couponCode,
        discountType,
        discountValue,
        minOrderCents,
        maxUses,
        maxUsesPerCustomer,
        validFrom,
        validUntil,
        active,
        JSON.stringify(
          restrictions,
        ),
        stamp,
        stamp,
      )
      .run();
  }

  return {
    code:
      couponCode,

    discountType,

    discountValue,

    minOrderCents,

    maxUses,

    maxUsesPerCustomer,

    validFrom,

    validUntil,

    active:
      active
      === 1,

    restrictions,
  };
}

export async function updateV2Settings(
  db,
  values = {},
) {
  if (
    !values
    || typeof values
    !== 'object'
    || Array.isArray(
      values,
    )
  ) {
    throw new Error(
      'Configurações inválidas.',
    );
  }

  const statements = [];

  const saved = {};

  for (
    const [
      key,
      rawValue,
    ]
    of Object.entries(
      values,
    )
  ) {
    if (
      !SETTINGS_ALLOWLIST
        .has(
          key,
        )
    ) {
      continue;
    }

    let value;

    if (
      INTEGER_SETTINGS
        .has(
          key,
        )
    ) {
      const rule =
        INTEGER_SETTINGS
          .get(
            key,
          );

      value =
        String(
          integer(
            rawValue,
            {
              ...rule,

              label:
                key,
            },
          ),
        );
    } else {
      value =
        cleanText(
          rawValue,
          2000,
        );
    }

    saved[
      key
    ] =
      value;

    statements.push(
      db
        .prepare(
          `
            INSERT INTO v2_settings(
              key,
              value,
              updated_at
            )
            VALUES (
              ?,
              ?,
              ?
            )
            ON CONFLICT(key)
            DO UPDATE SET
              value =
                excluded.value,

              updated_at =
                excluded.updated_at
          `,
        )
        .bind(
          key,
          value,
          nowIso(),
        ),
    );
  }

  /*
   * HARD LOCK técnico:
   * parcelamento financiado pelo comprador.
   * Não expomos opção "seller" na configuração.
   */
  statements.push(
    db
      .prepare(
        `
          INSERT INTO v2_settings(
            key,
            value,
            updated_at
          )
          VALUES (
            'mercado_pago_installments_cost',
            'buyer',
            ?
          )
          ON CONFLICT(key)
          DO UPDATE SET
            value = 'buyer',
            updated_at =
              excluded.updated_at
        `,
      )
      .bind(
        nowIso(),
      ),
  );

  await db.batch(
    statements,
  );

  return {
    saved,

    enforced: {
      mercado_pago_installments_cost:
        'buyer',
    },
  };
}

async function ensureProductExists(
  db,
  productCode,
) {
  const row =
    await db
      .prepare(
        `
          SELECT code
          FROM v2_products
          WHERE code = ?
          LIMIT 1
        `,
      )
      .bind(
        productCode,
      )
      .first();

  if (!row) {
    throw new Error(
      'Produto da galeria não encontrado.',
    );
  }
}

async function galleryMaxBytes(
  db,
) {
  const row =
    await db
      .prepare(
        `
          SELECT value
          FROM v2_settings
          WHERE key = 'gallery_max_upload_mb'
          LIMIT 1
        `,
      )
      .first();

  const mb =
    Number.parseInt(
      row
        ?.value,
      10,
    )
    || 80;

  return mb
    * 1024
    * 1024;
}

async function putGalleryFile(
  env,
  {
    file,
    keyPrefix,
    allowedTypes,
    maxBytes,
  },
) {
  if (
    !file
    || typeof file
      .stream
      !== 'function'
  ) {
    return null;
  }

  const mimeType =
    String(
      file.type
      || '',
    )
      .toLowerCase();

  if (
    !allowedTypes
      .has(
        mimeType,
      )
  ) {
    throw new Error(
      'Formato de mídia não permitido.',
    );
  }

  const size =
    Number(
      file.size
      || 0,
    );

  if (
    size <= 0
    || size > maxBytes
  ) {
    throw new Error(
      'Arquivo acima do limite permitido.',
    );
  }

  const key =
    `${
      keyPrefix
    }/${
      randomToken(
        'media_',
      )
    }${
      mimeExtension(
        mimeType,
      )
    }`;

  await env.FILES
    .put(
      key,
      file.stream(),
      {
        httpMetadata: {
          contentType:
            mimeType,

          cacheControl:
            'private, max-age=0',
        },
      },
    );

  return {
    key,

    mimeType,

    sizeBytes:
      size,

    originalFilename:
      cleanText(
        file.name,
        240,
      ),

    mediaType:
      mimeType
        .startsWith(
          'video/',
        )
          ? 'video'
          : 'image',
  };
}

export async function createV2GalleryItem(
  request,
  env,
) {
  if (!env.FILES) {
    throw new Error(
      'R2 ainda não está configurado.',
    );
  }

  const form =
    await request
      .formData();

  const productCode =
    safeCode(
      form.get(
        'productCode',
      ),
      'Produto',
    );

  await ensureProductExists(
    env.DB,
    productCode,
  );

  const media =
    form.get(
      'media',
    );

  const externalUrl =
    cleanText(
      form.get(
        'externalUrl',
      ),
      1000,
    )
    || null;

  if (
    (
      !media
      || typeof media
        .stream
        !== 'function'
    )
    && !externalUrl
  ) {
    throw new Error(
      'Envie uma mídia ou informe uma URL externa.',
    );
  }

  const maxBytes =
    await galleryMaxBytes(
      env.DB,
    );

  const storedMedia =
    media
    && typeof media
      .stream
      === 'function'
      ? await putGalleryFile(
        env,
        {
          file:
            media,

          keyPrefix:
            `gallery/${
              productCode
            }`,

          allowedTypes:
            GALLERY_MIME_TYPES,

          maxBytes,
        },
      )
      : null;

  const preview =
    form.get(
      'preview',
    );

  let storedPreview =
    null;

  try {
    storedPreview =
      preview
      && typeof preview
        .stream
        === 'function'
        ? await putGalleryFile(
          env,
          {
            file:
              preview,

            keyPrefix:
              `gallery/${
                productCode
              }/previews`,

            allowedTypes:
              GALLERY_PREVIEW_MIME_TYPES,

            maxBytes:
              Math.min(
                maxBytes,
                15
                * 1024
                * 1024,
              ),
          },
        )
        : null;

    const stamp =
      nowIso();

    const result =
      await env.DB
        .prepare(
          `
            INSERT INTO v2_gallery_items(
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
              ?,
              ?,
              ?,
              ?
            )
          `,
        )
        .bind(
          productCode,

          cleanText(
            form.get(
              'eventType',
            ),
            100,
          )
          || null,

          cleanText(
            form.get(
              'themeLabel',
            ),
            180,
          )
          || null,

          storedPreview
            ?.key
          || null,

          storedMedia
            ?.key
          || null,

          externalUrl,

          form.get(
            'active',
          )
          === 'false'
            ? 0
            : 1,

          Number.parseInt(
            form.get(
              'sortOrder',
            ),
            10,
          )
          || 0,

          storedMedia
            ?.mediaType
          || cleanText(
            form.get(
              'mediaType',
            ),
            40,
          )
          || null,

          storedMedia
            ?.originalFilename
          || null,

          storedMedia
            ?.mimeType
          || null,

          storedMedia
            ?.sizeBytes
          || null,

          cleanText(
            form.get(
              'caption',
            ),
            500,
          ),

          stamp,
          stamp,
        )
        .run();

    return {
      id:
        Number(
          result
            ?.meta
            ?.last_row_id,
        ),

      productCode,

      mediaStored:
        Boolean(
          storedMedia,
        ),

      previewStored:
        Boolean(
          storedPreview,
        ),

      externalUrl,
    };
  } catch (
    error
  ) {
    const keys =
      [
        storedMedia
          ?.key,
        storedPreview
          ?.key,
      ]
        .filter(Boolean);

    if (
      keys.length
    ) {
      await env.FILES
        .delete(
          keys,
        );
    }

    throw error;
  }
}

export async function updateV2GalleryItem(
  db,
  id,
  body = {},
) {
  const galleryId =
    integer(
      id,
      {
        min:
          1,

        max:
          1000000000,

        label:
          'Item da galeria',
      },
    );

  const existing =
    await db
      .prepare(
        `
          SELECT *
          FROM v2_gallery_items
          WHERE id = ?
          LIMIT 1
        `,
      )
      .bind(
        galleryId,
      )
      .first();

  if (!existing) {
    return null;
  }

  const eventType =
    body.eventType
    === undefined
      ? existing.event_type
      : cleanText(
        body.eventType,
        100,
      )
      || null;

  const themeLabel =
    body.themeLabel
    === undefined
      ? existing.theme_label
      : cleanText(
        body.themeLabel,
        180,
      )
      || null;

  const caption =
    body.caption
    === undefined
      ? existing.caption
      : cleanText(
        body.caption,
        500,
      );

  const externalUrl =
    body.externalUrl
    === undefined
      ? existing.external_url
      : cleanText(
        body.externalUrl,
        1000,
      )
      || null;

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
            100000,

          label:
            'Ordem',
        },
      );

  await db
    .prepare(
      `
        UPDATE v2_gallery_items
        SET
          event_type = ?,
          theme_label = ?,
          caption = ?,
          external_url = ?,
          active = ?,
          sort_order = ?,
          updated_at = ?
        WHERE id = ?
      `,
    )
    .bind(
      eventType,
      themeLabel,
      caption,
      externalUrl,
      active,
      sortOrder,
      nowIso(),
      galleryId,
    )
    .run();

  return {
    id:
      galleryId,

    eventType,

    themeLabel,

    caption,

    externalUrl,

    active:
      active
      === 1,

    sortOrder,
  };
}

export async function deleteV2GalleryItem(
  env,
  id,
) {
  const galleryId =
    integer(
      id,
      {
        min:
          1,

        max:
          1000000000,

        label:
          'Item da galeria',
      },
    );

  const existing =
    await env.DB
      .prepare(
        `
          SELECT
            preview_r2_key,
            media_r2_key
          FROM v2_gallery_items
          WHERE id = ?
          LIMIT 1
        `,
      )
      .bind(
        galleryId,
      )
      .first();

  if (!existing) {
    return null;
  }

  await env.DB
    .prepare(
      `
        DELETE FROM v2_gallery_items
        WHERE id = ?
      `,
    )
    .bind(
      galleryId,
    )
    .run();

  if (
    env.FILES
  ) {
    const keys =
      [
        existing.preview_r2_key,
        existing.media_r2_key,
      ]
        .filter(Boolean);

    if (
      keys.length
    ) {
      await env.FILES
        .delete(
          [
            ...new Set(
              keys,
            ),
          ],
        );
    }
  }

  return {
    id:
      galleryId,

    deleted:
      true,
  };
}

export async function getV2GalleryContent(
  env,
  id,
  kind,
) {
  const field =
    kind
    === 'preview'
      ? 'preview_r2_key'
      : 'media_r2_key';

  const row =
    await env.DB
      .prepare(
        `
          SELECT
            ${
              field
            } AS r2_key,
            mime_type
          FROM v2_gallery_items
          WHERE id = ?
          LIMIT 1
        `,
      )
      .bind(
        integer(
          id,
          {
            min:
              1,

            max:
              1000000000,

            label:
              'Item da galeria',
          },
        ),
      )
      .first();

  if (
    !row
    || !row.r2_key
    || !env.FILES
  ) {
    return null;
  }

  const object =
    await env.FILES
      .get(
        row.r2_key,
      );

  if (!object) {
    return null;
  }

  const headers =
    new Headers();

  object.writeHttpMetadata(
    headers,
  );

  headers.set(
    'cache-control',
    'private, no-store',
  );

  headers.set(
    'content-disposition',
    'inline',
  );

  return new Response(
    object.body,
    {
      headers,
    },
  );
}

export async function publishV2Terms(
  db,
  {
    version,
    body,
  },
) {
  const termsVersion =
    cleanText(
      version,
      40,
    );

  const termsBody =
    cleanText(
      body,
      100000,
    );

  if (
    !termsVersion
    || !termsBody
  ) {
    throw new Error(
      'Versão e texto dos termos são obrigatórios.',
    );
  }

  const existing =
    await db
      .prepare(
        `
          SELECT version
          FROM v2_terms_versions
          WHERE version = ?
          LIMIT 1
        `,
      )
      .bind(
        termsVersion,
      )
      .first();

  if (existing) {
    throw new Error(
      'Esta versão já foi publicada e é imutável. Crie uma nova versão.',
    );
  }

  const hash =
    await sha256Hex(
      termsBody,
    );

  const stamp =
    nowIso();

  await db.batch([
    db
      .prepare(
        `
          UPDATE v2_terms_versions
          SET active = 0
          WHERE active = 1
        `,
      ),

    db
      .prepare(
        `
          INSERT INTO v2_terms_versions(
            version,
            body,
            content_hash,
            active,
            published_at,
            created_at
          )
          VALUES (
            ?,
            ?,
            ?,
            1,
            ?,
            ?
          )
        `,
      )
      .bind(
        termsVersion,
        termsBody,
        hash,
        stamp,
        stamp,
      ),
  ]);

  return {
    version:
      termsVersion,

    contentHash:
      hash,

    active:
      true,

    publishedAt:
      stamp,

    immutable:
      true,
  };
}

export async function publishV2ContractTemplate(
  db,
  {
    title,
    body,
  },
) {
  const templateTitle =
    cleanText(
      title,
      180,
    );

  const templateBody =
    cleanText(
      body,
      100000,
    );

  if (
    !templateTitle
    || !templateBody
  ) {
    throw new Error(
      'Título e texto do contrato são obrigatórios.',
    );
  }

  const row =
    await db
      .prepare(
        `
          SELECT
            COALESCE(
              MAX(version),
              0
            ) AS max_version
          FROM v2_contract_templates
        `,
      )
      .first();

  const version =
    Number(
      row
        ?.max_version
      || 0,
    )
    + 1;

  const hash =
    await sha256Hex(
      templateBody,
    );

  const stamp =
    nowIso();

  await db.batch([
    db
      .prepare(
        `
          UPDATE v2_contract_templates
          SET active = 0
          WHERE active = 1
        `,
      ),

    db
      .prepare(
        `
          INSERT INTO v2_contract_templates(
            version,
            title,
            body,
            content_hash,
            active,
            published_at,
            created_at
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            1,
            ?,
            ?
          )
        `,
      )
      .bind(
        version,
        templateTitle,
        templateBody,
        hash,
        stamp,
        stamp,
      ),
  ]);

  return {
    version,

    title:
      templateTitle,

    contentHash:
      hash,

    active:
      true,

    publishedAt:
      stamp,

    immutable:
      true,
  };
}
