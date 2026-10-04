import {
  fail,
  json,
  readJson,
} from '../lib/http.js';

import {
  getV2ManualOrderForCustomer,
  startV2ManualOrderPayment,
} from '../lib/v2-orders-manual.js';

function routeError(
  error,
  status = 422,
) {
  return fail(
    error
      ?.message
    || 'Não foi possível continuar este pedido.',
    status,
    {
      ...(
        error
          ?.code
          ? {
            code:
              error.code,
          }
          : {}
      ),
    },
  );
}

export async function handlePublicManualOrderV2Api(
  request,
  env,
  url,
) {
  const method =
    request.method
      .toUpperCase();

  const summaryMatch =
    url.pathname
      .match(
        /^\/api\/v2\/manual-order\/(ord_[a-f0-9]{36})$/,
      );

  if (
    summaryMatch
    && method
    === 'GET'
  ) {
    const order =
      await getV2ManualOrderForCustomer(
        env.DB,
        summaryMatch[1],
      );

    if (!order) {
      return fail(
        'Pedido não encontrado.',
        404,
      );
    }

    return json({
      ok:
        true,

      order,
    });
  }

  const payMatch =
    url.pathname
      .match(
        /^\/api\/v2\/manual-order\/(ord_[a-f0-9]{36})\/start-payment$/,
      );

  if (
    payMatch
    && method
    === 'POST'
  ) {
    try {
      const body =
        await readJson(
          request,
        );

      const result =
        await startV2ManualOrderPayment(
          request,
          env,
          payMatch[1],
          body,
        );

      return json({
        ok:
          true,

        result,
      });
    } catch (
      error
    ) {
      return routeError(
        error,
        error
          ?.code
        === 'delivery_window_unavailable'
          ? 409
          : 422,
      );
    }
  }

  return null;
}
