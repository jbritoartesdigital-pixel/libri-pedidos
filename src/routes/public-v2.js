import {
  fail,
  json,
  readJson,
} from '../lib/http.js';

import {
  loadV2Catalog,
} from '../lib/v2-catalog.js';

import {
  calculateCommercialV2Quote,
} from '../lib/v2-commercial-pricing.js';

import {
  findV2DeliveryOptions,
} from '../lib/v2-agenda.js';

import {
  requestV2UrgencyReview,
  startApprovedV2UrgencyCheckout,
  startV2Checkout,
  V2CheckoutError,
} from '../lib/v2-checkout.js';

import {
  syncMercadoPagoOrder,
  validateMercadoPagoWebhook,
} from '../lib/v2-mercadopago.js';

function cleanPublicGalleryCode(
  value,
) {
  return String(
    value
    || '',
  )
    .trim()
    .slice(
      0,
      120,
    );
}

async function listPublicV2Gallery(
  env,
  url,
) {
  const productCode =
    cleanPublicGalleryCode(
      url.searchParams
        .get(
          'productCode',
        ),
    );

  const eventType =
    cleanPublicGalleryCode(
      url.searchParams
        .get(
          'eventType',
        ),
    );

  const result =
    await env.DB
      .prepare(
        `
          SELECT
            id,
            product_code,
            event_type,
            theme_label,
            preview_r2_key,
            media_r2_key,
            external_url,
            media_type,
            caption
          FROM v2_gallery_items
          WHERE
            active = 1
            AND (
              ? = ''
              OR product_code = ?
            )
            AND (
              ? = ''
              OR event_type IS NULL
              OR event_type = ''
              OR event_type = ?
            )
          ORDER BY
            sort_order,
            id
          LIMIT 60
        `,
      )
      .bind(
        productCode,
        productCode,
        eventType,
        eventType,
      )
      .all();

  return (
    result.results
    || []
  )
    .map(
      (row) => ({
        id:
          row.id,

        productCode:
          row.product_code,

        eventType:
          row.event_type
          || '',

        themeLabel:
          row.theme_label
          || '',

        mediaType:
          row.media_type
          || (
            row.media_r2_key
              ? 'image'
              : 'external'
          ),

        caption:
          row.caption
          || '',

        previewPath:
          row.preview_r2_key
            ? `/api/v2/gallery/${
              row.id
            }/preview`
            : '',

        mediaPath:
          row.media_r2_key
            ? `/api/v2/gallery/${
              row.id
            }/media`
            : '',

        externalUrl:
          row.external_url
          || '',

        url:
          row.external_url
          || '',
      }),
    );
}

async function streamPublicV2Gallery(
  env,
  id,
  kind,
) {
  if (!env.FILES) {
    return fail(
      'Galeria indisponível.',
      503,
    );
  }

  const numericId =
    Number.parseInt(
      id,
      10,
    );

  if (
    !Number.isInteger(
      numericId,
    )
    || numericId <= 0
  ) {
    return fail(
      'Item da galeria não encontrado.',
      404,
    );
  }

  const field =
    kind
    === 'preview'
      ? 'preview_r2_key'
      : 'media_r2_key';

  const row =
    await env.DB
      .prepare(
        `
          SELECT
            ${
              field
            } AS r2_key
          FROM v2_gallery_items
          WHERE
            id = ?
            AND active = 1
          LIMIT 1
        `,
      )
      .bind(
        numericId,
      )
      .first();

  if (
    !row
    || !row.r2_key
  ) {
    return fail(
      'Mídia não encontrada.',
      404,
    );
  }

  const object =
    await env.FILES
      .get(
        row.r2_key,
      );

  if (!object) {
    return fail(
      'Mídia não encontrada.',
      404,
    );
  }

  const headers =
    new Headers();

  object.writeHttpMetadata(
    headers,
  );

  headers.set(
    'cache-control',
    'public, max-age=3600',
  );

  headers.set(
    'content-disposition',
    'inline',
  );

  headers.set(
    'x-content-type-options',
    'nosniff',
  );

  return new Response(
    object.body,
    {
      headers,
    },
  );
}

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
     GALERIA PÚBLICA V2
  ================================================== */

  if (
    method === 'GET'
    && path
      === '/api/v2/gallery'
  ) {
    return json({
      ok:
        true,

      items:
        await listPublicV2Gallery(
          env,
          url,
        ),
    });
  }

  const galleryContentMatch =
    path.match(
      /^\/api\/v2\/gallery\/(\d+)\/(media|preview)$/,
    );

  if (
    method === 'GET'
    && galleryContentMatch
  ) {
    return streamPublicV2Gallery(
      env,
      galleryContentMatch[1],
      galleryContentMatch[2],
    );
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
        await calculateCommercialV2Quote(
          env.DB,
          body.selection
          || {},
          {
            eventType:
              body.eventType
              || null,
          },
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
        await calculateCommercialV2Quote(
          env.DB,
          body.selection
          || {},
          {
            eventType:
              body.eventType
              || null,
          },
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
     SOLICITAR ANÁLISE DE URGÊNCIA V2
  ================================================== */

  if (
    method === 'POST'
    && path
      === '/api/v2/urgency/request'
  ) {
    try {
      const body =
        await readJson(
          request,
        );

      const result =
        await requestV2UrgencyReview(
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

  /* ==================================================
     PAGAR URGÊNCIA APROVADA V2
  ================================================== */

  const urgencyCheckoutMatch =
    path.match(
      /^\/api\/v2\/urgency\/(ord_[a-f0-9]{36})\/checkout$/,
    );

  if (
    method === 'POST'
    && urgencyCheckoutMatch
  ) {
    try {
      const body =
        await readJson(
          request,
        );

      const result =
        await startApprovedV2UrgencyCheckout(
          request,
          env,
          urgencyCheckoutMatch[1],
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
