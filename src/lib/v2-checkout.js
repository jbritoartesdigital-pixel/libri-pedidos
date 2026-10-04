import {
  normalizeWhatsapp,
  nowIso,
  randomToken,
} from './http.js';

import {
  loadV2Settings,
  v2IntSetting,
} from './v2-catalog.js';

import {
  calculateCommercialV2Quote,
} from './v2-commercial-pricing.js';

import {
  findV2DeliveryOptions,
  planV2AllocationForWindow,
  validateV2DeliveryWindow,
} from './v2-agenda.js';

import {
  createMercadoPagoCheckout,
} from './v2-mercadopago.js';

export class V2CheckoutError extends Error {
  constructor(
    message,
    {
      status = 422,
      code = 'checkout_invalid',
      details = undefined,
    } = {},
  ) {
    super(message);

    this.name =
      'V2CheckoutError';

    this.status =
      status;

    this.code =
      code;

    this.details =
      details;
  }
}

async function sha256Hex(
  value,
) {
  const bytes =
    new TextEncoder()
      .encode(
        String(
          value
          ?? '',
        ),
      );

  const digest =
    await crypto
      .subtle
      .digest(
        'SHA-256',
        bytes,
      );

  return Array.from(
    new Uint8Array(
      digest,
    ),
    (byte) =>
      byte
        .toString(16)
        .padStart(2, '0'),
  ).join('');
}

function cleanText(
  value,
  maxLength = 500,
) {
  return String(
    value
    ?? '',
  )
    .trim()
    .slice(
      0,
      maxLength,
    );
}

function requireText(
  value,
  label,
  maxLength = 500,
) {
  const text =
    cleanText(
      value,
      maxLength,
    );

  if (!text) {
    throw new V2CheckoutError(
      `${label} é obrigatório.`,
    );
  }

  return text;
}

function optionalText(
  value,
  maxLength = 500,
) {
  const text =
    cleanText(
      value,
      maxLength,
    );

  return text
    || null;
}

function validIsoDate(
  value,
) {
  const text =
    String(
      value
      || '',
    );

  if (
    !/^\d{4}-\d{2}-\d{2}$/
      .test(text)
  ) {
    return false;
  }

  const parsed =
    Date.parse(
      `${text}T12:00:00Z`,
    );

  return Number.isFinite(
    parsed,
  );
}

async function activeV2Terms(
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

async function claimCheckoutRequest(
  db,
  requestKey,
) {
  const result =
    await db
      .prepare(
        `
          INSERT OR IGNORE INTO v2_checkout_requests(
            request_key,
            status,
            created_at,
            updated_at
          )
          VALUES (
            ?,
            'processing',
            ?,
            ?
          )
        `,
      )
      .bind(
        requestKey,
        nowIso(),
        nowIso(),
      )
      .run();

  const changes =
    Number(
      result
        ?.meta
        ?.changes
      || 0,
    );

  if (
    changes > 0
  ) {
    return {
      claimed:
        true,
    };
  }

  const existing =
    await db
      .prepare(
        `
          SELECT
            request_key,
            order_id,
            status
          FROM v2_checkout_requests
          WHERE request_key = ?
        `,
      )
      .bind(
        requestKey,
      )
      .first();

  return {
    claimed:
      false,

    existing,
  };
}

async function releaseCheckoutRequest(
  db,
  requestKey,
) {
  await db
    .prepare(
      `
        DELETE FROM v2_checkout_requests
        WHERE
          request_key = ?
          AND status = 'processing'
      `,
    )
    .bind(
      requestKey,
    )
    .run();
}

async function nextOrderCode(
  db,
) {
  const row =
    await db
      .prepare(
        `
          UPDATE v2_sequences
          SET value = value + 1
          WHERE name = 'order_number'
          RETURNING value
        `,
      )
      .first();

  if (
    !row
    || !Number.isInteger(
      Number(
        row.value,
      ),
    )
  ) {
    throw new V2CheckoutError(
      'Não foi possível gerar o número do pedido.',
      {
        status:
          500,

        code:
          'order_number_error',
      },
    );
  }

  return `LIBRI-${
    String(
      row.value,
    )
      .padStart(
        4,
        '0',
      )
  }`;
}

async function upsertCustomer(
  db,
  {
    name,
    whatsapp,
    email,
  },
) {
  const existing =
    await db
      .prepare(
        `
          SELECT id
          FROM v2_customers
          WHERE whatsapp = ?
          ORDER BY id DESC
          LIMIT 1
        `,
      )
      .bind(
        whatsapp,
      )
      .first();

  if (existing) {
    await db
      .prepare(
        `
          UPDATE v2_customers
          SET
            name = ?,
            email = ?,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        name,
        email,
        nowIso(),
        existing.id,
      )
      .run();

    return Number(
      existing.id,
    );
  }

  const result =
    await db
      .prepare(
        `
          INSERT INTO v2_customers(
            name,
            whatsapp,
            email,
            created_at,
            updated_at
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?
          )
        `,
      )
      .bind(
        name,
        whatsapp,
        email,
        nowIso(),
        nowIso(),
      )
      .run();

  return Number(
    result
      ?.meta
      ?.last_row_id,
  );
}

function orderItemRows(
  quote,
) {
  const rows = [];

  rows.push({
    itemType:
      'product',

    itemCode:
      quote.variant
        .code,

    name:
      quote.product
        .pricingMode
      === 'scene_count'
        ? `${
          quote.product.name
        } • ${
          quote.variant.label
        }`
        : quote.product
          .name,

    unitPriceCents:
      quote.variant
        .priceCents,

    pointsUnits:
      quote.variant
        .pointsUnits,

    configuration: {
      productCode:
        quote.product
          .code,

      productSlug:
        quote.product
          .slug,

      variantCode:
        quote.variant
          .code,

      sceneCount:
        quote.variant
          .sceneCount,
    },
  });

  for (
    const addon
    of quote.addons
  ) {
    rows.push({
      itemType:
        'addon',

      itemCode:
        addon.code,

      name:
        addon.name,

      unitPriceCents:
        addon.priceCents,

      pointsUnits:
        addon.pointsUnits,

      configuration:
        addon.config
        || {},
    });
  }

  return rows;
}

async function createOrderRecords(
  db,
  {
    orderCode,
    publicToken,
    customerId,
    eventType,
    eventSubtype,
    honoreeName,
    eventDate,
    deliveryStart,
    deliveryEnd,
    recommendedTargetDate,
    quote,
    terms,
    termsHash,
    termsEvidence,
  },
) {
  const stamp =
    nowIso();

  const orderResult =
    await db
      .prepare(
        `
          INSERT INTO v2_orders(
            order_code,
            public_token,
            customer_id,

            event_type,
            event_subtype,
            honoree_display_name,
            event_date,

            status,
            next_action,

            delivery_start,
            delivery_end,
            recommended_target_date,

            urgency_enabled,
            briefing_status,
            source,

            created_at,
            updated_at
          )
          VALUES (
            ?,
            ?,
            ?,

            ?,
            ?,
            ?,
            ?,

            'awaiting_payment',
            'Aguardando pagamento',

            ?,
            ?,
            ?,

            0,
            'locked',
            'store',

            ?,
            ?
          )
        `,
      )
      .bind(
        orderCode,
        publicToken,
        customerId,

        eventType,
        eventSubtype,
        honoreeName,
        eventDate,

        deliveryStart,
        deliveryEnd,
        recommendedTargetDate,

        stamp,
        stamp,
      )
      .run();

  const orderId =
    Number(
      orderResult
        ?.meta
        ?.last_row_id,
    );

  if (
    !Number.isInteger(orderId)
    || orderId <= 0
  ) {
    throw new V2CheckoutError(
      'Não foi possível criar o pedido.',
      {
        status:
          500,

        code:
          'order_create_error',
      },
    );
  }

  const itemStatements =
    orderItemRows(
      quote,
    )
      .map(
        (item) =>
          db
            .prepare(
              `
                INSERT INTO v2_order_items(
                  order_id,
                  item_type,
                  item_code,
                  name_snapshot,
                  quantity,
                  unit_price_cents,
                  points_units,
                  configuration_json,
                  created_at
                )
                VALUES (
                  ?,
                  ?,
                  ?,
                  ?,
                  1,
                  ?,
                  ?,
                  ?,
                  ?
                )
              `,
            )
            .bind(
              orderId,
              item.itemType,
              item.itemCode,
              item.name,
              item.unitPriceCents,
              item.pointsUnits,
              JSON.stringify(
                item.configuration,
              ),
              stamp,
            ),
      );

  await db.batch([
    ...itemStatements,

    db
      .prepare(
        `
          INSERT INTO v2_order_pricing(
            order_id,
            subtotal_cents,
            combo_discount_cents,
            coupon_discount_cents,
            urgency_percent,
            urgency_amount_cents,
            total_cents,
            payment_method,
            deposit_percent,
            deposit_cents,
            balance_cents,
            currency,
            pricing_snapshot_json,
            updated_at
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            'BRL',
            ?,
            ?
          )
        `,
      )
      .bind(
        orderId,

        quote.subtotalCents,
        quote.comboDiscountCents,
        quote.couponDiscountCents,

        quote.urgency
          .percent,

        quote.urgency
          .amountCents,

        quote.totalCents,

        quote.payment
          .method,

        quote.payment
          .depositPercent,

        quote.payment
          .depositCents,

        quote.payment
          .balanceCents,

        JSON.stringify(
          quote,
        ),

        stamp,
      ),

    db
      .prepare(
        `
          INSERT INTO v2_briefings(
            order_id,
            schema_version,
            data_json,
            current_section,
            completion_percent,
            updated_at
          )
          VALUES (
            ?,
            '2.0',
            '{}',
            NULL,
            0,
            ?
          )
        `,
      )
      .bind(
        orderId,
        stamp,
      ),

    db
      .prepare(
        `
          INSERT INTO v2_order_terms_acceptances(
            order_id,
            terms_version,
            terms_hash,
            accepted_at,
            evidence_json
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?
          )
        `,
      )
      .bind(
        orderId,
        terms.version,
        termsHash,
        stamp,
        JSON.stringify(
          termsEvidence,
        ),
      ),

    db
      .prepare(
        `
          INSERT INTO v2_order_history(
            order_id,
            action_code,
            description,
            metadata_json,
            created_at
          )
          VALUES (
            ?,
            'order_created',
            'Pedido V2 criado e aguardando pagamento.',
            ?,
            ?
          )
        `,
      )
      .bind(
        orderId,
        JSON.stringify({
          orderCode,
          totalCents:
            quote.totalCents,

          paymentMethod:
            quote.payment
              .method,

          deliveryStart,
          deliveryEnd,
        }),
        stamp,
      ),

    db
      .prepare(
        `
          INSERT INTO v2_order_history(
            order_id,
            action_code,
            description,
            metadata_json,
            created_at
          )
          VALUES (
            ?,
            'terms_accepted',
            'Condições do pedido aceitas.',
            ?,
            ?
          )
        `,
      )
      .bind(
        orderId,
        JSON.stringify({
          version:
            terms.version,

          hash:
            termsHash,
        }),
        stamp,
      ),
  ]);

  return orderId;
}

async function createCapacityHold(
  db,
  {
    orderId,
    allocation,
    expiresAt,
    defaultCapacityUnits,
  },
) {
  const holdToken =
    randomToken(
      'hold_',
    );

  const holdResult =
    await db
      .prepare(
        `
          INSERT INTO v2_checkout_holds(
            token,
            order_id,
            status,
            expires_at,
            created_at,
            updated_at
          )
          VALUES (
            ?,
            ?,
            'active',
            ?,
            ?,
            ?
          )
        `,
      )
      .bind(
        holdToken,
        orderId,
        expiresAt,
        nowIso(),
        nowIso(),
      )
      .run();

  const holdId =
    Number(
      holdResult
        ?.meta
        ?.last_row_id,
    );

  const now =
    nowIso();

  const statements =
    allocation.map(
      ({
        day,
        pointsUnits,
      }) =>
        db
          .prepare(
            `
              INSERT INTO v2_checkout_hold_allocations(
                hold_id,
                day,
                points_units,
                created_at
              )
              SELECT
                ?,
                ?,
                ?,
                ?
              WHERE
                ? <=
                (
                  CASE
                    WHEN COALESCE(
                      (
                        SELECT blocked
                        FROM v2_agenda_days
                        WHERE day = ?
                      ),
                      0
                    ) = 1
                    THEN 0
                    ELSE COALESCE(
                      (
                        SELECT sellable_capacity_units
                        FROM v2_agenda_days
                        WHERE day = ?
                      ),
                      ?
                    )
                  END

                  - COALESCE(
                    (
                      SELECT SUM(points_units)
                      FROM v2_agenda_allocations
                      WHERE day = ?
                    ),
                    0
                  )

                  - COALESCE(
                    (
                      SELECT SUM(a.points_units)
                      FROM v2_checkout_hold_allocations a
                      INNER JOIN v2_checkout_holds h
                        ON h.id = a.hold_id
                      WHERE
                        a.day = ?
                        AND h.status = 'active'
                        AND h.expires_at > ?
                    ),
                    0
                  )
                )
            `,
          )
          .bind(
            holdId,
            day,
            pointsUnits,
            now,

            pointsUnits,

            day,
            day,
            defaultCapacityUnits,

            day,

            day,
            now,
          ),
    );

  const results =
    await db.batch(
      statements,
    );

  const insertedAll =
    results.every(
      (result) =>
        Number(
          result
            ?.meta
            ?.changes
          || 0,
        )
        === 1,
    );

  if (!insertedAll) {
    await db
      .prepare(
        `
          DELETE FROM v2_checkout_holds
          WHERE id = ?
        `,
      )
      .bind(
        holdId,
      )
      .run();

    throw new V2CheckoutError(
      'Essa janela acabou de ficar indisponível. Escolha outra opção de entrega.',
      {
        status:
          409,

        code:
          'delivery_window_unavailable',
      },
    );
  }

  await db
    .prepare(
      `
        INSERT INTO v2_order_history(
          order_id,
          action_code,
          description,
          metadata_json,
          created_at
        )
        VALUES (
          ?,
          'capacity_held',
          'Capacidade de produção reservada temporariamente para o pagamento.',
          ?,
          ?
        )
      `,
    )
    .bind(
      orderId,
      JSON.stringify({
        holdToken,
        expiresAt,
      }),
      nowIso(),
    )
    .run();

  return {
    holdId,
    holdToken,
    expiresAt,
  };
}

async function completedCheckoutResponse(
  db,
  orderId,
) {
  const row =
    await db
      .prepare(
        `
          SELECT
            o.order_code,
            o.public_token,
            o.delivery_start,
            o.delivery_end,

            p.total_cents,
            p.payment_method,
            p.deposit_cents,
            p.balance_cents,

            h.token AS hold_token,
            h.expires_at AS hold_expires_at,

            pay.provider_order_id,
            pay.checkout_url
          FROM v2_orders o
          INNER JOIN v2_order_pricing p
            ON p.order_id = o.id
          LEFT JOIN v2_checkout_holds h
            ON h.order_id = o.id
            AND h.status = 'active'
          LEFT JOIN v2_payments pay
            ON pay.order_id = o.id
            AND pay.provider = 'mercado_pago'
          WHERE o.id = ?
          ORDER BY
            h.id DESC,
            pay.id DESC
          LIMIT 1
        `,
      )
      .bind(
        orderId,
      )
      .first();

  if (!row) {
    return null;
  }

  return {
    ok: true,

    recovered:
      true,

    order: {
      code:
        row.order_code,

      publicToken:
        row.public_token,

      customerAreaPath:
        `/meu-pedido/${
          row.public_token
        }`,

      deliveryWindow: {
        start:
          row.delivery_start,

        end:
          row.delivery_end,
      },
    },

    hold: {
      token:
        row.hold_token,

      expiresAt:
        row.hold_expires_at,
    },

    payment: {
      method:
        row.payment_method,

      totalCents:
        row.total_cents,

      amountDueNowCents:
        row.deposit_cents,

      balanceCents:
        row.balance_cents,

      provider:
        'mercado_pago',

      providerOrderId:
        row.provider_order_id,

      checkoutUrl:
        row.checkout_url,

      ready:
        Boolean(
          row.checkout_url,
        ),
    },
  };
}

export async function startV2Checkout(
  request,
  env,
  body,
) {
  const requestKey =
    requireText(
      body.clientRequestId,
      'Identificador do checkout',
      120,
    );

  if (
    requestKey.length < 12
  ) {
    throw new V2CheckoutError(
      'Atualize a página e tente novamente.',
      {
        status:
          422,

        code:
          'invalid_client_request_id',
      },
    );
  }

  const claim =
    await claimCheckoutRequest(
      env.DB,
      requestKey,
    );

  if (!claim.claimed) {
    const existing =
      claim.existing;

    if (
      existing
      ?.status
      === 'completed'
      && existing
        .order_id
    ) {
      const response =
        await completedCheckoutResponse(
          env.DB,
          existing.order_id,
        );

      if (response) {
        return response;
      }
    }

    throw new V2CheckoutError(
      'Este checkout já está sendo processado. Aguarde alguns segundos.',
      {
        status:
          409,

        code:
          'checkout_in_progress',
      },
    );
  }

  let orderId = null;

  try {
    const customerName =
      requireText(
        body.customer
          ?.name,
        'Seu nome',
        160,
      );

    const whatsapp =
      normalizeWhatsapp(
        body.customer
          ?.whatsapp,
      );

    if (
      whatsapp.length < 10
      || whatsapp.length > 15
    ) {
      throw new V2CheckoutError(
        'Confira o número do WhatsApp.',
      );
    }

    const email =
      optionalText(
        body.customer
          ?.email,
        240,
      );

    const honoreeName =
      requireText(
        body.event
          ?.honoreeName,
        'Nome do aniversariante, casal ou evento',
        180,
      );

    const eventDate =
      requireText(
        body.event
          ?.date,
        'Data do evento',
        10,
      );

    if (
      !validIsoDate(
        eventDate,
      )
    ) {
      throw new V2CheckoutError(
        'Confira a data do evento.',
      );
    }

    const eventType =
      optionalText(
        body.event
          ?.type,
        80,
      )
      || 'unspecified';

    const eventSubtype =
      optionalText(
        body.event
          ?.subtype,
        120,
      );

    const paymentMethod =
      cleanText(
        body.selection
          ?.paymentMethod,
        20,
      );

    if (
      ![
        'pix',
        'card',
      ].includes(
        paymentMethod,
      )
    ) {
      throw new V2CheckoutError(
        'Escolha Pix ou cartão.',
      );
    }

    const selection = {
      ...(
        body.selection
        || {}
      ),

      paymentMethod,
    };

    const existingCustomer =
      await env.DB
        .prepare(
          `
            SELECT id
            FROM v2_customers
            WHERE whatsapp = ?
            LIMIT 1
          `,
        )
        .bind(
          whatsapp,
        )
        .first();

    const quote =
      await calculateCommercialV2Quote(
        env.DB,
        selection,
        {
          customerId:
            existingCustomer
              ?.id
            || null,

          eventType,

          urgencyApproved:
            false,
        },
      );

    const deliveryStart =
      requireText(
        body.deliveryWindow
          ?.start,
        'Início da janela de entrega',
        10,
      );

    const deliveryEnd =
      requireText(
        body.deliveryWindow
          ?.end,
        'Fim da janela de entrega',
        10,
      );

    await validateV2DeliveryWindow(
      env.DB,
      {
        eventDate,
        start:
          deliveryStart,

        end:
          deliveryEnd,
      },
    );

    const plan =
      await planV2AllocationForWindow(
        env.DB,
        {
          start:
            deliveryStart,

          end:
            deliveryEnd,

          pointsUnits:
            quote.pointsUnits,
        },
      );

    if (!plan.fits) {
      throw new V2CheckoutError(
        'Essa janela não está mais disponível. Escolha outra opção de entrega.',
        {
          status:
            409,

          code:
            'delivery_window_unavailable',
        },
      );
    }

    if (
      body.termsAccepted
      !== true
    ) {
      throw new V2CheckoutError(
        'Leia e aceite as Condições do Pedido para continuar.',
        {
          code:
            'terms_required',
        },
      );
    }

    const terms =
      await activeV2Terms(
        env.DB,
      );

    if (!terms) {
      throw new V2CheckoutError(
        'As Condições do Pedido ainda não estão disponíveis.',
        {
          status:
            503,

          code:
            'terms_unavailable',
        },
      );
    }

    const acceptedVersion =
      cleanText(
        body.termsVersion,
        40,
      );

    if (
      acceptedVersion
      !== terms.version
    ) {
      throw new V2CheckoutError(
        'As Condições do Pedido foram atualizadas. Leia a nova versão antes de continuar.',
        {
          status:
            409,

          code:
            'terms_changed',

          details: {
            currentVersion:
              terms.version,
          },
        },
      );
    }

    const termsHash =
      terms.content_hash
      || await sha256Hex(
        terms.body,
      );

    if (
      !terms
        .content_hash
    ) {
      await env.DB
        .prepare(
          `
            UPDATE v2_terms_versions
            SET content_hash = ?
            WHERE
              version = ?
              AND content_hash IS NULL
          `,
        )
        .bind(
          termsHash,
          terms.version,
        )
        .run();
    }

    const ip =
      request.headers
        .get(
          'CF-Connecting-IP',
        )
      || '';

    const termsEvidence = {
      userAgent:
        request.headers
          .get(
            'user-agent',
          )
        || '',

      cfRay:
        request.headers
          .get(
            'cf-ray',
          )
        || '',

      connectionIpHash:
        ip
          ? await sha256Hex(
            ip,
          )
          : null,
    };

    const delivery =
      await findV2DeliveryOptions(
        env.DB,
        {
          eventDate,
          pointsUnits:
            quote.pointsUnits,

          limit:
            10,
        },
      );

    const recommendedTargetDate =
      delivery
        .recommendedTargetDate;

    const settings =
      await loadV2Settings(
        env.DB,
      );

    const holdMinutes =
      v2IntSetting(
        settings,
        'checkout_hold_minutes',
        30,
      );

    const defaultCapacityUnits =
      v2IntSetting(
        settings,
        'default_sellable_points_per_day_units',
        400,
      );

    const orderCode =
      await nextOrderCode(
        env.DB,
      );

    const publicToken =
      randomToken(
        'ord_',
      );

    const customerId =
      await upsertCustomer(
        env.DB,
        {
          name:
            customerName,

          whatsapp,
          email,
        },
      );

    orderId =
      await createOrderRecords(
        env.DB,
        {
          orderCode,
          publicToken,
          customerId,

          eventType,
          eventSubtype,
          honoreeName,
          eventDate,

          deliveryStart,
          deliveryEnd,
          recommendedTargetDate,

          quote,

          terms,
          termsHash,
          termsEvidence,
        },
      );

    const expiresAt =
      new Date(
        Date.now()
        + (
          holdMinutes
          * 60
          * 1000
        ),
      )
        .toISOString();

    const hold =
      await createCapacityHold(
        env.DB,
        {
          orderId,
          allocation:
            plan.allocation,

          expiresAt,

          defaultCapacityUnits,
        },
      );

    const mpCheckout =
      await createMercadoPagoCheckout(
        request,
        env,
        {
          orderId,
          orderCode,
          publicToken,

          paymentMethod,

          amountDueNowCents:
            quote.payment
              .depositCents,

          customerEmail:
            email,
        },
      );

    await env.DB
      .prepare(
        `
          UPDATE v2_checkout_requests
          SET
            order_id = ?,
            status = 'completed',
            updated_at = ?
          WHERE request_key = ?
        `,
      )
      .bind(
        orderId,
        nowIso(),
        requestKey,
      )
      .run();

    return {
      ok: true,

      recovered:
        false,

      order: {
        code:
          orderCode,

        publicToken,

        customerAreaPath:
          `/meu-pedido/${
            publicToken
          }`,

        deliveryWindow: {
          start:
            deliveryStart,

          end:
            deliveryEnd,
        },
      },

      hold: {
        token:
          hold.holdToken,

        expiresAt:
          hold.expiresAt,
      },

      payment: {
        method:
          paymentMethod,

        totalCents:
          quote.totalCents,

        amountDueNowCents:
          quote.payment
            .depositCents,

        balanceCents:
          quote.payment
            .balanceCents,

        provider:
          'mercado_pago',

        providerOrderId:
          mpCheckout
            .providerOrderId,

        checkoutUrl:
          mpCheckout
            .checkoutUrl,

        ready:
          true,
      },
    };
  } catch (
    error
  ) {
    if (orderId) {
      await env.DB
        .prepare(
          `
            DELETE FROM v2_orders
            WHERE id = ?
          `,
        )
        .bind(
          orderId,
        )
        .run();
    }

    await releaseCheckoutRequest(
      env.DB,
      requestKey,
    );

    if (
      error
      instanceof V2CheckoutError
    ) {
      throw error;
    }

    throw new V2CheckoutError(
      error
        ?.message
      || 'Não foi possível iniciar o pagamento.',
      {
        status:
          Number(
            error
              ?.status,
          )
          || 502,

        code:
          'payment_provider_error',

        details:
          error
            ?.details,
      },
    );
  }
}
