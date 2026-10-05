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
  listV2Production,
  markV2CongratulationsSent,
} from '../lib/v2-admin-core.js';

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
          },
        ),
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
