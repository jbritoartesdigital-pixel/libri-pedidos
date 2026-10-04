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

  return null;
}
