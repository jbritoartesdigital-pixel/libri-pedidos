import {
  fail,
  json,
  readJson,
} from '../lib/http.js';

import {
  createV2ManualOrder,
  listV2Orders,
  previewV2ManualOrder,
  reuseV2CustomerFromOrder,
  searchV2Customers,
} from '../lib/v2-orders-manual.js';

function routeError(
  error,
  status = 422,
) {
  return fail(
    error
      ?.message
    || 'Confira os dados do pedido.',
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

      ...(
        error
          ?.details
          ? {
            details:
              error.details,
          }
          : {}
      ),
    },
  );
}

export async function handleAdminOrdersV2Api(
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
    === '/api/admin/v2/orders'
  ) {
    const orders =
      await listV2Orders(
        env.DB,
        {
          q:
            url.searchParams
              .get(
                'q',
              )
            || '',

          status:
            url.searchParams
              .get(
                'status',
              )
            || '',

          source:
            url.searchParams
              .get(
                'source',
              )
            || '',

          paymentMethod:
            url.searchParams
              .get(
                'paymentMethod',
              )
            || '',

          eventDateFrom:
            url.searchParams
              .get(
                'eventDateFrom',
              )
            || '',

          eventDateTo:
            url.searchParams
              .get(
                'eventDateTo',
              )
            || '',

          limit:
            url.searchParams
              .get(
                'limit',
              )
            || 50,

          offset:
            url.searchParams
              .get(
                'offset',
              )
            || 0,
        },
      );

    return json({
      ok:
        true,

      orders,
    });
  }

  if (
    method
    === 'GET'
    && path
    === '/api/admin/v2/customers/search'
  ) {
    return json({
      ok:
        true,

      customers:
        await searchV2Customers(
          env.DB,
          url.searchParams
            .get(
              'q',
            )
          || '',
        ),
    });
  }

  if (
    method
    === 'POST'
    && path
    === '/api/admin/v2/orders/manual/quote'
  ) {
    try {
      const body =
        await readJson(
          request,
        );

      return json({
        ok:
          true,

        result:
          await previewV2ManualOrder(
            env.DB,
            body,
          ),
      });
    } catch (
      error
    ) {
      return routeError(
        error,
      );
    }
  }

  if (
    method
    === 'POST'
    && path
    === '/api/admin/v2/orders/manual'
  ) {
    try {
      const body =
        await readJson(
          request,
        );

      const result =
        await createV2ManualOrder(
          request,
          env,
          body,
        );

      return json(
        {
          ok:
            true,

          result,
        },
        201,
      );
    } catch (
      error
    ) {
      return routeError(
        error,
        error
          ?.code
        === 'manual_window_unavailable'
          ? 409
          : 422,
      );
    }
  }

  const reuseMatch =
    path
      .match(
        /^\/api\/admin\/v2\/orders\/(LIBRI-\d+)\/reuse-customer$/,
      );

  if (
    reuseMatch
    && method
    === 'GET'
  ) {
    const result =
      await reuseV2CustomerFromOrder(
        env.DB,
        reuseMatch[1],
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
  }

  return null;
}
