import {
  fail,
  json,
  readJson,
} from '../lib/http.js';

import {
  loadV2Catalog,
} from '../lib/v2-catalog.js';

import {
  calculateV2Quote,
} from '../lib/v2-quote.js';

import {
  findV2DeliveryOptions,
} from '../lib/v2-agenda.js';

import {
  startV2Checkout,
  V2CheckoutError,
} from '../lib/v2-checkout.js';

import {
  syncMercadoPagoOrder,
  validateMercadoPagoWebhook,
} from '../lib/v2-mercadopago.js';

async function readActiveV2Terms(
  db,
) {
  return db
    .prepare(
      `
        SELECT
          version,
          body,
          content_hash,
          published_at
        FROM v2_terms_versions
        WHERE active = 1
        ORDER BY published_at DESC
        LIMIT 1
      `,
    )
    .first();
}

function requestError(
  error,
) {
  if (
    error
    instanceof V2CheckoutError
  ) {
    return fail(
      error.message,
      error.status,
      {
        code:
          error.code,

        ...(
          error.details
            ? {
              details:
                error.details,
            }
            : {}
        ),
      },
    );
  }

  return fail(
    String(
      error?.message
      || 'Confira os dados enviados.',
    ),
    422,
  );
}

export async function handlePublicV2Api(
  request,
  env,
  url,
) {
  const method =
    request.method
      .toUpperCase();

  const path =
    url.pathname;

  /* ==================================================
     WEBHOOK MERCADO PAGO
  ================================================== */

  if (
    method === 'POST'
    && path
      === '/api/v2/payments/mercado-pago/webhook'
  ) {
    let body = {};

    try {
      body =
        await request
          .json();
    } catch {
      body = {};
    }

    const valid =
      await validateMercadoPagoWebhook(
        request,
        env,
        url,
        body,
      );

    if (!valid) {
      return fail(
        'Assinatura de webhook inválida.',
        401,
      );
    }

    const providerOrderId =
      String(
        url.searchParams
          .get(
            'data.id',
          )
        || url.searchParams
          .get(
            'data_id',
          )
        || body
          ?.data
          ?.id
        || '',
      )
        .trim();

    if (
      body
        ?.type
      && body.type
        !== 'order'
    ) {
      return json({
        ok: true,
        ignored: true,
      });
    }

    if (!providerOrderId) {
      return fail(
        'Order do Mercado Pago não informada.',
        422,
      );
    }

    /*
     * Não confiamos no status vindo no webhook.
     * Consultamos a Order diretamente no Mercado Pago.
     */
    const result =
      await syncMercadoPagoOrder(
        env,
        providerOrderId,
      );

    return json({
      ok: true,
      result,
    });
  }

  /* ==================================================
     CATÁLOGO V2
  ================================================== */

  if (
    method === 'GET'
    && path
      === '/api/v2/catalog'
  ) {
    const catalog =
      await loadV2Catalog(
        env.DB,
      );

    return json({
      ok: true,
      catalog,
    });
  }

  /* ==================================================
     TERMOS V2
  ================================================== */

  if (
    method === 'GET'
    && path
      === '/api/v2/terms/current'
  ) {
    const terms =
      await readActiveV2Terms(
        env.DB,
      );

    if (!terms) {
      return fail(
        'Termos V2 ainda não configurados.',
        503,
      );
    }

    return json({
      ok: true,
      terms: {
        version:
          terms.version,

        body:
          terms.body,

        contentHash:
          terms.content_hash,

        publishedAt:
          terms.published_at,
      },
    });
  }

  /* ==================================================
     COTAÇÃO V2
  ================================================== */

  if (
    method === 'POST'
    && path
      === '/api/v2/quote'
  ) {
    try {
      const body =
        await readJson(
          request,
        );

      const quote =
        await calculateV2Quote(
          env.DB,
          body.selection
          || {},
        );

      return json({
        ok: true,
        quote,
      });
    } catch (
      error
    ) {
      return requestError(
        error,
      );
    }
  }

  /* ==================================================
     JANELAS DE ENTREGA V2
  ================================================== */

  if (
    method === 'POST'
    && path
      === '/api/v2/delivery-options'
  ) {
    try {
      const body =
        await readJson(
          request,
        );

      const quote =
        await calculateV2Quote(
          env.DB,
          body.selection
          || {},
        );

      const delivery =
        await findV2DeliveryOptions(
          env.DB,
          {
            eventDate:
              body.eventDate,

            pointsUnits:
              quote.pointsUnits,

            limit:
              body.limit
              || 5,
          },
        );

      return json({
        ok: true,

        delivery,

        summary: {
          productCode:
            quote.product
              .code,

          variantCode:
            quote.variant
              .code,

          totalCents:
            quote.totalCents,
        },
      });
    } catch (
      error
    ) {
      return requestError(
        error,
      );
    }
  }

  /* ==================================================
     INICIAR CHECKOUT V2
  ================================================== */

  if (
    method === 'POST'
    && path
      === '/api/v2/checkout/start'
  ) {
    try {
      const body =
        await readJson(
          request,
        );

      const result =
        await startV2Checkout(
          request,
          env,
          body,
        );

      return json(
        result,
        201,
      );
    } catch (
      error
    ) {
      return requestError(
        error,
      );
    }
  }

  return null;
}
