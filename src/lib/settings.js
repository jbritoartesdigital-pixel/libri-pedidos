import {
  nowIso,
  normalizeDigits,
} from './http.js';

/* ==================================================
   CHAVES
================================================== */

const COMMERCIAL_PRICE_KEYS =
  new Set([
    'price_video_full_cents',
    'price_video_reduced_cents',
    'price_interactive_full_cents',
    'price_interactive_reduced_cents',

    'addon_confirmation_cents',
    'addon_filter_cents',
    'addon_extra_scene_cents',
    'addon_extra_person_cents',
  ]);

const EXAMPLE_URL_KEYS =
  new Set([
    'example_interactive_full_url',
    'example_interactive_reduced_url',
    'example_video_full_url',
    'example_video_reduced_url',
    'example_confirmation_url',
    'example_filter_url',
  ]);

const ALLOWED_KEYS =
  new Set([
    ...COMMERCIAL_PRICE_KEYS,

    'deposit_percent',
    'urgency_percent',
    'deadline_business_days',

    'pix_key',
    'pix_recipient_name',
    'libri_whatsapp',

    ...EXAMPLE_URL_KEYS,
  ]);

/* ==================================================
   LEITURA
================================================== */

export async function loadSettings(
  db,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            key,
            value
          FROM settings
        `,
      )
      .all();

  return Object.fromEntries(
    (
      result.results
      || []
    ).map(
      (row) => [
        row.key,
        row.value,
      ],
    ),
  );
}

export function intSetting(
  settings,
  key,
  fallback = 0,
) {
  const value =
    Number.parseInt(
      settings?.[key],
      10,
    );

  return Number.isFinite(
    value,
  )
    ? value
    : fallback;
}

function safePositiveInt(
  settings,
  key,
  fallback,
) {
  const value =
    intSetting(
      settings,
      key,
      fallback,
    );

  if (
    !Number.isInteger(value)
    || value <= 0
  ) {
    return fallback;
  }

  return value;
}

function safeBoundedInt(
  settings,
  key,
  fallback,
  min,
  max,
) {
  const value =
    intSetting(
      settings,
      key,
      fallback,
    );

  if (
    !Number.isInteger(value)
    || value < min
    || value > max
  ) {
    return fallback;
  }

  return value;
}

/* ==================================================
   CATÁLOGO SEGURO
================================================== */

export function catalogFromSettings(
  settings,
) {
  return {
    products: {
      video: {
        full:
          safePositiveInt(
            settings,
            'price_video_full_cents',
            15000,
          ),

        reduced:
          safePositiveInt(
            settings,
            'price_video_reduced_cents',
            7500,
          ),
      },

      interactive: {
        full:
          safePositiveInt(
            settings,
            'price_interactive_full_cents',
            18000,
          ),

        reduced:
          safePositiveInt(
            settings,
            'price_interactive_reduced_cents',
            10500,
          ),
      },
    },

    addons: {
      confirmation:
        safePositiveInt(
          settings,
          'addon_confirmation_cents',
          2500,
        ),

      filter:
        safePositiveInt(
          settings,
          'addon_filter_cents',
          3000,
        ),

      extraScene:
        safePositiveInt(
          settings,
          'addon_extra_scene_cents',
          3000,
        ),

      extraPerson:
        safePositiveInt(
          settings,
          'addon_extra_person_cents',
          3000,
        ),
    },

    rules: {
      depositPercent:
        safeBoundedInt(
          settings,
          'deposit_percent',
          50,
          1,
          100,
        ),

      urgencyPercent:
        safeBoundedInt(
          settings,
          'urgency_percent',
          30,
          1,
          100,
        ),

      deadlineBusinessDays:
        safeBoundedInt(
          settings,
          'deadline_business_days',
          5,
          1,
          365,
        ),
    },

    contact: {
      pixKey:
        settings?.pix_key
        || '',

      pixRecipientName:
        settings
          ?.pix_recipient_name
        || '',

      libriWhatsapp:
        settings
          ?.libri_whatsapp
        || '',
    },

    examples: {
      interactiveFull:
        settings
          ?.example_interactive_full_url
        || '',

      interactiveReduced:
        settings
          ?.example_interactive_reduced_url
        || '',

      videoFull:
        settings
          ?.example_video_full_url
        || '',

      videoReduced:
        settings
          ?.example_video_reduced_url
        || '',

      confirmation:
        settings
          ?.example_confirmation_url
        || '',

      filter:
        settings
          ?.example_filter_url
        || '',
    },
  };
}

/* ==================================================
   VALIDAÇÃO
================================================== */

function integerValue(
  value,
  label,
  {
    min,
    max,
  },
) {
  const raw =
    String(
      value ?? '',
    ).trim();

  if (!raw) {
    throw new Error(
      `${label} não pode ficar vazio.`,
    );
  }

  if (
    !/^-?\d+$/.test(raw)
  ) {
    throw new Error(
      `${label} precisa ser um número inteiro válido.`,
    );
  }

  const number =
    Number.parseInt(
      raw,
      10,
    );

  if (
    !Number.isSafeInteger(
      number,
    )
  ) {
    throw new Error(
      `${label} possui um valor inválido.`,
    );
  }

  if (
    number < min
    || number > max
  ) {
    throw new Error(
      `${label} deve ficar entre ${min} e ${max}.`,
    );
  }

  return String(number);
}

function validateExampleUrl(
  value,
  label,
) {
  const text =
    String(
      value ?? '',
    ).trim();

  if (!text) {
    return '';
  }

  let parsed;

  try {
    parsed =
      new URL(text);
  } catch {
    throw new Error(
      `${label} não é um link válido.`,
    );
  }

  if (
    parsed.protocol
      !== 'https:'
    && parsed.protocol
      !== 'http:'
  ) {
    throw new Error(
      `${label} precisa começar com http:// ou https://.`,
    );
  }

  return text;
}

function validateWhatsapp(
  value,
) {
  const text =
    String(
      value ?? '',
    ).trim();

  if (!text) {
    return '';
  }

  const digits =
    normalizeDigits(
      text,
    );

  if (
    digits.length < 10
    || digits.length > 15
  ) {
    throw new Error(
      'Confira o WhatsApp da Libri.',
    );
  }

  return text;
}

function normalizeSettingEntry(
  key,
  value,
) {
  if (
    COMMERCIAL_PRICE_KEYS
      .has(key)
  ) {
    return integerValue(
      value,
      'Preço',
      {
        min: 1,
        max: 100000000,
      },
    );
  }

  if (
    key
    === 'deposit_percent'
  ) {
    return integerValue(
      value,
      'Percentual da entrada',
      {
        min: 1,
        max: 100,
      },
    );
  }

  if (
    key
    === 'urgency_percent'
  ) {
    return integerValue(
      value,
      'Percentual de urgência',
      {
        min: 1,
        max: 100,
      },
    );
  }

  if (
    key
    === 'deadline_business_days'
  ) {
    return integerValue(
      value,
      'Prazo padrão',
      {
        min: 1,
        max: 365,
      },
    );
  }

  if (
    key
    === 'libri_whatsapp'
  ) {
    return validateWhatsapp(
      value,
    );
  }

  if (
    EXAMPLE_URL_KEYS
      .has(key)
  ) {
    return validateExampleUrl(
      value,
      'Link de exemplo',
    );
  }

  return String(
    value ?? '',
  ).trim();
}

/* ==================================================
   SALVAR
================================================== */

export async function saveSettings(
  db,
  values,
) {
  const entries =
    Object.entries(
      values
      || {},
    )
      .filter(
        ([key]) =>
          ALLOWED_KEYS
            .has(key),
      )
      .map(
        ([key, value]) => [
          key,
          normalizeSettingEntry(
            key,
            value,
          ),
        ],
      );

  if (
    !entries.length
  ) {
    return {
      savedKeys: [],
    };
  }

  const stamp =
    nowIso();

  await db.batch(
    entries.map(
      ([key, value]) =>
        db
          .prepare(
            `
              INSERT INTO settings(
                key,
                value,
                updated_at
              )
              VALUES (?, ?, ?)

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
            stamp,
          ),
    ),
  );

  return {
    savedKeys:
      entries.map(
        ([key]) => key,
      ),
  };
}