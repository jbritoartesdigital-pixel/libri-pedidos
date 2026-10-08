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
  findNextV2DeliveryWindow,
  planV2AllocationForWindow,
  validateV2DeliveryWindow,
  validateV2UrgencyWindow,
} from './v2-agenda.js';

import {
  createMercadoPagoCheckout,
  syncMercadoPagoOrder,
  cancelMercadoPagoOrder,
} from './v2-mercadopago.js';
import { withV2PaymentLock } from './v2-payment-lock.js';

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
            AND h.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          LEFT JOIN v2_payments pay
            ON pay.order_id = o.id
            AND pay.provider = 'mercado_pago'
            AND pay.status = 'pending'
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
          row.checkout_url && row.hold_token,
        ),
    },
  };
}

export async function resumeV2Payment(request, env, token, body = {}) {
  const order = await env.DB.prepare(`SELECT o.*, c.email, p.payment_method, p.total_cents, p.deposit_cents, p.balance_cents,
    p.pricing_snapshot_json, u.status AS urgency_status FROM v2_orders o
    JOIN v2_customers c ON c.id = o.customer_id JOIN v2_order_pricing p ON p.order_id = o.id
    LEFT JOIN v2_urgency_requests u ON u.order_id = o.id WHERE o.public_token = ?`).bind(token).first();
  if (!order) throw new V2CheckoutError('Pedido não encontrado.', { status: 404 });
  if (order.archived_at) {
    throw new V2CheckoutError(
      'O prazo de pagamento terminou, mas seu pedido está salvo. Entre em contato com a Libri para reativá-lo.',
      { status: 409, code: 'payment_window_expired' },
    );
  }

  const requestedMethod =
    urgencyPaymentMethod(
      body.paymentMethod,
      urgencyPaymentMethod(
        order.payment_method,
        'pix',
      ),
    );

  const changingMethod =
    requestedMethod
    !== urgencyPaymentMethod(
      order.payment_method,
      'pix',
    );

  return withV2PaymentLock(env.DB, order.id, async () => {
    const payments = await env.DB.prepare(`SELECT provider_order_id, status FROM v2_payments
      WHERE order_id = ? AND provider = 'mercado_pago' AND status IN ('pending', 'approved')
      ORDER BY id DESC`).bind(order.id).all();
    for (const p of payments.results || []) {
      const result = await syncMercadoPagoOrder(env, p.provider_order_id, { lock: false });
      if (result.approved) return { ok: true, alreadyPaid: true, capacityReview: !!result.capacityReview };
    }
    const current = await env.DB.prepare('SELECT status, briefing_status FROM v2_orders WHERE id = ?').bind(order.id).first();
    if (!['awaiting_payment', 'urgency_approved'].includes(current.status) || current.briefing_status !== 'locked') {
      throw new V2CheckoutError('O pedido não está disponível para pagamento.', { status: 409 });
    }
    const recovered = await completedCheckoutResponse(env.DB, order.id);
    if (
      recovered?.payment.ready
      && !changingMethod
    ) {
      return recovered;
    }

    const snapshot = safeJsonObject(order.pricing_snapshot_json);
    let effectiveStart = order.delivery_start;
    let effectiveEnd = order.delivery_end;
    let rescheduledDelivery = null;
    if (order.urgency_status !== 'approved') {
      try {
        await validateV2DeliveryWindow(env.DB, {
          eventDate: order.event_date,
          start: effectiveStart,
          end: effectiveEnd,
        });
      } catch (error) {
        if (error.message !== 'Essa janela não é compatível com a data do evento.') {
          throw error;
        }
        const nextWindow = await findNextV2DeliveryWindow(env.DB, {
          eventDate: order.event_date,
          previousStart: order.delivery_start,
          pointsUnits: snapshot.pointsUnits,
          excludeOrderId: order.id,
        });
        if (!nextWindow) {
          throw new V2CheckoutError(
            'A data original de entrega passou e não encontramos uma nova janela disponível. Entre em contato com a Libri para ajustar a entrega.',
            { status: 409, code: 'delivery_window_unavailable' },
          );
        }
        const previous = { start: order.delivery_start, end: order.delivery_end };
        const accepted = body.confirmedDeliveryWindow?.start === nextWindow.start
          && body.confirmedDeliveryWindow?.end === nextWindow.end;
        if (!accepted) {
          throw new V2CheckoutError(
            'A primeira data de entrega passou. Confira a nova previsão para continuar.',
            { status: 409, code: 'delivery_window_shifted',
              details: { previous, next: nextWindow } },
          );
        }
        effectiveStart = nextWindow.start;
        effectiveEnd = nextWindow.end;
        rescheduledDelivery = { previous, next: nextWindow };
      }
    }

    const orphanHold = await env.DB.prepare(`SELECT id FROM v2_checkout_holds WHERE order_id = ?
      AND status IN ('active', 'expired') AND NOT EXISTS
      (SELECT 1 FROM v2_payments WHERE order_id = ?) ORDER BY id DESC LIMIT 1`).bind(order.id, order.id).first();
    if (
      orphanHold
      && !changingMethod
    ) {
      // Tenta recuperar apenas respostas realmente incertas. Uma rejeição explícita
      // do provedor encerra a reserva órfã e permite uma nova tentativa segura.
      try {
        const checkout = await createMercadoPagoCheckout(request, env, { orderId: order.id,
          orderCode: order.order_code, publicToken: token, paymentMethod: order.payment_method,
          amountDueNowCents: Number(order.deposit_cents), customerEmail: order.email });
        const checked = await syncMercadoPagoOrder(env, checkout.providerOrderId, { lock: false });
        if (checked.approved) return { ok: true, alreadyPaid: true, capacityReview: !!checked.capacityReview };
        if (checked.paymentStatus === 'pending') {
          const existingHold = await env.DB.prepare(`SELECT status, expires_at FROM v2_checkout_holds WHERE id = ?`).bind(orphanHold.id).first();
          if (existingHold.status === 'active' && existingHold.expires_at > nowIso()) return completedCheckoutResponse(env.DB, order.id);
          await cancelMercadoPagoOrder(env, checkout.providerOrderId);
          const cancelled = await syncMercadoPagoOrder(env, checkout.providerOrderId, { lock: false });
          if (cancelled.approved) return { ok: true, alreadyPaid: true, capacityReview: !!cancelled.capacityReview };
          if (cancelled.paymentStatus === 'pending') throw new V2CheckoutError('Aguarde a confirmação do pagamento anterior.', { status: 409 });
        }
      } catch (error) {
        if (error.status && error.status >= 400 && error.status < 500) {
          await env.DB.prepare(`UPDATE v2_checkout_holds SET status = 'cancelled', updated_at = ?
            WHERE id = ? AND status IN ('active', 'expired')`).bind(nowIso(), orphanHold.id).run();
        } else {
          throw error;
        }
      }
    }
    // A replacement checkout is only created after the previous provider order is terminal.
    for (const p of payments.results || []) {
      const live = await env.DB.prepare('SELECT status FROM v2_payments WHERE provider_order_id = ?').bind(p.provider_order_id).first();
      if (live?.status === 'pending') {
        try { await cancelMercadoPagoOrder(env, p.provider_order_id); }
        catch (error) {
          const checked = await syncMercadoPagoOrder(env, p.provider_order_id, { lock: false });
          if (checked.approved) return { ok: true, alreadyPaid: true, capacityReview: !!checked.capacityReview };
          if (checked.paymentStatus === 'pending') throw error;
        }
        const checked = await syncMercadoPagoOrder(env, p.provider_order_id, { lock: false });
        if (checked.approved) return { ok: true, alreadyPaid: true, capacityReview: !!checked.capacityReview };
        if (checked.paymentStatus === 'pending') throw new V2CheckoutError('Aguarde a confirmação do cancelamento anterior.', { status: 409 });
      }
    }
    await env.DB.prepare(`UPDATE v2_checkout_holds SET status = 'cancelled', updated_at = ?
      WHERE order_id = ? AND status = 'active'`).bind(nowIso(), order.id).run();
    if (order.urgency_status === 'approved') {
      await env.DB.prepare(`UPDATE v2_orders SET status = 'urgency_approved' WHERE id = ?
        AND status = 'awaiting_payment' AND briefing_status = 'locked'`).bind(order.id).run();
      return startApprovedV2UrgencyCheckout(request, env, token, body);
    }
    const paymentPricing =
      await repriceV2PaymentMethod(
        env.DB,
        order.id,
        requestedMethod,
      );

    const plan = await planV2AllocationForWindow(env.DB, { start: effectiveStart, end: effectiveEnd, pointsUnits: snapshot.pointsUnits });
    if (!plan.fits) throw new V2CheckoutError('A janela perdeu capacidade. Entre em contato com a Libri para revisar a entrega.', { status: 409, code: 'delivery_window_unavailable' });
    const { terms, termsHash, evidence, alreadyAccepted: termsAlreadyAccepted } =
      await paymentTermsEvidence(request, env, body, order.id);
    if (rescheduledDelivery) {
      // Customer explicitly acknowledged the new window. Preserve order ID,
      // prices, checkout history and public URL; only the delivery dates change.
      const changed = await env.DB.prepare(`UPDATE v2_orders SET delivery_start = ?, delivery_end = ?, updated_at = ?
        WHERE id = ? AND delivery_start = ? AND delivery_end = ?`)
        .bind(effectiveStart, effectiveEnd, nowIso(), order.id,
          order.delivery_start, order.delivery_end).run();
      if (Number(changed.meta?.changes || 0) !== 1) {
        throw new V2CheckoutError('A entrega mudou enquanto você pagava. Atualize o pedido e tente novamente.',
          { status: 409, code: 'delivery_window_changed' });
      }
      await env.DB.prepare(`INSERT INTO v2_order_history(order_id, action_code, description, metadata_json, created_at)
        VALUES (?, 'delivery_window_rescheduled', 'Janela de entrega atualizada após confirmação da cliente.', ?, ?)`)
        .bind(order.id, JSON.stringify(rescheduledDelivery), nowIso()).run();
    }
    const settings = await loadV2Settings(env.DB);
    const minutes = Math.max(v2IntSetting(settings, 'checkout_hold_minutes', 30), v2IntSetting(settings, 'mercado_pago_order_expiry_minutes', 25) + 5);
    const hold = await createCapacityHold(env.DB, {
      orderId: order.id, allocation: plan.allocation,
      expiresAt: new Date(Date.now() + minutes * 60000).toISOString(),
      defaultCapacityUnits: v2IntSetting(settings, 'default_sellable_points_per_day_units', 400),
    });
    try {
      if (!termsAlreadyAccepted) {
        await env.DB.prepare(`INSERT INTO v2_order_terms_acceptances
          (order_id, terms_version, terms_hash, accepted_at, evidence_json) VALUES (?, ?, ?, ?, ?)`)
          .bind(order.id, terms.version, termsHash, nowIso(), JSON.stringify(evidence)).run();
      }
      await createMercadoPagoCheckout(request, env, {
        orderId: order.id, orderCode: order.order_code, publicToken: token,
        paymentMethod: paymentPricing.method, amountDueNowCents: paymentPricing.depositCents, customerEmail: order.email,
      });
      const response = await completedCheckoutResponse(env.DB, order.id);
      return rescheduledDelivery ? { ...response, deliveryRescheduled: rescheduledDelivery } : response;
    } catch (error) {
      // Keep the reservation on uncertain network failures: the provider may have created the order.
      if (error.status && error.status >= 400 && error.status < 500) {
        await env.DB.prepare("UPDATE v2_checkout_holds SET status = 'cancelled' WHERE id = ?").bind(hold.holdId).run();
      }
      throw error;
    }
  });
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

    const holdMinutes = Math.max(v2IntSetting(settings, 'checkout_hold_minutes', 30),
      Math.min(180, Math.max(5, v2IntSetting(settings, 'mercado_pago_order_expiry_minutes', 25))) + 5);

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
      const retained = await env.DB.prepare(`SELECT id, status FROM v2_checkout_holds
        WHERE order_id = ? ORDER BY id DESC LIMIT 1`).bind(orderId).first();
      if (retained) {
        if (error.status && error.status >= 400 && error.status < 500) {
          await env.DB.prepare(`UPDATE v2_checkout_holds SET status = 'cancelled', updated_at = ?
            WHERE id = ? AND status IN ('active', 'expired')`).bind(nowIso(), retained.id).run();
        }
        await completeCheckoutRequest(env.DB, requestKey, orderId);
        return completedCheckoutResponse(env.DB, orderId);
      }
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

/* ==================================================
   URGÊNCIA V2
   Fluxo:
   cliente solicita análise -> Ju decide -> cliente paga
   A taxa é SEMPRE 30% sobre o subtotal já descontado.
================================================== */

function safeJsonObject(
  value,
) {
  try {
    const parsed =
      typeof value
      === 'string'
        ? JSON.parse(
          value
          || '{}',
        )
        : (
          value
          || {}
        );

    return parsed
      && typeof parsed
      === 'object'
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function urgencyPaymentMethod(
  value,
  fallback = 'pix',
) {
  const method =
    cleanText(
      value,
      20,
    );

  return [
    'pix',
    'card',
  ].includes(
    method,
  )
    ? method
    : fallback;
}

async function repriceV2PaymentMethod(
  db,
  orderId,
  requestedMethod,
) {
  const row =
    await db
      .prepare(
        `
          SELECT
            total_cents,
            payment_method,
            pricing_snapshot_json
          FROM v2_order_pricing
          WHERE order_id = ?
          LIMIT 1
        `,
      )
      .bind(
        orderId,
      )
      .first();

  if (!row) {
    throw new V2CheckoutError(
      'Preço do pedido não encontrado.',
      {
        status: 404,
        code: 'pricing_not_found',
      },
    );
  }

  const method =
    urgencyPaymentMethod(
      requestedMethod,
      urgencyPaymentMethod(
        row.payment_method,
        'pix',
      ),
    );

  const totalCents =
    Number(
      row.total_cents
      || 0,
    );

  const depositPercent =
    method === 'card'
      ? 100
      : 50;

  const depositCents =
    Math.round(
      totalCents
      * depositPercent
      / 100,
    );

  const balanceCents =
    Math.max(
      0,
      totalCents
      - depositCents,
    );

  const snapshot =
    safeJsonObject(
      row.pricing_snapshot_json,
    );

  const nextSnapshot = {
    ...snapshot,
    totalCents,
    payment: {
      ...(snapshot.payment || {}),
      method,
      depositPercent,
      depositCents,
      balanceCents,
    },
  };

  await db
    .prepare(
      `
        UPDATE v2_order_pricing
        SET
          payment_method = ?,
          deposit_percent = ?,
          deposit_cents = ?,
          balance_cents = ?,
          pricing_snapshot_json = ?,
          updated_at = ?
        WHERE order_id = ?
      `,
    )
    .bind(
      method,
      depositPercent,
      depositCents,
      balanceCents,
      JSON.stringify(
        nextSnapshot,
      ),
      nowIso(),
      orderId,
    )
    .run();

  return {
    method,
    totalCents,
    depositPercent,
    depositCents,
    balanceCents,
  };
}

async function completeCheckoutRequest(
  db,
  requestKey,
  orderId,
) {
  await db
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
}

async function urgencyRequestResponse(
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
            o.status AS order_status,
            o.event_date,
            o.recommended_target_date,

            u.status AS urgency_status,
            u.urgency_percent,
            u.requested_at,
            u.decided_at
          FROM v2_orders o
          INNER JOIN v2_urgency_requests u
            ON u.order_id = o.id
          WHERE o.id = ?
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

    urgency: {
      status:
        row.urgency_status,

      percent:
        Number(
          row.urgency_percent
          || 30,
        ),

      requestedAt:
        row.requested_at,

      decidedAt:
        row.decided_at,
    },

    order: {
      code:
        row.order_code,

      publicToken:
        row.public_token,

      status:
        row.order_status,

      eventDate:
        row.event_date,

      recommendedTargetDate:
        row.recommended_target_date,

      customerAreaPath:
        `/meu-pedido/${
          row.public_token
        }`,
    },
  };
}

async function createUrgencyRequestOrderRecords(
  db,
  {
    orderCode,
    publicToken,
    customerId,
    eventType,
    eventSubtype,
    honoreeName,
    eventDate,
    recommendedTargetDate,
    quote,
    urgencyPercent,
  },
) {
  const stamp =
    nowIso();

  const appliedUrgencyPercent = Math.max(1, Math.min(100,
    Number.parseInt(urgencyPercent, 10) || 30));
  const urgencyAmountCents = Math.round(Number(quote.subtotalCents || 0) * appliedUrgencyPercent / 100);
  const projectedTotalCents = Number(quote.subtotalCents || 0) + urgencyAmountCents;
  const projectedDepositPercent = quote.payment.method === 'card' ? 100 : 50;
  const projectedDepositCents = Math.round(projectedTotalCents * projectedDepositPercent / 100);
  const projectedBalanceCents = Math.max(0, projectedTotalCents - projectedDepositCents);
  const projectedQuote = {
    ...quote,
    urgency: { approved: false, percent: appliedUrgencyPercent, amountCents: urgencyAmountCents },
    totalCents: projectedTotalCents,
    payment: { ...quote.payment, depositPercent: projectedDepositPercent,
      depositCents: projectedDepositCents, balanceCents: projectedBalanceCents },
  };

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

            'awaiting_urgency_decision',
            'Aguardando análise de encaixe',

            NULL,
            NULL,
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
    !Number.isInteger(
      orderId,
    )
    || orderId <= 0
  ) {
    throw new V2CheckoutError(
      'Não foi possível registrar a solicitação de encaixe.',
      {
        status:
          500,

        code:
          'urgency_order_create_error',
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

        appliedUrgencyPercent,
        urgencyAmountCents,
        projectedTotalCents,

        quote.payment
          .method,

        projectedDepositPercent,
        projectedDepositCents,
        projectedBalanceCents,

        JSON.stringify(
          projectedQuote,
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
          INSERT INTO v2_urgency_requests(
            order_id,
            status,
            urgency_percent,
            requested_delivery_start,
            requested_delivery_end,
            requested_at
          )
          VALUES (
            ?,
            'pending',
            ?,
            NULL,
            NULL,
            ?
          )
        `,
      )
      .bind(
        orderId,
        appliedUrgencyPercent,
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
            'urgency_requested',
            'Cliente solicitou análise de encaixe urgente.',
            ?,
            ?
          )
        `,
      )
      .bind(
        orderId,
        JSON.stringify({
          urgencyPercent:
            appliedUrgencyPercent,

          subtotalCents:
            quote.subtotalCents,

          totalBeforeUrgencyCents:
            quote.totalCents,

          urgencyAmountCents,
          projectedTotalCents,
        }),
        stamp,
      ),
  ]);

  return orderId;
}

async function urgencyTermsEvidence(
  request,
  env,
  body,
) {
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

  return {
    terms,
    termsHash,

    evidence: {
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
    },
  };
}

async function paymentTermsEvidence(request, env, body, orderId) {
  const existing = await env.DB.prepare(
    'SELECT terms_version, terms_hash FROM v2_order_terms_acceptances WHERE order_id = ? ORDER BY id DESC LIMIT 1',
  ).bind(orderId).first();
  if (existing) {
    return { alreadyAccepted: true, terms: { version: existing.terms_version },
      termsHash: existing.terms_hash, evidence: null };
  }
  return { alreadyAccepted: false, ...(await urgencyTermsEvidence(request, env, body)) };
}
export async function requestV2UrgencyReview(
  request,
  env,
  body,
) {
  const rawRequestKey =
    requireText(
      body.clientRequestId,
      'Identificador da solicitação',
      120,
    );

  if (
    rawRequestKey.length < 12
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

  const requestKey =
    `urgency:${rawRequestKey}`;

  const claim =
    await claimCheckoutRequest(
      env.DB,
      requestKey,
    );

  if (!claim.claimed) {
    if (
      claim.existing
        ?.status
      === 'completed'
      && claim.existing
        ?.order_id
    ) {
      const recovered =
        await urgencyRequestResponse(
          env.DB,
          claim.existing
            .order_id,
        );

      if (recovered) {
        return recovered;
      }
    }

    throw new V2CheckoutError(
      'Esta solicitação já está sendo processada.',
      {
        status:
          409,

        code:
          'urgency_request_in_progress',
      },
    );
  }

  let orderId =
    null;

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
      urgencyPaymentMethod(
        body.selection
          ?.paymentMethod,
        'pix',
      );

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

    if (
      (
        delivery.options
        || []
      ).length > 0
      || delivery
        .needsUrgencyReview
        !== true
    ) {
      throw new V2CheckoutError(
        'Ainda existem janelas normais disponíveis para esta data.',
        {
          status:
            409,

          code:
            'regular_delivery_available',

          details: {
            delivery,
          },
        },
      );
    }

    const settings = await loadV2Settings(env.DB);
    const urgencyPercent = Math.max(1, Math.min(100,
      v2IntSetting(settings, 'urgency_percent', 30)));

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

    const orderCode =
      await nextOrderCode(
        env.DB,
      );

    const publicToken =
      randomToken(
        'ord_',
      );

    orderId =
      await createUrgencyRequestOrderRecords(
        env.DB,
        {
          orderCode,
          publicToken,
          customerId,

          eventType,
          eventSubtype,
          honoreeName,
          eventDate,

          recommendedTargetDate:
            delivery
              .recommendedTargetDate,

          quote,
          urgencyPercent,
        },
      );

    await completeCheckoutRequest(
      env.DB,
      requestKey,
      orderId,
    );

    try {
      const {
        createV2AdminNotification,
      } =
        await import(
          './v2-notifications.js'
        );

      await createV2AdminNotification(
        env,
        {
          eventCode:
            'URGENCY_REQUESTED',

          orderId,

          title:
            'Pedido de encaixe urgente',

          body:
            `${orderCode} • ${honoreeName} • evento em ${eventDate}`,

          actionUrl:
            '/admin-v2',

          priority:
            'high',

          pushEligible:
            true,

          dedupeKey:
            `urgency-requested:${orderId}`,
        },
      );
    } catch {
      /*
       * A solicitação não pode ser perdida
       * se apenas a notificação falhar.
       */
    }

    return {
      ok: true,

      recovered:
        false,

      urgency: {
        status:
          'pending',

        percent:
          urgencyPercent,
      },

      order: {
        code:
          orderCode,

        publicToken,

        status:
          'awaiting_urgency_decision',

        eventDate,

        recommendedTargetDate:
          delivery
            .recommendedTargetDate,

        customerAreaPath:
          `/meu-pedido/${
            publicToken
          }`,
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
      || 'Não foi possível solicitar o encaixe.',
      {
        status:
          Number(
            error
              ?.status,
          )
          || 500,

        code:
          'urgency_request_error',

        details:
          error
            ?.details,
      },
    );
  }
}

export async function repriceApprovedV2Urgency(
  db,
  orderId,
  paymentMethod = null,
) {
  const row =
    await db
      .prepare(
        `
          SELECT
            subtotal_cents,
            combo_discount_cents,
            coupon_discount_cents,
            payment_method,
            pricing_snapshot_json,
            u.urgency_percent AS requested_urgency_percent
          FROM v2_order_pricing p
          LEFT JOIN v2_urgency_requests u ON u.order_id = p.order_id
          WHERE p.order_id = ?
          LIMIT 1
        `,
      )
      .bind(
        orderId,
      )
      .first();

  if (!row) {
    throw new V2CheckoutError(
      'Preço do pedido não encontrado.',
      {
        status:
          404,

        code:
          'urgency_pricing_not_found',
      },
    );
  }

  const snapshot =
    safeJsonObject(
      row.pricing_snapshot_json,
    );

  const method =
    urgencyPaymentMethod(
      paymentMethod,
      urgencyPaymentMethod(
        row.payment_method,
        'pix',
      ),
    );

  const subtotalCents =
    Number(
      row.subtotal_cents
      || 0,
    );

  const urgencyPercent = Math.max(1, Math.min(100,
    Number.parseInt(row.requested_urgency_percent, 10) || 30));

  const urgencyAmountCents =
    Math.round(
      subtotalCents
      * urgencyPercent
      / 100,
    );

  const totalCents =
    subtotalCents
    + urgencyAmountCents;

  const depositPercent =
    method
    === 'card'
      ? 100
      : 50;

  const depositCents =
    Math.round(
      totalCents
      * depositPercent
      / 100,
    );

  const balanceCents =
    Math.max(
      0,
      totalCents
      - depositCents,
    );

  const nextSnapshot = {
    ...snapshot,

    urgency: {
      approved:
        true,

      percent:
        urgencyPercent,

      amountCents:
        urgencyAmountCents,
    },

    totalCents,

    payment: {
      ...(
        snapshot.payment
        || {}
      ),

      method,

      depositPercent,
      depositCents,
      balanceCents,
    },
  };

  await db
    .prepare(
      `
        UPDATE v2_order_pricing
        SET
          urgency_percent = ?,
          urgency_amount_cents = ?,
          total_cents = ?,
          payment_method = ?,
          deposit_percent = ?,
          deposit_cents = ?,
          balance_cents = ?,
          pricing_snapshot_json = ?,
          updated_at = ?
        WHERE order_id = ?
      `,
    )
    .bind(
      urgencyPercent,
      urgencyAmountCents,
      totalCents,
      method,
      depositPercent,
      depositCents,
      balanceCents,
      JSON.stringify(
        nextSnapshot,
      ),
      nowIso(),
      orderId,
    )
    .run();

  return {
    subtotalCents,
    urgencyPercent,
    urgencyAmountCents,
    totalCents,

    payment: {
      method,
      depositPercent,
      depositCents,
      balanceCents,
    },

    pricingSnapshot:
      nextSnapshot,
  };
}

export async function startApprovedV2UrgencyCheckout(
  request,
  env,
  publicToken,
  body,
) {
  const rawRequestKey =
    requireText(
      body.clientRequestId,
      'Identificador do checkout',
      120,
    );

  if (
    rawRequestKey.length < 12
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

  const requestKey =
    `urgency-payment:${publicToken}:${rawRequestKey}`;

  const claim =
    await claimCheckoutRequest(
      env.DB,
      requestKey,
    );

  if (!claim.claimed) {
    if (
      claim.existing
        ?.status
      === 'completed'
      && claim.existing
        ?.order_id
    ) {
      const recovered =
        await completedCheckoutResponse(
          env.DB,
          claim.existing
            .order_id,
        );

      if (recovered) {
        return recovered;
      }
    }

    throw new V2CheckoutError(
      'Este pagamento já está sendo processado.',
      {
        status:
          409,

        code:
          'checkout_in_progress',
      },
    );
  }

  let orderId =
    null;

  let holdCreated =
    false;

  try {
    const token =
      requireText(
        publicToken,
        'Pedido',
        80,
      );

    const order =
      await env.DB
        .prepare(
          `
            SELECT
              o.id,
              o.order_code,
              o.public_token,
              o.event_date,
              o.status,
              o.delivery_start,
              o.delivery_end,
              o.customer_id,

              c.email,

              p.pricing_snapshot_json,

              u.status AS urgency_status
            FROM v2_orders o
            INNER JOIN v2_customers c
              ON c.id = o.customer_id
            INNER JOIN v2_order_pricing p
              ON p.order_id = o.id
            INNER JOIN v2_urgency_requests u
              ON u.order_id = o.id
            WHERE o.public_token = ?
            LIMIT 1
          `,
        )
        .bind(
          token,
        )
        .first();

    if (!order) {
      throw new V2CheckoutError(
        'Pedido não encontrado.',
        {
          status:
            404,

          code:
            'order_not_found',
        },
      );
    }

    orderId =
      Number(
        order.id,
      );

    if (
      order.status
      === 'awaiting_payment'
    ) {
      const existing =
        await completedCheckoutResponse(
          env.DB,
          orderId,
        );

      if (
        existing
        ?.payment
        ?.checkoutUrl
      ) {
        await completeCheckoutRequest(
          env.DB,
          requestKey,
          orderId,
        );

        return existing;
      }
    }

    if (
      order.status
      !== 'urgency_approved'
      || order.urgency_status
      !== 'approved'
    ) {
      throw new V2CheckoutError(
        'O encaixe ainda não foi aprovado pela Libri.',
        {
          status:
            409,

          code:
            'urgency_not_approved',
        },
      );
    }

    const deliveryStart =
      cleanText(
        order.delivery_start,
        10,
      );

    const deliveryEnd =
      cleanText(
        order.delivery_end,
        10,
      );

    if (
      !validIsoDate(
        deliveryStart,
      )
      || !validIsoDate(
        deliveryEnd,
      )
      || deliveryStart
        > deliveryEnd
      || deliveryEnd
        > order.event_date
    ) {
      throw new V2CheckoutError(
        'A janela aprovada para o encaixe é inválida.',
        {
          status:
            409,

          code:
            'urgency_window_invalid',
        },
      );
    }

    validateV2UrgencyWindow(deliveryStart, deliveryEnd, order.event_date);

    const paymentMethod =
      urgencyPaymentMethod(
        body.paymentMethod,
        '',
      );

    if (!paymentMethod) {
      throw new V2CheckoutError(
        'Escolha Pix ou cartão.',
      );
    }

    const { terms, termsHash, evidence, alreadyAccepted: termsAlreadyAccepted } =
      await paymentTermsEvidence(request, env, body, orderId);

    const storedSnapshot =
      safeJsonObject(
        order.pricing_snapshot_json,
      );

    const pointsUnits =
      Number.parseInt(
        storedSnapshot
          .pointsUnits,
        10,
      );

    if (
      !Number.isInteger(
        pointsUnits,
      )
      || pointsUnits <= 0
    ) {
      throw new V2CheckoutError(
        'A carga de produção deste pedido é inválida.',
        {
          status:
            409,

          code:
            'urgency_points_invalid',
        },
      );
    }

    const plan =
      await planV2AllocationForWindow(
        env.DB,
        {
          start:
            deliveryStart,

          end:
            deliveryEnd,

          pointsUnits,
        },
      );

    if (!plan.fits) {
      throw new V2CheckoutError(
        'O encaixe aprovado perdeu capacidade disponível. A Libri precisa revisar a janela antes do pagamento.',
        {
          status:
            409,

          code:
            'urgency_capacity_changed',
        },
      );
    }

    const pricing =
      await repriceApprovedV2Urgency(
        env.DB,
        orderId,
        paymentMethod,
      );

    const settings =
      await loadV2Settings(
        env.DB,
      );

    const holdMinutes = Math.max(v2IntSetting(settings, 'checkout_hold_minutes', 30),
      Math.min(180, Math.max(5, v2IntSetting(settings, 'mercado_pago_order_expiry_minutes', 25))) + 5);

    const defaultCapacityUnits =
      v2IntSetting(
        settings,
        'default_sellable_points_per_day_units',
        400,
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

    holdCreated =
      true;

    const stamp =
      nowIso();

    if (!termsAlreadyAccepted) {
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
          orderId,
          terms.version,
          termsHash,
          stamp,
          JSON.stringify(
            evidence,
          ),
        )
        .run();
    }

    const mpCheckout =
      await createMercadoPagoCheckout(
        request,
        env,
        {
          orderId,

          orderCode:
            order.order_code,

          publicToken:
            order.public_token,

          paymentMethod,

          amountDueNowCents:
            pricing.payment
              .depositCents,

          customerEmail:
            order.email,
        },
      );

    await env.DB.batch([
      env.DB
        .prepare(
          `
            UPDATE v2_orders
            SET
              status = 'awaiting_payment',
              next_action = 'Aguardando pagamento',
              urgency_enabled = 1,
              updated_at = ?
            WHERE id = ?
          `,
        )
        .bind(
          stamp,
          orderId,
        ),

      env.DB
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
              'urgency_checkout_started',
              'Pagamento do encaixe urgente iniciado.',
              ?,
              ?
            )
          `,
        )
        .bind(
          orderId,
          JSON.stringify({
            deliveryStart,
            deliveryEnd,

            urgencyPercent:
              pricing.urgencyPercent,

            urgencyAmountCents:
              pricing
                .urgencyAmountCents,

            totalCents:
              pricing
                .totalCents,

            paymentMethod,
          }),
          stamp,
        ),
    ]);

    await completeCheckoutRequest(
      env.DB,
      requestKey,
      orderId,
    );

    return {
      ok: true,

      recovered:
        false,

      order: {
        code:
          order.order_code,

        publicToken:
          order.public_token,

        customerAreaPath:
          `/meu-pedido/${
            order.public_token
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
          pricing
            .totalCents,

        amountDueNowCents:
          pricing.payment
            .depositCents,

        balanceCents:
          pricing.payment
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
    if (
      orderId
      && holdCreated
    ) {
      const payment =
        await env.DB
          .prepare(
            `
              SELECT id
              FROM v2_payments
              WHERE
                order_id = ?
                AND provider = 'mercado_pago'
                AND status = 'pending'
              ORDER BY id DESC
              LIMIT 1
            `,
          )
          .bind(
            orderId,
          )
          .first();

      if (!payment && error.status && error.status >= 400 && error.status < 500) {
        await env.DB
          .prepare(
            `
              DELETE FROM v2_checkout_holds
              WHERE
                order_id = ?
                AND status = 'active'
            `,
          )
          .bind(
            orderId,
          )
          .run();
      } else {
        await env.DB
          .prepare(
            `
              UPDATE v2_orders
              SET
                status = 'awaiting_payment',
                next_action = 'Aguardando pagamento',
                urgency_enabled = 1,
                updated_at = ?
              WHERE id = ?
            `,
          )
          .bind(
            nowIso(),
            orderId,
          )
          .run();
      }
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
      || 'Não foi possível iniciar o pagamento do encaixe.',
      {
        status:
          Number(
            error
              ?.status,
          )
          || 502,

        code:
          'urgency_payment_error',

        details:
          error
            ?.details,
      },
    );
  }
}

