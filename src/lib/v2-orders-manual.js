import {
  normalizeWhatsapp,
  nowIso,
  randomToken,
} from './http.js';

import {
  calculateCommercialV2Quote,
} from './v2-commercial-pricing.js';

import {
  findV2DeliveryOptions,
  planV2AllocationForWindow,
  validateV2DeliveryWindow,
} from './v2-agenda.js';

import {
  loadV2Settings,
  v2IntSetting,
} from './v2-catalog.js';

import {
  createMercadoPagoCheckout,
} from './v2-mercadopago.js';

const TOKEN_PATTERN =
  /^ord_[a-f0-9]{36}$/;

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

function requiredText(
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
    throw new Error(
      `${label} é obrigatório.`,
    );
  }

  return text;
}

function validIsoDate(
  value,
) {
  return /^\d{4}-\d{2}-\d{2}$/
    .test(
      String(
        value
        || '',
      ),
    );
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

  if (!row) {
    throw new Error(
      'Não foi possível gerar o número do pedido.',
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

async function findCustomerByWhatsapp(
  db,
  whatsapp,
) {
  return db
    .prepare(
      `
        SELECT
          id,
          name,
          whatsapp,
          email
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
    await findCustomerByWhatsapp(
      db,
      whatsapp,
    );

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

function orderItemRows(quote) {
  const rows = [
    {
      type:
        'product',

      code:
        quote.variant
          .code,

      name:
        quote.product
          .pricingMode
        === 'scene_count'
          ? `${
            quote.product
              .name
          } • ${
            quote.variant
              .label
          }`
          : quote.product
            .name,

      priceCents:
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
    },

    ...quote.addons.map(
      (addon) => ({
        type:
          'addon',

        code:
          addon.code,

        name:
          addon.name,

        priceCents:
          addon.priceCents,

        pointsUnits:
          addon.pointsUnits,

        configuration:
          addon.config
          || {},
      }),
    ),
  ];

  if (
    quote.combo
  ) {
    rows.push({
      type:
        'combo_adjustment',

      code:
        quote.combo
          .code,

      name:
        quote.combo
          .name,

      priceCents:
        0,

      pointsUnits:
        0,

      configuration: {
        discountCents:
          Number(
            quote.comboDiscountCents
            || 0,
          ),
      },
    });
  }

  return rows;
}

async function createManualOrderRecords(
  db,
  {
    customerId,
    event,
    quote,
    deliveryWindow,
    urgencyApproved,
    orderCode,
    publicToken,
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

            ?,
            'locked',
            'manual_whatsapp',

            ?,
            ?
          )
        `,
      )
      .bind(
        orderCode,
        publicToken,
        customerId,

        event.type,
        event.subtype,
        event.honoreeName,
        event.date,

        deliveryWindow.start,
        deliveryWindow.end,
        deliveryWindow.recommendedTargetDate,

        urgencyApproved
          ? 1
          : 0,

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
              item.type,
              item.code,
              item.name,
              item.priceCents,
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
          INSERT INTO v2_order_history(
            order_id,
            action_code,
            description,
            metadata_json,
            created_at
          )
          VALUES (
            ?,
            'manual_order_created',
            'Pedido criado manualmente a partir do atendimento.',
            ?,
            ?
          )
        `,
      )
      .bind(
        orderId,
        JSON.stringify({
          source:
            'manual_whatsapp',

          totalCents:
            quote.totalCents,

          paymentMethod:
            quote.payment
              .method,

          comboCode:
            quote.combo
              ?.code
            || null,

          couponCode:
            quote.coupon
              ?.code
            || null,

          urgencyApproved,
        }),
        stamp,
      ),
  ]);

  return orderId;
}

async function publicManualOrder(
  db,
  token,
) {
  if (
    !TOKEN_PATTERN
      .test(
        String(
          token
          || '',
        ),
      )
  ) {
    return null;
  }

  const order =
    await db
      .prepare(
        `
          SELECT
            o.id,
            o.order_code,
            o.public_token,
            o.event_type,
            o.event_subtype,
            o.honoree_display_name,
            o.event_date,
            o.status,
            o.delivery_start,
            o.delivery_end,
            o.urgency_enabled,
            o.briefing_status,

            c.name AS customer_name,
            c.email,

            p.total_cents,
            p.payment_method,
            p.deposit_cents,
            p.balance_cents,
            p.pricing_snapshot_json
          FROM v2_orders o
          INNER JOIN v2_customers c
            ON c.id = o.customer_id
          INNER JOIN v2_order_pricing p
            ON p.order_id = o.id
          WHERE
            o.public_token = ?
            AND o.source = 'manual_whatsapp'
          LIMIT 1
        `,
      )
      .bind(
        token,
      )
      .first();

  if (!order) {
    return null;
  }

  const itemsResult =
    await db
      .prepare(
        `
          SELECT
            item_type,
            item_code,
            name_snapshot,
            quantity,
            unit_price_cents
          FROM v2_order_items
          WHERE order_id = ?
          ORDER BY id
        `,
      )
      .bind(
        order.id,
      )
      .all();

  const terms =
    await db
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

  const payment =
    await db
      .prepare(
        `
          SELECT
            status,
            checkout_url,
            provider_order_id,
            created_at
          FROM v2_payments
          WHERE
            order_id = ?
            AND provider = 'mercado_pago'
          ORDER BY id DESC
          LIMIT 1
        `,
      )
      .bind(
        order.id,
      )
      .first();

  return {
    id:
      order.id,

    code:
      order.order_code,

    token:
      order.public_token,

    customerName:
      order.customer_name,

    event: {
      type:
        order.event_type,

      subtype:
        order.event_subtype,

      honoreeName:
        order.honoree_display_name,

      date:
        order.event_date,
    },

    status:
      order.status,

    deliveryWindow: {
      start:
        order.delivery_start,

      end:
        order.delivery_end,
    },

    urgencyApproved:
      order.urgency_enabled
      === 1,

    pricing: {
      totalCents:
        Number(
          order.total_cents
          || 0,
        ),

      paymentMethod:
        order.payment_method,

      depositCents:
        Number(
          order.deposit_cents
          || 0,
        ),

      balanceCents:
        Number(
          order.balance_cents
          || 0,
        ),

      snapshot:
        JSON.parse(
          order.pricing_snapshot_json
          || '{}',
        ),
    },

    items:
      itemsResult.results
      || [],

    terms:
      terms
      ? {
        version:
          terms.version,

        body:
          terms.body,

        contentHash:
          terms.content_hash,

        publishedAt:
          terms.published_at,
      }
      : null,

    payment: payment
      ? {
        status:
          payment.status,

        checkoutUrl:
          payment.checkout_url,

        providerOrderId:
          payment.provider_order_id,
      }
      : null,

    alreadyPaid:
      payment
        ?.status
      === 'approved',

    customerAreaPath:
      `/meu-pedido/${
        order.public_token
      }`,
  };
}

async function sha256Hex(
  value,
) {
  const digest =
    await crypto
      .subtle
      .digest(
        'SHA-256',
        new TextEncoder()
          .encode(
            String(
              value
              ?? '',
            ),
          ),
      );

  return Array.from(
    new Uint8Array(
      digest,
    ),
    (byte) =>
      byte
        .toString(16)
        .padStart(
          2,
          '0',
        ),
  )
    .join('');
}

async function createManualHold(
  db,
  {
    orderId,
    allocation,
    expiresAt,
    defaultCapacityUnits,
  },
) {
  await db
    .prepare(
      `
        UPDATE v2_checkout_holds
        SET
          status = 'expired',
          updated_at = ?
        WHERE
          order_id = ?
          AND status = 'active'
          AND expires_at <= ?
      `,
    )
    .bind(
      nowIso(),
      orderId,
      nowIso(),
    )
    .run();

  const existing =
    await db
      .prepare(
        `
          SELECT
            id,
            token,
            expires_at
          FROM v2_checkout_holds
          WHERE
            order_id = ?
            AND status = 'active'
            AND expires_at > ?
          ORDER BY id DESC
          LIMIT 1
        `,
      )
      .bind(
        orderId,
        nowIso(),
      )
      .first();

  if (existing) {
    return {
      holdId:
        existing.id,

      holdToken:
        existing.token,

      expiresAt:
        existing.expires_at,

      reused:
        true,
    };
  }

  const holdToken =
    randomToken(
      'hold_',
    );

  const result =
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
      result
        ?.meta
        ?.last_row_id,
    );

  const stamp =
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
            stamp,

            pointsUnits,

            day,
            day,
            defaultCapacityUnits,

            day,

            day,
            stamp,
          ),
    );

  const results =
    await db.batch(
      statements,
    );

  if (
    !results.every(
      (entry) =>
        Number(
          entry
            ?.meta
            ?.changes
          || 0,
        )
        === 1,
    )
  ) {
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

    throw new Error(
      'Essa janela acabou de ficar indisponível. Ajuste o pedido antes de reenviar o link.',
    );
  }

  return {
    holdId,
    holdToken,
    expiresAt,

    reused:
      false,
  };
}

export async function previewV2ManualOrder(
  db,
  body = {},
) {
  const eventDate =
    requiredText(
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
    throw new Error(
      'Data do evento inválida.',
    );
  }

  const whatsapp =
    normalizeWhatsapp(
      body.customer
        ?.whatsapp,
    );

  const existingCustomer =
    whatsapp
      ? await findCustomerByWhatsapp(
        db,
        whatsapp,
      )
      : null;

  const quote =
    await calculateCommercialV2Quote(
      db,
      body.selection
      || {},
      {
        customerId:
          existingCustomer
            ?.id
          || null,

        eventType:
          cleanText(
            body.event
              ?.type,
            80,
          ),

        urgencyApproved:
          body.urgencyApproved
          === true,
      },
    );

  const delivery =
    await findV2DeliveryOptions(
      db,
      {
        eventDate,

        pointsUnits:
          quote.pointsUnits,

        limit:
          6,
      },
    );

  return {
    quote,
    delivery,
  };
}

export async function createV2ManualOrder(
  request,
  env,
  body = {},
) {
  const customerName =
    requiredText(
      body.customer
        ?.name,
      'Nome da cliente',
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
    throw new Error(
      'Confira o WhatsApp da cliente.',
    );
  }

  const email =
    cleanText(
      body.customer
        ?.email,
      240,
    )
    || null;

  const event = {
    type:
      requiredText(
        body.event
          ?.type,
        'Tipo do evento',
        80,
      ),

    subtype:
      cleanText(
        body.event
          ?.subtype,
        120,
      )
      || null,

    honoreeName:
      requiredText(
        body.event
          ?.honoreeName,
        'Nome do aniversariante, casal ou evento',
        180,
      ),

    date:
      requiredText(
        body.event
          ?.date,
        'Data do evento',
        10,
      ),
  };

  if (
    !validIsoDate(
      event.date,
    )
  ) {
    throw new Error(
      'Data do evento inválida.',
    );
  }

  const deliveryWindow = {
    start:
      requiredText(
        body.deliveryWindow
          ?.start,
        'Início da janela',
        10,
      ),

    end:
      requiredText(
        body.deliveryWindow
          ?.end,
        'Fim da janela',
        10,
      ),
  };

  if (
    !validIsoDate(
      deliveryWindow.start,
    )
    || !validIsoDate(
      deliveryWindow.end,
    )
  ) {
    throw new Error(
      'Janela de entrega inválida.',
    );
  }

  const urgencyApproved =
    body.urgencyApproved
    === true;

  if (!urgencyApproved) {
    await validateV2DeliveryWindow(
      env.DB,
      {
        eventDate:
          event.date,

        start:
          deliveryWindow.start,

        end:
          deliveryWindow.end,
      },
    );
  } else if (
    deliveryWindow.end
    > event.date
  ) {
    throw new Error(
      'A entrega urgente não pode terminar depois do evento.',
    );
  }

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

  const quote =
    await calculateCommercialV2Quote(
      env.DB,
      body.selection
      || {},
      {
        customerId,

        eventType:
          event.type,

        urgencyApproved,
      },
    );

  const plan =
    await planV2AllocationForWindow(
      env.DB,
      {
        start:
          deliveryWindow.start,

        end:
          deliveryWindow.end,

        pointsUnits:
          quote.pointsUnits,
      },
    );

  if (!plan.fits) {
    const alternatives =
      await findV2DeliveryOptions(
        env.DB,
        {
          eventDate:
            event.date,

          pointsUnits:
            quote.pointsUnits,

          limit:
            6,
        },
      );

    const error =
      new Error(
        urgencyApproved
          ? 'Mesmo com encaixe aprovado, esta janela não possui capacidade. Abra capacidade na Agenda ou escolha outra janela.'
          : 'Esta janela não possui capacidade. Escolha outra opção ou aprove um encaixe urgente.',
      );

    error.code =
      'manual_window_unavailable';

    error.details = {
      alternatives,
    };

    throw error;
  }

  const recommended =
    await findV2DeliveryOptions(
      env.DB,
      {
        eventDate:
          event.date,

        pointsUnits:
          quote.pointsUnits,

        limit:
          6,
      },
    );

  deliveryWindow
    .recommendedTargetDate =
      recommended
        .recommendedTargetDate;

  const orderCode =
    await nextOrderCode(
      env.DB,
    );

  const publicToken =
    randomToken(
      'ord_',
    );

  const orderId =
    await createManualOrderRecords(
      env.DB,
      {
        customerId,
        event,
        quote,
        deliveryWindow,
        urgencyApproved,
        orderCode,
        publicToken,
      },
    );

  const origin =
    new URL(
      request.url,
    )
      .origin;

  const clientPath =
    `/pedido/manual/${
      publicToken
    }`;

  return {
    order: {
      id:
        orderId,

      code:
        orderCode,

      source:
        'manual_whatsapp',

      status:
        'awaiting_payment',

      publicToken,
    },

    quote,

    client: {
      path:
        clientPath,

      url:
        `${origin}${clientPath}`,

      customerAreaPath:
        `/meu-pedido/${
          publicToken
        }`,
    },
  };
}

export async function getV2ManualOrderForCustomer(
  db,
  token,
) {
  return publicManualOrder(
    db,
    token,
  );
}

export async function startV2ManualOrderPayment(
  request,
  env,
  token,
  body = {},
) {
  const manual =
    await publicManualOrder(
      env.DB,
      token,
    );

  if (!manual) {
    throw new Error(
      'Pedido não encontrado.',
    );
  }

  if (
    manual.alreadyPaid
  ) {
    return {
      alreadyPaid:
        true,

      customerAreaPath:
        manual
          .customerAreaPath,
    };
  }

  if (
    ![
      'awaiting_payment',
      'configuring',
    ].includes(
      manual.status,
    )
  ) {
    throw new Error(
      'Este pedido não está aguardando pagamento.',
    );
  }

  if (
    body.termsAccepted
    !== true
  ) {
    throw new Error(
      'Leia e aceite as Condições do Pedido para continuar.',
    );
  }

  if (
    !manual.terms
  ) {
    throw new Error(
      'As Condições do Pedido ainda não estão disponíveis.',
    );
  }

  if (
    cleanText(
      body.termsVersion,
      40,
    )
    !== manual
      .terms
      .version
  ) {
    const error =
      new Error(
        'As Condições do Pedido foram atualizadas. Leia a versão atual.',
      );

    error.code =
      'terms_changed';

    throw error;
  }

  const currentPayment =
    manual.payment;

  if (
    currentPayment
      ?.status
    === 'pending'
    && currentPayment
      .checkoutUrl
  ) {
    const activeHold =
      await env.DB
        .prepare(
          `
            SELECT
              token,
              expires_at
            FROM v2_checkout_holds
            WHERE
              order_id = ?
              AND status = 'active'
              AND expires_at > ?
            ORDER BY id DESC
            LIMIT 1
          `,
        )
        .bind(
          manual.id,
          nowIso(),
        )
        .first();

    if (activeHold) {
      return {
        alreadyStarted:
          true,

        payment: {
          checkoutUrl:
            currentPayment
              .checkoutUrl,

          providerOrderId:
            currentPayment
              .providerOrderId,
        },

        hold: {
          token:
            activeHold.token,

          expiresAt:
            activeHold.expires_at,
        },
      };
    }
  }

  const quote =
    manual.pricing
      .snapshot;

  const plan =
    await planV2AllocationForWindow(
      env.DB,
      {
        start:
          manual
            .deliveryWindow
            .start,

        end:
          manual
            .deliveryWindow
            .end,

        pointsUnits:
          quote.pointsUnits,
      },
    );

  if (!plan.fits) {
    const error =
      new Error(
        'A janela deste pedido ficou indisponível. Fale com a Libri para ajustar a entrega antes do pagamento.',
      );

    error.code =
      'delivery_window_unavailable';

    throw error;
  }

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

  const expiresAt =
    new Date(
      Date.now()
      + holdMinutes
      * 60
      * 1000,
    )
      .toISOString();

  const hold =
    await createManualHold(
      env.DB,
      {
        orderId:
          manual.id,

        allocation:
          plan.allocation,

        expiresAt,

        defaultCapacityUnits,
      },
    );

  const termsHash =
    manual.terms
      .contentHash
    || await sha256Hex(
      manual.terms
        .body,
    );

  const existingAcceptance =
    await env.DB
      .prepare(
        `
          SELECT id
          FROM v2_order_terms_acceptances
          WHERE
            order_id = ?
            AND terms_version = ?
            AND COALESCE(
              terms_hash,
              ''
            ) = ?
          LIMIT 1
        `,
      )
      .bind(
        manual.id,
        manual.terms
          .version,
        termsHash,
      )
      .first();

  if (!existingAcceptance) {
    await env.DB
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
        manual.id,
        manual.terms
          .version,
        termsHash,
        nowIso(),
        JSON.stringify({
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
        }),
      )
      .run();
  }

  const order =
    await env.DB
      .prepare(
        `
          SELECT
            o.id,
            o.order_code,
            o.public_token,

            c.email
          FROM v2_orders o
          INNER JOIN v2_customers c
            ON c.id = o.customer_id
          WHERE o.id = ?
          LIMIT 1
        `,
      )
      .bind(
        manual.id,
      )
      .first();

  const checkout =
    await createMercadoPagoCheckout(
      request,
      env,
      {
        orderId:
          order.id,

        orderCode:
          order.order_code,

        publicToken:
          order.public_token,

        paymentMethod:
          manual.pricing
            .paymentMethod,

        amountDueNowCents:
          manual.pricing
            .depositCents,

        customerEmail:
          order.email,
      },
    );

  await env.DB
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
          'manual_payment_started',
          'Cliente iniciou o pagamento do pedido criado manualmente.',
          ?,
          ?
        )
      `,
    )
    .bind(
      manual.id,
      JSON.stringify({
        providerOrderId:
          checkout
            .providerOrderId,

        holdExpiresAt:
          hold.expiresAt,
      }),
      nowIso(),
    )
    .run();

  return {
    alreadyStarted:
      false,

    payment: {
      checkoutUrl:
        checkout
          .checkoutUrl,

      providerOrderId:
        checkout
          .providerOrderId,

      amountDueNowCents:
        manual.pricing
          .depositCents,

      balanceCents:
        manual.pricing
          .balanceCents,
    },

    hold: {
      token:
        hold.holdToken,

      expiresAt:
        hold.expiresAt,
    },
  };
}

export async function listV2Orders(
  db,
  {
    q = '',
    status = '',
    source = '',
    paymentMethod = '',
    eventDateFrom = '',
    eventDateTo = '',
    limit = 50,
    offset = 0,
  } = {},
) {
  const clauses = [
    '1 = 1',
  ];

  const binds = [];

  const search =
    cleanText(
      q,
      120,
    );

  if (search) {
    clauses.push(
      `
        (
          o.order_code LIKE ?
          OR o.honoree_display_name LIKE ?
          OR c.name LIKE ?
          OR c.whatsapp LIKE ?
        )
      `,
    );

    const like =
      `%${
        search
      }%`;

    binds.push(
      like,
      like,
      like,
      like,
    );
  }

  if (status) {
    clauses.push(
      'o.status = ?',
    );

    binds.push(
      status,
    );
  }

  if (
    [
      'store',
      'manual_whatsapp',
    ].includes(
      source,
    )
  ) {
    clauses.push(
      'o.source = ?',
    );

    binds.push(
      source,
    );
  }

  if (
    [
      'pix',
      'card',
    ].includes(
      paymentMethod,
    )
  ) {
    clauses.push(
      'p.payment_method = ?',
    );

    binds.push(
      paymentMethod,
    );
  }

  if (
    validIsoDate(
      eventDateFrom,
    )
  ) {
    clauses.push(
      'o.event_date >= ?',
    );

    binds.push(
      eventDateFrom,
    );
  }

  if (
    validIsoDate(
      eventDateTo,
    )
  ) {
    clauses.push(
      'o.event_date <= ?',
    );

    binds.push(
      eventDateTo,
    );
  }

  const safeLimit =
    Math.max(
      1,
      Math.min(
        100,
        Number.parseInt(
          limit,
          10,
        )
        || 50,
      ),
    );

  const safeOffset =
    Math.max(
      0,
      Number.parseInt(
        offset,
        10,
      )
      || 0,
    );

  const result =
    await db
      .prepare(
        `
          SELECT
            o.order_code,
            o.honoree_display_name,
            o.event_type,
            o.event_date,
            o.status,
            o.next_action,
            o.delivery_start,
            o.delivery_end,
            o.source,
            o.created_at,

            c.name AS customer_name,
            c.whatsapp,

            p.total_cents,
            p.payment_method,

            (
              SELECT COALESCE(
                SUM(pay.amount_cents),
                0
              )
              FROM v2_payments pay
              WHERE
                pay.order_id = o.id
                AND pay.status = 'approved'
            ) AS paid_cents
          FROM v2_orders o
          INNER JOIN v2_customers c
            ON c.id = o.customer_id
          INNER JOIN v2_order_pricing p
            ON p.order_id = o.id
          WHERE ${
            clauses.join(
              ' AND ',
            )
          }
          ORDER BY
            o.created_at DESC,
            o.id DESC
          LIMIT ?
          OFFSET ?
        `,
      )
      .bind(
        ...binds,
        safeLimit,
        safeOffset,
      )
      .all();

  return (
    result.results
    || []
  )
    .map(
      (row) => ({
        code:
          row.order_code,

        honoreeName:
          row.honoree_display_name,

        eventType:
          row.event_type,

        eventDate:
          row.event_date,

        status:
          row.status,

        nextAction:
          row.next_action,

        source:
          row.source,

        customerName:
          row.customer_name,

        whatsapp:
          row.whatsapp,

        deliveryWindow: {
          start:
            row.delivery_start,

          end:
            row.delivery_end,
        },

        totalCents:
          Number(
            row.total_cents
            || 0,
          ),

        paidCents:
          Number(
            row.paid_cents
            || 0,
          ),

        paymentMethod:
          row.payment_method,

        createdAt:
          row.created_at,
      }),
    );
}

export async function searchV2Customers(
  db,
  q,
) {
  const search =
    cleanText(
      q,
      120,
    );

  if (!search) {
    return [];
  }

  const like =
    `%${
      search
    }%`;

  const result =
    await db
      .prepare(
        `
          SELECT
            c.id,
            c.name,
            c.whatsapp,
            c.email,

            COUNT(o.id) AS order_count,

            MAX(o.created_at) AS last_order_at
          FROM v2_customers c
          LEFT JOIN v2_orders o
            ON o.customer_id = c.id
          WHERE
            c.name LIKE ?
            OR c.whatsapp LIKE ?
            OR COALESCE(
              c.email,
              ''
            ) LIKE ?
          GROUP BY
            c.id,
            c.name,
            c.whatsapp,
            c.email
          ORDER BY
            last_order_at DESC,
            c.id DESC
          LIMIT 20
        `,
      )
      .bind(
        like,
        like,
        like,
      )
      .all();

  return (
    result.results
    || []
  );
}

export async function reuseV2CustomerFromOrder(
  db,
  orderCode,
) {
  const row =
    await db
      .prepare(
        `
          SELECT
            c.id,
            c.name,
            c.whatsapp,
            c.email
          FROM v2_orders o
          INNER JOIN v2_customers c
            ON c.id = o.customer_id
          WHERE o.order_code = ?
          LIMIT 1
        `,
      )
      .bind(
        orderCode,
      )
      .first();

  if (!row) {
    return null;
  }

  return {
    customer: {
      id:
        row.id,

      name:
        row.name,

      whatsapp:
        row.whatsapp,

      email:
        row.email,
    },

    reused:
      [
        'name',
        'whatsapp',
        'email',
      ],

    copiedAssets:
      false,

    copiedBriefing:
      false,

    copiedEvent:
      false,
  };
}
