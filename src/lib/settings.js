import { nowIso } from './http.js';

export async function loadSettings(db) {
  const result = await db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries((result.results || []).map((row) => [row.key, row.value]));
}

export function intSetting(settings, key, fallback = 0) {
  const value = Number.parseInt(settings[key], 10);
  return Number.isFinite(value) ? value : fallback;
}

export function catalogFromSettings(settings) {
  return {
    products: {
      video: {
        full: intSetting(settings, 'price_video_full_cents', 15000),
        reduced: intSetting(settings, 'price_video_reduced_cents', 7500),
      },
      interactive: {
        full: intSetting(settings, 'price_interactive_full_cents', 18000),
        reduced: intSetting(settings, 'price_interactive_reduced_cents', 10500),
      },
    },
    addons: {
      confirmation: intSetting(settings, 'addon_confirmation_cents', 2500),
      filter: intSetting(settings, 'addon_filter_cents', 3000),
      extraScene: intSetting(settings, 'addon_extra_scene_cents', 3000),
      extraPerson: intSetting(settings, 'addon_extra_person_cents', 3000),
    },
    rules: {
      depositPercent: intSetting(settings, 'deposit_percent', 50),
      urgencyPercent: intSetting(settings, 'urgency_percent', 30),
      deadlineBusinessDays: intSetting(settings, 'deadline_business_days', 5),
    },
    contact: {
      pixKey: settings.pix_key || '',
      pixRecipientName: settings.pix_recipient_name || '',
      libriWhatsapp: settings.libri_whatsapp || '',
    },
    examples: {
      interactiveFull: settings.example_interactive_full_url || '',
      interactiveReduced: settings.example_interactive_reduced_url || '',
      videoFull: settings.example_video_full_url || '',
      videoReduced: settings.example_video_reduced_url || '',
      confirmation: settings.example_confirmation_url || '',
      filter: settings.example_filter_url || '',
    },
  };
}

export async function saveSettings(db, values) {
  const allowed = new Set([
    'price_video_full_cents',
    'price_video_reduced_cents',
    'price_interactive_full_cents',
    'price_interactive_reduced_cents',
    'addon_confirmation_cents',
    'addon_filter_cents',
    'addon_extra_scene_cents',
    'addon_extra_person_cents',
    'deposit_percent',
    'urgency_percent',
    'deadline_business_days',
    'pix_key',
    'pix_recipient_name',
    'libri_whatsapp',
    'example_interactive_full_url',
    'example_interactive_reduced_url',
    'example_video_full_url',
    'example_video_reduced_url',
    'example_confirmation_url',
    'example_filter_url',
  ]);

  const entries = Object.entries(values || {}).filter(([key]) => allowed.has(key));
  if (!entries.length) return;

  const stamp = nowIso();
  await db.batch(
    entries.map(([key, value]) =>
      db
        .prepare(
          `INSERT INTO settings(key, value, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        )
        .bind(key, String(value ?? ''), stamp)
    )
  );
}
