import {
  fail,
  json,
  nowIso,
  normalizeWhatsapp,
  parseJson,
  randomToken,
  readJson,
} from '../lib/http.js';
import { calculateQuote } from '../lib/quote.js';
import { catalogFromSettings, loadSettings } from '../lib/settings.js';
import { addHistory } from '../lib/orders.js';

function publicCatalog(catalog) {
  return {
    products: catalog.products,
    addons: catalog.addons,
    rules: catalog.rules,
    examples: catalog.examples,
    contact: {
      libriWhatsapp: catalog.contact.libriWhatsapp,
    },
  };
}

function validateFinalPayload(data) {
  const briefing = data?.briefing || {};
  const required = [
    ['customerName', 'Seu nome'],
    ['whatsapp', 'WhatsApp'],
    ['honoreeName', 'Nome da criança ou homenageado(a)'],
    ['age', 'Idade'],
    ['eventDate', 'Data da festa'],
    ['eventTime', 'Horário'],
    ['venueName', 'Local'],
    ['venueAddress', 'Endereço'],
    ['theme', 'Tema'],
  ];

  const missing = required
    .filter(([key]) => briefing[key] === undefined || briefing[key] === null || String(briefing[key]).trim() === '')
    .map(([, label]) => label);

  if (!['full', 'reduced'].includes(data?.selection?.experience)) missing.push('Experiência');
  if (!['video', 'interactive'].includes(data?.selection?.format)) missing.push('Formato');
  if (data?.termsAccepted !== true) missing.push('Aceite dos termos');
  if (typeof data?.portfolioConsent !== 'boolean') missing.push('Autorização de divulgação');

  return missing;
}

export async function handlePublicApi(request, env, url) {
  const method = request.method.toUpperCase();
  const path = url.pathname;

  if (method === 'GET' && path === '/api/catalog') {
    const settings = await loadSettings(env.DB);
    return json({ ok: true, catalog: publicCatalog(catalogFromSettings(settings)) });
  }

  if (method === 'GET' && path === '/api/terms/current') {
    const terms = await env.DB
      .prepare('SELECT version, body, created_at FROM terms_versions WHERE active = 1 ORDER BY created_at DESC LIMIT 1')
      .first();
    if (!terms) return fail('Termos ainda não configurados.', 503);
    return json({ ok: true, terms });
  }

  if (method === 'POST' && path === '/api/drafts') {
    const token = randomToken('dr_');
    const stamp = nowIso();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB
      .prepare('INSERT INTO drafts(token, step, data_json, created_at, updated_at, expires_at) VALUES (?, 0, ?, ?, ?, ?)')
      .bind(token, '{}', stamp, stamp, expires)
      .run();
    return json({ ok: true, draft: { token, step: 0, data: {} } }, 201);
  }

  const draftMatch = path.match(/^\/api\/drafts\/(dr_[a-f0-9]+)$/);
  if (draftMatch && method === 'GET') {
    const row = await env.DB.prepare('SELECT * FROM drafts WHERE token = ?').bind(draftMatch[1]).first();
    if (!row) return fail('Rascunho não encontrado.', 404);
    return json({
      ok: true,
      draft: {
        token: row.token,
        step: row.step,
        data: parseJson(row.data_json, {}),
        updatedAt: row.updated_at,
      },
    });
  }

  if (draftMatch && method === 'PUT') {
    const body = await readJson(request);
    const row = await env.DB.prepare('SELECT token FROM drafts WHERE token = ?').bind(draftMatch[1]).first();
    if (!row) return fail('Rascunho não encontrado.', 404);
    const step = Math.max(0, Math.min(20, Number.parseInt(body.step, 10) || 0));
    const data = body.data && typeof body.data === 'object' ? body.data : {};
    await env.DB
      .prepare('UPDATE drafts SET step = ?, data_json = ?, updated_at = ? WHERE token = ?')
      .bind(step, JSON.stringify(data), nowIso(), draftMatch[1])
      .run();
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/api/quote') {
    const body = await readJson(request);
    const settings = await loadSettings(env.DB);
    const quote = calculateQuote(body.selection || {}, settings);
    return json({ ok: true, quote });
  }

  if (method === 'POST' && path === '/api/orders') {
    const body = await readJson(request);
    const missing = validateFinalPayload(body);
    if (missing.length) return fail('Confira os campos obrigatórios.', 422, { missing });

    const settings = await loadSettings(env.DB);
    const quote = calculateQuote(body.selection, settings);
    const terms = await env.DB
      .prepare('SELECT version FROM terms_versions WHERE active = 1 ORDER BY created_at DESC LIMIT 1')
      .first();
    if (!terms) return fail('Termos ainda não configurados.', 503);

    const draftToken = typeof body.draftToken === 'string' ? body.draftToken : null;
    if (draftToken) {
      const existingDraft = await env.DB.prepare('SELECT token FROM drafts WHERE token = ?').bind(draftToken).first();
      if (!existingDraft) return fail('O rascunho expirou. Recarregue a página e tente novamente.', 409);
    }

    const b = body.briefing;
    const stamp = nowIso();
    const publicToken = randomToken('ord_');
    const whatsapp = normalizeWhatsapp(b.whatsapp);
    if (whatsapp.length < 12) return fail('Confira o número do WhatsApp.', 422);

    const speechMode = b.speechPreference === 'approve'
      ? 'approve'
      : b.speechPreference === 'own'
        ? 'own'
        : 'libri';
    const speechStatus = speechMode === 'approve' ? 'waiting' : 'not_required';

    const result = await env.DB
      .prepare(
        `INSERT INTO orders(
          public_token, draft_token,
          customer_name, whatsapp, honoree_name, display_name, age,
          event_date, event_time, venue_name, venue_address, location_url, theme,
          experience, format, addons_json, briefing_json, pricing_json,
          subtotal_cents, urgency_enabled, urgency_percent, urgency_amount_cents,
          total_cents, deposit_percent, deposit_cents, balance_cents,
          terms_version, terms_accepted_at, portfolio_consent,
          status, photos_status, entry_status, mascot_status,
          speech_mode, speech_status, invitation_status, balance_status,
          created_at, updated_at, finalized_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?,
          'new', 'waiting', 'waiting', 'waiting', ?, ?, 'waiting', 'waiting', ?, ?, ?
        )`
      )
      .bind(
        publicToken,
        draftToken,
        String(b.customerName).trim(),
        whatsapp,
        String(b.honoreeName).trim(),
        String(b.displayName || b.honoreeName).trim(),
        Number.parseInt(b.age, 10) || 0,
        String(b.eventDate),
        String(b.eventTime),
        String(b.venueName).trim(),
        String(b.venueAddress).trim(),
        String(b.locationUrl || '').trim(),
        String(b.theme).trim(),
        quote.experience,
        quote.format,
        JSON.stringify(body.selection.addons || {}),
        JSON.stringify(b),
        JSON.stringify(quote),
        quote.subtotalCents,
        quote.totalCents,
        quote.depositPercent,
        quote.depositCents,
        quote.balanceCents,
        terms.version,
        stamp,
        body.portfolioConsent ? 1 : 0,
        speechMode,
        speechStatus,
        stamp,
        stamp,
        stamp
      )
      .run();

    const orderId = result.meta.last_row_id;
    const orderCode = `LIBRI-${String(orderId).padStart(4, '0')}`;
    await env.DB.prepare('UPDATE orders SET order_code = ? WHERE id = ?').bind(orderCode, orderId).run();
    await addHistory(env.DB, orderId, 'order_created', 'Pedido finalizado pela cliente');
    await addHistory(env.DB, orderId, 'terms_accepted', `Termos ${terms.version} aceitos`);
    await addHistory(
      env.DB,
      orderId,
      'portfolio_consent',
      body.portfolioConsent ? 'Divulgação autorizada' : 'Divulgação não autorizada'
    );

    if (draftToken) {
      await env.DB.prepare('DELETE FROM drafts WHERE token = ?').bind(draftToken).run();
    }

    return json(
      {
        ok: true,
        order: {
          code: orderCode,
          publicToken,
          totalCents: quote.totalCents,
          depositCents: quote.depositCents,
          balanceCents: quote.balanceCents,
        },
      },
      201
    );
  }

  const finalMatch = path.match(/^\/api\/orders\/(ord_[a-f0-9]+)\/final$/);
  if (finalMatch && method === 'GET') {
    const row = await env.DB
      .prepare(
        `SELECT order_code, customer_name, total_cents, deposit_cents, balance_cents
         FROM orders WHERE public_token = ?`
      )
      .bind(finalMatch[1])
      .first();
    if (!row) return fail('Pedido não encontrado.', 404);
    const settings = catalogFromSettings(await loadSettings(env.DB));
    return json({
      ok: true,
      final: {
        orderCode: row.order_code,
        customerName: row.customer_name,
        totalCents: row.total_cents,
        depositCents: row.deposit_cents,
        balanceCents: row.balance_cents,
        pixKey: settings.contact.pixKey,
        pixRecipientName: settings.contact.pixRecipientName,
        libriWhatsapp: settings.contact.libriWhatsapp,
      },
    });
  }

  return null;
}
