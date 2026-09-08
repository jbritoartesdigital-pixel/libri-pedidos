import {
  catalogFromSettings,
} from './settings.js';

/* ==================================================
   PREÇOS POR QUANTIDADE DE CENAS
================================================== */

export const SCENE_PRICES = Object.freeze({
  video: Object.freeze({
    1: 3500,
    2: 5000,
    3: 6500,
    4: 8000,
    5: 10500,
    6: 13000,
    7: 15500,
    8: 18000,
    9: 20500,
    10: 23000,
  }),

  interactive: Object.freeze({
    1: 5000,
    2: 7000,
    3: 9500,
    4: 12000,
    5: 15000,
    6: 18000,
    7: 21000,
    8: 24000,
    9: 27000,
    10: 30000,
  }),
});

/* ==================================================
   LIBRI MOMENTS
================================================== */

const PHOTO_ALBUM_PLANS = {
  festa: {
    key: 'festa',
    name: 'Festa',
    priceCents: 7900,
    photos: 200,
    days: 30,
  },

  premium: {
    key: 'premium',
    name: 'Premium',
    priceCents: 11900,
    photos: 400,
    days: 60,
  },

  exclusive: {
    key: 'exclusive',
    name: 'Exclusive',
    priceCents: 14900,
    photos: 700,
    days: 90,
  },
};

const PHOTO_ALBUM_EXTRA_100_CENTS =
  1500;

/* ==================================================
   HELPERS
================================================== */

function clampInt(
  value,
  min,
  max,
) {
  const number =
    Number.parseInt(
      value,
      10,
    );

  if (
    !Number.isFinite(number)
  ) {
    return min;
  }

  return Math.min(
    max,
    Math.max(
      min,
      number,
    ),
  );
}

function clampScenes(
  value,
) {
  const number =
    Number.parseInt(
      value,
      10,
    );

  if (
    !Number.isFinite(number)
  ) {
    return 6;
  }

  return Math.min(
    10,
    Math.max(
      1,
      number,
    ),
  );
}

function safeAlbumExtraCount(
  value,
) {
  const number =
    Number.parseInt(
      value,
      10,
    );

  if (
    !Number.isFinite(number)
    || number <= 0
  ) {
    return 0;
  }

  const technicalMax =
    Math.floor(
      Number.MAX_SAFE_INTEGER
      / PHOTO_ALBUM_EXTRA_100_CENTS,
    );

  return Math.min(
    number,
    technicalMax,
  );
}

function safeCents(
  value,
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
    || number < 0
  ) {
    return 0;
  }

  return Math.round(
    number,
  );
}

function safePercent(
  value,
  fallback = 0,
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return fallback;
  }

  return Math.min(
    100,
    Math.max(
      0,
      number,
    ),
  );
}

function normalizeFormat(
  value,
) {
  return value === 'interactive'
    ? 'interactive'
    : 'video';
}

function legacyExperienceForScenes(
  scenes,
) {
  return scenes <= 3
    ? 'reduced'
    : 'full';
}

function normalizeAlbumPlan(
  value,
) {
  return Object.prototype
    .hasOwnProperty
    .call(
      PHOTO_ALBUM_PLANS,
      value,
    )
    ? value
    : '';
}

function normalizeAddons(
  raw = {},
) {
  const photoAlbumPlan =
    normalizeAlbumPlan(
      raw.photoAlbumPlan,
    );

  const photoAlbumExtra100 =
    photoAlbumPlan
      ? safeAlbumExtraCount(
        raw.photoAlbumExtra100,
      )
      : 0;

  return {
    confirmation:
      raw.confirmation
      === true,

    /*
     * Todo plano Libri Moments
     * já inclui um filtro.
     * Quando Moments é selecionado,
     * o filtro avulso não é cobrado.
     */
    filter:
      photoAlbumPlan
        ? false
        : raw.filter === true,

    /*
     * Cena extra foi removida.
     * A quantidade total agora é
     * definida por scenes / sceneCount.
     */

    extraPerson:
      clampInt(
        raw.extraPerson,
        0,
        10,
      ),

    photoAlbumPlan,

    photoAlbumExtra100,
  };
}

function addonLine({
  key,
  qty,
  unitCents,
}) {
  const safeQty =
    Math.max(
      0,
      Number(qty) || 0,
    );

  const safeUnit =
    safeCents(
      unitCents,
    );

  return {
    key,

    qty:
      safeQty,

    unitCents:
      safeUnit,

    totalCents:
      safeQty
      * safeUnit,
  };
}

/* ==================================================
   COTAÇÃO
================================================== */

export function calculateQuote(
  selection = {},
  settings = {},
  options = {},
) {
  const catalog =
    catalogFromSettings(
      settings,
    );

  const scenes =
    clampScenes(
      selection.scenes
      ?? selection.sceneCount
      ?? 6,
    );

  const requestedFormat =
    normalizeFormat(
      selection.format,
    );

  const addons =
    normalizeAddons(
      selection.addons
      || {},
    );

  /*
   * Confirmação Libri só funciona
   * no Vídeo Interativo.
   */
  const format =
    addons.confirmation
      ? 'interactive'
      : requestedFormat;

  const formatAdjusted =
    format
    !== requestedFormat;

  const productCents =
    catalog
      ?.scenePrices
      ?.[format]
      ?.[scenes]
    ?? SCENE_PRICES
      [format]
      [scenes];

  const addonLines = [];

  /* ==================================================
     CONFIRMAÇÃO LIBRI
  ================================================== */

  if (
    addons.confirmation
  ) {
    addonLines.push(
      addonLine({
        key:
          'confirmation',

        qty:
          1,

        unitCents:
          catalog
            ?.addons
            ?.confirmation,
      }),
    );
  }

  /* ==================================================
     FILTRO AVULSO
  ================================================== */

  if (
    addons.filter
  ) {
    addonLines.push(
      addonLine({
        key:
          'filter',

        qty:
          1,

        unitCents:
          catalog
            ?.addons
            ?.filter,
      }),
    );
  }

  /* ==================================================
     PESSOA EXTRA
  ================================================== */

  if (
    addons.extraPerson
    > 0
  ) {
    addonLines.push(
      addonLine({
        key:
          'extraPerson',

        qty:
          addons
            .extraPerson,

        unitCents:
          catalog
            ?.addons
            ?.extraPerson,
      }),
    );
  }

  /* ==================================================
     LIBRI MOMENTS
  ================================================== */

  const defaultAlbumPlan =
    addons.photoAlbumPlan
      ? PHOTO_ALBUM_PLANS[
        addons.photoAlbumPlan
      ]
      : null;

  const configuredAlbumPlan =
    addons.photoAlbumPlan
      ? catalog
        ?.moments
        ?.plans
        ?.[addons.photoAlbumPlan]
      : null;

  const albumPlan =
    defaultAlbumPlan
      ? {
        ...defaultAlbumPlan,

        priceCents:
          configuredAlbumPlan
            ?.priceCents
          ?? defaultAlbumPlan
            .priceCents,
      }
      : null;

  const photoAlbumExtra100Cents =
    catalog
      ?.moments
      ?.extra100Cents
    ?? PHOTO_ALBUM_EXTRA_100_CENTS;

  if (
    albumPlan
  ) {
    addonLines.push(
      addonLine({
        key:
          addons.photoAlbumPlan
          === 'festa'
            ? 'photoAlbumFesta'
            : addons.photoAlbumPlan
            === 'premium'
              ? 'photoAlbumPremium'
              : 'photoAlbumExclusive',

        qty:
          1,

        unitCents:
          albumPlan
            .priceCents,
      }),
    );

    if (
      addons.photoAlbumExtra100
      > 0
    ) {
      addonLines.push(
        addonLine({
          key:
            'photoAlbumExtra100',

          qty:
            addons
              .photoAlbumExtra100,

          unitCents:
            photoAlbumExtra100Cents,
        }),
      );
    }
  }

  /* ==================================================
     TOTAIS
  ================================================== */

  const addonsCents =
    addonLines.reduce(
      (
        total,
        line,
      ) =>
        total
        + line.totalCents,

      0,
    );

  const subtotalCents =
    productCents
    + addonsCents;

  /* ==================================================
     URGÊNCIA
  ================================================== */

  const urgencyEnabled =
    options
      ?.urgencyEnabled
    === true;

  const urgencyPercent =
    urgencyEnabled
      ? safePercent(
        catalog
          ?.rules
          ?.urgencyPercent,
      )
      : 0;

  const urgencyAmountCents =
    urgencyEnabled
      ? Math.round(
        subtotalCents
        * urgencyPercent
        / 100,
      )
      : 0;

  const totalCents =
    subtotalCents
    + urgencyAmountCents;

  /* ==================================================
     ENTRADA
  ================================================== */

  const depositPercent =
    safePercent(
      catalog
        ?.rules
        ?.depositPercent,

      50,
    );

  const depositCents =
    Math.round(
      totalCents
      * depositPercent
      / 100,
    );

  const balanceCents =
    totalCents
    - depositCents;

  const experience =
    legacyExperienceForScenes(
      scenes,
    );

  /* ==================================================
     RESULTADO
  ================================================== */

  return {
    scenes,

    sceneCount:
      scenes,

    /*
     * Compatibilidade temporária
     * com pedidos e telas antigas.
     */
    experience,

    legacyExperience:
      experience,

    requestedFormat,

    format,

    formatAdjusted,

    addons,

    addonLines,

    productCents,

    addonsCents,

    subtotalCents,

    urgencyEnabled,

    urgencyPercent,

    urgencyAmountCents,

    totalCents,

    depositPercent,

    depositCents,

    balanceCents,

    photoAlbum:
      albumPlan
        ? {
          plan:
            albumPlan.key,

          name:
            albumPlan.name,

          basePriceCents:
            albumPlan
              .priceCents,

          photos:
            albumPlan.photos
            + (
              addons
                .photoAlbumExtra100
              * 100
            ),

          basePhotos:
            albumPlan.photos,

          extra100:
            addons
              .photoAlbumExtra100,

          extra100Cents:
            photoAlbumExtra100Cents,

          days:
            albumPlan.days,

          filterIncluded:
            true,
        }
        : null,
  };
}

/* ==================================================
   EXPORTS ÚTEIS
================================================== */

export const libriMomentsCatalog = {
  plans:
    PHOTO_ALBUM_PLANS,

  extra100Cents:
    PHOTO_ALBUM_EXTRA_100_CENTS,
};
