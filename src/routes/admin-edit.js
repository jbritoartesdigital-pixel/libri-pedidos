import {
  fail,
  json,
  normalizeWhatsapp,
  nowIso,
  readJson,
} from '../lib/http.js';

import {
  calculateQuote,
} from '../lib/quote.js';

import {
  loadSettings,
} from '../lib/settings.js';

import {
  addHistory,
} from '../lib/orders.js';

const text = (
  value,
  max = 3000,
) =>
  String(
    value ?? '',
  )
    .trim()
    .slice(
      0,
      max,
    );

const nullable = (
  value,
  max = 3000,
) =>
  text(
    value,
    max,
  )
  || null;

const hasOwn = (
  object,
  key,
) =>
  Object.prototype
    .hasOwnProperty
    .call(
      object || {},
      key,
    );

/* ==================================================
   JSON
================================================== */

function parseJson(
  value,
  fallback = {},
) {
  if (!value) {
    return fallback;
  }

  try {
    const parsed =
      JSON.parse(
        value,
      );

    return (
      parsed
      && typeof parsed === 'object'
    )
      ? parsed
      : fallback;
  } catch {
    return fallback;
  }
}

/* ==================================================
   NÚMEROS
================================================== */

function optInt(
  value,
  min,
  max,
) {
  if (
    value === undefined
    || value === null
    || String(value).trim() === ''
  ) {
    return null;
  }

  const number =
    Number.parseInt(
      value,
      10,
    );

  if (
    !Number.isFinite(
      number,
    )
  ) {
    return null;
  }

  return Math.min(
    max,
    Math.max(
      min,
      number,
    ),
  );
}

function optNonNegativeInt(
  value,
) {
  if (
    value === undefined
    || value === null
    || String(value).trim() === ''
  ) {
    return null;
  }

  const number =
    Number.parseInt(
      value,
      10,
    );

  if (
    !Number.isSafeInteger(
      number,
    )
  ) {
    return null;
  }

  return Math.max(
    0,
    number,
  );
}

function optMoney(
  value,
) {
  if (
    value === undefined
    || value === null
    || String(value).trim() === ''
  ) {
    return null;
  }

  const number =
    Number(value);

  return (
    Number.isInteger(
      number,
    )
    && number > 0
  )
    ? number
    : null;
}

/* ==================================================
   NORMALIZAÇÃO
================================================== */

function normalizeExperience(
  value,
  fallback = 'full',
) {
  return [
    'full',
    'reduced',
  ].includes(
    value,
  )
    ? value
    : fallback;
}

function normalizeFormat(
  value,
  fallback = 'video',
) {
  return [
    'video',
    'interactive',
  ].includes(
    value,
  )
    ? value
    : fallback;
}

function speechMode(
  value,
  fallback = 'libri',
) {
  return [
    'libri',
    'approve',
    'own',
  ].includes(
    value,
  )
    ? value
    : fallback;
}

function normalizeAlbumPlan(
  value,
) {
  return [
    'festa',
    'premium',
    'exclusive',
  ].includes(
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

  const extraScene =
    optInt(
      raw.extraScene,
      0,
      10,
    )
    || 0;

  const extraPerson =
    optInt(
      raw.extraPerson,
      0,
      10,
    )
    || 0;

  const photoAlbumExtra100 =
    photoAlbumPlan
      ? (
        optNonNegativeInt(
          raw.photoAlbumExtra100,
        )
        || 0
      )
      : 0;

  return {
    confirmation:
      raw.confirmation
      === true,

    /*
     * Libri Moments já inclui
     * filtro personalizado.
     */
    filter:
      photoAlbumPlan
        ? false
        : raw.filter === true,

    extraScene,

    extraPerson,

    photoAlbumPlan,

    photoAlbumExtra100,
  };
}

/* ==================================================
   COMPARAÇÃO
================================================== */

function sameSelection(
  a,
  b,
) {
  return JSON.stringify({
    experience:
      a.experience,

    format:
      a.format,

    addons:
      normalizeAddons(
        a.addons,
      ),
  }) === JSON.stringify({
    experience:
      b.experience,

    format:
      b.format,

    addons:
      normalizeAddons(
        b.addons,
      ),
  });
}

function changedFields(
  before,
  after,
  keys,
) {
  return keys.filter(
    (key) =>
      JSON.stringify(
        before[key]
        ?? null,
      )
      !== JSON.stringify(
        after[key]
        ?? null,
      ),
  );
}

/* ==================================================
   CAMPOS DO BRIEFING
================================================== */

function briefingValue(
  body,
  briefingPatch,
  key,
  fallback,
) {
  if (
    hasOwn(
      body,
      key,
    )
  ) {
    return body[key];
  }

  if (
    hasOwn(
      briefingPatch,
      key,
    )
  ) {
    return briefingPatch[key];
  }

  return fallback;
}

/* ==================================================
   ROTA
================================================== */

function orderIdFromPath(
  pathname,
) {
  const match =
    pathname.match(
      /^\/api\/admin\/orders\/(\d+)\/edit$/,
    );

  return match
    ? Number(
      match[1],
    )
    : 0;
}

/* ==================================================
   HANDLER
================================================== */

export async function handleAdminEditApi(
  request,
  env,
  url,
) {
  const orderId =
    orderIdFromPath(
      url.pathname,
    );

  if (!orderId) {
    return null;
  }

  if (
    request.method
      .toUpperCase()
    !== 'PATCH'
  ) {
    return fail(
      'Método não permitido.',
      405,
    );
  }

  /* ==================================================
     PEDIDO ATUAL
  ================================================== */

  const current =
    await env.DB.prepare(`
      SELECT *
      FROM orders
      WHERE id = ?
      LIMIT 1
    `)
      .bind(
        orderId,
      )
      .first();

  if (!current) {
    return fail(
      'Pedido não encontrado.',
      404,
    );
  }

  const body =
    await readJson(
      request,
    );

  const briefingPatch =
    body.briefing
    && typeof body.briefing
      === 'object'
      ? body.briefing
      : {};

  const oldBriefing =
    parseJson(
      current.briefing_json,
      {},
    );

  const oldPricing =
    parseJson(
      current.pricing_json,
      {},
    );

  const oldAddons =
    normalizeAddons(
      parseJson(
        current.addons_json,
        {},
      ),
    );

  /* ==================================================
     DADOS PRINCIPAIS
  ================================================== */

  const customerName =
    text(
      briefingValue(
        body,
        briefingPatch,
        'customerName',
        current.customer_name,
      ),
      160,
    );

  const whatsapp =
    normalizeWhatsapp(
      briefingValue(
        body,
        briefingPatch,
        'whatsapp',
        current.whatsapp,
      ),
    );

  const honoreeName =
    text(
      briefingValue(
        body,
        briefingPatch,
        'honoreeName',
        current.honoree_name,
      ),
      160,
    );

  const theme =
    text(
      briefingValue(
        body,
        briefingPatch,
        'theme',
        current.theme,
      ),
      240,
    );

  const missing = [];

  if (!customerName) {
    missing.push(
      'Nome da cliente',
    );
  }

  if (
    whatsapp.length < 10
    || whatsapp.length > 15
  ) {
    missing.push(
      'WhatsApp válido',
    );
  }

  if (!honoreeName) {
    missing.push(
      'Nome da criança ou homenageado(a)',
    );
  }

  if (!theme) {
    missing.push(
      'Tema',
    );
  }

  if (
    missing.length
  ) {
    return fail(
      'Confira os campos obrigatórios do pedido.',
      422,
      {
        missing,
      },
    );
  }

  /* ==================================================
     PRODUTO ATUAL
  ================================================== */

  const existingSelection = {
    experience:
      normalizeExperience(
        current.experience,
        'full',
      ),

    format:
      normalizeFormat(
        current.format,
        'video',
      ),

    addons:
      oldAddons,
  };

  const requestedAddons =
    hasOwn(
      body,
      'addons',
    )
      ? normalizeAddons({
        ...oldAddons,

        ...(body.addons || {}),
      })
      : oldAddons;

  const requestedSelection = {
    experience:
      hasOwn(
        body,
        'experience',
      )
        ? normalizeExperience(
          body.experience,
          existingSelection
            .experience,
        )
        : existingSelection
          .experience,

    format:
      hasOwn(
        body,
        'format',
      )
        ? normalizeFormat(
          body.format,
          existingSelection
            .format,
        )
        : existingSelection
          .format,

    addons:
      requestedAddons,
  };

  const selectionChanged =
    !sameSelection(
      existingSelection,
      requestedSelection,
    );

  const manualPriceTouched =
    hasOwn(
      body,
      'manualSubtotalCents',
    );

  const urgencyTouched =
    hasOwn(
      body,
      'urgencyEnabled',
    );

  const recalculatePrice =
    body.recalculatePrice
    === true;

  /*
   * Proteção:
   *
   * editar nome, endereço,
   * briefing etc. NÃO altera
   * automaticamente o valor
   * contratado.
   *
   * Se produto/adicionais forem
   * alterados, o painel deverá
   * pedir recálculo ou valor manual.
   */
  if (
    selectionChanged
    && !recalculatePrice
    && !manualPriceTouched
  ) {
    return fail(
      'Ao alterar produto ou adicionais, o painel precisa recalcular o valor ou informar um valor-base contratado.',
      422,
      {
        code:
          'price_mode_required',
      },
    );
  }

  /* ==================================================
     COTAÇÃO
  ================================================== */

  const settings =
    await loadSettings(
      env.DB,
    );

  const urgencyEnabled =
    urgencyTouched
      ? body.urgencyEnabled
        === true
      : Number(
        current.urgency_enabled
        || 0,
      ) === 1;

  const standardQuote =
    calculateQuote(
      requestedSelection,
      settings,
      {
        urgencyEnabled,
      },
    );

  const contractedManualSubtotal =
    manualPriceTouched
      ? optMoney(
        body.manualSubtotalCents,
      )
      : null;

  const commercialChanged =
    selectionChanged
    || manualPriceTouched
    || urgencyTouched
    || recalculatePrice;

  /* ==================================================
     PRESERVA VALORES EXISTENTES
  ================================================== */

  let subtotalCents =
    Number(
      current.subtotal_cents
      || 0,
    );

  let urgencyPercent =
    Number(
      current.urgency_percent
      || 0,
    );

  let urgencyAmountCents =
    Number(
      current.urgency_amount_cents
      || 0,
    );

  let totalCents =
    Number(
      current.total_cents
      || 0,
    );

  let depositPercent =
    Number(
      current.deposit_percent
      || 0,
    );

  let depositCents =
    Number(
      current.deposit_cents
      || 0,
    );

  let balanceCents =
    Number(
      current.balance_cents
      || 0,
    );

  let pricing =
    oldPricing;

  /* ==================================================
     RECÁLCULO COMERCIAL
  ================================================== */

  if (
    commercialChanged
  ) {
    if (
      manualPriceTouched
    ) {
      subtotalCents =
        contractedManualSubtotal
        ?? standardQuote
          .subtotalCents;
    } else if (
      recalculatePrice
      || selectionChanged
    ) {
      subtotalCents =
        standardQuote
          .subtotalCents;
    }

    urgencyPercent =
      urgencyEnabled
        ? standardQuote
          .urgencyPercent
        : 0;

    urgencyAmountCents =
      urgencyEnabled
        ? Math.round(
          subtotalCents
          * urgencyPercent
          / 100,
        )
        : 0;

    totalCents =
      subtotalCents
      + urgencyAmountCents;

    depositPercent =
      standardQuote
        .depositPercent;

    depositCents =
      Math.round(
        totalCents
        * depositPercent
        / 100,
      );

    balanceCents =
      totalCents
      - depositCents;

    pricing = {
      ...standardQuote,

      ...oldPricing,

      editedAt:
        nowIso(),

      standardProductCents:
        standardQuote
          .productCents,

      standardAddonsCents:
        standardQuote
          .addonsCents,

      standardSubtotalCents:
        standardQuote
          .subtotalCents,

      manualPriceOverride:
        manualPriceTouched
          ? contractedManualSubtotal
            !== null
          : (
            Boolean(
              oldPricing
                .manualPriceOverride,
            )
            && !recalculatePrice
          ),

      manualSubtotalCents:
        manualPriceTouched
          ? contractedManualSubtotal
          : (
            oldPricing
              .manualSubtotalCents
            ?? null
          ),

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

  /* ==================================================
     BRIEFING
  ================================================== */

  const selectedSpeechMode =
    speechMode(
      briefingValue(
        body,
        briefingPatch,
        'speechPreference',
        current.speech_mode
        || oldBriefing
          .speechPreference
        || 'libri',
      ),

      current.speech_mode
      || 'libri',
    );

  const ageRaw =
    briefingValue(
      body,
      briefingPatch,
      'age',
      current.age,
    );

  const age =
    optInt(
      ageRaw,
      0,
      120,
    );

  const nextBriefing = {
    ...oldBriefing,

    customerName,

    whatsapp,

    honoreeName,

    displayName:
      text(
        briefingValue(
          body,
          briefingPatch,
          'displayName',
          current.display_name,
        ),
        160,
      ),

    age,

    eventDate:
      text(
        briefingValue(
          body,
          briefingPatch,
          'eventDate',
          current.event_date,
        ),
        20,
      ),

    eventTime:
      text(
        briefingValue(
          body,
          briefingPatch,
          'eventTime',
          current.event_time,
        ),
        20,
      ),

    venueName:
      text(
        briefingValue(
          body,
          briefingPatch,
          'venueName',
          current.venue_name,
        ),
        240,
      ),

    venueAddress:
      text(
        briefingValue(
          body,
          briefingPatch,
          'venueAddress',
          current.venue_address,
        ),
        500,
      ),

    locationUrl:
      text(
        briefingValue(
          body,
          briefingPatch,
          'locationUrl',
          current.location_url,
        ),
        1000,
      ),

    theme,

    characterWanted:
      text(
        briefingValue(
          body,
          briefingPatch,
          'characterWanted',
          oldBriefing
            .characterWanted,
        ),
        300,
      ),

    mustHave:
      text(
        briefingValue(
          body,
          briefingPatch,
          'mustHave',
          oldBriefing
            .mustHave,
        ),
        1000,
      ),

    avoid:
      text(
        briefingValue(
          body,
          briefingPatch,
          'avoid',
          oldBriefing
            .avoid,
        ),
        1000,
      ),

    specialInfo:
      text(
        briefingValue(
          body,
          briefingPatch,
          'specialInfo',
          oldBriefing
            .specialInfo,
        ),
        2000,
      ),

    childStyle:
      text(
        briefingValue(
          body,
          briefingPatch,
          'childStyle',
          oldBriefing
            .childStyle,
        ),
        80,
      ),

    outfitChoice:
      text(
        briefingValue(
          body,
          briefingPatch,
          'outfitChoice',
          oldBriefing
            .outfitChoice,
        ),
        80,
      ),

    outfitDetails:
      text(
        briefingValue(
          body,
          briefingPatch,
          'outfitDetails',
          oldBriefing
            .outfitDetails,
        ),
        1000,
      ),

    appearanceDetails:
      text(
        briefingValue(
          body,
          briefingPatch,
          'appearanceDetails',
          oldBriefing
            .appearanceDetails,
        ),
        1200,
      ),

    colors:
      text(
        briefingValue(
          body,
          briefingPatch,
          'colors',
          oldBriefing
            .colors,
        ),
        500,
      ),

    colorsAvoided:
      text(
        briefingValue(
          body,
          briefingPatch,
          'colorsAvoided',
          oldBriefing
            .colorsAvoided,
        ),
        500,
      ),

    creativeIdea:
      text(
        briefingValue(
          body,
          briefingPatch,
          'creativeIdea',
          oldBriefing
            .creativeIdea,
        ),
        1500,
      ),

    speechPreference:
      selectedSpeechMode,

    ownSpeech:
      text(
        briefingValue(
          body,
          briefingPatch,
          'ownSpeech',
          oldBriefing
            .ownSpeech,
        ),
        1500,
      ),

    confirmationMode:
      text(
        briefingValue(
          body,
          briefingPatch,
          'confirmationMode',
          oldBriefing
            .confirmationMode,
        ),
        80,
      ),

    /* ==================================================
       PRESENTES
    ================================================== */

    giftPage:
      text(
        briefingValue(
          body,
          briefingPatch,
          'giftPage',
          oldBriefing
            .giftPage,
        ),
        40,
      ),

    giftDetails:
      text(
        briefingValue(
          body,
          briefingPatch,
          'giftDetails',
          oldBriefing
            .giftDetails,
        ),
        1500,
      ),

    /* ==================================================
       LIBRI MOMENTS
    ================================================== */

    photoAlbumInterest:
      standardQuote
        .addons
        .photoAlbumPlan
        ? 'yes'
        : text(
          briefingValue(
            body,
            briefingPatch,
            'photoAlbumInterest',
            oldBriefing
              .photoAlbumInterest
            || 'no',
          ),
          40,
        ),

    photoAlbumPlan:
      standardQuote
        .addons
        .photoAlbumPlan
      || '',

    photoAlbumExtra100:
      standardQuote
        .addons
        .photoAlbumExtra100
      || 0,
  };

  /* ==================================================
     HISTÓRICO DE ALTERAÇÕES
  ================================================== */

  const beforeSnapshot = {
    customerName:
      current.customer_name,

    whatsapp:
      current.whatsapp,

    honoreeName:
      current.honoree_name,

    displayName:
      current.display_name,

    age:
      current.age,

    eventDate:
      current.event_date,

    eventTime:
      current.event_time,

    venueName:
      current.venue_name,

    venueAddress:
      current.venue_address,

    locationUrl:
      current.location_url,

    theme:
      current.theme,

    experience:
      current.experience,

    format:
      current.format,

    addons:
      oldAddons,

    subtotalCents:
      Number(
        current.subtotal_cents
        || 0,
      ),

    totalCents:
      Number(
        current.total_cents
        || 0,
      ),

    briefing:
      oldBriefing,
  };

  const afterSnapshot = {
    customerName,

    whatsapp,

    honoreeName,

    displayName:
      nextBriefing
        .displayName,

    age,

    eventDate:
      nextBriefing
        .eventDate,

    eventTime:
      nextBriefing
        .eventTime,

    venueName:
      nextBriefing
        .venueName,

    venueAddress:
      nextBriefing
        .venueAddress,

    locationUrl:
      nextBriefing
        .locationUrl,

    theme,

    experience:
      standardQuote
        .experience,

    format:
      standardQuote
        .format,

    addons:
      standardQuote
        .addons,

    subtotalCents,

    totalCents,

    briefing:
      nextBriefing,
  };

  const simpleChanged =
    changedFields(
      beforeSnapshot,
      afterSnapshot,
      [
        'customerName',
        'whatsapp',
        'honoreeName',
        'displayName',
        'age',
        'eventDate',
        'eventTime',
        'venueName',
        'venueAddress',
        'locationUrl',
        'theme',
        'experience',
        'format',
        'addons',
        'subtotalCents',
        'totalCents',
        'briefing',
      ],
    );

  const speechStatus =
    selectedSpeechMode
      === 'approve'
      ? 'waiting'
      : 'not_required';

  const stamp =
    nowIso();

  /* ==================================================
     UPDATE
  ================================================== */

  await env.DB.prepare(`
    UPDATE orders
    SET
      customer_name = ?,
      whatsapp = ?,
      honoree_name = ?,
      display_name = ?,
      age = ?,
      event_date = ?,
      event_time = ?,
      venue_name = ?,
      venue_address = ?,
      location_url = ?,
      theme = ?,
      experience = ?,
      format = ?,
      addons_json = ?,
      briefing_json = ?,
      pricing_json = ?,
      subtotal_cents = ?,
      urgency_enabled = ?,
      urgency_percent = ?,
      urgency_amount_cents = ?,
      total_cents = ?,
      deposit_percent = ?,
      deposit_cents = ?,
      balance_cents = ?,
      speech_mode = ?,
      speech_status = ?,
      updated_at = ?
    WHERE id = ?
  `)
    .bind(
      customerName,

      whatsapp,

      honoreeName,

      nullable(
        nextBriefing
          .displayName,
        160,
      ),

      age,

      nullable(
        nextBriefing
          .eventDate,
        20,
      ),

      nullable(
        nextBriefing
          .eventTime,
        20,
      ),

      nullable(
        nextBriefing
          .venueName,
        240,
      ),

      nullable(
        nextBriefing
          .venueAddress,
        500,
      ),

      nullable(
        nextBriefing
          .locationUrl,
        1000,
      ),

      theme,

      standardQuote
        .experience,

      standardQuote
        .format,

      JSON.stringify(
        standardQuote
          .addons,
      ),

      JSON.stringify(
        nextBriefing,
      ),

      JSON.stringify(
        pricing,
      ),

      subtotalCents,

      urgencyEnabled
        ? 1
        : 0,

      urgencyPercent,

      urgencyAmountCents,

      totalCents,

      depositPercent,

      depositCents,

      balanceCents,

      selectedSpeechMode,

      speechStatus,

      stamp,

      orderId,
    )
    .run();

  /* ==================================================
     HISTÓRICO
  ================================================== */

  await addHistory(
    env.DB,

    orderId,

    'order_edited',

    'Pedido editado no painel administrativo.',

    {
      changedFields:
        simpleChanged,

      selectionChanged,

      commercialChanged,

      recalculatedPrice:
        recalculatePrice,

      manualPriceOverride:
        Boolean(
          pricing
            ?.manualPriceOverride,
        ),
    },
  );

  /* ==================================================
     RESPOSTA
  ================================================== */

  return json({
    ok: true,

    order: {
      id:
        orderId,

      orderCode:
        current.order_code,

      customerName,

      whatsapp,

      honoreeName,

      displayName:
        nextBriefing
          .displayName,

      age,

      eventDate:
        nextBriefing
          .eventDate,

      eventTime:
        nextBriefing
          .eventTime,

      venueName:
        nextBriefing
          .venueName,

      venueAddress:
        nextBriefing
          .venueAddress,

      locationUrl:
        nextBriefing
          .locationUrl,

      theme,

      experience:
        standardQuote
          .experience,

      requestedFormat:
        standardQuote
          .requestedFormat,

      format:
        standardQuote
          .format,

      formatAdjusted:
        standardQuote
          .formatAdjusted,

      addons:
        standardQuote
          .addons,

      subtotalCents,

      urgencyEnabled,

      urgencyPercent,

      urgencyAmountCents,

      totalCents,

      depositPercent,

      depositCents,

      balanceCents,

      briefing:
        nextBriefing,

      pricing,
    },
  });
}
