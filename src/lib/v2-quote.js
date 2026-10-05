import {
  loadV2AddonsByCodes,
  loadV2Settings,
  resolveV2ProductSelection,
  v2IntSetting,
} from './v2-catalog.js';

function normalizeAddonCodes(
  rawCodes = [],
) {
  const codes =
    [
      ...new Set(
        (Array.isArray(rawCodes)
          ? rawCodes
          : [])
          .map(
            (value) =>
              String(
                value
                || '',
              ).trim(),
          )
          .filter(Boolean),
      ),
    ];

  const hasMoments =
    codes.some(
      (code) =>
        code.startsWith(
          'moments_',
        )
        && code
          !== 'moments_extra_100',
    );

  if (!hasMoments) {
    return codes;
  }

  /*
   * Libri Moments já inclui
   * filtro no App Libri.
   * Nunca cobramos filtro
   * avulso junto com Moments.
   */
  return codes.filter(
    (code) =>
      code
      !== 'custom_filter',
  );
}

function moneyLine(
  type,
  code,
  name,
  amountCents,
) {
  return {
    type,
    code,
    name,
    amountCents,
  };
}

export async function calculateV2Quote(
  db,
  selection = {},
  serverOptions = {},
) {
  const [
    resolved,
    settings,
  ] =
    await Promise.all([
      resolveV2ProductSelection(
        db,
        selection,
      ),

      loadV2Settings(
        db,
      ),
    ]);

  const addonCodes =
    normalizeAddonCodes(
      selection.addonCodes,
    );

  const addons =
    await loadV2AddonsByCodes(
      db,
      addonCodes,
    );

  const lines = [
    moneyLine(
      'product',
      resolved.variant.code,
      resolved.product.name,
      resolved.variant.priceCents,
    ),

    ...addons.map(
      (addon) =>
        moneyLine(
          'addon',
          addon.code,
          addon.name,
          addon.priceCents,
        ),
    ),
  ];

  const productCents =
    resolved.variant
      .priceCents;

  const addonsCents =
    addons.reduce(
      (
        total,
        addon,
      ) =>
        total
        + addon.priceCents,

      0,
    );

  /*
   * Descontos de combo ainda
   * não são aplicados aqui.
   * A estrutura já existe no D1,
   * mas os valores comerciais
   * finais ainda não foram travados.
   */
  const comboDiscountCents =
    0;

  const couponDiscountCents =
    0;

  const subtotalCents =
    productCents
    + addonsCents
    - comboDiscountCents
    - couponDiscountCents;

  const urgencyApproved =
    serverOptions
      .urgencyApproved
    === true;

  const urgencyPercent =
    urgencyApproved
      ? 30
      : 0;

  const urgencyAmountCents =
    urgencyApproved
      ? Math.round(
        subtotalCents
        * urgencyPercent
        / 100,
      )
      : 0;

  const totalCents =
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

  const pixDepositPercent = 50;

  const depositPercent =
    paymentMethod
      === 'card'
      ? 100
      : pixDepositPercent;

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

  const pointsUnits =
    resolved.variant
      .pointsUnits
    + addons.reduce(
      (
        total,
        addon,
      ) =>
        total
        + addon.pointsUnits,

      0,
    );

  return {
    product: {
      ...resolved.product,
    },

    variant: {
      ...resolved.variant,
    },

    addons,

    lines,

    productCents,
    addonsCents,
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

    totalCents,

    payment: {
      method:
        paymentMethod,

      depositPercent,

      depositCents,

      balanceCents,
    },

    pointsUnits,

    points:
      pointsUnits
      / 100,
  };
}

