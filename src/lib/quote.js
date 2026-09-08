// LIBRI PEDIDOS V2 | lib/quote.js
// Nova precificação por quantidade de cenas.
// Mantém compatibilidade com pedidos antigos por meio do campo experience.

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

function clampScenes(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return 6;
  }

  return Math.max(1, Math.min(10, parsed));
}

function normalizeFormat(value) {
  return value === 'interactive'
    ? 'interactive'
    : 'video';
}

function legacyExperienceForScenes(scenes) {
  // Somente para manter compatibilidade com pedidos antigos.
  // A interface nova NÃO usa mais Reduzido / Completo.
  return scenes <= 3
    ? 'reduced'
    : 'full';
}

function asInt(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? Math.max(0, Math.round(number))
    : fallback;
}

function getNested(object, path) {
  return path
    .split('.')
    .reduce(
      (current, key) => current?.[key],
      object
    );
}

function firstInt(settings, paths, fallback = 0) {
  for (const path of paths) {
    const value = getNested(settings, path);

    if (
      value !== undefined &&
      value !== null &&
      value !== ''
    ) {
      return asInt(value, fallback);
    }
  }

  return fallback;
}

export function calculateQuote(
  selection = {},
  settings = {},
  options = {}
) {
  const requestedFormat = normalizeFormat(
    selection.format
  );

  const scenes = clampScenes(
    selection.scenes ??
    selection.sceneCount ??
    6
  );

  const addons = {
    confirmation:
      selection.addons?.confirmation === true,

    filter:
      selection.addons?.filter === true,

    extraPerson: Math.max(
      0,
      Math.min(
        10,
        Number.parseInt(
          selection.addons?.extraPerson,
          10
        ) || 0
      )
    ),
  };

  // Confirmação Libri depende do Vídeo Interativo.
  const formatAdjusted =
    addons.confirmation &&
    requestedFormat === 'video';

  const format = formatAdjusted
    ? 'interactive'
    : requestedFormat;

  const productCents =
    SCENE_PRICES[format][scenes];

  const confirmationUnit = firstInt(
    settings,
    [
      'addons.confirmation',
      'prices.addons.confirmation',
      'catalog.addons.confirmation',
    ],
    2500
  );

  const filterUnit = firstInt(
    settings,
    [
      'addons.filter',
      'prices.addons.filter',
      'catalog.addons.filter',
    ],
    3900
  );

  const extraPersonUnit = firstInt(
    settings,
    [
      'addons.extraPerson',
      'prices.addons.extraPerson',
      'catalog.addons.extraPerson',
    ],
    0
  );

  const addonLines = [
    {
      key: 'confirmation',
      qty: addons.confirmation ? 1 : 0,
      unitCents: confirmationUnit,
      totalCents:
        addons.confirmation
          ? confirmationUnit
          : 0,
    },

    {
      key: 'filter',
      qty: addons.filter ? 1 : 0,
      unitCents: filterUnit,
      totalCents:
        addons.filter
          ? filterUnit
          : 0,
    },

    {
      key: 'extraPerson',
      qty: addons.extraPerson,
      unitCents: extraPersonUnit,
      totalCents:
        addons.extraPerson *
        extraPersonUnit,
    },
  ].filter(
    (line) => line.qty > 0
  );

  const addonsCents =
    addonLines.reduce(
      (total, line) =>
        total + line.totalCents,
      0
    );

  const subtotalCents =
    productCents +
    addonsCents;

  const urgencyEnabled =
    options.urgencyEnabled === true;

  const urgencyPercent =
    urgencyEnabled
      ? firstInt(
          settings,
          [
            'rules.urgencyPercent',
            'urgencyPercent',
            'catalog.rules.urgencyPercent',
          ],
          30
        )
      : 0;

  const urgencyAmountCents =
    urgencyEnabled
      ? Math.round(
          subtotalCents *
          urgencyPercent /
          100
        )
      : 0;

  const totalCents =
    subtotalCents +
    urgencyAmountCents;

  const depositPercent = firstInt(
    settings,
    [
      'rules.depositPercent',
      'depositPercent',
      'catalog.rules.depositPercent',
    ],
    50
  );

  const depositCents =
    Math.round(
      totalCents *
      depositPercent /
      100
    );

  const balanceCents =
    totalCents -
    depositCents;

  return {
    scenes,
    sceneCount: scenes,

    requestedFormat,
    format,
    formatAdjusted,

    // Compatibilidade com banco / rotas antigas.
    experience:
      legacyExperienceForScenes(scenes),

    legacyExperience:
      legacyExperienceForScenes(scenes),

    productCents,

    addons,
    addonLines,
    addonsCents,

    subtotalCents,

    urgencyEnabled,
    urgencyPercent,
    urgencyAmountCents,

    totalCents,

    depositPercent,
    depositCents,
    balanceCents,
  };
}