import {
  parseJson,
} from './http.js';

import {
  calculateV2Quote,
} from './v2-quote.js';

import {
  loadV2Settings,
  v2IntSetting,
} from './v2-catalog.js';

import { priceWithCardProcessingFee } from './v2-payment-pricing.js';

function cleanText(
  value,
  maxLength = 200,
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

function percentDiscount(
  baseCents,
  percent,
) {
  return Math.round(
    baseCents
    * percent
    / 100,
  );
}

function boundedDiscount(
  baseCents,
  discountCents,
) {
  return Math.max(
    0,
    Math.min(
      baseCents,
      Number(
        discountCents
        || 0,
      ),
    ),
  );
}

function discountValue(
  baseCents,
  type,
  value,
) {
  const amount =
    type
    === 'percent'
      ? percentDiscount(
        baseCents,
        Number(
          value
          || 0,
        ),
      )
      : Number(
        value
        || 0,
      );

  return boundedDiscount(
    baseCents,
    amount,
  );
}

async function activeCombo(
  db,
  code,
) {
  const normalized =
    cleanText(
      code,
      80,
    );

  if (!normalized) {
    return null;
  }

  const combo =
    await db
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
          WHERE
            code = ?
            AND active = 1
          LIMIT 1
        `,
      )
      .bind(
        normalized,
      )
      .first();

  if (!combo) {
    throw new Error(
      'Combo não encontrado ou inativo.',
    );
  }

  const itemsResult =
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
        combo.id,
      )
      .all();

  return {
    ...combo,

    items:
      itemsResult.results
      || [],
  };
}

async function activeCombosForSuggestion(
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
              config_json
            FROM v2_combos
            WHERE
              active = 1
              AND discount_value > 0
            ORDER BY id
          `,
        )
        .all(),

      db
        .prepare(
          `
            SELECT
              i.combo_id,
              i.item_type,
              i.item_code,
              i.required
            FROM v2_combo_items i
            INNER JOIN v2_combos c
              ON c.id = i.combo_id
            WHERE
              c.active = 1
              AND c.discount_value > 0
            ORDER BY
              i.combo_id,
              i.id
          `,
        )
        .all(),
    ]);

  const itemsByCombo =
    new Map();

  for (
    const item
    of itemsResult.results
    || []
  ) {
    if (
      !itemsByCombo.has(
        item.combo_id,
      )
    ) {
      itemsByCombo.set(
        item.combo_id,
        [],
      );
    }

    itemsByCombo
      .get(
        item.combo_id,
      )
      .push(
        item,
      );
  }

  return (
    combosResult.results
    || []
  )
    .map(
      (combo) => ({
        ...combo,

        items:
          itemsByCombo
            .get(
              combo.id,
            )
          || [],
      }),
    );
}

async function bestComboSuggestion(
  db,
  quote,
  baseCents,
) {
  const combos =
    await activeCombosForSuggestion(
      db,
    );

  const eligible =
    combos
      .filter(
        (combo) =>
          comboMatches(
            combo,
            quote,
          ),
      )
      .map(
        (combo) => {
          const requiredItems =
            combo.items
              .filter(
                (item) =>
                  Number(
                    item.required,
                  )
                  === 1,
              )
              .length;

          return {
            ...combo,

            requiredItems,

            discountCents:
              discountValue(
                baseCents,
                combo.discount_type,
                combo.discount_value,
              ),
          };
        },
      )
      .filter(
        (combo) =>
          combo.discountCents
          > 0,
      )
      .sort(
        (
          left,
          right,
        ) =>
          right.requiredItems
          - left.requiredItems
          || right.discountCents
            - left.discountCents
          || Number(
            left.id,
          )
            - Number(
              right.id,
            ),
      );

  return eligible[0]
    || null;
}

function comboMatches(
  combo,
  quote,
) {
  if (!combo) {
    return true;
  }

  const addonCodes =
    new Set(
      quote.addons.map(
        (addon) =>
          addon.code,
      ),
    );

  const addonGroups =
    new Set(
      quote.addons.map(
        (addon) =>
          addon.group,
      ),
    );

  return combo.items
    .filter(
      (item) =>
        Number(
          item.required,
        )
        === 1,
    )
    .every(
      (item) => {
        if (
          item.item_type
          === 'main_product'
        ) {
          return item.item_code
            === quote.product.code;
        }

        if (
          item.item_type
          === 'addon'
        ) {
          return addonCodes.has(
            item.item_code,
          );
        }

        if (
          item.item_type
          === 'addon_group'
        ) {
          return addonGroups.has(
            item.item_code,
          );
        }

        return false;
      },
    );
}

function couponRestrictionsMatch(
  restrictions,
  {
    quote,
    eventType,
  },
) {
  const productCodes =
    Array.isArray(
      restrictions.productCodes,
    )
      ? restrictions.productCodes
      : [];

  if (
    productCodes.length
    && !productCodes.includes(
      quote.product.code,
    )
  ) {
    return false;
  }

  const eventTypes =
    Array.isArray(
      restrictions.eventTypes,
    )
      ? restrictions.eventTypes
      : [];

  if (
    eventTypes.length
    && eventType
    && !eventTypes.includes(
      eventType,
    )
  ) {
    return false;
  }

  const addonCodes =
    Array.isArray(
      restrictions.addonCodes,
    )
      ? restrictions.addonCodes
      : [];

  if (
    addonCodes.length
  ) {
    const selected =
      new Set(
        quote.addons.map(
          (addon) =>
            addon.code,
        ),
      );

    if (
      !addonCodes.some(
        (code) =>
          selected.has(
            code,
          ),
      )
    ) {
      return false;
    }
  }

  const minScenes =
    Number.parseInt(
      restrictions.minScenes,
      10,
    );

  if (
    Number.isInteger(
      minScenes,
    )
    && Number(
      quote.variant
        .sceneCount
      || 0,
    )
      < minScenes
  ) {
    return false;
  }

  const maxScenes =
    Number.parseInt(
      restrictions.maxScenes,
      10,
    );

  if (
    Number.isInteger(
      maxScenes,
    )
    && Number(
      quote.variant
        .sceneCount
      || 0,
    )
      > maxScenes
  ) {
    return false;
  }

  return true;
}

async function activeCoupon(
  db,
  code,
  {
    customerId = null,
    eventType = null,
    quote,
    baseCents,
  },
) {
  const normalized =
    cleanText(
      code,
      80,
    );

  if (!normalized) {
    return null;
  }

  const coupon =
    await db
      .prepare(
        `
          SELECT
            id,
            code,
            discount_type,
            discount_value,
            min_order_cents,
            max_uses,
            max_uses_per_customer,
            valid_from,
            valid_until,
            restrictions_json
          FROM v2_coupons
          WHERE
            code = ?
            COLLATE NOCASE
            AND active = 1
          LIMIT 1
        `,
      )
      .bind(
        normalized,
      )
      .first();

  if (!coupon) {
    throw new Error(
      'Cupom inválido ou inativo.',
    );
  }

  const now =
    Date.now();

  if (
    coupon.valid_from
    && Date.parse(
      coupon.valid_from,
    ) > now
  ) {
    throw new Error(
      'Este cupom ainda não está válido.',
    );
  }

  if (
    coupon.valid_until
    && Date.parse(
      coupon.valid_until,
    ) < now
  ) {
    throw new Error(
      'Este cupom expirou.',
    );
  }

  if (
    baseCents
    < Number(
      coupon.min_order_cents
      || 0,
    )
  ) {
    throw new Error(
      'O pedido não atingiu o valor mínimo deste cupom.',
    );
  }

  const useCount =
    await db
      .prepare(
        `
          SELECT COUNT(*) AS total
          FROM v2_coupon_uses
          WHERE coupon_id = ?
        `,
      )
      .bind(
        coupon.id,
      )
      .first();

  if (
    coupon.max_uses !== null
    && Number(
      useCount
        ?.total
      || 0,
    )
      >= Number(
        coupon.max_uses,
      )
  ) {
    throw new Error(
      'Este cupom atingiu o limite de usos.',
    );
  }

  if (
    customerId
    && coupon
      .max_uses_per_customer
      !== null
  ) {
    const customerUseCount =
      await db
        .prepare(
          `
            SELECT COUNT(*) AS total
            FROM v2_coupon_uses
            WHERE
              coupon_id = ?
              AND customer_id = ?
          `,
        )
        .bind(
          coupon.id,
          customerId,
        )
        .first();

    if (
      Number(
        customerUseCount
          ?.total
        || 0,
      )
      >= Number(
        coupon
          .max_uses_per_customer,
      )
    ) {
      throw new Error(
        'Este cupom já atingiu o limite de uso para esta cliente.',
      );
    }
  }

  const restrictions =
    parseJson(
      coupon
        .restrictions_json,
      {},
    );

  if (
    !couponRestrictionsMatch(
      restrictions,
      {
        quote,
        eventType,
      },
    )
  ) {
    throw new Error(
      'Este cupom não se aplica a esta configuração.',
    );
  }

  return {
    ...coupon,
    restrictions,
  };
}

export async function calculateCommercialV2Quote(
  db,
  selection = {},
  {
    customerId = null,
    eventType = null,
    urgencyApproved = false,
  } = {},
) {
  /*
   * A base existente continua sendo a fonte
   * de produto, variante, adicionais e points.
   * Combo/cupom/urgência comercial entram aqui.
   */
  const base =
    await calculateV2Quote(
      db,
      selection,
      {
        urgencyApproved:
          false,
      },
    );

  const baseBeforeDiscounts =
    Number(
      base.productCents
      || 0,
    )
    + Number(
      base.addonsCents
      || 0,
    );

  const combo =
    await activeCombo(
      db,
      selection.comboCode,
    );

  if (
    combo
    && !comboMatches(
      combo,
      base,
    )
  ) {
    throw new Error(
      'Os itens escolhidos não correspondem a este combo.',
    );
  }

  const comboDiscountCents =
    combo
      ? discountValue(
        baseBeforeDiscounts,
        combo.discount_type,
        combo.discount_value,
      )
      : 0;

  const afterCombo =
    Math.max(
      0,
      baseBeforeDiscounts
      - comboDiscountCents,
    );

  const suggestedCombo =
    combo
      ? null
      : await bestComboSuggestion(
        db,
        base,
        baseBeforeDiscounts,
      );


  const coupon =
    await activeCoupon(
      db,
      selection.couponCode,
      {
        customerId,
        eventType,
        quote:
          base,
        baseCents:
          afterCombo,
      },
    );

  const couponDiscountCents =
    coupon
      ? discountValue(
        afterCombo,
        coupon.discount_type,
        coupon.discount_value,
      )
      : 0;

  const subtotalCents =
    Math.max(
      0,
      afterCombo
      - couponDiscountCents,
    );

  const settings =
    await loadV2Settings(
      db,
    );

  const configuredUrgencyPercent =
    Math.max(
      1,
      Math.min(
        100,
        v2IntSetting(
          settings,
          'urgency_percent',
          30,
        ),
      ),
    );

  const urgencyPercent =
    urgencyApproved
      ? configuredUrgencyPercent
      : 0;

  const urgencyAmountCents =
    urgencyApproved
      ? Math.round(
        subtotalCents
        * urgencyPercent
        / 100,
      )
      : 0;

  const baseTotalCents =
    subtotalCents
    + urgencyAmountCents;

  const paymentMethod =
    [
      'pix',
      'card',
    ].includes(
      selection.paymentMethod,
    )
      ? selection.paymentMethod
      : null;

  if (!paymentMethod) {
    throw new Error(
      'Escolha Pix ou cartão.',
    );
  }

  const { totalCents, cardFeeCents, cardFeePercent } =
    priceWithCardProcessingFee(baseTotalCents, paymentMethod);

  const depositPercent =
    paymentMethod
    === 'card'
      ? 100
      : 50;

  const depositCents =
    Math.round(
      totalCents
      * depositPercent
      / 100,
    );

  const balanceCents =
    Math.max(
      0,
      totalCents
      - depositCents,
    );

  return {
    ...base,

    combo: combo
      ? {
        id:
          combo.id,

        code:
          combo.code,

        name:
          combo.name,
      }
      : null,

    suggestedCombo:
      suggestedCombo
        ? {
          code:
            suggestedCombo.code,

          name:
            suggestedCombo.name,

          description:
            suggestedCombo.description
            || '',

          discountCents:
            suggestedCombo.discountCents,
        }
        : null,

    coupon: coupon
      ? {
        id:
          coupon.id,

        code:
          coupon.code,
      }
      : null,

    comboDiscountCents,
    couponDiscountCents,
    subtotalCents,

    urgency: {
      approved:
        urgencyApproved,

      percent:
        urgencyPercent,

      amountCents:
        urgencyAmountCents,
    },

    baseTotalCents,
    cardFeeCents,
    cardFeePercent,
    totalCents,

    payment: {
      method:
        paymentMethod,

      depositPercent,

      depositCents,

      balanceCents,
    },
  };
}

export async function commitV2CouponUse(
  db,
  {
    orderId,
    customerId,
    pricingSnapshot,
    discountCents,
  },
) {
  const snapshot =
    typeof pricingSnapshot
      === 'string'
      ? parseJson(
        pricingSnapshot,
        {},
      )
      : (
        pricingSnapshot
        || {}
      );

  const coupon =
    snapshot.coupon;

  if (
    !coupon
    || !coupon.id
    || Number(
      discountCents
      || 0,
    )
      <= 0
  ) {
    return {
      committed:
        false,
    };
  }

  const result =
    await db
      .prepare(
        `
          INSERT OR IGNORE INTO v2_coupon_uses(
            coupon_id,
            order_id,
            customer_id,
            discount_cents,
            used_at
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            datetime('now')
          )
        `,
      )
      .bind(
        coupon.id,
        orderId,
        customerId,
        Number(
          discountCents,
        ),
      )
      .run();

  return {
    committed:
      Number(
        result
          ?.meta
          ?.changes
        || 0,
      )
      > 0,
  };
}

