import {
  catalogFromSettings,
} from './settings.js';

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

  /*
   * Não existe limite comercial
   * de pacotes definido.
   *
   * Este teto existe somente para
   * manter o cálculo em centavos
   * dentro do intervalo inteiro
   * seguro do JavaScript.
   */
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

function safeCents(value) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
    || number < 0
  ) {
    return 0;
  }

  return Math.round(number);
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

function normalizeExperience(
  value,
) {
  return value === 'reduced'
    ? 'reduced'
    : 'full';
}

function normalizeFormat(
  value,
) {
  return value === 'interactive'
    ? 'interactive'
    : 'video';
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
     *
     * Portanto, quando existe
     * álbum, o filtro avulso
     * deixa de ser cobrado.
     */
    filter:
      photoAlbumPlan
        ? false
        : raw.filter === true,

    extraScene:
      clampInt(
        raw.extraScene,
        0,
        10,
      ),

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

  const experience =
    normalizeExperience(
      selection.experience,
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
   * HARD LOCK:
   *
   * Confirmação Libri só funciona
   * no convite Interativo.
   */
  const format =
    addons.confirmation
      ? 'interactive'
      : requestedFormat;

  const formatAdjusted =
    format
    !== requestedFormat;

  const productCents =
    safeCents(
      catalog
        ?.products
        ?.[format]
        ?.[experience],
    );

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
     CENA EXTRA
  ================================================== */

  if (
    addons.extraScene
    > 0
  ) {
    addonLines.push(
      addonLine({
        key:
          'extraScene',

        qty:
          addons
            .extraScene,

        unitCents:
          catalog
            ?.addons
            ?.extraScene,
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

  const albumPlan =
    addons.photoAlbumPlan
      ? PHOTO_ALBUM_PLANS[
        addons.photoAlbumPlan
      ]
      : null;

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
            PHOTO_ALBUM_EXTRA_100_CENTS,
        }),
      );
    }
  }

  /* ==================================================
     TOTAIS DOS ADICIONAIS
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

  /* ==================================================
     RESULTADO
  ================================================== */

  return {
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
            PHOTO_ALBUM_EXTRA_100_CENTS,

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
