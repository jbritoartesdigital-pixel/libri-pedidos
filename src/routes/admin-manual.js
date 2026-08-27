import {
  fail,
  json,
  normalizeWhatsapp,
  nowIso,
  randomToken,
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

/* ==================================================
   HELPERS
================================================== */

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

function photosStatus(
  value,
) {
  return [
    'waiting',
    'received',
    'approved',
    'needs_new',
  ].includes(
    value,
  )
    ? value
    : 'waiting';
}

function entryStatus(
  value,
) {
  return value === 'confirmed'
    ? 'confirmed'
    : 'waiting';
}

function speechMode(
  value,
) {
  return [
    'libri',
    'approve',
    'own',
  ].includes(
    value,
  )
    ? value
    : 'libri';
}

function albumPlan(
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

function giftPageMode(
  value,
) {
  return [
    'yes',
    'no',
    'unsure',
  ].includes(
    value,
  )
    ? value
    : 'unsure';
}

/* ==================================================
   TERMOS
================================================== */

async function activeTerms(
  db,
) {
  return db.prepare(`
    SELECT
      version,
      body,
      created_at
    FROM terms_versions
    WHERE active = 1
    ORDER BY created_at DESC
    LIMIT 1
  `)
    .first();
}

/* ==================================================
   ID DO PEDIDO
================================================== */

async function resolveInsertedId(
  db,
  result,
  publicToken,
) {
  const metaId =
    Number(
      result
        ?.meta
        ?.last_row_id
      || 0,
    );

  if (
    Number.isInteger(
      metaId,
    )
    && metaId > 0
  ) {
    return metaId;
  }

  const row =
    await db.prepare(`
      SELECT id
      FROM orders
      WHERE public_token = ?
      LIMIT 1
    `)
      .bind(
        publicToken,
      )
      .first();

  return Number(
    row?.id
    || 0,
  );
}

const orderCode = (
  id,
) =>
  `LIBRI-${String(id).padStart(4, '0')}`;

/* ==================================================
   ROTA
================================================== */

export async function handleAdminManualApi(
  request,
  env,
  url,
) {
  if (
    url.pathname
    !== '/api/admin/orders/manual'
  ) {
    return null;
  }

  if (
    request.method
      .toUpperCase()
    !== 'POST'
  ) {
    return fail(
      'Método não permitido.',
      405,
    );
  }

  const body =
    await readJson(
      request,
    );

  /* ==================================================
     DADOS PRINCIPAIS
  ================================================== */

  const customerName =
    text(
      body.customerName,
      160,
    );

  const whatsapp =
    normalizeWhatsapp(
      body.whatsapp,
    );

  const honoreeName =
    text(
      body.honoreeName,
      160,
    );

  const theme =
    text(
      body.theme,
      240,
    );

  const missing = [];

  if (
    !customerName
  ) {
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

  if (
    !honoreeName
  ) {
    missing.push(
      'Nome da criança ou homenageado(a)',
    );
  }

  if (
    !theme
  ) {
    missing.push(
      'Tema',
    );
  }

  if (
    ![
      'full',
      'reduced',
    ].includes(
      body.experience,
    )
  ) {
    missing.push(
      'Experiência',
    );
  }

  if (
    ![
      'video',
      'interactive',
    ].includes(
      body.format,
    )
  ) {
    missing.push(
      'Formato',
    );
  }

  /*
   * Pedido manual oficial só registra
   * aceite que realmente ocorreu
   * no WhatsApp.
   */
  if (
    body.termsAcceptedOnWhatsapp
    !== true
  ) {
    missing.push(
      'Confirmação de aceite dos termos no WhatsApp',
    );
  }

  if (
    missing.length
  ) {
    return fail(
      'Confira os campos obrigatórios do pedido manual.',
      422,
      {
        missing,
      },
    );
  }

  /* ==================================================
     CONFIGURAÇÕES
  ================================================== */

  const settings =
    await loadSettings(
      env.DB,
    );

  /* ==================================================
     LIBRI MOMENTS
  ================================================== */

  const selectedAlbumPlan =
    albumPlan(
      body
        .addons
        ?.photoAlbumPlan,
    );

  const selectedAlbumExtra100 =
    selectedAlbumPlan
      ? (
        optInt(
          body
            .addons
            ?.photoAlbumExtra100,
          0,
          20,
        )
        || 0
      )
      : 0;

  /* ==================================================
     SELEÇÃO
  ================================================== */

  const selection = {
    experience:
      body.experience,

    format:
      body.format,

    addons: {
      confirmation:
        body
          .addons
          ?.confirmation
        === true,

      /*
       * O quote.js desliga automaticamente
       * o filtro avulso quando Moments
       * estiver selecionado.
       */
      filter:
        body
          .addons
          ?.filter
        === true,

      extraScene:
        optInt(
          body
            .addons
            ?.extraScene,
          0,
          10,
        )
        || 0,

      extraPerson:
        optInt(
          body
            .addons
            ?.extraPerson,
          0,
          10,
        )
        || 0,

      photoAlbumPlan:
        selectedAlbumPlan,

      photoAlbumExtra100:
        selectedAlbumExtra100,
    },
  };

  /* ==================================================
     COTAÇÃO PADRÃO
  ================================================== */

  const urgencyEnabled =
    body.urgencyEnabled
    === true;

  /*
   * Mantém a regra oficial:
   * Confirmação Libri força Interativo.
   */
  const standardQuote =
    calculateQuote(
      selection,
      settings,
      {
        urgencyEnabled,
      },
    );

  /* ==================================================
     VALOR MANUAL
  ================================================== */

  /*
   * Valor manual, quando usado,
   * é o valor-base contratado
   * antes da urgência.
   */
  const manualSubtotalCents =
    optMoney(
      body.manualSubtotalCents,
    );

  const subtotalCents =
    manualSubtotalCents
    ?? standardQuote
      .subtotalCents;

  const urgencyPercent =
    urgencyEnabled
      ? standardQuote
        .urgencyPercent
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

  const depositPercent =
    standardQuote
      .depositPercent;

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
     TERMOS
  ================================================== */

  const terms =
    await activeTerms(
      env.DB,
    );

  if (
    !terms
  ) {
    return fail(
      'Termos ainda não configurados.',
      503,
    );
  }

  /* ==================================================
     BRIEFING
  ================================================== */

  const selectedSpeechMode =
    speechMode(
      body.speechPreference,
    );

  const age =
    optInt(
      body.age,
      0,
      120,
    );

  const portfolioConsent =
    body.portfolioConsent
    === true;

  const selectedGiftPage =
    giftPageMode(
      body.giftPage,
    );

  const giftDetails =
    selectedGiftPage
    === 'yes'
      ? text(
        body.giftDetails,
        1500,
      )
      : '';

  const briefing = {
    source:
      'whatsapp_manual',

    manualOrder:
      true,

    customerName,

    whatsapp,

    honoreeName,

    displayName:
      text(
        body.displayName,
        160,
      ),

    age,

    eventDate:
      text(
        body.eventDate,
        20,
      ),

    eventTime:
      text(
        body.eventTime,
        20,
      ),

    venueName:
      text(
        body.venueName,
        240,
      ),

    venueAddress:
      text(
        body.venueAddress,
        500,
      ),

    locationUrl:
      text(
        body.locationUrl,
        1000,
      ),

    theme,

    characterWanted:
      text(
        body.characterWanted,
        300,
      ),

    mustHave:
      text(
        body.mustHave,
        1000,
      ),

    avoid:
      text(
        body.avoid,
        1000,
      ),

    specialInfo:
      text(
        body.specialInfo,
        2000,
      ),

    childStyle:
      text(
        body.childStyle,
        80,
      ),

    outfitChoice:
      text(
        body.outfitChoice,
        80,
      ),

    outfitDetails:
      text(
        body.outfitDetails,
        1000,
      ),

    appearanceDetails:
      text(
        body.appearanceDetails,
        1200,
      ),

    colors:
      text(
        body.colors,
        500,
      ),

    colorsAvoided:
      text(
        body.colorsAvoided,
        500,
      ),

    creativeIdea:
      text(
        body.creativeIdea,
        1500,
      ),

    speechPreference:
      selectedSpeechMode,

    ownSpeech:
      text(
        body.ownSpeech,
        1500,
      ),

    confirmationMode:
      text(
        body.confirmationMode,
        80,
      )
      || (
        standardQuote
          .addons
          .confirmation
          ? 'unsure'
          : ''
      ),

    /* ==================================================
       PÁGINA DE PRESENTES
    ================================================== */

    giftPage:
      selectedGiftPage,

    giftDetails,

    /* ==================================================
       LIBRI MOMENTS
    ================================================== */

    photoAlbumInterest:
      standardQuote
        .addons
        .photoAlbumPlan
        ? 'yes'
        : 'no',

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

    /* ==================================================
       PEDIDO MANUAL
    ================================================== */

    manualNotes:
      text(
        body.manualNotes,
        3000,
      ),

    termsAcceptedOnWhatsapp:
      true,

    portfolioConsent,
  };

  /* ==================================================
     PRICING JSON
  ================================================== */

  const pricing = {
    ...standardQuote,

    source:
      'whatsapp_manual',

    manualOrder:
      true,

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
      manualSubtotalCents
      !== null,

    manualSubtotalCents,

    subtotalCents,

    urgencyEnabled,

    urgencyPercent,

    urgencyAmountCents,

    totalCents,

    depositPercent,

    depositCents,

    balanceCents,
  };

  /* ==================================================
     STATUS INICIAL
  ================================================== */

  const stamp =
    nowIso();

  const publicToken =
    randomToken(
      'ord_',
    );

  const initialPhotosStatus =
    photosStatus(
      body.photosStatus,
    );

  const initialEntryStatus =
    entryStatus(
      body.entryStatus,
    );

  /* ==================================================
     COLUNAS
  ================================================== */

  const valuesByColumn = {
    public_token:
      publicToken,

    draft_token:
      null,

    customer_name:
      customerName,

    whatsapp,

    honoree_name:
      honoreeName,

    display_name:
      nullable(
        body.displayName,
        160,
      ),

    age,

    event_date:
      nullable(
        body.eventDate,
        20,
      ),

    event_time:
      nullable(
        body.eventTime,
        20,
      ),

    venue_name:
      nullable(
        body.venueName,
        240,
      ),

    venue_address:
      nullable(
        body.venueAddress,
        500,
      ),

    location_url:
      nullable(
        body.locationUrl,
        1000,
      ),

    theme,

    experience:
      standardQuote
        .experience,

    format:
      standardQuote
        .format,

    addons_json:
      JSON.stringify(
        standardQuote
          .addons,
      ),

    briefing_json:
      JSON.stringify(
        briefing,
      ),

    pricing_json:
      JSON.stringify(
        pricing,
      ),

    subtotal_cents:
      subtotalCents,

    urgency_enabled:
      urgencyEnabled
        ? 1
        : 0,

    urgency_percent:
      urgencyPercent,

    urgency_amount_cents:
      urgencyAmountCents,

    total_cents:
      totalCents,

    deposit_percent:
      depositPercent,

    deposit_cents:
      depositCents,

    balance_cents:
      balanceCents,

    terms_version:
      String(
        terms.version,
      ),

    terms_accepted_at:
      stamp,

    portfolio_consent:
      portfolioConsent
        ? 1
        : 0,

    status:
      'new',

    photos_status:
      initialPhotosStatus,

    photos_note:
      nullable(
        body.photosNote,
        1200,
      ),

    entry_status:
      initialEntryStatus,

    speech_mode:
      selectedSpeechMode,

    speech_status:
      selectedSpeechMode
      === 'approve'
        ? 'waiting'
        : 'not_required',

    created_at:
      stamp,

    updated_at:
      stamp,

    finalized_at:
      stamp,
  };

  /* ==================================================
     INSERT
  ================================================== */

  const columns =
    Object.keys(
      valuesByColumn,
    );

  const placeholders =
    columns.map(
      () => '?',
    );

  const insertResult =
    await env.DB.prepare(`
      INSERT INTO orders (
        ${columns.join(', ')}
      )
      VALUES (
        ${placeholders.join(', ')}
      )
    `)
      .bind(
        ...Object.values(
          valuesByColumn,
        ),
      )
      .run();

  const id =
    await resolveInsertedId(
      env.DB,
      insertResult,
      publicToken,
    );

  if (
    !id
  ) {
    return fail(
      'O pedido foi salvo, mas não foi possível identificar o número gerado.',
      500,
    );
  }

  /* ==================================================
     CÓDIGO LIBRI
  ================================================== */

  const code =
    orderCode(
      id,
    );

  await env.DB.prepare(`
    UPDATE orders
    SET
      order_code = ?,
      updated_at = ?
    WHERE id = ?
  `)
    .bind(
      code,
      nowIso(),
      id,
    )
    .run();

  /* ==================================================
     HISTÓRICO
  ================================================== */

  await addHistory(
    env.DB,
    id,
    'manual_order_created',
    'Pedido cadastrado manualmente a partir do WhatsApp.',
    {
      source:
        'whatsapp_manual',

      standardSubtotalCents:
        standardQuote
          .subtotalCents,

      contractedSubtotalCents:
        subtotalCents,

      manualPriceOverride:
        manualSubtotalCents
        !== null,

      giftPage:
        selectedGiftPage,

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
    },
  );

  /* ==================================================
     OBSERVAÇÃO INTERNA
  ================================================== */

  const manualNotes =
    text(
      body.manualNotes,
      3000,
    );

  if (
    manualNotes
  ) {
    await env.DB.prepare(`
      INSERT INTO internal_notes (
        order_id,
        note,
        created_at
      )
      VALUES (?, ?, ?)
    `)
      .bind(
        id,
        `Pedido manual via WhatsApp:\n${manualNotes}`,
        nowIso(),
      )
      .run();
  }

  /* ==================================================
     RESPOSTA
  ================================================== */

  return json(
    {
      ok:
        true,

      order: {
        id,

        orderCode:
          code,

        source:
          'whatsapp_manual',

        customerName,

        whatsapp,

        honoreeName,

        displayName:
          briefing
            .displayName,

        age,

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

        photoAlbum:
          standardQuote
            .photoAlbum
          || null,

        giftPage:
          selectedGiftPage,

        giftDetails,

        standardSubtotalCents:
          standardQuote
            .subtotalCents,

        subtotalCents,

        urgencyEnabled,

        urgencyPercent,

        urgencyAmountCents,

        totalCents,

        depositPercent,

        depositCents,

        balanceCents,

        manualPriceOverride:
          manualSubtotalCents
          !== null,

        photosStatus:
          initialPhotosStatus,

        entryStatus:
          initialEntryStatus,
      },
    },
    201,
  );
}
