// Administrative transcription of WhatsApp briefings. The public order token
// never leaves this authenticated API, and the customer validation stays shared.
import {
  getV2AdminBriefingState, saveV2Briefing, uploadV2BriefingFile,
  updateV2BriefingUpload, submitV2Briefing,
} from './v2-customer-area.js';
import { nowIso } from './http.js';

function blocked(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

async function orderByCode(db, code) {
  if (!/^LIBRI-\d+$/.test(code || '')) return null;
  return db.prepare(`
    SELECT id, public_token FROM v2_orders WHERE order_code = ? LIMIT 1
  `).bind(code).first();
}

async function history(db, id, code, description, metadata) {
  return db.prepare(`
    INSERT INTO v2_order_history(order_id, action_code, description, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, code, description, JSON.stringify({
    source: 'admin_whatsapp', actor: 'authenticated_admin',
    ...metadata,
  }), nowIso()).run();
}

async function checked(env, code) {
  const order = await orderByCode(env.DB, code);
  if (!order) return null;
  const state = await getV2AdminBriefingState(env.DB, order.public_token);
  if (!state) return null;
  return { order, state };
}

function mayEdit(state) {
  if (state.status === 'locked') {
    blocked('O briefing só pode ser preenchido depois da liberação financeira.', 403);
  }
  if (['cancelled', 'finalized'].includes(state.orderStatus)) {
    blocked('Este pedido já foi encerrado e não aceita alterações no briefing.', 409);
  }
}

async function origins(db, orderId) {
  const rows = await db.prepare(`
    SELECT metadata_json, created_at FROM v2_order_history
    WHERE order_id = ? AND action_code = 'admin_briefing_saved'
    ORDER BY id DESC LIMIT 120
  `).bind(orderId).all();
  const result = {};
  for (const row of rows.results || []) {
    let metadata;
    try { metadata = JSON.parse(row.metadata_json || '{}'); } catch { continue; }
    for (const key of Object.keys(metadata.changed || {})) {
      if (!result[key]) result[key] = {
        source: 'admin_whatsapp', updatedAt: row.created_at,
      };
    }
  }
  return result;
}

export async function readAdminBriefing(env, code) {
  const entry = await checked(env, code);
  if (!entry) return null;
  return {
    ...entry.state,
    uploads: entry.state.uploads.map(upload => ({
      ...upload,
      contentPath: `/api/admin/v2/orders/${code}/uploads/${upload.id}/content`,
    })),
    fieldOrigins: await origins(env.DB, entry.order.id),
  };
}

export async function saveAdminBriefing(env, code, body = {}) {
  const entry = await checked(env, code);
  if (!entry) return null;
  mayEdit(entry.state);
  if (body.expectedUpdatedAt !== entry.state.updatedAt) {
    blocked('O briefing mudou desde que foi aberto. Atualize e confira antes de salvar.', 409);
  }
  const data = body.data;
  if (!data || Array.isArray(data) || typeof data !== 'object'
    || Object.keys(data).length > 80) {
    blocked('Envie somente os campos editados do briefing.');
  }
  const valid = new Set(entry.state.schema.sections.flatMap(
    section => section.fields.map(field => field.key),
  ));
  for (const key of Object.keys(data)) {
    if (/(?:^|_)(?:confirmed|approved|accepted|consent|declaration|signature)(?:$|_)/i.test(key)) {
      blocked('Consentimentos e declarações precisam ser confirmados pela própria cliente.');
    }
    if (!valid.has(key)) blocked('Atualize o formulário para preencher este campo.');
  }
  const saved = await saveV2Briefing(env, entry.order.public_token, {
    data,
    currentSection: body.currentSection,
  }, true);
  const changed = {};
  for (const key of new Set([
    ...Object.keys(entry.state.data), ...Object.keys(saved.data),
  ])) {
    const before = entry.state.data[key] ?? null;
    const after = saved.data[key] ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changed[key] = { before, after };
    }
  }
  if (Object.keys(changed).length) {
    await history(env.DB, entry.order.id, 'admin_briefing_saved',
      'Dados do briefing registrados ou corrigidos pela administradora (WhatsApp).',
      { changed, section: saved.currentSection });
  }
  return {
    ...saved,
    changedKeys: Object.keys(changed),
  };
}

export async function uploadAdminBriefing(request, env, code) {
  const entry = await checked(env, code);
  if (!entry) return null;
  mayEdit(entry.state);
  const result = await uploadV2BriefingFile(request, env, entry.order.public_token, true);
  await history(env.DB, entry.order.id, 'admin_briefing_upload',
    'Arquivo recebido pelo WhatsApp anexado pela administradora.',
    { upload: result?.upload && {
      id: result.upload.id, fieldKey: result.upload.fieldKey,
      filename: result.upload.originalFilename, mimeType: result.upload.mimeType,
    } });
  return result;
}

export async function updateAdminBriefingFile(env, code, id, body) {
  const entry = await checked(env, code);
  if (!entry) return null;
  mayEdit(entry.state);
  const previous = entry.state.uploads.find(upload => Number(upload.id) === id);
  if (!previous) return false;
  const result = await updateV2BriefingUpload(env, entry.order.public_token, id, body, true);
  if (result && result.note !== previous.note) {
    await history(env.DB, entry.order.id, 'admin_briefing_upload_note',
      'Observação de arquivo atualizada pela administradora (WhatsApp).',
      { uploadId: id, before: previous.note, after: result.note });
  }
  return result;
}

export async function completeAdminBriefing(env, code) {
  const entry = await checked(env, code);
  if (!entry) return null;
  mayEdit(entry.state);
  if (entry.state.status === 'completed') return {
    alreadyCompleted: true, status: 'completed',
  };
  const result = await submitV2Briefing(env, entry.order.public_token, true);
  return { status: result.status, orderStatus: result.orderStatus,
    alreadyCompleted: result.alreadyCompleted };
}
