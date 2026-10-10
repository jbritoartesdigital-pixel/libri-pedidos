import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { captureFieldViewport, restoreFieldViewport } from '../public/js/client-v2-viewport.js';
import { database, day, providerMock } from './helpers.mjs';
import { requestV2UrgencyReview, resumeV2Payment, startV2Checkout } from '../src/lib/v2-checkout.js';
import { decideV2Urgency, validateUrgencyWindow } from '../src/lib/v2-urgency-admin.js';
import { syncMercadoPagoOrder, validateMercadoPagoWebhook } from '../src/lib/v2-mercadopago.js';
import { getV2CustomerArea, saveV2Briefing, submitV2Briefing, buildV2BriefingSimulationSchema } from '../src/lib/v2-customer-area.js';
import { downloadV2OrderFolder } from '../src/lib/v2-order-zip.js';
import { calculateCommercialV2Quote } from '../src/lib/v2-commercial-pricing.js';
import { loadV2Catalog } from '../src/lib/v2-catalog.js';
import { runV2Scheduler } from '../src/lib/v2-scheduler.js';
import { applyV2AdminAction, cancelV2Order, deleteUnpaidV2Order, getV2AdminOrderDetail, getV2Central, listV2ArchivedOrders, listV2Production } from '../src/lib/v2-admin-core.js';
import { getV2AgendaRange, setV2AgendaDay, setV2AgendaPeriod, getV2CascadeSuggestions, anticipateV2Production, releaseV2CascadeSurplus } from '../src/lib/v2-agenda-admin.js';
import { findV2DeliveryOptions, planV2AllocationForWindow, validateV2DeliveryWindow } from '../src/lib/v2-agenda.js';
import worker from '../src/index.js';
import { createMercadoPagoCheckout } from '../src/lib/v2-mercadopago.js';
import { createV2Preview, revokeV2Preview } from '../src/lib/v2-preview.js';
import { createV2FinancePayment, getV2FinanceDashboard, updateV2FinancePayment, voidV2FinancePayment } from '../src/lib/v2-finance.js';
import { getV2StoreConfig, updateV2GalleryItem, updateV2Settings } from '../src/lib/v2-store-config.js';
import { planCustomerPhotoBatch } from '../public/js/client-v2-upload.js';

const request = new Request('https://pedidos.libriconvites.com.br/api/v2/checkout/start');
function env(DB) { return { DB, MERCADO_PAGO_ACCESS_TOKEN: 'TEST-token' }; }
function input(overrides = {}) { return { clientRequestId: crypto.randomUUID(),
  customer: { name: 'Cliente Teste', whatsapp: '5511999999999', email: 'test@example.com' },
  event: { honoreeName: 'Teste', type: 'birthday', date: day(2) },
  selection: { productCode: 'interactive_essential', paymentMethod: 'pix' }, ...overrides }; }
async function terms(DB, method = 'pix') {
  const row = await DB.prepare('SELECT version FROM v2_terms_versions WHERE active = 1').first();
  return { clientRequestId: crypto.randomUUID(), termsAccepted: true, termsVersion: row.version, paymentMethod: method };
}
async function urgency(DB) {
  return requestV2UrgencyReview(request, env(DB), input());
}

test('simulation briefing uses real schema without creating orders, payments or uploads', async () => {
  const DB = database();
  const e = env(DB);
  const count = () => DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n;
  const before = count();
  const requestSchema = async (productCode, eventType, data, addonCodes = []) => {
    const response = await worker.fetch(new Request(
      'https://pedidos.libriconvites.com.br/api/v2/briefing-simulation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productCode, eventType, addonCodes, data }),
      }), e, { waitUntil() {} });
    return { status: response.status, body: await response.json() };
  };
  let result = await requestSchema('cinematic_video', 'birthday', {});
  assert.equal(result.status, 200);
  assert.equal(result.body.simulation, true);
  const fields = () => result.body.schema.sections.flatMap(s => s.fields);
  assert.ok(fields().some(f => f.key === 'gift_page_video'));
  assert.ok(!fields().some(f => f.key === 'gift_mode'));
  assert.ok(result.body.schema.uploadRules);
  result = await requestSchema('cinematic_video', 'birthday', {
    gift_page_video: 'yes', gift_mode: 'both',
    gift_categories: ['clothes', 'shoes'], gift_clothing_size: '3', gift_shoe_size: '25',
  });
  assert.ok(fields().some(f => f.key === 'gift_mode'));
  assert.ok(fields().some(f => f.key === 'gift_clothing_size'));
  assert.ok(fields().some(f => f.key === 'pix_key'));
  result = await requestSchema('interactive_essential', 'birthday', {
    interactive_resources: ['gifts'], gift_mode: 'pix',
    pix_key_type: 'email', pix_key: 'presentes@example.com', pix_holder: 'Responsável',
  });
  assert.ok(fields().some(f => f.key === 'pix_confirmed'));
  assert.ok(!fields().some(f => f.key === 'gift_page_video'));
  const invalid = await requestSchema('__invalid__', 'birthday', {});
  assert.equal(invalid.status, 404);
  assert.equal(count(), before, 'stateless simulation never changes real orders');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments').get().n, 0);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_briefing_uploads').get().n, 0);
});

test('Libri RSVP closed list asks only strict or flexible, not guest names', () => {
  const product = { code: 'interactive_essential', name: 'Convite interativo' };
  const addons = [{ code: 'confirmation_libri', name: 'Confirmação de Presença Libri' }];
  const schemaFor = data => buildV2BriefingSimulationSchema({
    product, eventType: 'birthday', addons, data,
  });
  const fields = data => schemaFor(data).sections.flatMap(section => section.fields);
  const initial = fields({});
  const mode = initial.find(item => item.key === 'rsvp_mode');
  assert.equal(mode?.required, true);
  assert.deepEqual(mode.options.map(option => option.value), ['free', 'guest_list', 'unknown']);
  assert.ok(!initial.some(item => item.key === 'rsvp_list_behavior'));
  assert.ok(!initial.some(item => item.key === 'guest_list'));

  const closed = fields({ rsvp_mode: 'guest_list' });
  const behavior = closed.find(item => item.key === 'rsvp_list_behavior');
  assert.ok(behavior, 'closed lists must explicitly choose a behavior');
  assert.equal(behavior.type, 'choice');
  assert.equal(behavior.required, true);
  assert.deepEqual(behavior.options.map(option => option.value), ['strict', 'flexible']);
  assert.match(behavior.options[0].label, /somente as pessoas cadastradas/);
  assert.match(behavior.options[1].label, /adicionar acompanhantes até o limite/);
  assert.match(behavior.help, /diretamente no aplicativo Libri RSVP/);
  assert.ok(!closed.some(item => item.key === 'guest_list'), 'never ask for guest names');
  for (const behaviorChoice of ['strict', 'flexible']) {
    const resolved = fields({ rsvp_mode: 'guest_list', rsvp_list_behavior: behaviorChoice });
    assert.equal(resolved.find(item => item.key === 'rsvp_list_behavior').required, true);
    assert.ok(!resolved.some(item => item.key === 'guest_list'));
  }
  for (const rsvp_mode of ['free', 'unknown']) {
    const other = fields({ rsvp_mode });
    assert.ok(!other.some(item => item.key === 'rsvp_list_behavior'));
    assert.ok(!other.some(item => item.key === 'guest_list'));
  }
  const withoutAddon = buildV2BriefingSimulationSchema({
    product, eventType: 'birthday', addons: [], data: { rsvp_mode: 'guest_list' },
  }).sections.flatMap(section => section.fields);
  assert.ok(!withoutAddon.some(item => item.key === 'rsvp_list_behavior' || item.key === 'rsvp_mode'));
});

test('paid Libri RSVP order persists the closed-list behavior and clears it when switching to free', async t => {
  const DB = database();
  const mp = providerMock(t);
  const e = env(DB);
  const order = await startV2Checkout(request, e, input({
    event: { honoreeName: 'RSVP modo lista', type: 'birthday', date: day(65) },
    deliveryWindow: { start: day(10), end: day(12) },
    selection: { productCode: 'interactive_essential', paymentMethod: 'pix', addonCodes: ['confirmation_libri'] },
    ...await terms(DB),
  }));
  mp.approve(order.payment.providerOrderId);
  await syncMercadoPagoOrder(e, order.payment.providerOrderId);
  const token = order.order.publicToken;
  const save = async patch => saveV2Briefing(e, token, { currentSection: 'addons', data: patch });

  let result = await save({ rsvp_mode: 'guest_list' });
  assert.ok(result.schema.sections.flatMap(x => x.fields).some(x => x.key === 'rsvp_list_behavior'));
  assert.ok(!result.schema.sections.flatMap(x => x.fields).some(x => x.key === 'guest_list'));
  const strict = await save({ rsvp_list_behavior: 'strict' });
  assert.equal(strict.data.rsvp_list_behavior, 'strict');
  const flexible = await save({ rsvp_list_behavior: 'flexible' });
  assert.equal(flexible.data.rsvp_list_behavior, 'flexible');
  assert.equal((await getV2CustomerArea(e, token)).briefing.data.rsvp_list_behavior, 'flexible');
  result = await save({ rsvp_mode: 'free' });
  assert.equal(result.data.rsvp_mode, 'free');
  assert.equal(result.data.rsvp_list_behavior, undefined);
  assert.ok(!result.schema.sections.flatMap(x => x.fields).some(x => x.key === 'rsvp_list_behavior'));
  const invalid = await save({ rsvp_list_behavior: 'strict' });
  assert.equal(invalid.data.rsvp_list_behavior, undefined, 'hidden choice cannot be injected');
});

test('customer simulation continues to briefing with direct interactive upgrade explanation', () => {
  const storefront = readFileSync('public/js/client-v2-store.js', 'utf8');
  const area = readFileSync('public/js/client-v2-area.js', 'utf8');
  const appShell = readFileSync('public/client-v2.html', 'utf8');
  const entry = readFileSync('public/js/client-v2.js', 'utf8');
  assert.match(storefront, /'Testar o briefing da cliente'/);
  assert.match(storefront, /state.step = 11/);
  assert.match(storefront, /renderBriefingSimulation/);
  assert.match(storefront, /\/api\/v2\/briefing-simulation/);
  assert.match(storefront, /simulationBriefingAnswers/);
  assert.match(storefront, /As respostas de teste são usadas apenas para atualizar perguntas condicionais/);
  assert.match(storefront, /Confirmar presença pelo WhatsApp/);
  assert.match(storefront, /Abrir a localização/);
  assert.match(storefront, /sugestões de presentes ou Pix/);
  assert.match(storefront, /um único link/);
  assert.match(storefront, /A confirmação avançada com lista de convidados é um adicional separado/);
  assert.match(area, /export function inputHtml/);
  assert.ok(appShell.includes('/js/client-v2.js?v=20261009-mobile-briefing-3'));
  assert.ok(entry.includes('./client-v2-store.js?v=20261009-mobile-briefing-3'));
  assert.ok(entry.includes('./client-v2-area.js?v=20261009-mobile-briefing-3'));
});

test("briefing reference photos appear in both real and simulated children\u0027s style choices", () => {
  const area = readFileSync('public/js/client-v2-area.js', 'utf8');
  const store = readFileSync('public/js/client-v2-store.js', 'utf8');
  const css = readFileSync('public/css/client-v2.css', 'utf8');
  for (const file of ['mascote-bonequinho.webp', 'mascote-realista.webp']) {
    assert.ok(existsSync('public/images/exemplos/' + file), file + ' must exist');
    assert.ok(area.includes('/images/exemplos/' + file));
  }
  assert.match(area, /definition\.key === 'visual_style'/);
  assert.match(area, /stylized_doll/);
  assert.match(area, /realistic_detailed/);
  assert.match(area, /choice-reference-image/);
  assert.match(store, /inputHtml\(/);
  assert.match(css, /\.choice-reference-image/);
});

test('birthday simulation without an age still shows original child style image choices', () => {
  const visualChoices = (eventType, data = {}) => {
    const schema = buildV2BriefingSimulationSchema({
      product: { code: 'cinematic_video', name: 'Convite em vídeo' },
      eventType,
      data: { appearance_choice: 'yes', ...data },
    });
    const appearance = schema.sections.find(section => section.id === 'appearance');
    return appearance.fields.find(field => field.key === 'visual_style').options
      .map(option => option.value);
  };
  const child = ['stylized_doll', 'realistic_detailed', 'libri_decides'];
  const older = ['realistic_detailed', 'stylized', 'libri_decides'];
  assert.deepEqual(visualChoices('birthday'), child, 'simulation can skip the age field');
  assert.deepEqual(visualChoices('birthday', { age: '' }), child);
  assert.deepEqual(visualChoices('birthday', { age: '1' }), child);
  assert.deepEqual(visualChoices('birthday', { age: '6' }), child);
  assert.deepEqual(visualChoices('birthday', { age: '12' }), child);
  assert.deepEqual(visualChoices('baptism'), child);
  assert.deepEqual(visualChoices('birthday', { age: '13' }), older);
  assert.deepEqual(visualChoices('birthday', { age: '25' }), older);
  assert.deepEqual(visualChoices('15_years'), older);
  assert.deepEqual(visualChoices('wedding'), older);

  // The renderer shows both existing V1 images whenever 'stylized_doll'
  // is present, and both real and test briefings reuse this same schema.
  const sharedForm = readFileSync('public/js/client-v2-area.js', 'utf8');
  assert.match(sharedForm, /some\(option => option\.value === 'stylized_doll'\)/);
  assert.match(sharedForm, /mascote-bonequinho\.webp/);
  assert.match(sharedForm, /mascote-realista\.webp/);
});

test('dependent briefing selections keep their visible position, in preview and in real order', () => {
  const area = readFileSync('public/js/client-v2-area.js', 'utf8');
  const store = readFileSync('public/js/client-v2-store.js', 'utf8');
  assert.match(area, /render\(captureFieldViewport\(control\)\)/);
  assert.match(area, /restoreFieldViewport\(viewport, app\)/);
  assert.match(store, /preservePosition: true, control: input/);
  assert.match(store, /if \(!preservePosition\)/);
  assert.match(store, /revision !== simulationBriefingRenderRevision/);
  const originalWindow = globalThis.window;
  try {
    const scrolls = [];
    const focused = [];
    globalThis.window = {
      scrollY: 420,
      scrollTo(options) { scrolls.push(options); },
    };
    const input = {
      dataset: { field: 'visual_style' },
      value: 'stylized_doll',
      closest() { return { getBoundingClientRect: () => ({ top: 270 }) }; },
    };
    const saved = captureFieldViewport(input);
    globalThis.window.scrollY = 0;
    restoreFieldViewport(saved, {
      querySelectorAll() {
        return [{
          dataset: { field: 'visual_style' },
          value: 'stylized_doll',
          closest() { return { getBoundingClientRect: () => ({ top: 450 }) }; },
          focus(options) { focused.push(options); },
        }];
      },
    });
    assert.deepEqual(scrolls, [{ top: 180, behavior: 'instant' }]);
    assert.deepEqual(focused, [{ preventScroll: true }]);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('child style references are side by side on mobile and Libri decides remains full width', () => {
  const component = readFileSync('public/js/client-v2-area.js', 'utf8');
  const css = readFileSync('public/css/client-v2.css', 'utf8');
  assert.match(component, /choice-grid-references/);
  assert.match(component, /choice-card-reference-other/);
  assert.match(css, /\.grid\.two\.choice-grid-references\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.grid\.two\.choice-grid-references \.choice-card-reference-other\s*\{\s*grid-column:\s*1 \/ -1/);
  assert.match(css, /\.briefing-form \.page-title/);
  assert.match(css, /\.briefing-form \.action-row/);
});

test('Libri decides does not require style, outfit or photos, but explicit appearance does', () => {
  const generate = (appearance_choice, outfit_choice) =>
    buildV2BriefingSimulationSchema({
      product: { code: 'cinematic_video', name: 'Vídeo' },
      eventType: 'birthday',
      data: { appearance_choice, age: 4, ...(outfit_choice ? { outfit_choice } : {}) },
    });
  let schema = generate('libri_decides');
  const appearance = schema.sections.find(section => section.id === 'appearance');
  assert.equal(appearance.fields.find(field => field.key === 'appearance_choice').required, true);
  assert.equal(appearance.fields.find(field => field.key === 'visual_style').required, false);
  assert.equal(appearance.fields.find(field => field.key === 'outfit_choice').required, false);
  assert.equal(schema.uploadRules.find(rule => rule.fieldKey === 'person_photos').min, 0);
  assert.equal(schema.uploadRules.find(rule => rule.fieldKey === 'person_photos').max, 5);
  assert.ok(appearance.fields.find(field => field.key === 'visual_style').options.some(x => x.value === 'stylized_doll'));
  schema = generate('yes');
  assert.equal(schema.sections.find(section => section.id === 'appearance').fields.find(field => field.key === 'visual_style').required, true);
  assert.equal(schema.sections.find(section => section.id === 'appearance').fields.find(field => field.key === 'outfit_choice').required, true);
  assert.equal(schema.uploadRules.find(rule => rule.fieldKey === 'person_photos').min, 2);
  assert.equal(schema.uploadRules.find(rule => rule.fieldKey === 'person_photos').max, 5);
  schema = generate('libri_decides', 'send_photo');
  assert.equal(schema.uploadRules.find(rule => rule.fieldKey === 'outfit_photos').min, 1);
  assert.equal(schema.uploadRules.find(rule => rule.fieldKey === 'outfit_photos').max, 2);
});

test('multi-photo selection preserves max count, server mime and size policies', () => {
  const rule = {
    max: 5, maxBytes: 30 * 1024 * 1024,
    accept: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  };
  const photo = (name, type = 'image/jpeg', size = 10000) => ({ name, type, size });
  let plan = planCustomerPhotoBatch([photo('a.jpg'), photo('b.jpg'), photo('c.jpg')], 2, rule);
  assert.equal(plan.error, '');
  assert.equal(plan.files.length, 3);
  plan = planCustomerPhotoBatch([photo('d.jpg'), photo('e.jpg')], 4, rule);
  assert.equal(plan.files.length, 0);
  assert.match(plan.error, /no máximo 1 foto/);
  assert.match(planCustomerPhotoBatch([photo('a.jpg')], 5, rule).error, /limite de fotos/);
  assert.match(planCustomerPhotoBatch([photo('a.pdf', 'application/pdf')], 0, rule).error, /JPG/);
  assert.match(planCustomerPhotoBatch([photo('huge.jpg', 'image/jpeg', 30 * 1024 * 1024 + 1)], 0, rule).error, /30 MB/);
  assert.equal(planCustomerPhotoBatch([], 0, rule).files.length, 0);
  assert.equal(planCustomerPhotoBatch([photo('a.heic', 'image/heic')], 0, rule).error, '');
  for (const max of [2, 5, 6]) {
    assert.equal(planCustomerPhotoBatch(Array.from({ length: max }, (_, i) => photo(String(i))), 0, { ...rule, max }).files.length, max);
    assert.notEqual(planCustomerPhotoBatch(Array.from({ length: max + 1 }, (_, i) => photo(String(i))), 0, { ...rule, max }).error, '');
  }
});

test('bulk upload is sequential, reconciles uncertain writes and save indicator remains discreet', () => {
  const area = readFileSync('public/js/client-v2-area.js', 'utf8');
  const store = readFileSync('public/js/client-v2-store.js', 'utf8');
  const css = readFileSync('public/css/client-v2.css', 'utf8');
  assert.match(area, /multiple\s+accept=/);
  assert.match(area, /planCustomerPhotoBatch\(input\.files, existingCount, rule\)/);
  assert.match(area, /for \(const \[index, file\] of batch\.files\.entries\(\)\)/);
  assert.match(area, /await uploadCustomerPhoto\(/);
  assert.match(area, /!seen\.has\(Number\(item\.id\)\)/);
  assert.match(area, /confirmationUnknown = !checked/);
  assert.match(area, /briefingUploadNeedsRefresh = true/);
  assert.match(area, /if \(briefingUploadNeedsRefresh\)/);
  assert.match(area, /break; \/\/ Never silently skip a failed photo/);
  assert.match(area, /briefingUploadsRunning/);
  assert.match(area, /aria-live="polite">Salvamento automático/);
  assert.match(area, /setBriefingSaveFeedback\('Salvo ✓', 'saved'\)/);
  assert.match(area, /setBriefingSaveFeedback\('Não salvo', 'error'\)/);
  assert.match(css, /#briefingSaveStatus/);
  assert.match(store, /\['pix_key', 'pix_holder', 'age'\]/);
  assert.match(store, /preservePosition: true, control: input/);
});

test('admin entry HTML has correctly quoted executable module import (regression: blank admin after deploy)', () => {
  const adminHtml = readFileSync('public/admin-v2.html', 'utf8');
  const clientHtml = readFileSync('public/client-v2.html', 'utf8');
  for (const [name, html] of [['admin', adminHtml], ['client', clientHtml]]) {
    const stylesheets = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)];
    assert.equal(stylesheets.length, 1, name + ' must load exactly one stylesheet');
    assert.match(
      stylesheets[0][0],
      /\bhref="\/css\/[a-z0-9-]+\.css(?:\?v=[a-z0-9-]+)?"(?=\s|>)/i,
      name + ' stylesheet href must have a closing double quote before >',
    );
    const scripts = [...html.matchAll(/<script\b[^>]*\btype="module"[^>]*>/g)];
    assert.equal(scripts.length, 1, name + ' must load exactly one entry module');
    assert.match(scripts[0][0], /\bsrc="\/js\/[a-z0-9-]+\.js(?:\?v=[a-z0-9-]+)?"(?=\s|>)/i,
      name + ' module src must have a closing double quote before >');
    assert.match(scripts[0][0], /\btype="module"/, name + ' must use module script');
    assert.match(html, /<\/script>/, name + ' must terminate the script element');
  }
  assert.match(adminHtml, /href="\/css\/admin-v2\.css\?v=20261009-admin-quickfinish-1">/);
  assert.match(adminHtml, /src="\/js\/admin-v2\.js\?v=20261010-finalized-1"><\/script>/);
});

test('all migrations run in SQLite with V1 and V2 tables intact', () => {
  const DB = database(); assert.equal(DB.migrationCount, 19);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_products').get().n, 7);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_combos').get().n, 5);
  assert.equal(DB.sqlite.prepare("SELECT value FROM v2_settings WHERE key = 'company_name'").get().value, 'Libri Convites');
  assert.equal(DB.sqlite.prepare("SELECT value FROM v2_settings WHERE key = 'company_instagram'").get().value, '@libriconvites');
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_notification_preferences WHERE event_code IN ('EVENT_TOMORROW','DELIVERY_TOMORROW','ACTION_REQUIRED')").get().n, 3);
  assert.equal(DB.sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.ok(DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'orders'").get());
  assert.ok(
    DB.sqlite.prepare("SELECT name FROM pragma_table_info('v2_orders') WHERE name='archived_at'").get(),
  );
});

test('legacy V1 orders migrate idempotently into the V2 model without deleting source data', () => {
  const DB = database();
  const legacyToken = 'ord_' + 'b'.repeat(36);

  DB.sqlite.prepare(`
    INSERT INTO orders(
      order_code, public_token, customer_name, whatsapp,
      honoree_name, display_name, age,
      event_date, event_time, venue_name, venue_address, location_url, theme,
      experience, format, addons_json, briefing_json, pricing_json,
      subtotal_cents, urgency_enabled, urgency_percent, urgency_amount_cents,
      total_cents, deposit_percent, deposit_cents, balance_cents,
      terms_version, terms_accepted_at, portfolio_consent,
      status, photos_status, entry_status, mascot_status, speech_mode,
      speech_status, invitation_status, balance_status,
      production_started_at, production_deadline_at,
      created_at, updated_at, finalized_at
    )
    VALUES (
      'LIBRI-0999', ?, 'Cliente Legada', '5561999999999',
      'Aurora Legada', 'Aurora', 5,
      '2026-12-20', '16:00', 'Salão', 'Rua Teste', 'https://maps.example/teste', 'Jardim',
      'full', 'interactive',
      '{"confirmation":true,"extraPerson":1,"photoAlbumPlan":"festa","photoAlbumExtra100":1}',
      '{"mustHave":"Borboletas","speechPreference":"libri"}',
      '{"productCents":18000,"addonsCents":11900}',
      29900, 1, 30, 8970,
      38870, 50, 19435, 19435,
      '1.0', '2026-10-01T12:00:00.000Z', 1,
      'producing', 'approved', 'confirmed', 'approved', 'libri',
      'not_required', 'producing', 'waiting',
      '2026-10-02T12:00:00.000Z', '2026-10-10T12:00:00.000Z',
      '2026-10-01T12:00:00.000Z', '2026-10-03T12:00:00.000Z', '2026-10-03T12:00:00.000Z'
    )
  `).run(legacyToken);

  const legacyId = DB.sqlite.prepare("SELECT id FROM orders WHERE order_code='LIBRI-0999'").get().id;
  DB.sqlite.prepare(`
    INSERT INTO order_history(order_id, action_code, description, metadata_json, created_at)
    VALUES (?, 'update_entry_status', 'Entrada confirmada', '{}', '2026-10-01T13:00:00.000Z')
  `).run(legacyId);
  DB.sqlite.prepare(`
    INSERT INTO internal_notes(order_id, note, created_at)
    VALUES (?, 'Manter detalhe aprovado pela cliente.', '2026-10-02T14:00:00.000Z')
  `).run(legacyId);

  const migration = readFileSync('migrations/0014_v1_to_v2_retirement.sql', 'utf8');
  DB.sqlite.exec(migration);
  DB.sqlite.exec(migration);

  const migrated = DB.sqlite.prepare(`
    SELECT o.*, c.name AS customer_name, c.whatsapp
    FROM v2_orders o
    JOIN v2_customers c ON c.id = o.customer_id
    WHERE o.order_code='LIBRI-0999'
  `).get();

  assert.equal(migrated.public_token, legacyToken);
  assert.equal(migrated.customer_name, 'Cliente Legada');
  assert.equal(migrated.whatsapp, '5561999999999');
  assert.equal(migrated.honoree_display_name, 'Aurora');
  assert.equal(migrated.status, 'in_production');
  assert.equal(migrated.briefing_status, 'completed');
  assert.equal(migrated.delivery_end, '2026-10-10');

  const briefing = JSON.parse(DB.sqlite.prepare(
    "SELECT data_json FROM v2_briefings WHERE order_id=?"
  ).get(migrated.id).data_json);
  assert.equal(briefing.theme_or_style, 'Jardim');
  assert.equal(briefing.event_time, '16:00');
  assert.equal(briefing.mustHave, 'Borboletas');

  assert.equal(DB.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM v2_order_items WHERE order_id=?"
  ).get(migrated.id).n, 5);
  assert.equal(DB.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM v2_payments WHERE order_id=? AND status='approved'"
  ).get(migrated.id).n, 1);
  assert.equal(DB.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM v2_order_terms_acceptances WHERE order_id=?"
  ).get(migrated.id).n, 1);
  assert.equal(DB.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM v2_internal_notes WHERE order_id=?"
  ).get(migrated.id).n, 1);
  assert.ok(DB.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM v2_agenda_allocations WHERE order_id=?"
  ).get(migrated.id).n > 0);

  assert.equal(DB.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM v2_orders WHERE order_code='LIBRI-0999'"
  ).get().n, 1);
  assert.equal(DB.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM orders WHERE order_code='LIBRI-0999'"
  ).get().n, 1);
});

test('legacy repair finalizes delivered historical orders and moves imported payments off migration month', async () => {
  const DB = database();

  const legacyToken = 'ord_' + 'c'.repeat(36);
  DB.sqlite.prepare(`
    INSERT INTO orders(
      order_code, public_token, customer_name, whatsapp,
      honoree_name, display_name, age,
      event_date, event_time, venue_name, venue_address, location_url, theme,
      experience, format, addons_json, briefing_json, pricing_json,
      subtotal_cents, urgency_enabled, urgency_percent, urgency_amount_cents,
      total_cents, deposit_percent, deposit_cents, balance_cents,
      terms_version, terms_accepted_at, portfolio_consent,
      status, photos_status, entry_status, mascot_status, speech_mode,
      speech_status, invitation_status, balance_status,
      production_started_at, production_deadline_at,
      created_at, updated_at, finalized_at
    )
    VALUES (
      'LIBRI-0998', ?, 'Cliente Histórica', '5561888888888',
      'Evento Histórico', 'Evento Histórico', 7,
      '2026-09-20', '18:00', 'Salão', 'Rua Antiga', '', 'Tema antigo',
      'full', 'interactive', '{}', '{"mustHave":"Histórico"}', '{}',
      10000, 0, 0, 0,
      10000, 50, 5000, 5000,
      '1.0', '2026-08-01T12:00:00.000Z', 1,
      'producing', 'approved', 'confirmed', 'approved', 'libri',
      'not_required', 'approved', 'waiting',
      '2026-08-03T12:00:00.000Z', '2026-08-10T12:00:00.000Z',
      '2026-08-01T12:00:00.000Z', '2026-10-06T01:00:00.000Z', '2026-08-01T12:00:00.000Z'
    )
  `).run(legacyToken);

  const migration14 = readFileSync('migrations/0014_v1_to_v2_retirement.sql', 'utf8');
  const migration15 = readFileSync('migrations/0015_fix_legacy_finalized_finance.sql', 'utf8');
  DB.sqlite.exec(migration14);

  const before = DB.sqlite.prepare(
    "SELECT status FROM v2_orders WHERE order_code='LIBRI-0998'"
  ).get();
  assert.equal(before.status, 'balance_pending');

  const beforePayment = DB.sqlite.prepare(`
    SELECT paid_at
    FROM v2_payments
    WHERE order_id=(SELECT id FROM v2_orders WHERE order_code='LIBRI-0998')
      AND payment_type='deposit'
  `).get();
  assert.equal(beforePayment.paid_at, '2026-10-06T01:00:00.000Z');

  DB.sqlite.exec(migration15);
  DB.sqlite.exec(migration15);

  const repaired = DB.sqlite.prepare(`
    SELECT status, next_action, finalized_at
    FROM v2_orders
    WHERE order_code='LIBRI-0998'
  `).get();
  assert.equal(repaired.status, 'finalized');
  assert.match(repaired.next_action, /Finalizado/);
  assert.ok(repaired.finalized_at);

  const repairedPayment = DB.sqlite.prepare(`
    SELECT paid_at
    FROM v2_payments
    WHERE order_id=(SELECT id FROM v2_orders WHERE order_code='LIBRI-0998')
      AND payment_type='deposit'
  `).get();
  assert.equal(repairedPayment.paid_at, '2026-08-01T12:00:00.000Z');

  assert.equal(DB.sqlite.prepare(`
    SELECT COUNT(*) AS n
    FROM v2_agenda_allocations
    WHERE order_id=(SELECT id FROM v2_orders WHERE order_code='LIBRI-0998')
  `).get().n, 0);

  const finance = await getV2FinanceDashboard(DB, { preset: 'this_month' });
  assert.equal(finance.summary.receivableCents, 0);
  assert.equal(finance.summary.openReceivableAllCents, 0);
  assert.equal(finance.receivables.some(item => item.orderCode === 'LIBRI-0998'), false);
  assert.equal(finance.movements.some(item => item.orderCode === 'LIBRI-0998'), false);
});


test('legacy paid historical order is finalized even when V1 invitation approval flag was stale', async () => {
  const DB = database();

  const legacyToken = 'ord_' + 'd'.repeat(36);
  DB.sqlite.prepare(`
    INSERT INTO orders(
      order_code, public_token, customer_name, whatsapp,
      honoree_name, display_name, age,
      event_date, event_time, venue_name, venue_address, location_url, theme,
      experience, format, addons_json, briefing_json, pricing_json,
      subtotal_cents, urgency_enabled, urgency_percent, urgency_amount_cents,
      total_cents, deposit_percent, deposit_cents, balance_cents,
      terms_version, terms_accepted_at, portfolio_consent,
      status, photos_status, entry_status, mascot_status, speech_mode,
      speech_status, invitation_status, balance_status,
      production_started_at, production_deadline_at,
      created_at, updated_at, finalized_at
    )
    VALUES (
      'LIBRI-0997', ?, 'Cliente Histórica Paga', '5561777777777',
      'Evento Pago', 'Evento Pago', 6,
      '2026-08-15', '17:00', 'Salão', 'Rua Histórica', '', 'Tema antigo',
      'full', 'interactive', '{}', '{"mustHave":"Histórico pago"}', '{}',
      10000, 0, 0, 0,
      10000, 50, 5000, 5000,
      '1.0', '2026-07-01T12:00:00.000Z', 1,
      'producing', 'approved', 'confirmed', 'approved', 'libri',
      'not_required', 'waiting', 'confirmed',
      '2026-07-03T12:00:00.000Z', '2026-07-10T12:00:00.000Z',
      '2026-07-01T12:00:00.000Z', '2026-10-06T01:00:00.000Z', '2026-08-15T23:00:00.000Z'
    )
  `).run(legacyToken);

  const migration14 = readFileSync('migrations/0014_v1_to_v2_retirement.sql', 'utf8');
  const migration15 = readFileSync('migrations/0015_fix_legacy_finalized_finance.sql', 'utf8');
  const migration17 = readFileSync('migrations/0017_fix_legacy_paid_history.sql', 'utf8');

  DB.sqlite.exec(migration14);

  assert.equal(
    DB.sqlite.prepare(
      "SELECT status FROM v2_orders WHERE order_code='LIBRI-0997'"
    ).get().status,
    'in_production',
  );

  DB.sqlite.exec(migration15);

  assert.equal(
    DB.sqlite.prepare(
      "SELECT status FROM v2_orders WHERE order_code='LIBRI-0997'"
    ).get().status,
    'in_production',
    '0015 did not cover a stale invitation flag despite historical full payment',
  );

  assert.ok(
    DB.sqlite.prepare(`
      SELECT COUNT(*) AS n
      FROM v2_agenda_allocations
      WHERE order_id=(SELECT id FROM v2_orders WHERE order_code='LIBRI-0997')
    `).get().n > 0,
  );

  DB.sqlite.exec(migration17);
  DB.sqlite.exec(migration17);

  const repaired = DB.sqlite.prepare(`
    SELECT status, next_action, finalized_at
    FROM v2_orders
    WHERE order_code='LIBRI-0997'
  `).get();

  assert.equal(repaired.status, 'finalized');
  assert.match(repaired.next_action, /Finalizado/);
  assert.ok(repaired.finalized_at);

  assert.equal(
    DB.sqlite.prepare(`
      SELECT COUNT(*) AS n
      FROM v2_agenda_allocations
      WHERE order_id=(SELECT id FROM v2_orders WHERE order_code='LIBRI-0997')
    `).get().n,
    0,
  );

  const payments = DB.sqlite.prepare(`
    SELECT payment_type, paid_at
    FROM v2_payments
    WHERE order_id=(SELECT id FROM v2_orders WHERE order_code='LIBRI-0997')
    ORDER BY payment_type
  `).all();

  assert.equal(payments.length, 2);
  assert.ok(
    payments.every(
      payment =>
        payment.paid_at.startsWith('2026-07-01'),
    ),
  );

  const finance = await getV2FinanceDashboard(DB, { preset: 'this_month' });
  assert.equal(finance.summary.receivableCents, 0);
  assert.equal(finance.summary.openReceivableAllCents, 0);
  assert.equal(
    finance.receivables.some(
      item => item.orderCode === 'LIBRI-0997',
    ),
    false,
  );
  assert.equal(
    finance.movements.some(
      item => item.orderCode === 'LIBRI-0997',
    ),
    false,
  );
});

test('urgency: request, approval, exact discounted price, Pix, repeated webhook and production preservation', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const result = await urgency(DB); const token = result.order.publicToken;
  assert.equal(mp.posts, 0);
  const pendingPricing = DB.sqlite.prepare('SELECT subtotal_cents, urgency_percent, urgency_amount_cents, total_cents FROM v2_order_pricing').get();
  assert.equal(pendingPricing.urgency_percent, 30);
  assert.equal(pendingPricing.urgency_amount_cents, Math.round(pendingPricing.subtotal_cents * 0.3));
  assert.equal(pendingPricing.total_cents, pendingPricing.subtotal_cents + pendingPricing.urgency_amount_cents);
  DB.sqlite.prepare('UPDATE v2_order_pricing SET subtotal_cents = 7001, combo_discount_cents = 1000, coupon_discount_cents = 500').run();
  const approved = await decideV2Urgency(DB, result.order.code, { decision: 'approve', deliveryStart: day(0), deliveryEnd: day(1) });
  assert.equal(approved.pricing.totalCents, 9101); assert.equal(approved.pricing.urgencyAmountCents, 2100);
  assert.equal(approved.pricing.payment.depositCents, 4551); assert.equal(approved.pricing.payment.balanceCents, 4550);
  await assert.rejects(decideV2Urgency(DB, result.order.code, { decision: 'reject', note: 'Duplicada' }));
  const payment = await resumeV2Payment(request, e, token, await terms(DB));
  assert.equal(mp.bodies[0].total_amount, '45.51');
  assert.equal(mp.bodies[0].capture_mode, undefined);
  assert.equal(mp.bodies[0].expiration_time, undefined);
  assert.equal(mp.bodies[0].description, undefined);
  assert.equal(mp.bodies[0].config.statement_descriptor, undefined);
  assert.equal(mp.bodies[0].config.online.auto_return, 'approved');
  assert.equal(mp.bodies[0].config.online.retries, undefined);
  assert.deepEqual(Object.keys(mp.bodies[0].items[0]).sort(),
    ['quantity', 'title', 'unit_price']);
  assert.equal(mp.bodies[0].payer.email, 'test@example.com');
  assert.equal(payment.payment.ready, true);
  const reused = await resumeV2Payment(request, e, token, await terms(DB)); assert.equal(reused.payment.checkoutUrl, payment.payment.checkoutUrl); assert.equal(mp.posts, 1);
  mp.approve(payment.payment.providerOrderId);
  await syncMercadoPagoOrder(e, payment.payment.providerOrderId);
  const area = await getV2CustomerArea(e, token); assert.equal(area.briefing.locked, false);
  assert.equal(area.payment.paidCents, 4551); assert.equal(area.payment.remainingCents, 4550);
  DB.sqlite.prepare("UPDATE v2_settings SET value='pix-teste' WHERE key='balance_pix_key'").run();
  DB.sqlite.prepare("UPDATE v2_settings SET value='Libri Teste' WHERE key='balance_pix_recipient_name'").run();
  DB.sqlite.prepare("UPDATE v2_orders SET status='balance_pending'").run();
  const balanceArea = await getV2CustomerArea(e, token);
  assert.deepEqual(balanceArea.payment.balancePix, { key: 'pix-teste', recipient: 'Libri Teste' });
  DB.sqlite.prepare("UPDATE v2_orders SET status = 'in_production', briefing_status = 'completed'").run();
  await syncMercadoPagoOrder(e, payment.payment.providerOrderId);
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_orders').get().status, 'in_production');
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_order_history WHERE action_code = 'payment_confirmed'").get().n, 1);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_agenda_allocations').get().n, 1);
  const units = DB.sqlite.prepare('SELECT points_units FROM v2_agenda_allocations').get().points_units;
  assert.equal(typeof units, 'number'); assert.equal(units, 100);
});

test('customer area reconciles an approved urgency payment without waiting for the scheduler', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const result = await urgency(DB); const token = result.order.publicToken;
  await decideV2Urgency(DB, result.order.code, {
    decision: 'approve', deliveryStart: day(0), deliveryEnd: day(1),
  });
  const payment = await resumeV2Payment(request, e, token, await terms(DB));
  mp.approve(payment.payment.providerOrderId);

  const area = await getV2CustomerArea(e, token);

  assert.equal(area.briefing.locked, false);
  assert.equal(area.order.status, 'briefing_pending');
});

test('rejection prevents payment; invalid and past windows are rejected', async () => {
  const DB = database(); const result = await urgency(DB);
  assert.throws(() => validateUrgencyWindow(day(-1), day(1), day(2)));
  assert.throws(() => validateUrgencyWindow('2026-02-30', '2026-03-01', '2026-03-02'));
  await decideV2Urgency(DB, result.order.code, { decision: 'reject', note: 'Sem capacidade' });
  const area = await getV2CustomerArea(env(DB), result.order.publicToken); assert.equal(area.urgency.note, 'Sem capacidade');
  await assert.rejects(resumeV2Payment(request, env(DB), result.order.publicToken, await terms(DB)));
});

test('card charges 100%; payment-time capacity is revalidated and concurrent requests are serialized', async t => {
  const DB = database(); const mp = providerMock(t); const result = await urgency(DB);
  await decideV2Urgency(DB, result.order.code, { decision: 'approve', deliveryStart: day(0), deliveryEnd: day(1) });
  await setV2AgendaPeriod(DB, { start: day(0), end: day(1), blocked: true });
  await assert.rejects(resumeV2Payment(request, env(DB), result.order.publicToken, await terms(DB, 'card')), /capacidade/);
  assert.equal(mp.posts, 0);
  await setV2AgendaPeriod(DB, { start: day(0), end: day(1), blocked: false });
  const body = await terms(DB, 'card');
  const results = await Promise.allSettled([resumeV2Payment(request, env(DB), result.order.publicToken, body), resumeV2Payment(request, env(DB), result.order.publicToken, body)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1); assert.equal(mp.posts, 1);
  assert.deepEqual(
    mp.bodies[0].config.payment_method,
    {
      not_allowed_types: [
        'bank_transfer',
        'debit_card',
        'prepaid_card',
        'ticket',
        'account_money',
        'digital_currency',
      ],
    },
    'card Orders payload must use only documented request restrictions',
  );
  const pricing = DB.sqlite.prepare('SELECT total_cents, deposit_cents, balance_cents FROM v2_order_pricing').get();
  assert.equal(pricing.total_cents, pricing.deposit_cents); assert.equal(pricing.balance_cents, 0);

  assert.equal(
    Object.prototype.hasOwnProperty.call(
      mp.bodies[0].config.payment_method,
      'max_installments',
    ),
    false,
  );

  assert.equal(
    Object.prototype.hasOwnProperty.call(
      mp.bodies[0].config.payment_method,
      'default_type',
    ),
    false,
  );

  assert.equal(
    Object.prototype.hasOwnProperty.call(
      mp.bodies[0].config.payment_method,
      'installments_cost',
    ),
    false,
  );

  assert.equal(
    Object.prototype.hasOwnProperty.call(
      mp.bodies[0].config.payment_method,
      'installments',
    ),
    false,
  );

  assert.equal(
    Object.prototype.hasOwnProperty.call(
      mp.bodies[0].items[0],
      'unit_measure',
    ),
    false,
  );

  assert.equal(
    Object.prototype.hasOwnProperty.call(
      mp.bodies[0].items[0],
      'total_amount',
    ),
    false,
  );

  assert.deepEqual(
    Object.keys(
      mp.bodies[0].items[0],
    ).sort(),
    [
      'quantity',
      'title',
      'unit_price',
    ],
    'Checkout Pro item payload must stay minimal',
  );
});

test('card Orders API logs sanitized rejection causes and never exposes provider secrets', async t => {
  const DB = database();
  const e = env(DB);
  const mp = providerMock(t);
  const initial = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Diagnostico cartao', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    selection: { productCode: 'interactive_essential', paymentMethod: 'card' },
    ...await terms(DB, 'card'),
  }));
  assert.equal(mp.posts, 1);
  const orderId = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code = ?')
    .get(initial.order.code).id;

  t.mock.restoreAll();
  const logs = [];
  let sent;
  t.mock.method(console, 'error', (...parts) => logs.push(parts.join(' ')));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.mercadopago.com/v1/orders');
    sent = { body: JSON.parse(options.body), headers: options.headers };
    return Response.json({
      message: 'Unsupported card property for client@example.com Bearer APP_USR-private-token',
      cause: [{
        code: 'unsupported_properties',
        property: 'config.payment_method.default_type',
        description: 'invalid for client@example.com APP_USR-private-token',
      }],
    }, { status: 400, headers: { 'x-request-id': 'mp-trace-123' } });
  });

  let rejection;
  await assert.rejects(
    createMercadoPagoCheckout(request, e, {
      orderId, orderCode: initial.order.code, publicToken: initial.order.publicToken,
      paymentMethod: 'card', amountDueNowCents: initial.payment.amountDueNowCents,
      customerEmail: 'client@example.com',
    }),
    error => { rejection = error; return error.status === 400; },
  );

  assert.equal(sent.headers['authorization'], 'Bearer TEST-token');
  assert.match(sent.headers['x-idempotency-key'], /^[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(sent.body).sort(), [
    'config', 'external_reference', 'items', 'payer', 'processing_mode', 'total_amount', 'type',
  ]);
  assert.deepEqual(Object.keys(sent.body.items[0]).sort(), ['quantity', 'title', 'unit_price']);
  assert.equal(sent.body.items[0].unit_price, sent.body.total_amount);
  assert.deepEqual(Object.keys(sent.body.config.payment_method), ['not_allowed_types']);
  assert.equal(sent.body.config.payment_method.not_allowed_types.includes('credit_card'), false);
  assert.equal(sent.body.external_reference, initial.order.code);
  assert.equal(initial.payment.balanceCents, 0);

  assert.equal(rejection.details.providerCode, 'unsupported_properties');
  assert.match(rejection.message, /Código: unsupported_properties/);
  assert.ok(logs.some(line => line.includes('config.payment_method.default_type')));
  assert.ok(logs.some(line => line.includes('mp-trace-123')));
  for (const output of [rejection.message, JSON.stringify(rejection.details), ...logs]) {
    assert.equal(output.includes('client@example.com'), false);
    assert.equal(output.includes('APP_USR-private-token'), false);
    assert.equal(output.includes('TEST-token'), false);
  }
});

test('checkout price breakdown stays visible in mobile frontend even after deploy and method switch', () => {
  const shell = readFileSync('public/client-v2.html', 'utf8');
  const entry = readFileSync('public/js/client-v2.js', 'utf8');
  const store = readFileSync('public/js/client-v2-store.js', 'utf8');
  const area = readFileSync('public/js/client-v2-area.js', 'utf8');
  assert.ok(shell.includes('/js/client-v2.js?v=20261009-mobile-briefing-3'));
  assert.ok(entry.includes('./client-v2-area.js?v=20261009-mobile-briefing-3'));
  assert.ok(entry.includes('./client-v2-store.js?v=20261009-mobile-briefing-3'));
  assert.match(store, /Acréscimo no cartão/);
  assert.match(store, /quote.cardFeeCents/);
  assert.match(area, /data-card-extra/);
  assert.match(area, /cardTotalCents/);
  assert.match(area, /Pix • entrada de 50%/);
});

test('4.97% card fee preserves a 70 BRL net target while Pix keeps its price', async () => {
  const DB = database();
  DB.sqlite.prepare("UPDATE v2_product_variants SET price_cents = 7000 WHERE product_id = (SELECT id FROM v2_products WHERE code = 'interactive_essential')").run();
  const pix = await calculateCommercialV2Quote(DB, { productCode: 'interactive_essential', paymentMethod: 'pix' });
  const card = await calculateCommercialV2Quote(DB, { productCode: 'interactive_essential', paymentMethod: 'card' });
  assert.equal(pix.totalCents, 7000);
  assert.equal(pix.cardFeeCents, 0);
  assert.equal(pix.payment.depositCents, 3500);
  assert.equal(pix.payment.balanceCents, 3500);
  assert.equal(card.baseTotalCents, 7000);
  assert.equal(card.cardFeeCents, 366);
  assert.equal(card.cardFeePercent, 4.97);
  assert.equal(card.totalCents, 7366);
  assert.equal(card.payment.depositCents, 7366);
  assert.equal(card.payment.balanceCents, 0);
  assert.equal(card.totalCents - Math.round(card.totalCents * 0.0497), 7000);
});

test('card fee is the exact Mercado Pago checkout total, and switching back to Pix removes it', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  DB.sqlite.prepare("UPDATE v2_product_variants SET price_cents = 7000 WHERE product_id = (SELECT id FROM v2_products WHERE code = 'interactive_essential')").run();
  const card = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Taxa transparente', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    selection: { productCode: 'interactive_essential', paymentMethod: 'card' },
    ...await terms(DB, 'card'),
  }));
  assert.equal(card.payment.totalCents, 7366);
  assert.equal(card.payment.amountDueNowCents, 7366);
  assert.equal(mp.bodies[0].total_amount, '73.66');
  const stored = DB.sqlite.prepare('SELECT total_cents, pricing_snapshot_json FROM v2_order_pricing').get();
  assert.equal(stored.total_cents, 7366);
  assert.equal(JSON.parse(stored.pricing_snapshot_json).cardFeeCents, 366);

  const customerArea = await getV2CustomerArea(e, card.order.publicToken);
  assert.equal(customerArea.payment.cardTotalCents, 7366);
  assert.equal(customerArea.payment.baseTotalCents, 7000);
  assert.equal(customerArea.payment.cardFeeCents, 366);

  const pix = await resumeV2Payment(request, e, card.order.publicToken, {
    clientRequestId: crypto.randomUUID(), paymentMethod: 'pix',
  });
  assert.equal(pix.order.code, card.order.code);
  assert.equal(pix.payment.totalCents, 7000);
  assert.equal(pix.payment.amountDueNowCents, 3500);
  assert.equal(mp.bodies[1].total_amount, '35.00');
  assert.equal((await getV2CustomerArea(e, card.order.publicToken)).payment.cardTotalCents, 7366);

  const cardAgain = await resumeV2Payment(request, e, card.order.publicToken, {
    clientRequestId: crypto.randomUUID(), paymentMethod: 'card',
  });
  assert.equal(cardAgain.order.code, card.order.code);
  assert.equal(cardAgain.payment.totalCents, 7366);
  assert.equal(cardAgain.payment.amountDueNowCents, 7366);
  assert.equal(mp.bodies[2].total_amount, '73.66');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n, 1);
});

test('pre-existing unpaid card orders preserve their contracted total on unchanged retry', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const initial = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Preço acordado antes da taxa', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    selection: { productCode: 'interactive_essential', paymentMethod: 'card' },
    ...await terms(DB, 'card'),
  }));
  const originalId = initial.payment.providerOrderId;
  const id = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code=?').get(initial.order.code).id;
  const oldSnapshot = JSON.parse(DB.sqlite.prepare('SELECT pricing_snapshot_json FROM v2_order_pricing WHERE order_id=?').get(id).pricing_snapshot_json);
  delete oldSnapshot.cardFeeCents;
  delete oldSnapshot.cardFeePercent;
  delete oldSnapshot.baseTotalCents;
  const agreedCents = oldSnapshot.subtotalCents;
  oldSnapshot.totalCents = agreedCents;
  oldSnapshot.payment.depositCents = agreedCents;
  DB.sqlite.prepare('UPDATE v2_order_pricing SET total_cents=?, deposit_cents=?, pricing_snapshot_json=? WHERE order_id=?')
    .run(agreedCents, agreedCents, JSON.stringify(oldSnapshot), id);
  mp.orders.get(originalId).status = 'expired';
  mp.orders.get(originalId).status_detail = 'expired';
  const resumed = await resumeV2Payment(request, e, initial.order.publicToken, {
    clientRequestId: crypto.randomUUID(), paymentMethod: 'card',
  });
  assert.equal(resumed.payment.totalCents, agreedCents);
  assert.equal(resumed.payment.amountDueNowCents, agreedCents);
  assert.equal((await getV2CustomerArea(e, initial.order.publicToken)).payment.cardTotalCents, agreedCents);
});

test('customer can switch an unpaid regular order from card to Pix without creating another order', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const body = input({
    event: { honoreeName: 'Troca método', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    selection: { productCode: 'interactive_essential', paymentMethod: 'card' },
    ...await terms(DB, 'card'),
  });

  const first = await startV2Checkout(request, e, body);
  assert.equal(first.payment.method, 'card');
  assert.equal(first.payment.amountDueNowCents, first.payment.totalCents);

  const switched = await resumeV2Payment(request, e, first.order.publicToken, {
    clientRequestId: crypto.randomUUID(),
    paymentMethod: 'pix',
  });

  assert.equal(switched.order.code, first.order.code);
  assert.equal(switched.payment.method, 'pix');
  assert.equal(switched.payment.amountDueNowCents, Math.round(switched.payment.totalCents * 0.5));
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n, 1);
  assert.equal(DB.sqlite.prepare('SELECT payment_method FROM v2_order_pricing').get().payment_method, 'pix');
  assert.equal(mp.posts, 2);
  assert.equal(mp.orders.get(first.payment.providerOrderId).status, 'cancelled');
});

test('late payment retry proposes next delivery dates in a popup without changing original order until confirmed', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Entrega venceu', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    selection: { productCode: 'interactive_essential', paymentMethod: 'card' },
    ...await terms(DB, 'card'),
  }));
  const originalCode = checkout.order.code;
  const token = checkout.order.publicToken;
  DB.sqlite.prepare('UPDATE v2_orders SET delivery_start = ?, delivery_end = ? WHERE order_code = ?')
    .run(day(0), day(2), originalCode);
  DB.sqlite.prepare("UPDATE v2_checkout_holds SET expires_at = '2000-01-01T00:00:00Z' WHERE order_id = (SELECT id FROM v2_orders WHERE order_code = ?)")
    .run(originalCode);

  const first = await resumeV2Payment(request, e, token, {
    clientRequestId: crypto.randomUUID(),
    paymentMethod: 'pix',
  }).then(() => null, error => error);
  assert.equal(first.code, 'delivery_window_shifted');
  assert.deepEqual(first.details.previous, { start: day(0), end: day(2) });
  assert.deepEqual(first.details.next, { start: day(1), end: day(3) });
  assert.equal(mp.posts, 1, 'the popup must not create a new provider order');
  assert.equal(mp.orders.get(checkout.payment.providerOrderId).status, 'created',
    'no cancellation before customer approves the new date');
  assert.equal(DB.sqlite.prepare('SELECT delivery_start FROM v2_orders WHERE order_code=?')
    .get(originalCode).delivery_start, day(0));

  const agreed = await resumeV2Payment(request, e, token, {
    clientRequestId: crypto.randomUUID(),
    paymentMethod: 'pix',
    confirmedDeliveryWindow: first.details.next,
  });
  assert.equal(agreed.order.code, originalCode);
  assert.equal(agreed.payment.method, 'pix');
  assert.deepEqual(agreed.deliveryRescheduled, first.details);
  assert.equal(agreed.payment.amountDueNowCents, Math.round(agreed.payment.totalCents * 0.5));
  assert.equal(DB.sqlite.prepare('SELECT delivery_start FROM v2_orders WHERE order_code=?')
    .get(originalCode).delivery_start, day(1));
  assert.equal(DB.sqlite.prepare('SELECT delivery_end FROM v2_orders WHERE order_code=?')
    .get(originalCode).delivery_end, day(3));
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_order_history WHERE action_code='delivery_window_rescheduled'").get().n, 1);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n, 1);
  assert.equal(mp.posts, 2);
  assert.equal(mp.orders.get(checkout.payment.providerOrderId).status, 'cancelled');
  const area = await getV2CustomerArea(e, token);
  assert.deepEqual(area.order.deliveryWindow, { start: day(1), end: day(3) });
});

test('rescheduled delivery rejects forged or outdated confirmation and recalculates nearest free window', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Janela livre', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) }, ...await terms(DB),
  }));
  const id = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code=?')
    .get(checkout.order.code).id;
  DB.sqlite.prepare('UPDATE v2_orders SET delivery_start=?, delivery_end=? WHERE id=?')
    .run(day(0), day(2), id);
  DB.sqlite.prepare("UPDATE v2_checkout_holds SET expires_at='2000-01-01' WHERE order_id=?").run(id);
  await setV2AgendaPeriod(DB, { start: day(1), end: day(3), blocked: true });
  const rejected = await resumeV2Payment(request, e, checkout.order.publicToken, {
    paymentMethod: 'card',
    confirmedDeliveryWindow: { start: day(1), end: day(3) },
  }).then(() => null, error => error);
  assert.equal(rejected.code, 'delivery_window_shifted');
  assert.deepEqual(rejected.details.next, { start: day(2), end: day(4) });
  assert.equal(DB.sqlite.prepare('SELECT delivery_start FROM v2_orders WHERE id=?')
    .get(id).delivery_start, day(0));
  assert.equal(mp.posts, 1);
});

test('no replacement delivery window leaves pending order intact without inventing availability', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Sem janela', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) }, ...await terms(DB),
  }));
  const id = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code=?').get(checkout.order.code).id;
  DB.sqlite.prepare('UPDATE v2_orders SET delivery_start=?, delivery_end=?, event_date=? WHERE id=?')
    .run(day(0), day(2), day(3), id);
  DB.sqlite.prepare("UPDATE v2_checkout_holds SET expires_at='2000-01-01' WHERE order_id=?").run(id);
  const rejected = await resumeV2Payment(request, e, checkout.order.publicToken, { paymentMethod: 'pix' })
    .then(() => null, error => error);
  assert.equal(rejected.code, 'delivery_window_unavailable');
  assert.match(rejected.message, /não encontramos uma nova janela/i);
  assert.equal(DB.sqlite.prepare('SELECT delivery_start FROM v2_orders WHERE id=?').get(id).delivery_start, day(0));
  assert.equal(mp.posts, 1);
});

test('customer-area API exposes a typed delivery-change response consumed by popup UI', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const original = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Aviso de entrega', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    selection: { productCode: 'interactive_essential', paymentMethod: 'card' },
    ...await terms(DB, 'card'),
  }));
  const token = original.order.publicToken;
  DB.sqlite.prepare('UPDATE v2_orders SET delivery_start = ?, delivery_end = ? WHERE order_code=?')
    .run(day(0), day(2), original.order.code);
  DB.sqlite.prepare("UPDATE v2_checkout_holds SET expires_at='2000-01-01T00:00:00Z' WHERE order_id=(SELECT id FROM v2_orders WHERE order_code=?)")
    .run(original.order.code);
  const res = await worker.fetch(
    new Request(`https://example.com/api/v2/customer-area/${token}/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paymentMethod: 'pix', clientRequestId: crypto.randomUUID() }),
    }),
    e, { waitUntil() {} },
  );
  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.details.code, 'delivery_window_shifted');
  assert.deepEqual(data.details.details.previous, { start: day(0), end: day(2) });
  assert.deepEqual(data.details.details.next, { start: day(1), end: day(3) });
  assert.equal(mp.posts, 1);

  const shell = readFileSync('public/client-v2.html', 'utf8');
  const entry = readFileSync('public/js/client-v2.js', 'utf8');
  const area = readFileSync('public/js/client-v2-area.js', 'utf8');
  assert.ok(shell.includes('/js/client-v2.js?v=20261009-mobile-briefing-3'));
  assert.ok(entry.includes('./client-v2-area.js?v=20261009-mobile-briefing-3'));
  assert.match(area, /delivery_window_shifted/);
  assert.match(area, /confirmNewDeliveryWindow/);
});

test('admin can delete only unpaid pre-production orders and pending provider checkout is canceled', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const body = input({ event: { honoreeName: 'Teste apagar', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) }, ...await terms(DB) });
  const checkout = await startV2Checkout(request, e, body);
  const orderId = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code = ?').get(checkout.order.code).id;
  const providerOrderId = checkout.payment.providerOrderId;

  const deleted = await deleteUnpaidV2Order(e, checkout.order.code);
  assert.equal(deleted.deleted, true);
  assert.equal(mp.orders.get(providerOrderId).status, 'cancelled');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders WHERE id = ?').get(orderId).n, 0);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_checkout_holds WHERE order_id = ?').get(orderId).n, 0);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_checkout_requests WHERE order_id = ?').get(orderId).n, 0);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_customers').get().n, 0);

  const paidBody = input({ clientRequestId: crypto.randomUUID(),
    event: { honoreeName: 'Teste pago', type: 'birthday', date: day(60) },
    deliveryWindow: { start: day(20), end: day(22) }, ...await terms(DB) });
  const paid = await startV2Checkout(request, e, paidBody);
  mp.approve(paid.payment.providerOrderId);
  await syncMercadoPagoOrder(e, paid.payment.providerOrderId);
  await assert.rejects(deleteUnpaidV2Order(e, paid.order.code), /pagamento confirmado/i);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders WHERE order_code = ?').get(paid.order.code).n, 1);
});

test('V2 cancellation keeps the order record, releases capacity and cancels pending checkout', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const body = input({
    event: { honoreeName: 'Cancelamento', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  });
  const checkout = await startV2Checkout(request, e, body);
  const providerOrderId = checkout.payment.providerOrderId;
  const cancelled = await cancelV2Order(e, checkout.order.code, { reason: 'Cliente desistiu' });

  assert.equal(cancelled.cancelled, true);
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_orders WHERE order_code = ?').get(checkout.order.code).status, 'cancelled');
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_checkout_holds WHERE order_id = (SELECT id FROM v2_orders WHERE order_code = ?) ORDER BY id DESC LIMIT 1').get(checkout.order.code).status, 'cancelled');
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_payments WHERE provider_order_id = ?').get(providerOrderId).status, 'cancelled');
  assert.equal(mp.orders.get(providerOrderId).status, 'cancelled');
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_order_history WHERE action_code = 'order_cancelled'").get().n, 1);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders WHERE order_code = ?').get(checkout.order.code).n, 1);
});

test('Admin preview publication and revocation follow the production workflow', async t => {
  const DB = database(); providerMock(t);
  const e = env(DB);
  const body = input({
    event: { honoreeName: 'Prévia', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  });
  const checkout = await startV2Checkout(request, e, body);
  DB.sqlite.prepare("UPDATE v2_orders SET status='in_production', briefing_status='completed' WHERE order_code = ?")
    .run(checkout.order.code);

  const stored = [];
  e.FILES = {
    async put(key) { stored.push(key); },
    async delete() {},
  };

  const form = new FormData();
  form.append('file', new Blob(['preview'], { type: 'image/jpeg' }), 'preview.jpg');
  form.append('watermarkConfirmed', 'true');
  form.append('watermarkLabel', 'PRÉVIA • TESTE');

  const previewRequest = new Request(
    'https://pedidos.libriconvites.com.br/api/admin/v2/orders/' + checkout.order.code + '/previews',
    { method: 'POST', body: form },
  );
  const createdResponse = await createV2Preview(previewRequest, e, checkout.order.code);
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.preview.status, 'active');
  assert.equal(stored.length, 1);
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_orders WHERE order_code = ?').get(checkout.order.code).status, 'waiting_customer');

  const revokedResponse = await revokeV2Preview(e, created.preview.id);
  assert.equal(revokedResponse.status, 200);
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_previews WHERE id = ?').get(created.preview.id).status, 'revoked');
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_orders WHERE order_code = ?').get(checkout.order.code).status, 'in_production');
});

test('production search finds theme and exposes the planned card data', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const body = input({
    event: { honoreeName: 'Aurora', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  });
  const checkout = await startV2Checkout(request, e, body);
  mp.approve(checkout.payment.providerOrderId);
  await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);
  DB.sqlite.prepare("UPDATE v2_orders SET status='ready_for_production', briefing_status='completed' WHERE order_code = ?")
    .run(checkout.order.code);
  DB.sqlite.prepare("UPDATE v2_briefings SET data_json = ? WHERE order_id = (SELECT id FROM v2_orders WHERE order_code = ?)")
    .run(JSON.stringify({ theme_or_style: 'Jardim Encantado' }), checkout.order.code);

  const rows = await listV2Production(DB, { q: 'Jardim Encantado', when: 'new' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].honoreeName, 'Aurora');
  assert.equal(rows[0].theme, 'Jardim Encantado');
  assert.ok(rows[0].productName);
  assert.ok(rows[0].paidCents > 0);
});

test('finance edit date guard explains future dates before contacting the API', () => {
  const admin = readFileSync('public/js/admin-v2-finance.js', 'utf8');
  const backend = readFileSync('src/lib/v2-finance.js', 'utf8');
  assert.match(admin, /export function financeReceiptDateMessage/);
  assert.match(admin, /max="\$\{todaySaoPaulo\(\)\}"/);
  assert.match(admin, /financeReceiptDateMessage\(paidDate\)/);
  assert.match(admin, /A data .* ainda não chegou/);
  assert.match(admin, /Datas futuras não entram como recebimento/);
  assert.match(backend, /Datas futuras não são recebimentos/);
});

test('Pix manually confirmed from WhatsApp unlocks a manual order, but sending the key does not', async t => {
  const DB = database();
  providerMock(t);
  const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Duas parcelas pelo WhatsApp', type: 'birthday', date: day(60) },
    deliveryWindow: { start: day(12), end: day(14) },
    ...await terms(DB),
  }));
  const order = DB.sqlite.prepare(
    'SELECT id,status,briefing_status FROM v2_orders WHERE order_code=?'
  ).get(checkout.order.code);
  assert.equal(order.status, 'awaiting_payment');
  assert.equal(order.briefing_status, 'locked');
  assert.equal((await getV2AdminOrderDetail(DB, checkout.order.code)).payment.paidCents, 0);

  // The same explicit source as an order opened by the WhatsApp admin workflow.
  DB.sqlite.prepare("UPDATE v2_orders SET source='manual_whatsapp' WHERE id=?")
    .run(order.id);
  const deposit = await createV2FinancePayment(DB, {
    orderCode: checkout.order.code,
    amountCents: checkout.payment.amountDueNowCents,
    paidDate: day(-1),
    paymentType: 'deposit',
    note: 'Primeira parcela de Pix recebida fora do sistema',
  });
  assert.ok(deposit.id > 0);
  const first = DB.sqlite.prepare(
    'SELECT status,briefing_status FROM v2_orders WHERE id=?'
  ).get(order.id);
  assert.equal(first.status, 'briefing_pending');
  assert.equal(first.briefing_status, 'available');
  assert.equal(deposit.remainingCents, checkout.payment.totalCents - checkout.payment.amountDueNowCents);
  const detail = await getV2AdminOrderDetail(DB, checkout.order.code);
  assert.equal(detail.payment.remainingBalanceCents, deposit.remainingCents);

  // A future payment request sent on WhatsApp is NOT an approved receipt.
  assert.equal(DB.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM v2_payments WHERE order_id=? AND provider='direct_pix'"
  ).get(order.id).n, 1);

  const balance = await createV2FinancePayment(DB, {
    orderCode: checkout.order.code,
    amountCents: deposit.remainingCents,
    paidDate: day(-1),
    paymentType: 'balance',
    note: 'Segunda parcela confirmada no extrato depois do WhatsApp',
  });
  assert.equal(balance.remainingCents, 0);
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_orders WHERE id=?').get(order.id).status,
    'briefing_pending', 'settling the balance cannot falsely approve or deliver the invitation');
  const paid = await getV2AdminOrderDetail(DB, checkout.order.code);
  assert.equal(paid.payment.remainingBalanceCents, 0);
  await assert.rejects(
    createV2FinancePayment(DB, {
      orderCode: checkout.order.code, amountCents: 1,
      paidDate: day(-1), paymentType: 'balance',
    }),
    /não pode ser maior que o saldo/,
    'repeated confirmation must not add a second receipt',
  );
});

test('existing partial Pix receipts cannot display awaiting first payment in admin', async t => {
  const DB = database();
  providerMock(t);
  const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Status Pix WhatsApp', type: 'birthday', date: day(60) },
    deliveryWindow: { start: day(12), end: day(14) },
    ...await terms(DB),
  }));
  await createV2FinancePayment(DB, {
    orderCode: checkout.order.code, amountCents: 500,
    paidDate: day(-1), paymentType: 'deposit',
    note: 'Pix manual já confirmado no banco',
  });
  const detail = await getV2AdminOrderDetail(DB, checkout.order.code);
  assert.equal(detail.order.status, 'awaiting_payment',
    'provider checkout status is not overwritten by a separate manual entry');
  assert.match(detail.order.statusLabel, /Entrada recebida.*saldo pendente/);
  assert.match(detail.order.nextAction, /saldo Pix.*WhatsApp/);
  const ui=readFileSync('public/js/admin-v2-order.js','utf8');
  assert.match(ui, /Enviar a chave Pix não registra um pagamento/);
});

test('manual duplicated Pix can be annulled with audit while Mercado Pago remains untouched', async t => {
  const DB = database(), mp = providerMock(t), e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Correção financeira', type: 'birthday', date: day(55) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  }));
  mp.approve(checkout.payment.providerOrderId);
  await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);
  const order = DB.sqlite.prepare('SELECT id,order_code FROM v2_orders WHERE order_code=?')
    .get(checkout.order.code);
  const paid = await getV2AdminOrderDetail(DB, order.order_code);
  const remaining = paid.payment.remainingBalanceCents;
  assert.ok(remaining > 0);
  DB.sqlite.prepare("UPDATE v2_orders SET status='balance_pending' WHERE id=?").run(order.id);
  const recorded = await applyV2AdminAction(DB, order.order_code, 'balance_received');
  assert.equal(recorded.status, 'ready_for_delivery');
  const manual = DB.sqlite.prepare(
    "SELECT id,status,amount_cents FROM v2_payments WHERE order_id=? AND provider='direct_pix'"
  ).get(order.id);
  assert.equal(manual.amount_cents, remaining);
  assert.equal((await getV2AdminOrderDetail(DB, order.order_code)).payment.remainingBalanceCents, 0);
  await assert.rejects(
    applyV2AdminAction(DB, order.order_code, 'balance_received'),
    /não está disponível/,
    'repeat balance button must not create another payment',
  );
  assert.equal(DB.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM v2_payments WHERE order_id=? AND provider='direct_pix'"
  ).get(order.id).n, 1);
  await assert.rejects(
    voidV2FinancePayment(DB, manual.id, { reason:'Lançamento em duplicidade', confirmation:'INVALIDO' }),
    /ANULAR/,
  );
  const mpRow = DB.sqlite.prepare(
    "SELECT id,status,amount_cents FROM v2_payments WHERE order_id=? AND provider='mercado_pago'"
  ).get(order.id);
  await assert.rejects(
    voidV2FinancePayment(DB, mpRow.id, { reason:'Lançamento em duplicidade', confirmation:'ANULAR' }),
    /Mercado Pago/,
  );
  const corrected = await voidV2FinancePayment(DB, manual.id, {
    reason: 'Saldo duplicado registrado por engano', confirmation:'ANULAR',
  });
  assert.equal(corrected.voided,true);
  assert.equal(corrected.remainingCents,remaining);
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_payments WHERE id=?').get(manual.id).status, 'cancelled');
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_orders WHERE id=?').get(order.id).status, 'balance_pending');
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_payments WHERE id=?').get(mpRow.id).status, 'approved');
  assert.equal((await getV2AdminOrderDetail(DB, order.order_code)).payment.remainingBalanceCents, remaining);
  assert.equal(DB.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM v2_order_history WHERE order_id=? AND action_code='finance_payment_voided'"
  ).get(order.id).n,1);
  await assert.rejects(
    voidV2FinancePayment(DB, manual.id, { reason:'Já foi anulada anteriormente', confirmation:'ANULAR' }),
    /Somente entradas Pix manuais ativas/,
  );
  assert.equal(DB.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM v2_order_history WHERE order_id=? AND action_code='finance_payment_voided'"
  ).get(order.id).n,1);
});

test('a mistaken manual Pix entry can be annulled even after an order is finalized or cancelled', async t => {
  const DB = database();
  const mp = providerMock(t);
  const e = env(DB);
  for (const finalStatus of ['finalized', 'cancelled']) {
    const checkout = await startV2Checkout(request, e, input({
      event: { honoreeName: 'Correção encerrada ' + finalStatus, type: 'birthday', date: day(55) },
      deliveryWindow: { start: day(10), end: day(12) },
      ...await terms(DB),
    }));
    mp.approve(checkout.payment.providerOrderId);
    await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);
    const order = DB.sqlite.prepare('SELECT id,order_code FROM v2_orders WHERE order_code=?')
      .get(checkout.order.code);
    const previous = await getV2AdminOrderDetail(DB, order.order_code);
    const manual = await createV2FinancePayment(DB, {
      orderCode: order.order_code,
      amountCents: 500,
      paidDate: day(-1),
      paymentType: 'balance',
      note: 'Saldo lançado duas vezes por engano',
    });
    const manualId = Number(manual.id);
    const mpRow = DB.sqlite.prepare(
      "SELECT id,amount_cents,status FROM v2_payments WHERE order_id=? AND provider='mercado_pago'"
    ).get(order.id);
    const before = await getV2AdminOrderDetail(DB, order.order_code);
    assert.equal(before.payment.paidCents, previous.payment.paidCents + 500);
    DB.sqlite.prepare(
      "UPDATE v2_orders SET status=?, next_action='Encerrado', updated_at=datetime('now') WHERE id=?"
    ).run(finalStatus, order.id);

    const correction = await voidV2FinancePayment(DB, manualId, {
      reason: 'Registro manual do saldo duplicado',
      confirmation: 'ANULAR',
    });
    assert.equal(correction.voided, true);
    assert.equal(correction.closedOrderPreserved, true);
    assert.equal(correction.orderStatus, finalStatus);
    assert.equal(
      DB.sqlite.prepare('SELECT status FROM v2_orders WHERE id=?').get(order.id).status,
      finalStatus,
      'financial correction must not undo delivery or cancellation',
    );
    assert.equal(
      DB.sqlite.prepare('SELECT status FROM v2_payments WHERE id=?').get(manualId).status,
      'cancelled',
    );
    assert.deepEqual(
      DB.sqlite.prepare('SELECT id,amount_cents,status FROM v2_payments WHERE id=?').get(mpRow.id),
      mpRow,
      'provider payments must remain intact',
    );
    const updated = await getV2AdminOrderDetail(DB, order.order_code);
    assert.equal(updated.payment.paidCents, previous.payment.paidCents);
    assert.equal(updated.payment.remainingBalanceCents, previous.payment.remainingBalanceCents);
    assert.equal(correction.remainingCents, previous.payment.remainingBalanceCents);
    const audit = DB.sqlite.prepare(
      "SELECT metadata_json FROM v2_order_history WHERE order_id=? AND action_code='finance_payment_voided'"
    ).get(order.id);
    assert.ok(audit);
    const meta = JSON.parse(audit.metadata_json);
    assert.equal(meta.orderStatusAtCorrection, finalStatus);
    assert.equal(meta.closedOrderPreserved, true);
    assert.equal(meta.amountCents, 500);
    await assert.rejects(
      voidV2FinancePayment(DB, manualId, {
        reason:'Tentativa de anulação repetida',
        confirmation:'ANULAR',
      }),
      /Somente entradas Pix manuais ativas/,
    );
    assert.equal(
      DB.sqlite.prepare(
        "SELECT COUNT(*) AS n FROM v2_order_history WHERE order_id=? AND action_code='finance_payment_voided'"
      ).get(order.id).n,
      1,
      'a duplicate click cannot create a second correction',
    );
  }
});

test('admin imports core contract and shows recovery rather than an indefinite white screen', () => {
  const html = readFileSync('public/admin-v2.html', 'utf8');
  const core = readFileSync('public/js/admin-v2-core.js', 'utf8');
  const guard = readFileSync('public/js/admin-v2-boot-watchdog.js', 'utf8');
  assert.ok(html.includes('admin-v2-boot-watchdog.js'));
  assert.ok(guard.includes('adminBootRetry'));
  for (const symbol of [
    'app', 'authGate', 'viewRoot', 'viewTitle', 'viewEyebrow',
    'modalRoot', 'state', 'esc', 'money', 'dateBr', 'dateTimeBr',
  ]) {
    assert.ok(
      core.includes('export const ' + symbol + ' ') ||
      core.includes('export function ' + symbol + '('),
      'Admin core must export: ' + symbol,
    );
  }
});

test('admin order shows one-tap briefing/finalize, folds rarely used buttons and refreshes checklist in place', () => {
  const ui=readFileSync('public/js/admin-v2-order.js','utf8');
  const styles=readFileSync('public/css/admin-v2.css','utf8');
  const finance=readFileSync('public/js/admin-v2-finance.js','utf8');
  const route=readFileSync('src/routes/admin-finance-v2.js','utf8');
  assert.match(ui,/id="toggleOrderBriefing"/);
  assert.match(ui,/id="orderBriefingPanel"/);
  assert.match(ui,/id="orderPreviewDetails"/);
  assert.match(ui,/Outras ações e observações/);
  assert.match(ui,/Ver contratação e pagamentos/);
  assert.match(ui,/\['finalize','balance_received'\]/);
  assert.match(ui,/body.innerHTML = finalizeChecklistHtml\(detail\)/);
  assert.doesNotMatch(ui,/await reopenFinalize\(\)/);
  assert.match(styles,/\.order-briefing-panel/);
  assert.match(finance,/data-void-payment/);
  assert.match(finance,/Anular este lançamento/);
  assert.match(route,/voidV2FinancePayment/);
});

test('finance admin can correct direct Pix but not Mercado Pago reconciliation', async t => {
  const DB = database();
  const mp = providerMock(t);
  const e = env(DB);

  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Finance editável', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  }));

  mp.approve(checkout.payment.providerOrderId);
  await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);

  const orderId = DB.sqlite.prepare(
    'SELECT id FROM v2_orders WHERE order_code=?'
  ).get(checkout.order.code).id;

  DB.sqlite.prepare(`
    INSERT INTO v2_payments(
      order_id, provider, payment_type, method, status,
      amount_cents, fee_cents, net_cents, paid_at
    )
    VALUES (?, 'direct_pix', 'balance', 'pix', 'approved', 1000, 0, 1000, ?)
  `).run(orderId, day(5) + 'T12:00:00.000Z');

  const directPix = DB.sqlite.prepare(
    "SELECT id FROM v2_payments WHERE order_id=? AND provider='direct_pix'"
  ).get(orderId);

  const edited = await updateV2FinancePayment(DB, directPix.id, {
    amountCents: 2500,
    paidDate: day(-1),
    paymentType: 'balance',
  });

  assert.equal(edited.amountCents, 2500);
  assert.equal(
    DB.sqlite.prepare('SELECT amount_cents FROM v2_payments WHERE id=?').get(directPix.id).amount_cents,
    2500,
  );
  assert.equal(
    DB.sqlite.prepare('SELECT net_cents FROM v2_payments WHERE id=?').get(directPix.id).net_cents,
    2500,
  );

  const oldDate = DB.sqlite.prepare('SELECT paid_at FROM v2_payments WHERE id=?')
    .get(directPix.id).paid_at;
  await assert.rejects(
    updateV2FinancePayment(DB, directPix.id, {
      amountCents: 3000,
      paidDate: day(1),
      paymentType: 'balance',
    }),
    /Datas futuras não são recebimentos/,
  );
  assert.equal(DB.sqlite.prepare('SELECT paid_at FROM v2_payments WHERE id=?')
    .get(directPix.id).paid_at, oldDate);
  assert.equal(DB.sqlite.prepare('SELECT amount_cents FROM v2_payments WHERE id=?')
    .get(directPix.id).amount_cents, 2500);

  const mercadoPago = DB.sqlite.prepare(
    "SELECT id FROM v2_payments WHERE order_id=? AND provider='mercado_pago'"
  ).get(orderId);

  await assert.rejects(
    updateV2FinancePayment(DB, mercadoPago.id, {
      amountCents: 1,
      paidDate: day(-1),
      paymentType: 'deposit',
    }),
    /Mercado Pago/,
  );

  assert.equal(
    DB.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM v2_order_history WHERE order_id=? AND action_code='finance_payment_corrected'"
    ).get(orderId).n,
    1,
  );
});

test('finance does not pretend Mercado Pago fees are zero before reconciliation', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Financeiro', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  }));
  mp.approve(checkout.payment.providerOrderId);
  await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);

  const finance = await getV2FinanceDashboard(DB, { preset: 'this_month' });
  assert.equal(finance.summary.mercadoPagoFeesComplete, false);
  assert.equal(finance.summary.mercadoPagoFeePendingCount, 1);
  assert.equal(finance.summary.netCashMovementComplete, false);
  assert.equal(finance.movements[0].feeKnown, false);
  assert.equal(finance.movements[0].netKnown, false);
  assert.equal(finance.movements[0].netCents, null);
});

test('Mercado Pago effective deductions reconcile even when fee_details lists only part of charge', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Taxas MP completas', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    selection: { productCode: 'interactive_essential', paymentMethod: 'card' },
    ...await terms(DB, 'card'),
  }));
  const gross = checkout.payment.amountDueNowCents;
  mp.setFinanceDetails(checkout.payment.providerOrderId, {
    feeCents: 174,
    netCents: gross - 348,
  });
  mp.approve(checkout.payment.providerOrderId);
  const synced = await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);
  assert.equal(synced.financeReconciled, true);
  const original = DB.sqlite.prepare('SELECT id, amount_cents, fee_cents, net_cents FROM v2_payments WHERE provider_order_id=?')
    .get(checkout.payment.providerOrderId);
  assert.equal(original.amount_cents, gross);
  assert.equal(original.fee_cents, 348);
  assert.equal(original.net_cents, gross - 348);
  let finance = await getV2FinanceDashboard(DB, { preset: 'this_month' });
  assert.equal(finance.summary.mercadoPagoFeeCents, 348);
  assert.equal(finance.summary.netCashMovementCents, gross - 348);
  assert.equal(finance.movements[0].feeCents, 348);
  assert.equal(finance.movements[0].netCents, gross - 348);
  assert.equal((await getV2AdminOrderDetail(DB, checkout.order.code)).payment.feeCents, 348);

  // Existing reconciled rows must display correctly without a DB migration.
  DB.sqlite.prepare('UPDATE v2_payments SET fee_cents = 174 WHERE id=?').run(original.id);
  finance = await getV2FinanceDashboard(DB, { preset: 'this_month' });
  assert.equal(finance.summary.mercadoPagoFeeCents, 348);
  assert.equal(finance.movements[0].feeCents, 348);
  assert.equal((await getV2AdminOrderDetail(DB, checkout.order.code)).payment.feeCents, 348);
});

test('customer can specify a music name or link in interactive and cinematic invitations', async t => {
  const DB = database(); providerMock(t); const e = env(DB);
  const interactive = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Música interativa', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  }));
  const id = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code=?').get(interactive.order.code).id;
  let area = await getV2CustomerArea(e, interactive.order.publicToken);
  const fields = () => area.briefing.schema.sections.flatMap(s => s.fields);
  assert.ok(fields().some(x => x.key === 'music_choice'));
  assert.ok(!fields().some(x => x.key === 'music_request'));
  DB.sqlite.prepare('UPDATE v2_briefings SET data_json=? WHERE order_id=?')
    .run(JSON.stringify({ music_choice: 'yes', music_request: 'Canção escolhida - artista ou URL' }), id);
  area = await getV2CustomerArea(e, interactive.order.publicToken);
  const music = fields().find(x => x.key === 'music_request');
  assert.ok(music, 'music input should appear when yes');
  assert.equal(music.required, false, 'optional song allows Libri to choose');
  assert.match(music.label, /Qual música você prefere/);
  assert.equal(area.briefing.data.music_request, 'Canção escolhida - artista ou URL');
  DB.sqlite.prepare('UPDATE v2_briefings SET data_json=? WHERE order_id=?')
    .run(JSON.stringify({ music_choice: 'no' }), id);
  area = await getV2CustomerArea(e, interactive.order.publicToken);
  assert.ok(!fields().some(x => x.key === 'music_request'));

  const video = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Música no vídeo', type: 'birthday', date: day(51) },
    deliveryWindow: { start: day(13), end: day(15) },
    selection: { productCode: 'cinematic_video', scenes: 4, paymentMethod: 'pix' },
    ...await terms(DB),
  }));
  const videoId = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code=?').get(video.order.code).id;
  DB.sqlite.prepare('UPDATE v2_briefings SET data_json=? WHERE order_id=?').run(JSON.stringify({ music_choice: 'yes' }), videoId);
  const videoArea = await getV2CustomerArea(e, video.order.publicToken);
  assert.ok(videoArea.briefing.schema.sections.flatMap(s => s.fields).some(x => x.key === 'music_request'));
});

test('cinematic video offers optional end-of-video gift page with selectable categories, sizes and Pix', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const video = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Presentes no vídeo', type: 'birthday', date: day(65) },
    deliveryWindow: { start: day(10), end: day(12) },
    selection: { productCode: 'cinematic_video', scenes: 4, paymentMethod: 'pix' },
    ...await terms(DB),
  }));
  const id = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code=?').get(video.order.code).id;
  const fields = async () => (await getV2CustomerArea(e, video.order.publicToken))
    .briefing.schema.sections.flatMap(s => s.fields);
  const initial = await fields();
  assert.equal(initial.find(f => f.key === 'gift_page_video')?.required, true);
  assert.match(initial.find(f => f.key === 'gift_page_video')?.label || '', /ao final do vídeo/);
  assert.ok(!initial.some(f => f.key === 'interactive_resources'));
  assert.ok(!initial.some(f => f.key === 'gift_mode'));
  DB.sqlite.prepare('UPDATE v2_briefings SET data_json=? WHERE order_id=?')
    .run(JSON.stringify({ gift_page_video: 'yes' }), id);
  assert.equal((await fields()).find(f => f.key === 'gift_mode')?.required, true);
  DB.sqlite.prepare('UPDATE v2_briefings SET data_json=? WHERE order_id=?')
    .run(JSON.stringify({ gift_page_video: 'yes', gift_mode: 'both',
      gift_categories: ['clothes', 'shoes', 'toys', 'books', 'educational', 'other'],
      gift_clothing_size: '3 anos', gift_shoe_size: '25', gift_other_details: 'Fraldas',
      pix_key_type: 'email', pix_key: 'presentes@example.com', pix_holder: 'Responsável' }), id);
  const enabled = await fields();
  const byKey = key => enabled.find(f => f.key === key);
  assert.equal(byKey('gift_categories')?.type, 'multi_choice');
  assert.equal(byKey('gift_categories')?.required, true);
  assert.deepEqual(byKey('gift_categories').options.map(x => x.label), [
    'Roupinhas', 'Calçados', 'Brinquedos', 'Livros', 'Materiais educativos', 'Outros',
  ]);
  assert.equal(byKey('gift_clothing_size')?.required, true);
  assert.equal(byKey('gift_shoe_size')?.required, true);
  assert.equal(byKey('gift_other_details')?.required, true);
  assert.equal(byKey('pix_key')?.required, true);
  assert.equal(byKey('pix_holder')?.required, true);
  assert.ok(byKey('pix_key_type').options.some(v => v.label === 'Chave aleatória'));
  assert.equal(byKey('gift_suggestions').required, false);

  mp.approve(video.payment.providerOrderId);
  await syncMercadoPagoOrder(e, video.payment.providerOrderId);
  const cleaned = await saveV2Briefing(e, video.order.publicToken, {
    currentSection: 'product',
    data: { gift_mode: 'suggestions', gift_categories: ['toys', 'books'] },
  });
  assert.equal(cleaned.data.gift_mode, 'suggestions');
  assert.deepEqual(cleaned.data.gift_categories, ['toys', 'books']);
  for (const key of ['pix_key', 'pix_key_type', 'pix_holder', 'gift_clothing_size',
    'gift_shoe_size', 'gift_other_details']) assert.equal(cleaned.data[key], undefined);

  const omitted = await saveV2Briefing(e, video.order.publicToken, {
    currentSection: 'product', data: { gift_page_video: 'no' },
  });
  assert.equal(omitted.data.gift_page_video, 'no');
  assert.ok(!omitted.schema.sections.flatMap(s => s.fields).some(f => f.key === 'gift_mode'));
  for (const key of ['gift_mode', 'gift_categories', 'gift_suggestions', 'pix_key']) {
    assert.equal(omitted.data[key], undefined);
  }
});

test('interactive invitation keeps gifts without video page and accepts legacy written suggestions', async t => {
  const DB = database(); providerMock(t); const e = env(DB);
  const interactive = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Lista antiga', type: 'birthday', date: day(65) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  }));
  const id = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code=?').get(interactive.order.code).id;
  DB.sqlite.prepare('UPDATE v2_briefings SET data_json=? WHERE order_id=?')
    .run(JSON.stringify({ interactive_resources: ['gifts'], gift_mode: 'suggestions',
      gift_suggestions: 'Livros e fraldas, tamanho G' }), id);
  const area = await getV2CustomerArea(e, interactive.order.publicToken);
  const fields = area.briefing.schema.sections.flatMap(s => s.fields);
  assert.ok(!fields.some(f => f.key === 'gift_page_video'));
  assert.equal(fields.find(f => f.key === 'gift_categories')?.required, false,
    'existing written gift lists must remain valid');
  assert.equal(area.briefing.data.gift_suggestions, 'Livros e fraldas, tamanho G');
  const options = fields.find(f => f.key === 'gift_mode')?.options || [];
  assert.ok(options.some(x => x.value === 'both' && /Pix/.test(x.label)));
});

test('wedding gift lists still support registry link and Pix with no child sizing requirements', async t => {
  const DB = database(); providerMock(t); const e = env(DB);
  const order = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Casal', type: 'wedding', date: day(65) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  }));
  const id = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code=?').get(order.order.code).id;
  DB.sqlite.prepare('UPDATE v2_briefings SET data_json=? WHERE order_id=?')
    .run(JSON.stringify({ interactive_resources: ['gifts'], gift_mode: 'registry' }), id);
  const fields = (await getV2CustomerArea(e, order.order.publicToken))
    .briefing.schema.sections.flatMap(s => s.fields);
  assert.equal(fields.find(f => f.key === 'gift_registry_url')?.required, true);
  assert.ok(!fields.some(f => f.key === 'gift_categories'));
  assert.ok(!fields.some(f => f.key === 'gift_clothing_size'));
  assert.ok(fields.find(f => f.key === 'gift_mode').options.some(x => x.value === 'both'));
});

test('gift Pix is checked for format and exact recipient and confirmation is reset on edits', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Presente Pix protegido', type: 'birthday', date: day(65) },
    deliveryWindow: { start: day(10), end: day(12) }, ...await terms(DB),
  }));
  mp.approve(checkout.payment.providerOrderId);
  await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);
  const token = checkout.order.publicToken;
  const save = async patch => saveV2Briefing(e, token, { currentSection: 'product', data: patch });
  await save({ interactive_resources: ['gifts'] });
  await save({ gift_mode: 'both' });
  await save({ gift_categories: ['toys'] });
  let state = await save({
    pix_key_type: 'email',
    pix_key: 'presentes@exemplo.com',
    pix_holder: 'Responsável da festa',
  });
  let fields = state.schema.sections.flatMap(section => section.fields);
  let confirmation = fields.find(field => field.key === 'pix_confirmed');
  assert.equal(confirmation.required, true);
  assert.match(confirmation.help, /presentes@exemplo.com/);
  assert.match(confirmation.help, /Responsável da festa/);
  assert.ok(confirmation.options.some(option => option.value === 'yes'));
  const incomplete = await submitV2Briefing(e, token).catch(error => error);
  assert.equal(incomplete.code, 'briefing_incomplete');
  assert.ok(incomplete.details.fields.some(item => item.key === 'pix_confirmed'));

  state = await save({ pix_confirmed: 'yes' });
  assert.equal(state.data.pix_confirmed, 'yes');
  state = await save({ pix_key: 'outra@exemplo.com' });
  assert.equal(state.data.pix_confirmed, undefined, 'changing Pix must cancel previous confirmation');
  await save({ pix_key_type: 'cpf', pix_key: '00000000000' });
  const invalid = await submitV2Briefing(e, token).catch(error => error);
  assert.ok(invalid.details.fields.some(item => item.key === 'pix_key' && /formato/.test(item.message)));

  await save({ pix_key: '529.982.247-25' });
  const cpfOk = await submitV2Briefing(e, token).catch(error => error);
  assert.ok(!cpfOk.details.fields.some(item => item.key === 'pix_key'), 'valid CPF check digits pass');

  state = await save({ gift_mode: 'suggestions' });
  for (const key of ['pix_key', 'pix_key_type', 'pix_holder', 'pix_confirmed']) {
    assert.equal(state.data[key], undefined);
  }
});

test('video gift page has required Pix recipient confirmation just like interactive orders', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const order = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Página extra', type: 'birthday', date: day(65) },
    deliveryWindow: { start: day(10), end: day(12) },
    selection: { productCode: 'cinematic_video', scenes: 4, paymentMethod: 'pix' },
    ...await terms(DB),
  }));
  mp.approve(order.payment.providerOrderId);
  await syncMercadoPagoOrder(e, order.payment.providerOrderId);
  const save = async patch => saveV2Briefing(e, order.order.publicToken,
    { currentSection: 'product', data: patch });
  await save({ gift_page_video: 'yes' });
  await save({ gift_mode: 'pix' });
  const data = await save({ pix_key_type: 'random',
    pix_key: '123e4567-e89b-12d3-a456-426614174000', pix_holder: 'Titular' });
  assert.ok(data.schema.sections.flatMap(s => s.fields).some(f =>
    f.key === 'pix_confirmed' && f.required));
  const result = await save({ gift_page_video: 'no' });
  assert.ok(!result.schema.sections.flatMap(s => s.fields).some(f => f.key === 'pix_confirmed'));
  assert.equal(result.data.pix_confirmed, undefined);
});

test('approved briefing and Admin UX shows inline validation and production at a glance', () => {
  const customer = readFileSync('public/js/client-v2-area.js','utf8');
  const admin = readFileSync('public/js/admin-v2-order.js','utf8');
  const customerCss = readFileSync('public/css/client-v2.css','utf8');
  const adminCss = readFileSync('public/css/admin-v2.css','utf8');
  assert.match(customer, /briefing-field-invalid/);
  assert.match(customer, /scrollIntoView/);
  assert.match(customer, /aria-invalid/);
  assert.match(customer, /id="briefingErrors"/);
  assert.match(customer, /showBriefingMissing\(missing\)/);
  assert.match(admin, /productionQuickBlock\(detail\)/);
  assert.match(admin, /Página extra de presentes após o vídeo/);
  assert.match(admin, /Fotos da pessoa/);
  assert.match(admin, /Referências/);
  assert.match(admin, /Falas/);
  assert.match(admin, /Música/);
  assert.match(customerCss, /\.briefing-field-invalid/);
  assert.match(adminCss, /\.production-quick-grid/);
  assert.ok(readFileSync('public/admin-v2.html', 'utf8').includes(
    'admin-v2.js?v=20261010-finalized-1'));
  assert.ok(readFileSync('public/client-v2.html', 'utf8').includes(
    'client-v2.js?v=20261009-mobile-briefing-3'));
});

test('exported invitation zip includes readable category, size and gift Pix labels', () => {
  const zip = readFileSync('src/lib/v2-order-zip.js', 'utf8');
  assert.match(zip, /gift_page_video: 'Página extra de presentes/);
  assert.match(zip, /gift_categories: 'Tipos de presentes sugeridos'/);
  assert.match(zip, /gift_clothing_size: 'Tamanho das roupinhas'/);
  assert.match(zip, /pix_holder: 'Titular da chave Pix'/);
});

test('approved Mercado Pago payment reconciles real fee and net amount from Payments API', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Taxa real', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  }));

  mp.setFinanceDetails(checkout.payment.providerOrderId, {
    feeCents: 237,
  });
  mp.approve(checkout.payment.providerOrderId);

  const synced = await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);
  assert.equal(synced.financeReconciled, true);

  const payment = DB.sqlite.prepare(
    'SELECT amount_cents, fee_cents, net_cents FROM v2_payments WHERE provider_order_id = ?'
  ).get(checkout.payment.providerOrderId);

  assert.equal(payment.fee_cents, 237);
  assert.equal(payment.net_cents, payment.amount_cents - 237);

  const finance = await getV2FinanceDashboard(DB, { preset: 'this_month' });
  assert.equal(finance.summary.mercadoPagoFeesComplete, true);
  assert.equal(finance.summary.mercadoPagoFeeCents, 237);
  assert.equal(finance.summary.netCashMovementComplete, true);
  assert.equal(finance.movements[0].feeKnown, true);
  assert.equal(finance.movements[0].feeCents, 237);
  assert.equal(finance.movements[0].netKnown, true);
});

test('normal checkout resumes expired payment in same order; stale payment cannot mutate paid order', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const body = input({ event: { honoreeName: 'Teste', type: 'birthday', date: day(50) }, deliveryWindow: { start: day(10), end: day(12) }, ...await terms(DB) });
  const checkout = await startV2Checkout(request, e, body);
  const old = checkout.payment.providerOrderId; mp.orders.get(old).status = 'expired';
  mp.orders.get(old).status_detail = 'expired';
  const resumed = await resumeV2Payment(request, e, checkout.order.publicToken, { clientRequestId: crypto.randomUUID() });
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n, 1); assert.equal(mp.posts, 2);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_order_terms_acceptances').get().n, 1);
  mp.approve(resumed.payment.providerOrderId); await syncMercadoPagoOrder(e, resumed.payment.providerOrderId);
  await syncMercadoPagoOrder(e, old);
  assert.equal(DB.sqlite.prepare('SELECT next_action FROM v2_orders').get().next_action, 'Briefing aguardando preenchimento');
});

test('amount mismatch blocks unlocking; valid signature preserves order ID case and rejects tampering', async t => {
  const DB = database(); const mp = providerMock(t); const result = await urgency(DB);
  await decideV2Urgency(DB, result.order.code, { decision: 'approve', deliveryStart: day(0), deliveryEnd: day(1) });
  const payment = await resumeV2Payment(request, env(DB), result.order.publicToken, await terms(DB));
  mp.approve(payment.payment.providerOrderId); mp.orders.get(payment.payment.providerOrderId).total_amount = '0.01';
  await assert.rejects(syncMercadoPagoOrder(env(DB), payment.payment.providerOrderId), /Valor/);
  assert.equal(DB.sqlite.prepare('SELECT briefing_status FROM v2_orders').get().briefing_status, 'locked');
  const secret = 'test-secret'; const ts = '1742505638683'; const id = 'ORDabc123';
  const signature = createHmac('sha256', secret).update(`id:${id};request-id:req;ts:${ts};`).digest('hex');
  const url = new URL(`https://example.com/webhook?data.id=${id}`);
  const signed = new Request(url, { headers: { 'x-signature': `ts=${ts},v1=${signature}`, 'x-request-id': 'req' } });
  const config = { MERCADO_PAGO_WEBHOOK_SECRET: secret };
  assert.equal(await validateMercadoPagoWebhook(signed, config, url, { data: { id } }), true);
  assert.equal(await validateMercadoPagoWebhook(signed, config, url, { data: { id: 'OTHER' } }), false);
  assert.equal(await validateMercadoPagoWebhook(signed, config, new URL('https://example.com/?data.id=ordabc123'), {}), false);
});

test('card rejection survives 30 minutes, keeps original link and allows changing to Pix', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  mp.rejectNext();
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Retry cartao', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    selection: { productCode: 'interactive_essential', paymentMethod: 'card' },
    ...await terms(DB, 'card'),
  }));
  assert.equal(checkout.payment.ready, false);
  const code = checkout.order.code, token = checkout.order.publicToken;
  DB.sqlite.prepare("UPDATE v2_orders SET created_at = datetime('now', '-40 minutes') WHERE order_code = ?").run(code);
  DB.sqlite.prepare("UPDATE v2_checkout_holds SET expires_at = '2000-01-01T00:00:00.000Z' WHERE order_id = (SELECT id FROM v2_orders WHERE order_code = ?)").run(code);
  const afterCron = await runV2Scheduler(e);
  assert.equal(afterCron.abandonedOrders.archived, 0);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders WHERE order_code = ?').get(code).n, 1);
  const area = await getV2CustomerArea(e, token);
  assert.ok(area); assert.equal(area.order.archived, false);
  assert.equal(area.payment.method, 'card');
  assert.ok(area.payment.deadlineAt);

  const retry = await resumeV2Payment(request, e, token, {
    clientRequestId: crypto.randomUUID(), paymentMethod: 'pix',
  });
  assert.equal(retry.order.code, code);
  assert.equal(retry.payment.method, 'pix');
  assert.equal(retry.payment.balanceCents, retry.payment.totalCents - retry.payment.amountDueNowCents);
  assert.match(retry.payment.checkoutUrl, /^https:\/\//);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n, 1);
  assert.equal(mp.posts, 1);
});

test('after 24h, scheduler archives unpaid orders without deleting customer or purchase history', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  mp.rejectNext();
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Abandonado', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    selection: { productCode: 'interactive_essential', paymentMethod: 'card' },
    ...await terms(DB, 'card'),
  }));
  const code = checkout.order.code, token = checkout.order.publicToken;
  const id = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code = ?').get(code).id;
  const itemCount = DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_order_items WHERE order_id = ?').get(id).n;
  DB.sqlite.prepare("UPDATE v2_orders SET created_at = datetime('now', '-25 hours'), updated_at = datetime('now', '-25 hours') WHERE id = ?").run(id);
  DB.sqlite.prepare("UPDATE v2_checkout_holds SET expires_at = '2000-01-01T00:00:00.000Z' WHERE order_id = ?").run(id);

  const result = await runV2Scheduler(e);
  assert.equal(result.abandonedOrders.archived, 1);
  assert.equal(result.abandonedOrders.deleted, 0);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders WHERE id = ?').get(id).n, 1);
  assert.ok(DB.sqlite.prepare('SELECT archived_at FROM v2_orders WHERE id = ?').get(id).archived_at);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_order_items WHERE order_id = ?').get(id).n, itemCount);
  assert.equal((await getV2CustomerArea(e, token)).order.archived, true);
  const financial = await getV2Central(DB);
  assert.equal(financial.finance.salesCents, 0);
  assert.equal(financial.finance.receivableCents, 0);
  await assert.rejects(resumeV2Payment(request, e, token, { paymentMethod: 'pix' }), /pedido está salvo/);
  assert.equal((await runV2Scheduler(e)).abandonedOrders.archived, 0);
  const archived = await listV2ArchivedOrders(DB, { q: code });
  assert.ok(archived.some(item => item.code === code));
  await applyV2AdminAction(DB, code, 'unarchive');
  const resumed = await resumeV2Payment(request, e, token, { clientRequestId: crypto.randomUUID(), paymentMethod: 'pix' });
  assert.equal(resumed.order.code, code);
  assert.equal(resumed.payment.ready, true);
});

test('unpaid checkout with outstanding provider payment is never archived while remote status is pending', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Pagamento pendente', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) }, ...await terms(DB),
  }));
  const id = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code = ?').get(checkout.order.code).id;
  DB.sqlite.prepare("UPDATE v2_orders SET created_at = datetime('now', '-25 hours') WHERE id = ?").run(id);
  DB.sqlite.prepare("UPDATE v2_checkout_holds SET expires_at = '2000-01-01T00:00:00.000Z' WHERE order_id = ?").run(id);
  const result = await runV2Scheduler(e);
  assert.equal(result.abandonedOrders.archived, 0);
  assert.equal(DB.sqlite.prepare('SELECT archived_at FROM v2_orders WHERE id = ?').get(id).archived_at, null);
  assert.equal(mp.orders.get(checkout.payment.providerOrderId).status, 'created');
});

test('scheduler repairs missing notifications, expires reservations and previews, cleans challenges, deduplicates events', async () => {
  const DB = database(); const result = await urgency(DB); const id = DB.sqlite.prepare('SELECT id FROM v2_orders').get().id;
  DB.sqlite.prepare('DELETE FROM v2_notifications').run();
  DB.sqlite.prepare("INSERT INTO v2_checkout_holds(token, order_id, expires_at) VALUES ('expired', ?, '2000-01-01')").run(id);
  DB.sqlite.prepare("INSERT INTO v2_previews(order_id, version_number, media_type, preview_r2_key, expires_at) VALUES (?, 1, 'image', 'test', '2000-01-01')").run(id);
  await runV2Scheduler(env(DB)); await runV2Scheduler(env(DB));
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_checkout_holds').get().status, 'expired');
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_previews').get().status, 'expired');
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_notifications WHERE event_code = 'URGENCY_REQUESTED'").get().n, 1);
  assert.equal((await getV2CustomerArea(env(DB), result.order.publicToken)).urgency.status, 'pending');
});

test('public catalog uses Álbum da Festa as the Moments commercial label', async () => {
  const DB = database();
  const catalog = await loadV2Catalog(DB);
  const album = catalog.addons.find(item => item.code === 'moments_festa');

  assert.ok(album);
  assert.match(album.name, /^Álbum da Festa/);
  assert.equal(
    DB.sqlite.prepare(
      "SELECT value FROM v2_settings WHERE key='moments_public_label'"
    ).get().value,
    'Álbum da Festa',
  );
});

test('public catalog exposes official combo composition', async () => {
  const DB = database();
  const catalog = await loadV2Catalog(DB);
  assert.equal(catalog.combos.length, 5);
  const complete = catalog.combos.find(item => item.code === 'libri_completo');
  assert.equal(complete.discountValue, 0);
  assert.equal(complete.discountType, 'percent');
  assert.deepEqual(
    complete.items.map(item => item.itemCode).sort(),
    ['confirmation', 'moments', 'reminder', 'save_the_date'],
  );
});

test('official combos are seeded with the approved compositions and configurable zero discount', () => {
  const DB = database();
  const rows = DB.sqlite.prepare(`
    SELECT c.code, c.name, c.discount_value, i.item_type, i.item_code
    FROM v2_combos c
    LEFT JOIN v2_combo_items i ON i.combo_id = c.id
    ORDER BY c.code, i.item_code
  `).all();

  const byCode = rows.reduce((acc, row) => {
    (acc[row.code] ||= []).push(row);
    return acc;
  }, {});
  assert.deepEqual(byCode.convite_save.map(row => row.item_code), ['save_the_date']);
  assert.deepEqual(byCode.antes_festa.map(row => row.item_code), ['reminder', 'save_the_date']);
  assert.deepEqual(byCode.organizacao.map(row => row.item_code), ['confirmation', 'reminder']);
  assert.deepEqual(byCode.festa_completa.map(row => row.item_code), ['confirmation', 'moments']);
  assert.deepEqual(byCode.libri_completo.map(row => row.item_code), ['confirmation', 'moments', 'reminder', 'save_the_date']);
  assert.ok(rows.every(row => row.discount_value === 0));
});

test('combo is suggested only after its real addons are selected and never injects items', async () => {
  const DB = database();

  DB.sqlite.prepare(`
    UPDATE v2_combos
    SET discount_type = 'fixed',
        discount_value = 700
    WHERE code = 'antes_festa'
  `).run();

  const selection = {
    productCode: 'interactive_essential',
    paymentMethod: 'pix',
    addonCodes: [
      'save_animated',
      'reminder_static',
    ],
  };

  const suggested =
    await calculateCommercialV2Quote(
      DB,
      selection,
    );

  assert.equal(suggested.combo, null);
  assert.equal(
    suggested.suggestedCombo.code,
    'antes_festa',
  );
  assert.equal(
    suggested.suggestedCombo.discountCents,
    700,
  );
  assert.deepEqual(
    suggested.addons.map(
      (item) => item.code,
    ).sort(),
    [
      'reminder_static',
      'save_animated',
    ],
  );

  const applied =
    await calculateCommercialV2Quote(
      DB,
      {
        ...selection,
        comboCode:
          'antes_festa',
      },
    );

  assert.equal(
    applied.combo.code,
    'antes_festa',
  );
  assert.equal(
    applied.suggestedCombo,
    null,
  );
  assert.deepEqual(
    applied.addons.map(
      (item) => item.code,
    ).sort(),
    [
      'reminder_static',
      'save_animated',
    ],
  );

  const removed =
    await calculateCommercialV2Quote(
      DB,
      selection,
    );

  assert.deepEqual(
    removed.addons.map(
      (item) => item.code,
    ).sort(),
    [
      'reminder_static',
      'save_animated',
    ],
  );

  const missingRequirement =
    await calculateCommercialV2Quote(
      DB,
      {
        ...selection,
        addonCodes: [
          'save_animated',
        ],
      },
    );

  assert.equal(
    missingRequirement.suggestedCombo,
    null,
  );
});

test('most complete eligible configured combo is the single public suggestion', async () => {
  const DB = database();

  DB.sqlite.exec(`
    UPDATE v2_combos
    SET discount_type = 'fixed',
        discount_value = CASE code
          WHEN 'convite_save' THEN 100
          WHEN 'antes_festa' THEN 200
          WHEN 'organizacao' THEN 200
          WHEN 'festa_completa' THEN 300
          WHEN 'libri_completo' THEN 400
          ELSE 0
        END;
  `);

  const quote =
    await calculateCommercialV2Quote(
      DB,
      {
        productCode:
          'interactive_essential',
        paymentMethod:
          'pix',
        addonCodes: [
          'save_static',
          'reminder_animated',
          'confirmation_libri',
          'moments_premium',
        ],
      },
    );

  assert.equal(
    quote.suggestedCombo.code,
    'libri_completo',
  );

  assert.equal(
    quote.suggestedCombo.discountCents,
    400,
  );
});

test('Production UI exposes completed filter and clears contradictory active-only date presets', () => {
  const production = readFileSync('public/js/admin-v2-production.js', 'utf8');
  const boot = readFileSync('public/js/admin-v2.js', 'utf8');
  assert.match(production, /\['finalized', 'Finalizados'\]/);
  assert.match(production, /status === 'finalized'/);
  assert.match(production, /\['new', 'in_production'\]\.includes\(period\.value\)/);
  assert.match(production, /Os que já foram arquivados continuam na seção Arquivados/);
  assert.match(boot, /admin-v2-production\.js\?v=20261010-finalized-1/);
});

test('Finalizados filter shows completed non-archived orders newest first, without altering records', async t => {
  const DB = database();
  providerMock(t);
  const e = env(DB);
  const make = async (name, status, finalizedAt, archivedAt = null, offset = 0) => {
    const checkout = await startV2Checkout(request, e, input({
      event: { honoreeName: name, type: 'birthday', date: day(65 + offset) },
      deliveryWindow: { start: day(12 + offset), end: day(14 + offset) },
      ...await terms(DB),
    }));
    DB.sqlite.prepare(`
      UPDATE v2_orders
      SET status=?, finalized_at=?, archived_at=?, updated_at=datetime('now')
      WHERE order_code=?
    `).run(status, finalizedAt, archivedAt, checkout.order.code);
    return checkout.order.code;
  };

  const old = await make('Finalizado antigo', 'finalized', '2026-08-08T11:00:00.000Z', null, 0);
  const fresh = await make('Finalizado recente', 'finalized', '2026-10-08T11:00:00.000Z', null, 1);
  const archived = await make('Finalizado arquivado', 'finalized',
    '2026-10-09T11:00:00.000Z', '2026-10-10T11:00:00.000Z', 2);
  const active = await make('Ativo em produção', 'in_production', null, null, 3);
  const before = DB.sqlite.prepare(
    "SELECT id,status,archived_at,finalized_at FROM v2_orders ORDER BY id"
  ).all();

  const defaultList = await listV2Production(DB);
  assert.ok(defaultList.some(x => x.code === active), 'default operational queue remains intact');
  for (const code of [old, fresh, archived]) {
    assert.ok(!defaultList.some(x => x.code === code), 'completed orders must not flood operational queue');
  }

  const completed = await listV2Production(DB, { status: 'finalized' });
  assert.deepEqual(completed.map(x => x.code), [fresh, old],
    'Finalizados must show only unarchived completed orders, latest completion first');
  assert.ok(completed.every(x => x.statusLabel === 'Finalizado'));
  assert.ok(!completed.some(x => x.code === archived || x.code === active));
  assert.deepEqual(
    (await listV2Production(DB, { status: 'finalized', q: 'Finalizado antigo' })).map(x => x.code),
    [old], 'search must still work for completed orders',
  );
  assert.deepEqual(
    (await listV2Production(DB, { status: 'in_production' })).map(x => x.code),
    [active], 'other status filters remain operational',
  );
  assert.equal(
    (await listV2ArchivedOrders(DB)).some(x => x.code === archived),
    true, 'archived finalized orders remain available in Arquivados',
  );
  assert.deepEqual(
    DB.sqlite.prepare("SELECT id,status,archived_at,finalized_at FROM v2_orders ORDER BY id").all(),
    before, 'opening the finalized filter must not update any order or payment',
  );
});

test('archived orders leave operational views without losing financial history', async t => {
  const DB = database();
  const mp = providerMock(t);
  const e = env(DB);

  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Arquivo Teste', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  }));

  mp.approve(checkout.payment.providerOrderId);
  await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);

  const order = DB.sqlite.prepare(
    'SELECT id, order_code FROM v2_orders WHERE order_code=?'
  ).get(checkout.order.code);

  DB.sqlite.prepare(
    "UPDATE v2_orders SET status='finalized', event_date=?, finalized_at=datetime('now') WHERE id=?"
  ).run(day(-1), order.id);

  const paymentsBefore = DB.sqlite.prepare(
    'SELECT COUNT(*) AS n FROM v2_payments WHERE order_id=?'
  ).get(order.id).n;

  const archived = await applyV2AdminAction(DB, order.order_code, 'archive');
  assert.equal(archived.archived, true);

  const row = DB.sqlite.prepare(
    'SELECT archived_at FROM v2_orders WHERE id=?'
  ).get(order.id);
  assert.ok(row.archived_at);

  const archivedList = await listV2ArchivedOrders(DB, { q: 'Arquivo Teste' });
  assert.equal(archivedList.some(item => item.code === order.order_code), true);

  const central = await getV2Central(DB);
  assert.equal(
    central.attention.some(item => item.code === order.order_code),
    false,
  );
  assert.equal(
    central.partiesToday.some(item => item.code === order.order_code),
    false,
  );

  assert.equal(
    DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments WHERE order_id=?').get(order.id).n,
    paymentsBefore,
    'archiving must not delete financial history',
  );

  const restored = await applyV2AdminAction(DB, order.order_code, 'unarchive');
  assert.equal(restored.archived, false);
  assert.equal(
    DB.sqlite.prepare('SELECT archived_at FROM v2_orders WHERE id=?').get(order.id).archived_at,
    null,
  );
});

test('manual finance entries are audited and bounded by real order values', async t => {
  const DB = database();
  const mp = providerMock(t);
  const e = env(DB);

  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Finance Manual', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  }));

  mp.approve(checkout.payment.providerOrderId);
  await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);

  const order = DB.sqlite.prepare(`
    SELECT o.id, o.order_code, pr.total_cents
    FROM v2_orders o
    JOIN v2_order_pricing pr ON pr.order_id=o.id
    WHERE o.order_code=?
  `).get(checkout.order.code);

  const paidBefore = DB.sqlite.prepare(`
    SELECT COALESCE(SUM(CASE WHEN status='approved' AND payment_type!='refund' THEN amount_cents ELSE 0 END),0)
      - COALESCE(SUM(CASE WHEN status='approved' AND payment_type='refund' THEN amount_cents ELSE 0 END),0) AS n
    FROM v2_payments WHERE order_id=?
  `).get(order.id).n;

  const remaining = order.total_cents - paidBefore;
  assert.ok(remaining > 0);

  const added = await createV2FinancePayment(DB, {
    orderCode: order.order_code,
    amountCents: Math.min(500, remaining),
    paidDate: day(-1),
    paymentType: 'balance',
    note: 'Pix recebido fora do sistema',
  });

  assert.ok(added.id > 0);

  const saved = DB.sqlite.prepare(
    'SELECT provider, provider_payload_json FROM v2_payments WHERE id=?'
  ).get(added.id);

  assert.equal(saved.provider, 'direct_pix');
  assert.equal(JSON.parse(saved.provider_payload_json).note, 'Pix recebido fora do sistema');

  assert.equal(
    DB.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM v2_order_history WHERE order_id=? AND action_code='finance_payment_added'"
    ).get(order.id).n,
    1,
  );

  await assert.rejects(
    createV2FinancePayment(DB, {
      orderCode: order.order_code,
      amountCents: order.total_cents + 1,
      paidDate: day(-1),
      paymentType: 'balance',
    }),
    /saldo ainda aberto/,
  );

  await assert.rejects(
    createV2FinancePayment(DB, {
      orderCode: order.order_code,
      amountCents: order.total_cents + 1,
      paidDate: day(-1),
      paymentType: 'refund',
    }),
    /valor líquido já recebido/,
  );

  const dashboard = await getV2FinanceDashboard(DB, {
    preset: 'custom',
    start: day(-2),
    end: day(0),
  });

  assert.equal(
    dashboard.movements.some(
      item => item.id === added.id && item.note === 'Pix recebido fora do sistema'
    ),
    true,
  );
});

test('ZIP export keeps real JPEG PNG TXT and PDF file extensions for ChatGPT and image viewers', async t => {
  const DB = database();
  providerMock(t);
  const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Pacote de mídias', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  }));
  const order = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code=?')
    .get(checkout.order.code);
  const now = new Date().toISOString();
  for (const item of [
    { category: 'person', fieldKey: 'person_photos', name: 'foto original.jpeg',
      mime: 'image/jpeg', key: 'photo-r2', bytes: 'JPEGIMAGE' },
    { category: 'reference', fieldKey: 'reference_files', name: 'referencia.png',
      mime: 'image/png', key: 'reference-r2', bytes: 'PNGIMAGE' },
  ]) {
    DB.sqlite.prepare(`
      INSERT INTO v2_briefing_uploads (
        order_id, category, field_key, original_filename, stored_filename,
        mime_type, size_bytes, r2_key, note, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)
    `).run(order.id, item.category, item.fieldKey, item.name, item.name,
      item.mime, item.bytes.length, item.key, now, now);
  }
  e.FILES = {
    async get(key) {
      const bytes = { 'photo-r2': 'JPEGIMAGE', 'reference-r2': 'PNGIMAGE' }[key];
      assert.ok(bytes, 'only order image keys should be retrieved');
      return { body: new Blob([bytes]).stream() };
    },
  };
  const response = await downloadV2OrderFolder(e, checkout.order.code);
  assert.equal(response.status, 200);
  const raw = new TextDecoder().decode(await response.arrayBuffer());
  assert.match(raw, /DADOS_DO_CONVITE\/dados_do_convite\.txt/);
  assert.match(raw, /DADOS_DO_CONVITE\/resumo_pedido\.txt/);
  assert.match(raw, /FOTOS\/aniversariante_01\.jpeg/);
  assert.match(raw, /REFERENCIAS\/referencia_01\.png/);
  assert.match(raw, /DOCUMENTOS\/termos_aceitos\.txt/);
  assert.match(raw, /JPEGIMAGE/);
  assert.match(raw, /PNGIMAGE/);
  assert.doesNotMatch(raw, /(?:aniversariante_01_jpeg|referencia_01_png|dados_do_convite_txt)/);
  assert.match(response.headers.get('content-type'), /application\/zip/);
});

test('admin sees client photos inline with protected R2 access and human-friendly form answers', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Fotos do pedido', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) }, ...await terms(DB),
  }));
  const order = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code=?').get(checkout.order.code);
  DB.sqlite.prepare('UPDATE v2_briefings SET data_json=? WHERE order_id=?').run(JSON.stringify({
    avoid_colors: 'Vermelho', must_avoid: 'Não usar corações',
    visual_feeling: ['magical', 'delicate'],
    appearance_choice: 'yes',
  }), order.id);
  const now = new Date().toISOString();
  const uploadId = Number(DB.sqlite.prepare(`
    INSERT INTO v2_briefing_uploads (
      order_id, category, field_key, original_filename, stored_filename,
      mime_type, size_bytes, r2_key, note, sort_order, created_at, updated_at
    ) VALUES (?, 'reference', 'reference_files', 'festa.png', 'festa.png',
      'image/png', 3, ?, 'Inspiração aprovada', 0, ?, ?)
  `).run(order.id, 'orders/' + order.id + '/briefing/reference/demo.png', now, now).lastInsertRowid);
  const detail = await getV2AdminOrderDetail(DB, checkout.order.code);
  assert.equal(detail.uploads.uploads.length, 1);
  assert.equal(detail.uploads.uploads[0].id, uploadId);
  assert.equal(detail.uploads.uploads[0].fieldLabel, 'Referências visuais');
  assert.equal(detail.briefing.fields.find(x => x.key === 'avoid_colors').label,
    'Tem alguma cor que você não quer?');
  assert.equal(detail.briefing.fields.find(x => x.key === 'must_avoid').label,
    'Tem algo que você não quer no convite?');
  assert.match(detail.copy.production, /Tem alguma cor que você não quer\?: Vermelho/);
  assert.match(detail.copy.production, /Que sensação você quer para o convite\?: Mágico, Delicado/);

  let getCount = 0;
  e.FILES = { async get(key) {
    assert.equal(key, 'orders/' + order.id + '/briefing/reference/demo.png');
    getCount++;
    return { body: new Blob(['png']).stream() };
  }};
  const path = `/api/admin/v2/orders/${checkout.order.code}/uploads/${uploadId}/content`;
  const { handleAdminV2CoreApi } = await import('../src/routes/admin-v2-core.js');
  const inline = await handleAdminV2CoreApi(
    new Request('https://example.com' + path), e, new URL('https://example.com' + path));
  assert.equal(inline.status, 200);
  assert.equal(inline.headers.get('content-type'), 'image/png');
  assert.match(inline.headers.get('content-disposition'), /^inline;/);
  assert.match(inline.headers.get('cache-control'), /no-store/);
  assert.equal(await inline.text(), 'png');

  const download = await handleAdminV2CoreApi(new Request('https://example.com' + path + '?download=1'),
    e, new URL('https://example.com' + path + '?download=1'));
  assert.match(download.headers.get('content-disposition'), /^attachment;/);
  assert.equal(await download.text(), 'png');
  const mismatch = await handleAdminV2CoreApi(new Request('https://example.com' + path.replace(checkout.order.code, 'LIBRI-99999')),
    e, new URL('https://example.com' + path.replace(checkout.order.code, 'LIBRI-99999')));
  assert.equal(mismatch.status, 404);
  assert.equal(getCount, 2);
  const unauthorized = await worker.fetch(new Request('https://example.com' + path), e, { waitUntil() {} });
  assert.equal(unauthorized.status, 401);
  assert.equal(getCount, 2);
});

test('customer and admin use plain-language labels, photo viewer and fresh mobile assets', () => {
  const admin = readFileSync('public/js/admin-v2-order.js', 'utf8');
  const customer = readFileSync('public/js/client-v2-area.js', 'utf8');
  const shell = readFileSync('public/admin-v2.html', 'utf8');
  const entry = readFileSync('public/js/admin-v2.js', 'utf8');
  const publicShell = readFileSync('public/client-v2.html', 'utf8');
  assert.match(admin, /Fotos e referências recebidas/);
  assert.match(admin, /data-order-photo/);
  assert.match(admin, /orderPhotoViewer/);
  assert.match(admin, /Dados enviados pela cliente/);
  assert.match(admin, /definition\?\.label/);
  assert.match(customer, /Preencher dados/);
  assert.match(customer, /Enviar dados/);
  assert.doesNotMatch(customer, /'Briefing'/);
  assert.ok(shell.includes('admin-v2.js?v=20261010-finalized-1'));
  assert.ok(entry.includes('admin-v2-order.js?v=20261010-balance-wa-1'));
  assert.ok(publicShell.includes('client-v2.js?v=20261009-mobile-briefing-3'));
});

test('approved admin bundle wires music, gallery navigation, fees, order links and contextual WhatsApp', () => {
  const order = readFileSync('public/js/admin-v2-order.js', 'utf8');
  const finance = readFileSync('public/js/admin-v2-finance.js', 'utf8');
  const admin = readFileSync('public/js/admin-v2.js', 'utf8');
  const shell = readFileSync('public/admin-v2.html', 'utf8');
  const css = readFileSync('public/css/admin-v2.css', 'utf8');
  assert.match(order, /musicPreferenceBlock/);
  assert.match(order, /Abrir música/);
  assert.match(order, /rel="noopener noreferrer"/);
  assert.match(order, /orderPhotoPrev/);
  assert.match(order, /orderPhotoNext/);
  assert.match(order, /orderPhotoZoom/);
  assert.match(order, /touchstart/);
  assert.match(order, /ArrowRight/);
  assert.match(finance, /feeBreakdownHtml/);
  assert.match(finance, /finance-fee-details/);
  assert.match(finance, /data-finance-open-order/);
  assert.match(finance, /await openOrderDetail\(orderCode\)/);
  assert.match(admin, /renderFinance\(open\)/);
  assert.match(css, /\.finance-fee-breakdown/);
  assert.match(css, /\.order-photo-viewer-controls/);
  assert.ok(shell.includes('/css/admin-v2.css?v=20261009-admin-quickfinish-1'));
  assert.ok(shell.includes('/js/admin-v2.js?v=20261010-finalized-1'));
  assert.ok(admin.includes("./admin-v2-order.js?v=20261010-balance-wa-1"));
  assert.ok(admin.includes("./admin-v2-finance.js?v=20261010-void-closed-1"));
});

test('finance separates verified Mercado Pago fee components from undisclosed difference, surviving re-sync', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Taxas detalhadas', type: 'birthday', date: day(51) },
    deliveryWindow: { start: day(10), end: day(12) },
    selection: { productCode: 'interactive_essential', paymentMethod: 'card' },
    ...await terms(DB, 'card'),
  }));
  const gross = checkout.payment.amountDueNowCents;
  const orderId = checkout.payment.providerOrderId;
  mp.setFinanceDetails(orderId, { feeCents: 174, netCents: gross - 348 });
  mp.approve(orderId);
  await syncMercadoPagoOrder(e, orderId);
  let finance = await getV2FinanceDashboard(DB, { preset: 'this_month' });
  let movement = finance.movements.find(item => item.orderCode === checkout.order.code);
  assert.equal(movement.feeCents, 348);
  assert.equal(movement.feeBreakdown.parts.length, 1);
  assert.equal(movement.feeBreakdown.parts[0].amountCents, 174);
  assert.equal(movement.feeBreakdown.otherCents, 174);
  await syncMercadoPagoOrder(e, orderId);
  finance = await getV2FinanceDashboard(DB, { preset: 'this_month' });
  movement = finance.movements.find(item => item.orderCode === checkout.order.code);
  assert.equal(movement.feeBreakdown.parts[0].amountCents, 174);
  assert.equal(movement.feeBreakdown.otherCents, 174);

  DB.sqlite.prepare('UPDATE v2_payments SET fee_cents=?, provider_payload_json=? WHERE provider_order_id=?')
    .run(174, '{}', orderId);
  const old = await getV2FinanceDashboard(DB, { preset: 'this_month' });
  const historical = old.movements.find(item => item.orderCode === checkout.order.code);
  assert.equal(historical.feeBreakdown.parts[0].amountCents, 174);
  assert.equal(historical.feeBreakdown.otherCents, 174);
  assert.match(historical.feeBreakdown.note, /histórico/);
});

test('WhatsApp shortcuts match unpaid order and photo requirements, without spamming irrelevant actions', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Fotos necessárias', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) }, ...await terms(DB),
  }));
  let detail = await getV2AdminOrderDetail(DB, checkout.order.code);
  assert.ok(detail.whatsappActions.some(item => item.code === 'payment'));
  assert.ok(!detail.whatsappActions.some(item => item.code === 'briefing'));
  assert.ok(!detail.whatsappActions.some(item => item.code === 'photos'));
  const id = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code=?').get(checkout.order.code).id;
  DB.sqlite.prepare('UPDATE v2_briefings SET data_json=? WHERE order_id=?')
    .run(JSON.stringify({ appearance_choice: 'yes' }), id);
  mp.approve(checkout.payment.providerOrderId);
  await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);
  detail = await getV2AdminOrderDetail(DB, checkout.order.code);
  assert.ok(!detail.whatsappActions.some(item => item.code === 'payment'));
  assert.ok(detail.whatsappActions.some(item => item.code === 'photos'));
  const requestPhotos = detail.whatsappActions.find(item => item.code === 'photos');
  assert.match(requestPhotos.message, /fotos da pessoa/i);
  assert.match(requestPhotos.url, /^https:\/\/wa\.me\//);
  DB.sqlite.prepare('UPDATE v2_briefings SET data_json=? WHERE order_id=?')
    .run(JSON.stringify({ appearance_choice: 'no' }), id);
  detail = await getV2AdminOrderDetail(DB, checkout.order.code);
  assert.ok(!detail.whatsappActions.some(item => item.code === 'photos'));
});


test('monthly R$2000 goal and seven-day workload are computed from confirmed receipts', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  let central = await getV2Central(DB);
  assert.equal(central.finance.monthlyGoal.targetCents, 200000);
  assert.equal(central.finance.monthlyGoal.realizedCents, 0);
  assert.equal(central.workload.count, 0);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Meta e agenda', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(1), end: day(3) }, ...await terms(DB),
  }));
  central = await getV2Central(DB);
  assert.equal(central.finance.monthlyGoal.realizedCents, 0, 'unpaid does not count');
  assert.equal(central.workload.count, 0, 'awaiting payment is not workload');
  mp.approve(checkout.payment.providerOrderId);
  await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);
  central = await getV2Central(DB);
  assert.equal(central.finance.monthlyGoal.realizedCents, checkout.payment.amountDueNowCents);
  assert.equal(central.workload.count, 1);
  assert.equal(central.workload.orders[0].code, checkout.order.code);
  await updateV2Settings(DB, { monthly_revenue_goal_cents: 100000 });
  central = await getV2Central(DB);
  assert.equal(central.finance.monthlyGoal.targetCents, 100000);
  assert.equal(central.finance.monthlyGoal.remainingCents, 100000 - checkout.payment.amountDueNowCents);
});

test('top products show real receipts and configurable costs without altering prices', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Custo e margem', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) }, ...await terms(DB),
  }));
  mp.approve(checkout.payment.providerOrderId);
  await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);
  await updateV2Settings(DB, { production_costs_json: JSON.stringify({ interactive_essential: 1200 }) });
  const report = await getV2FinanceDashboard(DB, { preset: 'this_month' });
  const product = report.breakdown.byProduct.find(x => x.productCode === 'interactive_essential');
  assert.ok(product);
  assert.equal(product.costConfigured, true);
  assert.equal(product.totalCostCents, 1200);
  assert.equal(product.estimatedMarginCents, product.receivedNetCents - 1200);
  assert.equal(product.averageTicketCents, product.salesCents);
  assert.ok((await getV2StoreConfig(e)).settings.growth.monthlyRevenueGoalCents === 200000);
});

test('private returning-customer lookup and advanced order filters cover archive safely', async t => {
  const DB = database(); providerMock(t); const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    customer: { name: 'Cliente Antiga', whatsapp: '5511988887777', email: 'antiga@example.com' },
    event: { honoreeName: 'Primeiro Evento', type: 'birthday', date: day(60) },
    deliveryWindow: { start: day(10), end: day(12) }, ...await terms(DB),
  }));
  const customerResponse = await worker.fetch(new Request(
    'https://example.com/api/admin/v2/customers/lookup?whatsapp=5511988887777',
  ), e, { waitUntil() {} });
  assert.equal(customerResponse.status, 401, 'public cannot look up contact data');
  const { lookupReturningV2Customer, searchV2AdminOrders } = await import('../src/lib/v2-admin-search.js');
  const found = await lookupReturningV2Customer(DB, '11988887777');
  assert.equal(found.name, 'Cliente Antiga');
  assert.equal(found.previousOrders, 1);
  assert.equal((await searchV2AdminOrders(DB, { q: 'Primeiro Evento' })).length, 1);
  assert.equal((await searchV2AdminOrders(DB, { product: 'interactive_essential' })).length, 1);
  assert.equal((await searchV2AdminOrders(DB, { archived: 'yes' })).length, 0);
  DB.sqlite.prepare("UPDATE v2_orders SET archived_at='2026-01-01T00:00:00Z' WHERE order_code=?")
    .run(checkout.order.code);
  assert.equal((await searchV2AdminOrders(DB, { archived: 'yes' })).length, 1);
  assert.equal((await searchV2AdminOrders(DB, { archived: 'no' })).length, 0);
  await assert.rejects(searchV2AdminOrders(DB, { from: '2026-11-01', to: '2026-01-01' }));
});

test('retention never deletes automatically, requires finalization, manual backup and exact code', async t => {
  const DB = database(); providerMock(t); const e = env(DB);
  const order = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Arquivo seguro', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) }, ...await terms(DB),
  }));
  const { previewV2PhotoRetention, purgeV2FinishedOrderPhotos } =
    await import('../src/lib/v2-admin-storage.js');
  const id = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code=?')
    .get(order.order.code).id;
  const stamp = new Date().toISOString();
  DB.sqlite.prepare(`INSERT INTO v2_briefing_uploads (
    order_id, category, field_key, original_filename, stored_filename, mime_type,
    size_bytes, r2_key, note, sort_order, created_at, updated_at)
    VALUES (?, 'reference', 'reference_files', 'old.png', 'old.png', 'image/png',
     3, ?, '', 0, ?, ?)`).run(id, 'orders/' + id + '/briefing/reference/old.png', stamp, stamp);
  assert.equal((await previewV2PhotoRetention(DB)).enabled, false);
  await updateV2Settings(DB, { upload_retention_days: 30 });
  assert.equal((await previewV2PhotoRetention(DB)).orders.length, 0, 'not finalized yet');
  DB.sqlite.prepare("UPDATE v2_orders SET status='finalized', finalized_at='2025-01-01T00:00:00Z' WHERE id=?")
    .run(id);
  assert.equal((await previewV2PhotoRetention(DB)).orders.length, 1);
  await assert.rejects(purgeV2FinishedOrderPhotos(e, order.order.code, { backupConfirmed: true }));
  const deleted = [];
  e.FILES = { async delete(key) { deleted.push(key); } };
  const out = await purgeV2FinishedOrderPhotos(e, order.order.code, {
    confirmCode: order.order.code, backupConfirmed: true,
  });
  assert.equal(out.removed, 1);
  assert.equal(deleted.length, 1);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_briefing_uploads WHERE order_id=?').get(id).n, 0);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_order_history WHERE order_id=? AND action_code='photos_deleted_manually'").get(id).n, 1);
});

test('client upload and draft scripts guard connection recovery and clear user-facing help', () => {
  const html = readFileSync('public/client-v2.html', 'utf8');
  const entry = readFileSync('public/js/client-v2.js', 'utf8');
  const area = readFileSync('public/js/client-v2-area.js', 'utf8');
  const upload = readFileSync('public/js/client-v2-upload.js', 'utf8');
  const clientCss = readFileSync('public/css/client-v2.css', 'utf8');
  const admin = readFileSync('public/js/admin-v2.js', 'utf8');
  assert.ok(html.includes('/js/client-v2.js?v=20261009-mobile-briefing-3'));
  assert.ok(entry.includes('client-v2-area.js?v=20261009-mobile-briefing-3'));
  assert.ok(admin.includes('admin-v2-central.js?v=20261008-growth-1'));
  assert.ok(admin.includes('admin-v2-manual.js?v=20261008-growth-1'));
  assert.match(area, /uploadCustomerPhoto/);
  assert.match(area, /localStorage\.setItem/);
  assert.match(area, /const seen = new Set/);
  assert.match(area, /HELPFUL_EXAMPLES/);
  assert.match(upload, /xhr\.upload\.onprogress/);
  assert.match(clientCss, /\.photo-upload-progress/);
});

test('admin final checklist blocks incomplete delivery and requires manual final-file confirmation', async t => {
  const DB = database();
  const mp = providerMock(t);
  const e = env(DB);

  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Checklist Final', type: 'birthday', date: day(40) },
    deliveryWindow: { start: day(8), end: day(10) },
    ...await terms(DB),
  }));

  mp.approve(checkout.payment.providerOrderId);
  await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);

  const order = DB.sqlite.prepare(
    'SELECT id, order_code FROM v2_orders WHERE order_code=?'
  ).get(checkout.order.code);

  const incomplete = await getV2AdminOrderDetail(DB, order.order_code);
  assert.equal(incomplete.finalizeChecklist.ready, false);
  assert.equal(
    incomplete.finalizeChecklist.items.find(item => item.code === 'briefing').ok,
    false,
  );
  assert.equal(
    incomplete.finalizeChecklist.items.find(item => item.code === 'preview').ok,
    false,
  );

  const remaining = incomplete.payment.remainingBalanceCents;
  assert.ok(remaining > 0);

  await createV2FinancePayment(DB, {
    orderCode: order.order_code,
    amountCents: remaining,
    paidDate: day(-1),
    paymentType: 'balance',
    note: 'Saldo para teste do checklist',
  });

  DB.sqlite.prepare(`
    UPDATE v2_briefings
    SET completion_percent=100, completed_at=datetime('now'), updated_at=datetime('now')
    WHERE order_id=?
  `).run(order.id);

  const preview = DB.sqlite.prepare(`
    INSERT INTO v2_previews(
      order_id, version_number, media_type, preview_r2_key,
      watermark_label, status, expires_at, created_at
    )
    VALUES (?,1,'image',?,'PRÉVIA','approved',datetime('now','+1 day'),datetime('now'))
  `).run(order.id, `test/checklist-${order.id}.webp`);

  DB.sqlite.prepare(`
    INSERT INTO v2_preview_approvals(preview_id, order_id, approved_at, evidence_json)
    VALUES (?, ?, datetime('now'), '{}')
  `).run(Number(preview.lastInsertRowid), order.id);

  DB.sqlite.prepare(`
    UPDATE v2_orders
    SET briefing_status='completed', status='in_production', updated_at=datetime('now')
    WHERE id=?
  `).run(order.id);

  const ready = await getV2AdminOrderDetail(DB, order.order_code);
  assert.equal(ready.finalizeChecklist.ready, true);
  assert.equal(ready.finalizeChecklist.items.every(item => item.ok), true);
  assert.ok(ready.allowedActions.includes('finalize'), 'fully verified orders can finish without moving through intermediate statuses');

  await assert.rejects(
    applyV2AdminAction(DB, order.order_code, 'finalize'),
    /arquivo ou link final/i,
  );

  const finalized = await applyV2AdminAction(
    DB,
    order.order_code,
    'finalize',
    { finalDeliveryConfirmed: true },
  );

  assert.equal(finalized.status, 'finalized');
});

test('admin deadline risk reflects proximity and ready-for-delivery state', async t => {
  const DB = database();
  const mp = providerMock(t);
  const e = env(DB);

  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Risco Prazo', type: 'birthday', date: day(30) },
    deliveryWindow: { start: day(8), end: day(10) },
    ...await terms(DB),
  }));

  mp.approve(checkout.payment.providerOrderId);
  await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);

  DB.sqlite.prepare(`
    UPDATE v2_orders
    SET status='in_production', delivery_start=?, delivery_end=?, updated_at=datetime('now')
    WHERE order_code=?
  `).run(day(0), day(2), checkout.order.code);

  let orders = await listV2Production(DB);
  let row = orders.find(item => item.code === checkout.order.code);
  assert.equal(row.risk.level, 'priority');
  assert.match(row.risk.reason, /faixa de entrega está em andamento/i);

  DB.sqlite.prepare(`
    UPDATE v2_orders
    SET status='ready_for_delivery', delivery_start=?, delivery_end=?, updated_at=datetime('now')
    WHERE order_code=?
  `).run(day(0), day(2), checkout.order.code);

  orders = await listV2Production(DB);
  row = orders.find(item => item.code === checkout.order.code);
  assert.equal(row.risk.level, 'low');
  assert.equal(row.risk.label, 'Tranquilo');
});

test('WhatsApp quick-message templates are editable and rendered in admin order details', async t => {
  const DB = database();
  const mp = providerMock(t);
  const e = env(DB);

  await updateV2Settings(DB, {
    whatsapp_template_briefing:
      'Olá {cliente}. Pedido {pedido} de {homenageado}. Continue: {link}',
    whatsapp_template_preview:
      'Prévia de {homenageado}: {link}',
    whatsapp_template_balance:
      'Saldo {saldo} do pedido {pedido}: {link}',
    whatsapp_template_finalized:
      'Finalizado {pedido} para {cliente}: {link}',
  });

  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Template WhatsApp', type: 'birthday', date: day(30) },
    deliveryWindow: { start: day(8), end: day(10) },
    ...await terms(DB),
  }));

  mp.approve(checkout.payment.providerOrderId);
  await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);

  const detail = await getV2AdminOrderDetail(DB, checkout.order.code);
  const briefingAction = detail.whatsappActions.find(item => item.code === 'briefing');

  assert.ok(briefingAction);
  assert.match(briefingAction.message, /Olá Cliente Teste/);
  assert.match(briefingAction.message, new RegExp(checkout.order.code));
  assert.match(briefingAction.message, /Template WhatsApp/);
  assert.match(
    briefingAction.message,
    /https:\/\/pedidos\.libriconvites\.com\.br\/meu-pedido\//,
  );
  assert.match(briefingAction.url, /^https:\/\/wa\.me\//);
});

test('final polish surfaces progressive reasons, safer delivery changes, next steps, quick WhatsApp and isolated simulation', () => {
  const store = readFileSync(
    new URL('../public/js/client-v2-store.js', import.meta.url),
    'utf8',
  );
  const area = readFileSync(
    new URL('../public/js/client-v2-area.js', import.meta.url),
    'utf8',
  );
  const central = readFileSync(
    new URL('../public/js/admin-v2-central.js', import.meta.url),
    'utf8',
  );
  const order = readFileSync(
    new URL('../public/js/admin-v2-order.js', import.meta.url),
    'utf8',
  );
  const finance = readFileSync(
    new URL('../public/js/admin-v2-finance.js', import.meta.url),
    'utf8',
  );
  const admin = readFileSync(
    new URL('../public/js/admin-v2.js', import.meta.url),
    'utf8',
  );
  const adminHtml = readFileSync(
    new URL('../public/admin-v2.html', import.meta.url),
    'utf8',
  );
  const storeSettings = readFileSync(
    new URL('../public/js/admin-v2-store-settings.js', import.meta.url),
    'utf8',
  );
  const production = readFileSync(
    new URL('../public/js/admin-v2-production.js', import.meta.url),
    'utf8',
  );

  assert.match(store, /Por que estou te sugerindo isso/);
  assert.match(store, /comboSavingsForOffer/);
  assert.match(store, /Seu prazo precisa ser ajustado/);
  assert.match(store, /STORE_KEY_SIMULATION/);
  assert.match(store, /Nenhum pedido, cobrança, agenda ou lançamento financeiro será criado/);
  assert.match(store, /Briefing visualizado/);
  assert.match(store, /state\.simulationMode/);

  const simulatedCustomer = store.slice(
    store.indexOf('function renderCustomer('),
    store.indexOf('function renderReview('),
  );
  assert.match(simulatedCustomer, /if \(\s*state\.simulationMode/);
  assert.ok(
    simulatedCustomer.indexOf('state.simulationMode')
      < simulatedCustomer.indexOf("'/api/v2/urgency/request'"),
    'simulation must short-circuit before urgency creates an order',
  );

  const termsBlock = store.slice(
    store.indexOf('function renderTerms('),
    store.indexOf('export async function startStore('),
  );
  assert.ok(
    termsBlock.indexOf('state.simulationMode')
      < termsBlock.indexOf("'/api/v2/checkout/start'"),
    'simulation must stop before checkout creates an order or payment',
  );

  assert.match(area, /Seu próximo passo/);
  assert.match(area, /Preencher dados/);
  assert.match(area, /Abrir prévia/);
  assert.match(area, /Ver saldo/);

  assert.match(central, /Hoje precisa da sua atenção/);
  assert.match(central, /Simular compra/);
  assert.match(central, /attentionReason/);
  assert.match(central, /WhatsApp/);

  assert.match(order, /detail\.whatsappActions/);
  assert.match(order, /Mensagens rápidas/);
  assert.match(order, /Arquivar pedido/);
  assert.match(order, /Restaurar pedido/);

  assert.match(finance, /Adicionar lançamento/);
  assert.match(finance, /Reembolso \/ ajuste negativo/);
  assert.match(finance, /\/api\/admin\/v2\/finance\/payments/);

  assert.match(admin, /renderArchived/);
  assert.match(adminHtml, /data-view="archived"/);

  assert.match(order, /Concluir pedido/);
  assert.match(order, /finalDeliveryConfirmed/);
  assert.match(order, /detail\.whatsappActions/);
  assert.match(order, /risk-badge/);

  assert.match(production, /Prazo:/);
  assert.match(production, /order\.risk/);

  assert.match(storeSettings, /Mensagens rápidas do WhatsApp/);
  assert.match(storeSettings, /whatsappBriefingTemplate/);
  assert.match(storeSettings, /whatsappPreviewTemplate/);
  assert.match(storeSettings, /whatsappBalanceTemplate/);
  assert.match(storeSettings, /whatsappFinalizedTemplate/);
  assert.match(storeSettings, /\{cliente\}/);
  assert.match(storeSettings, /\{saldo\}/);
});

test('gallery supports real interactive invitation links instead of forcing video', async () => {
  const DB = database();

  const inserted = DB.sqlite.prepare(`
    INSERT INTO v2_gallery_items(
      product_code,
      event_type,
      theme_label,
      external_url,
      active,
      sort_order,
      created_at,
      updated_at
    )
    VALUES (
      'interactive_essential',
      'birthday',
      'Demo Interativo',
      'https://libriconvites.com.br/demo-antigo',
      1,
      0,
      datetime('now'),
      datetime('now')
    )
  `).run();

  const id = Number(inserted.lastInsertRowid);

  await assert.rejects(
    updateV2GalleryItem(DB, id, {
      externalUrl: 'javascript:alert(1)',
    }),
    /https:\/\//,
  );

  await assert.rejects(
    updateV2GalleryItem(DB, id, {
      externalUrl: 'http://example.com',
    }),
    /https:\/\//,
  );

  const updated = await updateV2GalleryItem(DB, id, {
    externalUrl: 'https://libriconvites.com.br/demo-real',
  });

  assert.equal(
    updated.externalUrl,
    'https://libriconvites.com.br/demo-real',
  );

  const store = readFileSync(
    'public/js/client-v2-store.js',
    'utf8',
  );

  const admin = readFileSync(
    'public/js/admin-v2-store-settings.js',
    'utf8',
  );

  assert.match(store, /Abrir convite interativo/);
  assert.match(store, /gallery-interactive-placeholder/);
  assert.match(store, /item\.externalUrl/);
  assert.match(store, /rel="noopener noreferrer"/);
  assert.match(
    store,
    /items\.length\s*===\s*1[\s\S]*items\[0\]\.externalUrl[\s\S]*window\.open/,
  );

  assert.match(admin, /Link do convite \/ demonstração/);
  assert.match(admin, /abre em nova aba/);
});

test('public store does not expose a fixed combo chooser or auto-add combo items', () => {
  const source =
    readFileSync(
      'public/js/client-v2-store.js',
      'utf8',
    );

  assert.equal(
    source.includes(
      '<strong>Sem combo</strong>',
    ),
    false,
  );

  assert.equal(
    source.includes(
      'ensureComboSelections',
    ),
    false,
  );

  assert.match(
    source,
    /Suas escolhas formam o combo/,
  );

  assert.match(
    source,
    /Não, quero apenas o vídeo/,
  );

  assert.match(
    source,
    /recommendedShortScenes/,
  );

  assert.match(
    source,
    /recommendedCompleteScenes/,
  );

  assert.match(
    source,
    /function approximateVideoDuration\(/,
  );
  assert.match(
    source,
    /4:\s*'30 a 40 segundos'/,
  );
  assert.match(
    source,
    /6:\s*'45 a 60 segundos'/,
  );
  assert.match(
    source,
    /8:\s*'1min a 1min20'/,
  );
  assert.match(
    source,
    /Vídeo de aproximadamente/,
  );
  assert.equal(
    source.includes('padrão desta faixa'),
    false,
  );
  assert.match(
    source,
    /function needsConfigurationChoice\(/,
  );
  assert.match(
    source,
    /needsConfigurationChoice\(\s*productFor\(\s*state/,
  );
});

test('commercial quote applies configured urgency and fixed Pix 50% after combo and coupon discounts', async () => {
  const DB = database();
  DB.sqlite.exec(`INSERT INTO v2_combos(code,name,discount_type,discount_value) VALUES ('test','Test','fixed',100);
    INSERT INTO v2_coupons(code,discount_type,discount_value) VALUES ('TEST','percent',10);
    UPDATE v2_settings SET value = '99' WHERE key IN ('urgency_percent','pix_deposit_percent');`);
  const quote = await calculateCommercialV2Quote(DB, { productCode: 'interactive_essential', paymentMethod: 'pix', comboCode: 'test', couponCode: 'TEST' }, { urgencyApproved: true });
  assert.equal(quote.subtotalCents, Math.round((quote.productCents - 100) * 0.9));
  assert.equal(quote.urgency.percent, 99);
  assert.equal(quote.urgency.amountCents, Math.round(quote.subtotalCents * 0.99));
  assert.equal(quote.payment.depositPercent, 50);
});

test('Moments +100 fotos is ignored unless a base Moments plan is selected', async () => {
  const DB = database();

  const extraOnly = await calculateCommercialV2Quote(DB, {
    productCode: 'interactive_essential',
    paymentMethod: 'pix',
    addonCodes: ['moments_extra_100'],
  });

  assert.equal(
    extraOnly.addons.some(addon => addon.code === 'moments_extra_100'),
    false,
  );

  const withBase = await calculateCommercialV2Quote(DB, {
    productCode: 'interactive_essential',
    paymentMethod: 'pix',
    addonCodes: ['moments_festa', 'moments_extra_100'],
  });

  assert.equal(withBase.addons.some(addon => addon.code === 'moments_festa'), true);
  assert.equal(withBase.addons.some(addon => addon.code === 'moments_extra_100'), true);
});

test('normal delivery offers 3-day commercial windows while agenda uses only needed production days', async () => {
  const DB = database();

  for (let offset = 1; offset <= 35; offset += 1) {
    await setV2AgendaDay(DB, day(offset), {
      sellableCapacityUnits: 400,
      internalBufferUnits: 100,
      blocked: offset === 22,
    });
  }

  const delivery = await findV2DeliveryOptions(DB, {
    eventDate: day(60),
    pointsUnits: 100,
    limit: 6,
  });

  assert.ok(delivery.options.length > 0);

  for (const option of delivery.options) {
    const start = new Date(option.start + 'T12:00:00Z');
    const end = new Date(option.end + 'T12:00:00Z');
    assert.equal(Math.round((end - start) / 86400000) + 1, 3);
  }

  const first = delivery.options[0];

  await assert.doesNotReject(validateV2DeliveryWindow(DB, {
    eventDate: day(60),
    start: first.start,
    end: first.end,
  }));

  const plan = await planV2AllocationForWindow(DB, {
    start: first.start,
    end: first.end,
    pointsUnits: 100,
  });

  assert.equal(plan.fits, true);
  assert.equal(plan.allocation.length, 1);

  await assert.rejects(
    validateV2DeliveryWindow(DB, {
      eventDate: day(60),
      start: day(10),
      end: day(11),
    }),
    /3 dias/,
  );
});

test('agenda shows the full 3-day delivery window and keeps today parties after delivery is finalized', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const eventDate = day(40);
  const deliveryStart = day(5);
  const deliveryMiddle = day(6);
  const deliveryEnd = day(7);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Festa Calendário', type: 'birthday', date: eventDate },
    deliveryWindow: { start: deliveryStart, end: deliveryEnd },
    ...await terms(DB),
  }));
  mp.approve(checkout.payment.providerOrderId);
  await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);

  const deliveryAgenda = await getV2AgendaRange(DB, {
    start: deliveryStart,
    end: deliveryEnd,
  });

  for (const visibleDay of [deliveryStart, deliveryMiddle, deliveryEnd]) {
    const dayRow = deliveryAgenda.days.find(item => item.day === visibleDay);
    assert.ok(dayRow);
    assert.equal(
      dayRow.deliveries.some(item => item.code === checkout.order.code),
      true,
      'the promised delivery window must be visible on all three customer-facing days',
    );
  }

  const orderId = DB.sqlite.prepare(
    'SELECT id FROM v2_orders WHERE order_code = ?'
  ).get(checkout.order.code).id;

  DB.sqlite.prepare(
    "UPDATE v2_orders SET status='finalized', finalized_at=datetime('now'), event_date=? WHERE id=?"
  ).run(day(0), orderId);

  const todayAgenda = await getV2AgendaRange(DB, {
    start: day(0),
    end: day(0),
  });

  assert.equal(
    todayAgenda.days[0].events.some(item => item.code === checkout.order.code),
    true,
    'a party happening today must remain visible even when the invitation was already delivered/finalized',
  );

  const finalizedDeliveryAgenda = await getV2AgendaRange(DB, {
    start: deliveryStart,
    end: deliveryEnd,
  });

  assert.equal(
    finalizedDeliveryAgenda.days.some(dayRow =>
      dayRow.deliveries.some(item => item.code === checkout.order.code)
    ),
    false,
    'finalized delivery cards must disappear after delivery is completed',
  );

  DB.sqlite.prepare(
    'UPDATE v2_orders SET event_date=? WHERE id=?'
  ).run(day(-1), orderId);

  const pastAgenda = await getV2AgendaRange(DB, {
    start: day(-1),
    end: day(-1),
  });

  assert.equal(
    pastAgenda.days[0].events.some(item => item.code === checkout.order.code),
    false,
    'old finalized parties must not clutter the visual agenda',
  );
});


test('restored agenda day/period and cascade suggestions run against actual schema', async () => {
  const DB = database();
  const edited = await setV2AgendaDay(DB, day(3), { sellableCapacityUnits: 200, internalBufferUnits: 100 });
  assert.equal(edited.sellableCapacityUnits, 200);
  assert.equal((await getV2AgendaRange(DB, { start: day(3), end: day(4) })).days.length, 2);
  assert.deepEqual(await getV2CascadeSuggestions(DB), { suggestions: [], releaseable: [] });
  const a = await urgency(DB); const b = await requestV2UrgencyReview(request, env(DB), input());
  const rows = DB.sqlite.prepare('SELECT id,order_code FROM v2_orders ORDER BY id').all();
  DB.sqlite.prepare("UPDATE v2_orders SET status='finalized' WHERE id=?").run(rows[0].id);
  DB.sqlite.prepare("UPDATE v2_orders SET status='ready_for_production',briefing_status='completed' WHERE id=?").run(rows[1].id);
  DB.sqlite.prepare("INSERT INTO v2_payments(order_id,provider,payment_type,method,status,amount_cents) VALUES (?,'direct_pix','deposit','pix','approved',1000)").run(rows[1].id);
  for (const [i,d] of [[0,3],[1,5]]) DB.sqlite.prepare('INSERT INTO v2_agenda_allocations(order_id,day,points_units) VALUES (?,?,100)').run(rows[i].id,day(d));
  assert.equal((await getV2CascadeSuggestions(DB)).suggestions.length, 1);
  assert.equal((await anticipateV2Production(DB, { sourceOrderCode: a.order.code, targetOrderCode: b.order.code })).movedUnits, 100);
  const afterAnticipation = await getV2CascadeSuggestions(DB);
  assert.equal(afterAnticipation.suggestions.length, 0);
  assert.equal(afterAnticipation.releaseable.length, 1);
  assert.equal(afterAnticipation.releaseable[0].sourceOrderCode, a.order.code);
  assert.equal((await releaseV2CascadeSurplus(DB, { sourceOrderCode: a.order.code })).releasedUnits, 100);
});

test('normal delivery availability prevents urgency request', async () => {
  const DB = database();
  await assert.rejects(requestV2UrgencyReview(request, env(DB), input({ event: { honoreeName: 'Teste', date: day(50) } })), error => error.code === 'regular_delivery_available');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n, 0);
});

test('explicit provider rejection releases old attempt and retries with a fresh idempotency key', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const body = input({ event: { honoreeName: 'Teste', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) }, ...await terms(DB) });

  mp.rejectNext();

  const first = await startV2Checkout(request, e, body);
  assert.equal(first.payment.ready, false);
  assert.equal(DB.sqlite.prepare("SELECT status FROM v2_checkout_holds ORDER BY id DESC LIMIT 1").get().status, 'cancelled');

  const resumed = await resumeV2Payment(request, e, first.order.publicToken, {
    clientRequestId: crypto.randomUUID(),
  });

  assert.equal(resumed.payment.ready, true);
  assert.equal(mp.keysUsed.length, 2);
  assert.notEqual(mp.keysUsed[0], mp.keysUsed[1]);
  assert.equal(DB.sqlite.prepare("SELECT status FROM v2_checkout_holds ORDER BY id DESC LIMIT 1").get().status, 'active');
});

test('uncertain provider response is recovered with same idempotency key and no duplicate charge', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const a = await urgency(DB);
  await decideV2Urgency(DB, a.order.code, { decision: 'approve', deliveryStart: day(0), deliveryEnd: day(1) });
  const first = await resumeV2Payment(request, e, a.order.publicToken, await terms(DB));
  const order = DB.sqlite.prepare('SELECT id, order_code FROM v2_orders').get();
  await createMercadoPagoCheckout(request, e, { orderId: order.id, orderCode: order.order_code,
    publicToken: a.order.publicToken, paymentMethod: 'pix', amountDueNowCents: first.payment.amountDueNowCents,
    customerEmail: 'test@example.com' });
  assert.equal(mp.posts, 1); assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments').get().n, 1);
  DB.sqlite.prepare('DELETE FROM v2_payments').run();
  const recovered = await resumeV2Payment(request, e, a.order.publicToken, await terms(DB));
  assert.equal(recovered.payment.providerOrderId, first.payment.providerOrderId); assert.equal(mp.posts, 1);
});

test('approved payment rebuilds a missing temporary hold and unlocks briefing when capacity still fits', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Reserva perdida', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  }));

  const orderId = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code = ?').get(checkout.order.code).id;
  DB.sqlite.prepare('DELETE FROM v2_checkout_holds WHERE order_id = ?').run(orderId);

  mp.approve(checkout.payment.providerOrderId);
  const result = await syncMercadoPagoOrder(e, checkout.payment.providerOrderId);

  assert.equal(result.approved, true);
  assert.equal(result.capacityReview, undefined);
  assert.equal(DB.sqlite.prepare('SELECT briefing_status FROM v2_orders WHERE id = ?').get(orderId).briefing_status, 'available');
  assert.ok(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_agenda_allocations WHERE order_id = ?').get(orderId).n > 0);
});

test('scheduler repairs a paid order left locked after the temporary hold disappeared', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const checkout = await startV2Checkout(request, e, input({
    event: { honoreeName: 'Reparo automático', type: 'birthday', date: day(50) },
    deliveryWindow: { start: day(10), end: day(12) },
    ...await terms(DB),
  }));

  const orderId = DB.sqlite.prepare('SELECT id FROM v2_orders WHERE order_code = ?').get(checkout.order.code).id;
  DB.sqlite.prepare('DELETE FROM v2_checkout_holds WHERE order_id = ?').run(orderId);
  mp.approve(checkout.payment.providerOrderId);
  DB.sqlite.prepare("UPDATE v2_payments SET status='approved' WHERE provider_order_id = ?")
    .run(checkout.payment.providerOrderId);

  await runV2Scheduler(e);

  assert.equal(DB.sqlite.prepare('SELECT briefing_status FROM v2_orders WHERE id = ?').get(orderId).briefing_status, 'available');
  assert.ok(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_agenda_allocations WHERE order_id = ?').get(orderId).n > 0);
});

test('late accredited payment does not oversell capacity; repeated review is deduplicated', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB); const a = await urgency(DB);
  await decideV2Urgency(DB, a.order.code, { decision: 'approve', deliveryStart: day(0), deliveryEnd: day(1) });
  const payment = await resumeV2Payment(request, e, a.order.publicToken, await terms(DB));
  DB.sqlite.prepare("UPDATE v2_checkout_holds SET status='expired',expires_at='2000-01-01'").run();
  await setV2AgendaPeriod(DB, { start: day(0), end: day(1), blocked: true });
  mp.approve(payment.payment.providerOrderId);
  const result = await syncMercadoPagoOrder(e, payment.payment.providerOrderId); assert.equal(result.capacityReview, true);
  await syncMercadoPagoOrder(e, payment.payment.providerOrderId);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_agenda_allocations').get().n, 0);
  assert.equal(DB.sqlite.prepare('SELECT briefing_status FROM v2_orders').get().briefing_status, 'locked');
  const reviewArea = await getV2CustomerArea(e, a.order.publicToken);
  assert.equal(reviewArea.payment.capacityReview, true);
  assert.ok(reviewArea.payment.paidCents > 0);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_notifications WHERE dedupe_key LIKE 'payment-capacity:%'").get().n, 1);
});

test('stale cancellation cannot release replacement hold; provider canceled spelling supported', async t => {
  const DB = database(); const mp = providerMock(t); const e = env(DB);
  const a = await urgency(DB); await decideV2Urgency(DB, a.order.code, { decision: 'approve', deliveryStart: day(0), deliveryEnd: day(1) });
  const first = await resumeV2Payment(request, e, a.order.publicToken, await terms(DB));
  mp.orders.get(first.payment.providerOrderId).status = 'canceled'; mp.orders.get(first.payment.providerOrderId).status_detail = 'canceled';
  const next = await resumeV2Payment(request, e, a.order.publicToken, await terms(DB));
  assert.notEqual(first.payment.providerOrderId, next.payment.providerOrderId);
  await syncMercadoPagoOrder(e, first.payment.providerOrderId);
  assert.equal(DB.sqlite.prepare('SELECT status FROM v2_checkout_holds ORDER BY id DESC LIMIT 1').get().status, 'active');
});

test('admin and briefing surfaces expose the remaining Project Bible controls', () => {
  const central =
    readFileSync(
      'public/js/admin-v2-central.js',
      'utf8',
    );

  const production =
    readFileSync(
      'public/js/admin-v2-production.js',
      'utf8',
    );

  const area =
    readFileSync(
      'public/js/client-v2-area.js',
      'utf8',
    );

  const commercial =
    readFileSync(
      'public/js/admin-v2-store-commercial.js',
      'utf8',
    );

  assert.match(
    central,
    /Festas de amanhã/,
  );

  assert.match(
    production,
    /Aprovados/,
  );

  assert.match(
    production,
    /Finalizados/,
  );

  assert.match(
    area,
    /Observação desta referência/,
  );

  assert.match(
    area,
    /controlslist="nodownload noremoteplayback"/,
  );

  assert.match(
    area,
    /Quero falar de um ajuste/,
  );

  assert.match(
    area,
    /Está aprovado ✓/,
  );

  assert.match(
    commercial,
    /Produtos permitidos/,
  );

  assert.match(
    commercial,
    /Eventos permitidos/,
  );

  assert.match(
    commercial,
    /Adicionais permitidos/,
  );
});

test('Worker serves only V2 runtime, redirects legacy pages and retires V1 APIs', async () => {
  const DB = database(); const e = env(DB); delete e.MERCADO_PAGO_ACCESS_TOKEN;
  const served = []; e.ASSETS = { async fetch(r) { served.push(new URL(r.url).pathname); return new Response('shell'); } };
  const ctx = { waitUntil(p) { this.pending = p; } };

  assert.equal((await worker.fetch(new Request('https://example.com/api/v2/catalog'), e, ctx)).status, 200);
  for (const path of ['/api/catalog', '/api/orders', '/api/admin/orders']) {
    assert.equal((await worker.fetch(new Request(`https://example.com${path}`), e, ctx)).status, 410);
  }

  const unauth = await worker.fetch(new Request('https://example.com/api/admin/v2/orders/LIBRI-1001/urgency', { method: 'POST' }), e, ctx);
  assert.equal(unauth.status, 401);

  for (const path of ['/pedido', '/admin-v2', '/meu-pedido/ord_' + 'a'.repeat(36)]) {
    assert.equal((await worker.fetch(new Request(`https://example.com${path}`), e, ctx)).status, 200);
  }

  const root = await worker.fetch(new Request('https://example.com/'), e, ctx);
  const admin = await worker.fetch(new Request('https://example.com/admin'), e, ctx);
  assert.equal(root.status, 308);
  assert.equal(root.headers.get('location'), 'https://example.com/pedido');
  assert.equal(admin.status, 308);
  assert.equal(admin.headers.get('location'), 'https://example.com/admin-v2');
  assert.deepEqual(served, ['/client-v2.html', '/admin-v2.html', '/client-v2.html']);

  await worker.scheduled({}, e, ctx); await ctx.pending;
});


test('store client keeps the approved commercial journey and a single final recommendation', () => {
  const source = readFileSync(
    new URL('../public/js/client-v2-store.js', import.meta.url),
    'utf8',
  );

  assert.equal(
    source.includes('comboOfferHtml('),
    false,
    'combo must not be offered during configuration/addons',
  );
  assert.equal(
    source.includes('recommendedDeliveryDaysBeforeEvent'),
    false,
    'delivery target must not become a commercial Save/Reminder cutoff',
  );

  const configuration = source.slice(
    source.indexOf('function renderConfiguration('),
    source.indexOf('function renderDetails('),
  );
  assert.equal(configuration.includes('name="addon"'), false);
  assert.equal(configuration.includes('couponCode'), false);

  const routerStart = source.indexOf(
    '  const render = () => {',
    source.indexOf('export async function startStore('),
  );
  const routerEnd = source.indexOf(
    '\n\n  render();',
    routerStart,
  );
  const router = source.slice(routerStart, routerEnd);

  const orderedCalls = [
    'renderConfiguration(',
    'renderDetails(',
    'renderDelivery(',
    'renderAddons(',
    'renderRecommendation(',
    'renderCustomer(',
    'renderReview(',
    'renderPayment(',
    'renderTerms(',
  ];

  let lastIndex = -1;
  for (const call of orderedCalls) {
    const index = router.indexOf(call);
    assert.ok(index > lastIndex, `${call} must appear in the approved order`);
    lastIndex = index;
  }

  const addons = source.slice(
    source.indexOf('function renderAddons('),
    source.indexOf('function renderRecommendation('),
  );
  assert.match(addons, /refreshDeliveryForSelection/);

  assert.match(addons, /data-addon-family/);
  assert.match(addons, /activeAddonGroup/);
  assert.match(
    addons,
    /addons\.length\s*===\s*1/,
    'groups with a single visible addon must render directly instead of opening a tab',
  );
  assert.match(addons, /addon-single/);
  assert.match(addons, /addonExplanationHtml/);
  assert.match(source, /Confirmação de presença vinculada ao seu convite/);
  assert.match(source, /Pode ser preparado para Instagram ou para o App Libri/);
  assert.match(source, /Até \${Number\(config\.photoLimit\)} fotos/);

  const addonGrouping = source.slice(
    source.indexOf('function addonGroups('),
    source.indexOf('async function updateQuote('),
  );
  assert.match(addonGrouping, /moments_extra/);
  assert.match(addonGrouping, /!hasMoments/);

  const recommendationLogic = source.slice(
    source.indexOf('function finalRecommendation('),
    source.indexOf('function recommendationTitle('),
  );

  const upgradeLogic = source.slice(
    source.indexOf('function interactiveUpgradeOffer('),
    source.indexOf('function progressiveAddonOffer('),
  );

  assert.match(upgradeLogic, /product_upgrade/);
  assert.match(upgradeLogic, /cinematic_video/);
  assert.match(upgradeLogic, /cinematic_interactive/);
  assert.match(upgradeLogic, /sceneCount/);

  assert.match(recommendationLogic, /cinematic_video/);
  assert.match(recommendationLogic, /groups\.size\s*===\s*0/);
  assert.match(recommendationLogic, /progressiveAddonOffer\(\s*state,\s*'confirmation'/);
  assert.match(recommendationLogic, /progressiveAddonOffer\(\s*state,\s*'moments'/);

  const upgradeIndex = recommendationLogic.indexOf("'cinematic_video'");
  const confirmationIndex = recommendationLogic.indexOf("'confirmation'");
  const momentsIndex = recommendationLogic.indexOf("'moments'");
  const comboCompletionIndex = recommendationLogic.lastIndexOf('configuredCombos.length');

  assert.ok(upgradeIndex >= 0);
  assert.ok(confirmationIndex > upgradeIndex);
  assert.ok(momentsIndex > confirmationIndex);
  assert.ok(
    comboCompletionIndex > momentsIndex,
    'generic combo completion must come after the progressive functional ladder',
  );

  assert.equal(
    /else if\s*\([\s\S]*!groups\.has\([\s\S]*'moments'/.test(
      recommendationLogic,
    ),
    false,
    'Álbum da Festa must not be a generic fallback for every order',
  );

  const recommendation = source.slice(
    source.indexOf('function renderRecommendation('),
    source.indexOf('function renderCustomer('),
  );
  assert.match(recommendation, /promo-sheet/);
  assert.match(recommendation, /Oferta para adicionar agora/);
  assert.match(recommendation, /addonExplanationHtml/);
  assert.match(recommendation, /Na prática, o que seus convidados podem fazer/);

  const addonExplanation = source.slice(
    source.indexOf('function addonExplanation('),
    source.indexOf('function addonFamilySummary('),
  );
  assert.match(addonExplanation, /O que você leva/);
  assert.match(recommendation, /Quero vídeo \+ interativo por/);
  assert.match(recommendation, /replaceState/);

  const recommendationTitle = source.slice(
    source.indexOf('function recommendationTitle('),
    source.indexOf('async function refreshDeliveryForSelection('),
  );
  assert.match(
    recommendationTitle,
    /Quer deixar seu convite interativo/,
  );
  assert.match(recommendation, /Não, quero apenas o vídeo/);
  assert.equal(
    recommendation.includes('name="finalOfferAddon"'),
    false,
    'the final recommendation must be a compact one-click offer, not a second addon selection screen',
  );

  const review = source.slice(
    source.indexOf('function renderReview('),
    source.indexOf('async function renderPayment('),
  );
  assert.equal(review.includes('termsAccepted'), false);
  assert.equal(review.includes('paymentMethod'), false);

  const terms = source.slice(
    source.indexOf('function renderTerms('),
    source.indexOf('export async function startStore('),
  );
  assert.match(terms, /termsAccepted/);
  assert.match(terms, /\/api\/v2\/checkout\/start/);
});


test('briefing client serializes fast choices and validates each step', () => {
  const source = readFileSync(
    new URL('../public/js/client-v2-area.js', import.meta.url),
    'utf8',
  );

  assert.match(source, /let briefingSaveQueue\s*=\s*Promise\.resolve\(\)/);
  assert.match(source, /function enqueueBriefingSave\(/);
  assert.match(source, /async function saveBriefingNow\(/);
  assert.match(source, /function scheduleBriefingSave\(/);
  assert.match(source, /function missingBriefingItems\(/);
  assert.match(source, /Falta preencher nesta etapa/);

  assert.equal(
    source.includes('await autosave('),
    false,
    'choice controls must not await a debounced function that returns before persistence',
  );

  const bindStart = source.indexOf('function bindBriefing()');
  const bindEnd = source.indexOf('function bindPreview()', bindStart);
  const briefingBinding = source.slice(bindStart, bindEnd);

  assert.match(
    briefingBinding,
    /await saveBriefingNow\(\s*sectionId,/,
  );
  assert.match(
    briefingBinding,
    /briefingChoiceRevision/,
  );
  assert.match(
    briefingBinding,
    /missingBriefingItems\(\s*area,/,
  );

  const submitStart = briefingBinding.indexOf("'briefingSubmit'");
  const submitBlock = briefingBinding.slice(submitStart);
  assert.match(
    submitBlock,
    /await saveBriefingNow\(\s*sectionId,\s*\{\}/,
    'pending briefing changes must be flushed before final validation',
  );
});
