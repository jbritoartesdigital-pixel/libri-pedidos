import { fail, json, readJson } from '../lib/http.js';
import {
  completeAdminBriefing, readAdminBriefing, saveAdminBriefing,
  uploadAdminBriefing, updateAdminBriefingFile,
} from '../lib/v2-admin-briefing.js';

function errorResponse(error) {
  return fail(error?.message || 'Não foi possível atualizar o briefing.',
    Number(error?.status) || 422, {
      ...(error?.details ? { details: error.details } : {}),
    });
}

// Executed behind the same Passkey authentication gate as the entire Admin V2.
export async function handleAdminBriefingV2Api(request, env, url) {
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const briefing = path.match(/^\/api\/admin\/v2\/orders\/(LIBRI-\d+)\/briefing$/);
  const uploads = path.match(/^\/api\/admin\/v2\/orders\/(LIBRI-\d+)\/briefing\/uploads$/);
  const upload = path.match(/^\/api\/admin\/v2\/orders\/(LIBRI-\d+)\/briefing\/uploads\/(\d+)$/);
  const submit = path.match(/^\/api\/admin\/v2\/orders\/(LIBRI-\d+)\/briefing\/submit$/);
  try {
    let result;
    if (briefing && method === 'GET') {
      result = await readAdminBriefing(env, briefing[1]);
      return result ? json({ ok: true, briefing: result })
        : fail('Pedido não encontrado.', 404);
    }
    if (briefing && method === 'PATCH') {
      result = await saveAdminBriefing(env, briefing[1], await readJson(request));
      return result ? json({ ok: true, result }) : fail('Pedido não encontrado.', 404);
    }
    if (uploads && method === 'POST') {
      result = await uploadAdminBriefing(request, env, uploads[1]);
      return result ? json({ ok: true, result }, 201) : fail('Pedido não encontrado.', 404);
    }
    if (upload && method === 'PATCH') {
      result = await updateAdminBriefingFile(env, upload[1], Number(upload[2]), await readJson(request));
      return result ? json({ ok: true, result }) : fail('Arquivo não encontrado.', 404);
    }
    if (submit && method === 'POST') {
      result = await completeAdminBriefing(env, submit[1]);
      return result ? json({ ok: true, result }) : fail('Pedido não encontrado.', 404);
    }
  } catch (error) {
    return errorResponse(error);
  }
  return null;
}
