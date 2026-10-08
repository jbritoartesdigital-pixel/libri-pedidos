import {
  fail,
  json,
  readJson,
} from '../lib/http.js';

import {
  addV2InternalNote,
  applyV2AdminAction,
  cancelV2Order,
  deleteUnpaidV2Order,
  getV2AdminOrderDetail,
  getV2Central,
  listV2ArchivedOrders,
  listV2Production,
  markV2CongratulationsSent,
  markV2ExternalPreviewApproval,
} from '../lib/v2-admin-core.js';

import { lookupReturningV2Customer, searchV2AdminOrders } from '../lib/v2-admin-search.js';

export async function handleAdminV2CoreApi(
  request,
  env,
  url,
) {
  const method =
    request.method
      .toUpperCase();

  const path =
    url.pathname;

  if (method === 'GET' && path === '/api/admin/v2/customers/lookup') {
    try {
      return json({
        ok: true,
        customer: await lookupReturningV2Customer(env.DB, url.searchParams.get('whatsapp')),
      });
    } catch { return fail('Não foi possível consultar a cliente.', 422); }
  }

  if (method === 'GET' && path === '/api/admin/v2/orders/search') {
    try {
      return json({
        ok: true,
        orders: await searchV2AdminOrders(env.DB, Object.fromEntries(url.searchParams.entries())),
      });
    } catch (error) { return fail(error.message || 'Busca inválida.', 422); }
  }

  if (
    method
    === 'GET'
    && path
    === '/api/admin/v2/central'
  ) {
    return json({
      ok: true,
      central:
        await getV2Central(
          env.DB,
        ),
    });
  }

  if (
    method
    === 'GET'
    && path
    === '/api/admin/v2/archived'
  ) {
    return json({
      ok: true,
      orders:
        await listV2ArchivedOrders(
          env.DB,
          {
            q:
              url.searchParams
                .get(
                  'q',
                )
              || '',
            limit:
              url.searchParams
                .get(
                  'limit',
                )
              || 80,
          },
        ),
    });
  }

  if (
    method
    === 'GET'
    && path
    === '/api/admin/v2/production'
  ) {
    return json({
      ok: true,
      orders:
        await listV2Production(
          env.DB,
          {
            status:
              url.searchParams
                .get(
                  'status',
                )
              || '',
            q:
              url.searchParams
                .get(
                  'q',
                )
              || '',
            when:
              url.searchParams
                .get(
                  'when',
                )
              || '',
          },
        ),
    });
  }

  // Admin-only file preview. The global /api/admin/v2/* auth gate runs
  // before this handler, so customer uploads never become public assets.
  const uploadMatch = path.match(
    /^\/api\/admin\/v2\/orders\/(LIBRI-\d+)\/uploads\/(\d+)\/content$/,
  );
  if (uploadMatch && method === 'GET') {
    if (!env.FILES) return fail('Armazenamento de imagens indisponível.', 503);
    const row = await env.DB.prepare(`
      SELECT u.r2_key, u.mime_type, u.original_filename
      FROM v2_briefing_uploads u
      JOIN v2_orders o ON o.id = u.order_id
      WHERE o.order_code = ? AND u.id = ?
      LIMIT 1
    `).bind(uploadMatch[1], Number(uploadMatch[2])).first();
    if (!row) return fail('Imagem não encontrada neste pedido.', 404);
    const file = await env.FILES.get(row.r2_key);
    if (!file) return fail('Imagem não encontrada no armazenamento.', 404);
    const supportedImages = new Set([
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    ]);
    const isImage = supportedImages.has(row.mime_type);
    const download = url.searchParams.get('download') === '1' || !isImage;
    const safeName = String(row.original_filename || 'imagem')
      .replace(/[\r\n"\\]/g, '_').slice(0, 160);
    return new Response(file.body, {
      headers: {
        'content-type': isImage ? row.mime_type : 'application/octet-stream',
        'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${safeName}"`,
        'cache-control': 'private, no-store, max-age=0',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'same-origin',
      },
    });
  }

  const detailMatch =
    path
      .match(
        /^\/api\/admin\/v2\/orders\/(LIBRI-\d+)$/,
      );

  if (
    detailMatch
    && method
    === 'GET'
  ) {
    const detail =
      await getV2AdminOrderDetail(
        env.DB,
        detailMatch[1],
      );

    if (!detail) {
      return fail(
        'Pedido não encontrado.',
        404,
      );
    }

    return json({
      ok: true,
      detail,
    });
  }

  if (
    detailMatch
    && method
    === 'DELETE'
  ) {
    try {
      const result =
        await deleteUnpaidV2Order(
          env,
          detailMatch[1],
        );

      if (!result) {
        return fail(
          'Pedido não encontrado.',
          404,
        );
      }

      return json({
        ok: true,
        result,
      });
    } catch (
      error
    ) {
      return fail(
        error?.message
        || 'Não foi possível excluir este pedido.',
        409,
      );
    }
  }

  const cancelMatch =
    path
      .match(
        /^\/api\/admin\/v2\/orders\/(LIBRI-\d+)\/cancel$/,
      );

  if (
    cancelMatch
    && method === 'POST'
  ) {
    try {
      const body =
        await readJson(
          request,
        );

      const result =
        await cancelV2Order(
          env,
          cancelMatch[1],
          {
            reason:
              body.reason,
            note:
              body.note,
          },
        );

      if (!result) {
        return fail(
          'Pedido não encontrado.',
          404,
        );
      }

      return json({
        ok: true,
        result,
      });
    } catch (
      error
    ) {
      return fail(
        error?.message
        || 'Não foi possível cancelar este pedido.',
        409,
      );
    }
  }

  const approvalMatch =
    path
      .match(
        /^\/api\/admin\/v2\/orders\/(LIBRI-\d+)\/preview-approval$/,
      );

  if (
    approvalMatch
    && method
    === 'POST'
  ) {
    const body =
      await readJson(
        request,
      );

    try {
      const result =
        await markV2ExternalPreviewApproval(
          env.DB,
          approvalMatch[1],
          {
            channel:
              body.channel
              || 'whatsapp',
            note:
              body.note
              || '',
          },
        );

      if (!result) {
        return fail(
          'Pedido não encontrado.',
          404,
        );
      }

      return json({
        ok:
          true,
        result,
      });
    } catch (
      error
    ) {
      return fail(
        error
          ?.message
        || 'Não foi possível registrar a aprovação.',
        409,
      );
    }
  }

  const actionMatch =
    path
      .match(
        /^\/api\/admin\/v2\/orders\/(LIBRI-\d+)\/action$/,
      );

  if (
    actionMatch
    && method
    === 'POST'
  ) {
    const body =
      await readJson(
        request,
      );

    try {
      const result =
        await applyV2AdminAction(
          env.DB,
          actionMatch[1],
          String(
            body.action
            || '',
          )
            .trim(),
          body,
        );

      if (!result) {
        return fail(
          'Pedido não encontrado.',
          404,
        );
      }

      return json({
        ok: true,
        result,
      });
    } catch (
      error
    ) {
      return fail(
        error
          ?.message
        || 'Não foi possível executar esta ação.',
        409,
      );
    }
  }

  const noteMatch =
    path
      .match(
        /^\/api\/admin\/v2\/orders\/(LIBRI-\d+)\/notes$/,
      );

  if (
    noteMatch
    && method
    === 'POST'
  ) {
    const body =
      await readJson(
        request,
      );

    try {
      const note =
        await addV2InternalNote(
          env.DB,
          noteMatch[1],
          body.note,
        );

      if (!note) {
        return fail(
          'Pedido não encontrado.',
          404,
        );
      }

      return json(
        {
          ok: true,
          note,
        },
        201,
      );
    } catch (
      error
    ) {
      return fail(
        error
          ?.message
        || 'Confira a observação.',
        422,
      );
    }
  }

  const congratulationsMatch =
    path
      .match(
        /^\/api\/admin\/v2\/orders\/(LIBRI-\d+)\/congratulations-sent$/,
      );

  if (
    congratulationsMatch
    && method
    === 'POST'
  ) {
    const result =
      await markV2CongratulationsSent(
        env.DB,
        congratulationsMatch[1],
      );

    if (!result) {
      return fail(
        'Pedido não encontrado.',
        404,
      );
    }

    return json(
      result,
    );
  }

  return null;
}
