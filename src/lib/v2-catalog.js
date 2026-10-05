import {
  parseJson,
} from './http.js';

function uniqueStrings(values = []) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  ];
}

export async function loadV2Settings(db) {
  const result =
    await db
      .prepare(
        `
          SELECT
            key,
            value
          FROM v2_settings
        `,
      )
      .all();

  return Object.fromEntries(
    (result.results || [])
      .map((row) => [
        row.key,
        row.value,
      ]),
  );
}

export function v2IntSetting(
  settings,
  key,
  fallback = 0,
) {
  const parsed =
    Number.parseInt(
      settings?.[key],
      10,
    );

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

export async function loadV2Catalog(db) {
  const [
    productsResult,
    variantsResult,
    addonsResult,
    combosResult,
    comboItemsResult,
    settings,
  ] =
    await Promise.all([
      db
        .prepare(
          `
            SELECT
              code,
              slug,
              name,
              short_description,
              pricing_mode,
              sort_order,
              config_json
            FROM v2_products
            WHERE active = 1
            ORDER BY sort_order, id
          `,
        )
        .all(),

      db
        .prepare(
          `
            SELECT
              pv.code,
              p.code AS product_code,
              pv.label,
              pv.scene_count,
              pv.price_cents,
              pv.points_units,
              pv.is_default,
              pv.sort_order,
              pv.config_json
            FROM v2_product_variants pv
            INNER JOIN v2_products p
              ON p.id = pv.product_id
            WHERE
              pv.active = 1
              AND p.active = 1
            ORDER BY
              p.sort_order,
              pv.sort_order,
              pv.id
          `,
        )
        .all(),

      db
        .prepare(
          `
            SELECT
              code,
              name,
              addon_group,
              price_cents,
              points_units,
              sort_order,
              config_json
            FROM v2_addons
            WHERE active = 1
            ORDER BY sort_order, id
          `,
        )
        .all(),

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
              config_json
            FROM v2_combos
            WHERE active = 1
            ORDER BY id
          `,
        )
        .all(),

      db
        .prepare(
          `
            SELECT
              combo_id,
              item_type,
              item_code,
              required
            FROM v2_combo_items
            ORDER BY id
          `,
        )
        .all(),

      loadV2Settings(db),
    ]);

  const variantsByProduct = {};

  for (
    const row
    of variantsResult.results || []
  ) {
    const key =
      row.product_code;

    if (!variantsByProduct[key]) {
      variantsByProduct[key] = [];
    }

    variantsByProduct[key]
      .push({
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
          row.is_default === 1,

        config:
          parseJson(
            row.config_json,
            {},
          ),
      });
  }

  const products =
    (productsResult.results || [])
      .map(
        (row) => ({
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

          config:
            parseJson(
              row.config_json,
              {},
            ),

          variants:
            variantsByProduct[
              row.code
            ] || [],
        }),
      );

  const addons =
    (addonsResult.results || [])
      .map(
        (row) => ({
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

          config:
            parseJson(
              row.config_json,
              {},
            ),
        }),
      );

  const comboItemsById =
    new Map();

  for (
    const item
    of comboItemsResult.results
    || []
  ) {
    if (
      !comboItemsById.has(
        item.combo_id,
      )
    ) {
      comboItemsById.set(
        item.combo_id,
        [],
      );
    }

    comboItemsById
      .get(
        item.combo_id,
      )
      .push({
        itemType:
          item.item_type,

        itemCode:
          item.item_code,

        required:
          Number(
            item.required,
          ) === 1,
      });
  }

  const combos =
    (combosResult.results || [])
      .map(
        (row) => ({
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
            Number(
              row.discount_value
              || 0,
            ),

          items:
            comboItemsById.get(
              row.id,
            )
            || [],

          config:
            parseJson(
              row.config_json,
              {},
            ),
        }),
      );

  return {
    products,
    addons,
    combos,

    rules: {
      pointsUnitScale:
        v2IntSetting(
          settings,
          'points_unit_scale',
          100,
        ),

      sellablePointsPerDayUnits:
        v2IntSetting(
          settings,
          'default_sellable_points_per_day_units',
          400,
        ),

      internalBufferPointsPerDayUnits:
        v2IntSetting(
          settings,
          'default_internal_buffer_points_per_day_units',
          100,
        ),

      recommendedDeliveryDaysBeforeEvent:
        v2IntSetting(
          settings,
          'recommended_delivery_days_before_event',
          40,
        ),

      urgencyPercent:
        v2IntSetting(
          settings,
          'urgency_percent',
          30,
        ),

      pixDepositPercent:
        v2IntSetting(
          settings,
          'pix_deposit_percent',
          50,
        ),

      previewExpiryHours:
        v2IntSetting(
          settings,
          'preview_expiry_hours',
          24,
        ),

      checkoutHoldMinutes:
        v2IntSetting(
          settings,
          'checkout_hold_minutes',
          30,
        ),
    },
  };
}

export async function resolveV2ProductSelection(
  db,
  selection = {},
) {
  const productCode =
    String(
      selection.productCode
      || '',
    ).trim();

  const productSlug =
    String(
      selection.productSlug
      || '',
    ).trim();

  let product;

  if (productCode) {
    product =
      await db
        .prepare(
          `
            SELECT
              id,
              code,
              slug,
              name,
              pricing_mode,
              config_json
            FROM v2_products
            WHERE
              code = ?
              AND active = 1
            LIMIT 1
          `,
        )
        .bind(productCode)
        .first();
  } else if (productSlug) {
    product =
      await db
        .prepare(
          `
            SELECT
              id,
              code,
              slug,
              name,
              pricing_mode,
              config_json
            FROM v2_products
            WHERE
              slug = ?
              AND active = 1
            LIMIT 1
          `,
        )
        .bind(productSlug)
        .first();
  }

  if (!product) {
    throw new Error(
      'Produto não encontrado.',
    );
  }

  const variantCode =
    String(
      selection.variantCode
      || '',
    ).trim();

  let variant;

  if (variantCode) {
    variant =
      await db
        .prepare(
          `
            SELECT
              code,
              label,
              scene_count,
              price_cents,
              points_units,
              is_default,
              config_json
            FROM v2_product_variants
            WHERE
              product_id = ?
              AND code = ?
              AND active = 1
            LIMIT 1
          `,
        )
        .bind(
          product.id,
          variantCode,
        )
        .first();
  } else if (
    product.pricing_mode
    === 'scene_count'
  ) {
    const scenes =
      Number.parseInt(
        selection.scenes,
        10,
      );

    if (
      !Number.isInteger(scenes)
      || scenes < 1
      || scenes > 8
    ) {
      throw new Error(
        'Escolha entre 1 e 8 cenas.',
      );
    }

    variant =
      await db
        .prepare(
          `
            SELECT
              code,
              label,
              scene_count,
              price_cents,
              points_units,
              is_default,
              config_json
            FROM v2_product_variants
            WHERE
              product_id = ?
              AND scene_count = ?
              AND active = 1
            LIMIT 1
          `,
        )
        .bind(
          product.id,
          scenes,
        )
        .first();
  } else {
    variant =
      await db
        .prepare(
          `
            SELECT
              code,
              label,
              scene_count,
              price_cents,
              points_units,
              is_default,
              config_json
            FROM v2_product_variants
            WHERE
              product_id = ?
              AND active = 1
            ORDER BY
              is_default DESC,
              sort_order,
              id
            LIMIT 1
          `,
        )
        .bind(product.id)
        .first();
  }

  if (!variant) {
    throw new Error(
      'Configuração deste produto não encontrada.',
    );
  }

  return {
    product: {
      code:
        product.code,

      slug:
        product.slug,

      name:
        product.name,

      pricingMode:
        product.pricing_mode,

      config:
        parseJson(
          product.config_json,
          {},
        ),
    },

    variant: {
      code:
        variant.code,

      label:
        variant.label,

      sceneCount:
        variant.scene_count,

      priceCents:
        variant.price_cents,

      pointsUnits:
        variant.points_units,

      config:
        parseJson(
          variant.config_json,
          {},
        ),
    },
  };
}

export async function loadV2AddonsByCodes(
  db,
  rawCodes = [],
) {
  const codes =
    uniqueStrings(
      rawCodes,
    );

  if (!codes.length) {
    return [];
  }

  const placeholders =
    codes
      .map(() => '?')
      .join(', ');

  const result =
    await db
      .prepare(
        `
          SELECT
            code,
            name,
            addon_group,
            price_cents,
            points_units,
            config_json
          FROM v2_addons
          WHERE
            active = 1
            AND code IN (${placeholders})
        `,
      )
      .bind(...codes)
      .all();

  const rows =
    result.results
    || [];

  const found =
    new Set(
      rows.map(
        (row) => row.code,
      ),
    );

  const missing =
    codes
      .filter(
        (code) =>
          !found.has(code),
      );

  if (missing.length) {
    throw new Error(
      `Adicional não encontrado: ${missing[0]}.`,
    );
  }

  return rows.map(
    (row) => ({
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

      config:
        parseJson(
          row.config_json,
          {},
        ),
    }),
  );
}
