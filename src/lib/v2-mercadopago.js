import {
  nowIso,
} from './http.js';

import {
  loadV2Settings,
  v2IntSetting,
} from './v2-catalog.js';

import {
  commitV2CouponUse,
} from './v2-commercial-pricing.js';
import { planV2AllocationForWindow } from './v2-agenda.js';
import { createV2AdminNotification } from './v2-notifications.js';
import { withV2PaymentLock } from './v2-payment-lock.js';

const MP_API_BASE =
  'https://api.mercadopago.com';

function centsToAmount(
  cents,
) {
  return (
    Number(cents)
    / 100
  )
    .toFixed(2);
}

function safeJson(
  value,
) {
  if (
    value
    && typeof value
      === 'object'
  ) {
    return value;
  }

  return {};
}

function paymentMethodConfig(
  method,
  settings,
) {
  if (
    method
    === 'pix'
  ) {
    return {
      not_allowed_types: [
        'credit_card',
        'debit_card',
        'prepaid_card',
        'ticket',
        'account_money',
        'digital_currency',
      ],
    };
  }

  const maxInstallments =
    Math.max(
      1,
      Math.min(
        36,
        v2IntSetting(
          settings,
          'mercado_pago_max_installments',
          12,
        ),
      ),
    );

  const installmentsCost =
    String(
      settings
        ?.mercado_pago_installments_cost
      || 'buyer',
    )
      .trim()
      .toLowerCase()
    === 'seller'
      ? 'seller'
      : 'buyer';

  return {
    default_type:
      'credit_card',

    max_installments:
      maxInstallments,

    installments_cost:
      installmentsCost,

    installments: {
      available: {
        type:
          'all',
      },
    },

    not_allowed_types: [
      'bank_transfer',
      'debit_card',
      'prepaid_card',
      'ticket',
      'account_money',
      'digital_currency',
    ],
  };
}

async function mpFetch(
  env,
  path,
  {
    method = 'GET',
    body = undefined,
    idempotencyKey = undefined,
  } = {},
) {
  const token =
    String(
      env
        .MERCADO_PAGO_ACCESS_TOKEN
      || '',
    )
      .trim();

  if (!token) {
    throw new Error(
      'Mercado Pago ainda não foi configurado no servidor.',
    );
  }

  const headers = {
    accept:
      'application/json',

    authorization:
      `Bearer ${token}`,
  };

  if (body !== undefined) {
    headers[
      'content-type'
    ] =
      'application/json';
  }

  if (idempotencyKey) {
    headers[
      'x-idempotency-key'
    ] =
      idempotencyKey;
  }

  const response =
    await fetch(
      `${MP_API_BASE}${path}`,
      {
        method,
        headers,

        body:
          body === undefined
            ? undefined
            : JSON.stringify(
              body,
            ),
        signal: AbortSignal.timeout(15000),
      },
    );

  let data = {};

  try {
    data =
      await response
        .json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const message =
      data
        ?.message
      || data
        ?.error
      || data
        ?.status_detail
      || 'Mercado Pago recusou a solicitação.';

    const error =
      new Error(
        String(
          message,
        ),
      );

    error.status =
      response.status;

    error.details =
      data;

    throw error;
  }

  return data;
}

export async function createMercadoPagoCheckout(
  request,
  env,
  {
    orderId,
    orderCode,
    publicToken,
    paymentMethod,
    amountDueNowCents,
    customerEmail,
  },
) {
  const settings =
    await loadV2Settings(
      env.DB,
    );

  const expiryMinutes =
    Math.max(
      5,
      Math.min(
        180,
        v2IntSetting(
          settings,
          'mercado_pago_order_expiry_minutes',
          25,
        ),
      ),
    );

  const origin =
    new URL(
      request.url,
    )
      .origin;

  const customerArea =
    `${origin}/meu-pedido/${
      encodeURIComponent(
        publicToken,
      )
    }`;

  const hold = await env.DB.prepare(`SELECT token FROM v2_checkout_holds
    WHERE order_id = ? AND status IN ('active', 'expired') ORDER BY id DESC LIMIT 1`).bind(orderId).first();
  if (!hold) throw new Error('Reserva do pagamento não encontrada.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${orderId}:${hold.token}`)));
  digest[6] = (digest[6] & 15) | 64;
  digest[8] = (digest[8] & 63) | 128;
  const hex = Array.from(digest.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
  const idempotencyKey = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

  const paymentType =
    paymentMethod
    === 'pix'
      ? 'deposit'
      : 'full_payment';

  const amount =
    centsToAmount(
      amountDueNowCents,
    );
  if (!Number.isSafeInteger(amountDueNowCents) || amountDueNowCents <= 0) {
    throw new Error('O valor do pagamento deve ser positivo em centavos.');
  }

  const body = {
    type:
      'online',

    processing_mode:
      'manual',

    capture_mode:
      'automatic_async',

    total_amount:
      amount,

    external_reference:
      orderCode,

    expiration_time:
      `PT${expiryMinutes}M`,

    description:
      paymentMethod
      === 'pix'
        ? `Entrada ${orderCode}`
        : `Pedido ${orderCode}`,

    config: {
      statement_descriptor:
        'LIBRI',

      online: {
        success_url:
          `${customerArea}?payment=success`,

        pending_url:
          `${customerArea}?payment=pending`,

        failure_url:
          `${customerArea}?payment=failure`,

        auto_return:
          'all',

        retries: {
          allowed:
            true,
        },
      },

      payment_method:
        paymentMethodConfig(
          paymentMethod,
          settings,
        ),
    },

    items: [
      {
        external_code:
          orderCode,

        title:
          paymentMethod
          === 'pix'
            ? `Entrada do pedido ${orderCode}`
            : `Pedido ${orderCode}`,

        quantity:
          1,

        unit_measure:
          'unit',

        unit_price:
          amount,

        total_amount:
          amount,
      },
    ],
  };

  if (customerEmail) {
    body.payer = {
      email:
        customerEmail,
    };
  }

  const mpOrder =
    await mpFetch(
      env,
      '/v1/orders',
      {
        method:
          'POST',

        body,

        idempotencyKey,
      },
    );

  const providerOrderId =
    String(
      mpOrder
        ?.id
      || '',
    )
      .trim();

  const checkoutUrl =
    String(
      mpOrder
        ?.checkout_url
      || '',
    )
      .trim();

  if (
    !providerOrderId
    || !checkoutUrl
  ) {
    throw new Error(
      'O Mercado Pago não devolveu a URL de pagamento.',
    );
  }

  const stamp =
    nowIso();

  await env.DB
    .prepare(
      `
        INSERT INTO v2_payments(
          order_id,
          provider,
          payment_type,
          provider_payment_id,
          method,
          status,
          amount_cents,
          fee_cents,
          net_cents,
          installments,
          provider_payload_json,
          paid_at,
          created_at,
          updated_at,

          provider_order_id,
          provider_status,
          provider_status_detail,
          checkout_url,
          external_reference
        )
        SELECT
          ?,
          'mercado_pago',
          ?,
          NULL,
          ?,
          'pending',
          ?,
          0,
          NULL,
          NULL,
          ?,
          NULL,
          ?,
          ?,

          ?,
          ?,
          ?,
          ?,
          ?
        WHERE NOT EXISTS (SELECT 1 FROM v2_payments WHERE provider = 'mercado_pago' AND provider_order_id = ?)
      `,
    )
    .bind(
      orderId,
      paymentType,
      paymentMethod,
      amountDueNowCents,
      JSON.stringify(
        mpOrder,
      ),
      stamp,
      stamp,

      providerOrderId,
      mpOrder
        ?.status
      || 'created',
      mpOrder
        ?.status_detail
      || 'created',
      checkoutUrl,
      orderCode,
      providerOrderId,
    )
    .run();

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
          'payment_checkout_created',
          'Checkout do Mercado Pago criado.',
          ?,
          ?
        )
      `,
    )
    .bind(
      orderId,
      JSON.stringify({
        providerOrderId,
        paymentMethod,
        amountDueNowCents,
      }),
      stamp,
    )
    .run();

  return {
    providerOrderId,
    checkoutUrl,

    providerStatus:
      mpOrder
        ?.status
      || 'created',

    providerStatusDetail:
      mpOrder
        ?.status_detail
      || 'created',
  };
}

export async function fetchMercadoPagoOrder(
  env,
  providerOrderId,
) {
  return mpFetch(
    env,
    `/v1/orders/${
      encodeURIComponent(
        providerOrderId,
      )
    }`,
  );
}

export async function cancelMercadoPagoOrder(env, providerOrderId) {
  return mpFetch(env, `/v1/orders/${encodeURIComponent(providerOrderId)}/cancel`, {
    method: 'POST', idempotencyKey: crypto.randomUUID(),
  });
}

function parseSignature(
  header,
) {
  const values =
    Object.fromEntries(
      String(
        header
        || '',
      )
        .split(',')
        .map(
          (part) =>
            part
              .trim()
              .split(
                '=',
                2,
              ),
        )
        .filter(
          (pair) =>
            pair.length
            === 2,
        ),
    );

  return {
    ts:
      values.ts
      || '',

    v1:
      values.v1
      || '',
  };
}

async function hmacSha256Hex(
  secret,
  message,
) {
  const encoder =
    new TextEncoder();

  const key =
    await crypto
      .subtle
      .importKey(
        'raw',
        encoder.encode(
          secret,
        ),
        {
          name:
            'HMAC',

          hash:
            'SHA-256',
        },
        false,
        [
          'sign',
        ],
      );

  const signature =
    await crypto
      .subtle
      .sign(
        'HMAC',
        key,
        encoder.encode(
          message,
        ),
      );

  return Array.from(
    new Uint8Array(
      signature,
    ),
    (byte) =>
      byte
        .toString(16)
        .padStart(2, '0'),
  ).join('');
}

function constantTimeStringEqual(
  a,
  b,
) {
  const left =
    String(
      a
      || '',
    );

  const right =
    String(
      b
      || '',
    );

  if (
    left.length
    !== right.length
  ) {
    return false;
  }

  let diff = 0;

  for (
    let index = 0;
    index < left.length;
    index += 1
  ) {
    diff |=
      left
        .charCodeAt(
          index,
        )
      ^ right
        .charCodeAt(
          index,
        );
  }

  return diff
    === 0;
}

export async function validateMercadoPagoWebhook(
  request,
  env,
  url,
  body,
) {
  const secret =
    String(
      env
        .MERCADO_PAGO_WEBHOOK_SECRET
      || '',
    )
      .trim();

  if (!secret) {
    throw new Error(
      'Webhook do Mercado Pago ainda não foi configurado.',
    );
  }

  const xSignature =
    request.headers
      .get(
        'x-signature',
      )
    || '';

  const xRequestId =
    request.headers
      .get(
        'x-request-id',
      )
    || '';

  const dataId =
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
    || '';

  const {
    ts,
    v1,
  } =
    parseSignature(
      xSignature,
    );

  if (
    !ts
    || !v1
    || !xRequestId
    || !dataId
    || !/^\d+$/.test(ts)
    || !/^[a-fA-F0-9]{64}$/.test(v1)
    || (body?.data?.id && String(body.data.id) !== String(dataId))
  ) {
    return false;
  }

  /*
   * Manifest oficial:
   * id:<data.id>;request-id:<x-request-id>;ts:<ts>;
   *
   * IMPORTANTE:
   * preservamos exatamente o case do data.id.
   * O SDK oficial corrigiu isso em 2026.
   */
  const manifest =
    `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  const calculated =
    await hmacSha256Hex(
      secret,
      manifest,
    );

  return constantTimeStringEqual(
    calculated,
    v1.toLowerCase(),
  );
}

function orderIsApproved(
  mpOrder,
) {
  return (
    mpOrder
      ?.status
    === 'processed'
    && mpOrder
      ?.status_detail
    === 'accredited'
  );
}

function normalizePaymentStatus(
  mpOrder,
) {
  if (
    orderIsApproved(
      mpOrder,
    )
  ) {
    return 'approved';
  }

  const status =
    String(
      mpOrder
        ?.status
      || '',
    );

  if (status === 'refunded' || status === 'charged_back') return 'refunded';

  const detail =
    String(
      mpOrder
        ?.status_detail
      || '',
    );

  if (
    detail.includes(
      'refund',
    )
  ) {
    return 'refunded';
  }

  if (
    status
    === 'cancelled'
    || status === 'canceled'
    || detail
      .includes(
        'cancel',
      )
  ) {
    return 'cancelled';
  }

  if (
    status
    === 'expired'
    || detail
      .includes(
        'expired',
      )
  ) {
    return 'expired';
  }

  if (
    status
    === 'failed'
    || status
      === 'rejected'
  ) {
    return 'rejected';
  }

  return 'pending';
}

function firstTransaction(
  mpOrder,
) {
  return (
    mpOrder
      ?.transactions
      ?.payments
      ?.[0]
    || {}
  );
}

async function convertHoldToAgenda(
  db,
  orderId,
) {
  const hold =
    await db
      .prepare(
        `
          SELECT
            id,
            status,
            expires_at
          FROM v2_checkout_holds
          WHERE
            order_id = ?
            AND status IN ('active', 'expired')
          ORDER BY id DESC
          LIMIT 1
        `,
      )
      .bind(
        orderId,
      )
      .first();

  if (!hold) {
    return {
      converted:
        false,

      reason:
        'hold_not_found',
    };
  }

  const allocationRows =
    await db
      .prepare(
        `
          SELECT
            day,
            points_units
          FROM v2_checkout_hold_allocations
          WHERE hold_id = ?
          ORDER BY day
        `,
      )
      .bind(
        hold.id,
      )
      .all();

  const rows =
    allocationRows
      .results
    || [];

  if (!rows.length) return { converted: false, reason: 'empty_hold' };
  if (hold.expires_at <= nowIso()) {
    const order = await db.prepare('SELECT delivery_start, delivery_end FROM v2_orders WHERE id = ?').bind(orderId).first();
    const plan = await planV2AllocationForWindow(db, {
      start: order.delivery_start, end: order.delivery_end,
      pointsUnits: rows.reduce((sum, row) => sum + Number(row.points_units), 0),
    });
    if (!plan.fits) return { converted: false, reason: 'late_payment_capacity_changed' };
    rows.splice(0, rows.length, ...plan.allocation.map(x => ({ day: x.day, points_units: x.pointsUnits })));
  }

  const existing =
    await db
      .prepare(
        `
          SELECT COUNT(*) AS total
          FROM v2_agenda_allocations
          WHERE order_id = ?
        `,
      )
      .bind(
        orderId,
      )
      .first();

  if (
    Number(
      existing
        ?.total
      || 0,
    )
    > 0
  ) {
    await db
      .prepare(
        `
          UPDATE v2_checkout_holds
          SET
            status = 'converted',
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        nowIso(),
        hold.id,
      )
      .run();

    return {
      converted:
        true,

      alreadyConverted:
        true,
    };
  }

  const settings = await loadV2Settings(db);
  const defaultCapacity = v2IntSetting(settings, 'default_sellable_points_per_day_units', 400);
  const allocationJson = JSON.stringify(rows);
  const conversion = await db.batch([
    ...rows.map(
      (row) =>
        db
          .prepare(
            `
              INSERT INTO v2_agenda_allocations(
                order_id,
                day,
                points_units,
                allocation_type,
                created_at
              )
              SELECT
                ?,
                ?,
                ?,
                'confirmed',
                ?
              WHERE NOT EXISTS (SELECT 1 FROM v2_agenda_allocations WHERE order_id = ? AND day = ?)
                AND NOT EXISTS (
                  SELECT 1 FROM json_each(?) proposed
                  WHERE CAST(json_extract(proposed.value, '$.points_units') AS INTEGER) >
                    CASE WHEN COALESCE((SELECT blocked FROM v2_agenda_days WHERE day = json_extract(proposed.value, '$.day')), 0) = 1 THEN 0
                    ELSE COALESCE((SELECT sellable_capacity_units FROM v2_agenda_days WHERE day = json_extract(proposed.value, '$.day')), ?) END
                    - COALESCE((SELECT SUM(points_units) FROM v2_agenda_allocations WHERE day = json_extract(proposed.value, '$.day') AND order_id != ?), 0)
                    - COALESCE((SELECT SUM(a.points_units) FROM v2_checkout_hold_allocations a JOIN v2_checkout_holds h ON h.id = a.hold_id
                      WHERE a.day = json_extract(proposed.value, '$.day') AND h.status = 'active' AND h.expires_at > ? AND h.order_id != ?), 0)
                )
            `,
          )
          .bind(
            orderId,
            row.day,
            row.points_units,
            nowIso(),
            orderId,
            row.day,
            allocationJson,
            defaultCapacity,
            orderId,
            nowIso(),
            orderId,
          ),
    ),

    db
      .prepare(
        `
          UPDATE v2_checkout_holds
          SET
            status = 'converted',
            updated_at = ?
          WHERE id = ?
            AND EXISTS (SELECT 1 FROM v2_agenda_allocations WHERE order_id = ?)
        `,
      )
      .bind(
        nowIso(),
        hold.id,
        orderId,
      ),
  ]);

  if (conversion.slice(0, rows.length).some(x => Number(x.meta?.changes) !== 1)) {
    return { converted: false, reason: 'capacity_changed' };
  }

  return {
    converted:
      true,
  };
}

async function releaseHold(
  db,
  orderId,
  status,
) {
  await db
    .prepare(
      `
        UPDATE v2_checkout_holds
        SET
          status = ?,
          updated_at = ?
        WHERE
          order_id = ?
          AND status = 'active'
      `,
    )
    .bind(
      status,
      nowIso(),
      orderId,
    )
    .run();
}

export async function syncMercadoPagoOrder(env, providerOrderId, { lock = true } = {}) {
  if (!lock) return syncMercadoPagoOrderUnlocked(env, providerOrderId);
  const payment = await env.DB.prepare(`SELECT order_id FROM v2_payments
    WHERE provider = 'mercado_pago' AND provider_order_id = ?`).bind(providerOrderId).first();
  if (!payment) return { found: false };
  return withV2PaymentLock(env.DB, payment.order_id, () => syncMercadoPagoOrderUnlocked(env, providerOrderId));
}

async function syncMercadoPagoOrderUnlocked(
  env,
  providerOrderId,
) {
  const localPayment =
    await env.DB
      .prepare(
        `
          SELECT
            p.id AS payment_id,
            p.order_id,
            p.status AS local_payment_status,
            p.method,
            p.payment_type,
            p.amount_cents,

            o.order_code,
            o.customer_id,
            o.status AS local_order_status,
            o.briefing_status,

            pr.pricing_snapshot_json,
            pr.coupon_discount_cents
          FROM v2_payments p
          INNER JOIN v2_orders o
            ON o.id = p.order_id
          INNER JOIN v2_order_pricing pr
            ON pr.order_id = o.id
          WHERE
            p.provider = 'mercado_pago'
            AND p.provider_order_id = ?
          LIMIT 1
        `,
      )
      .bind(
        providerOrderId,
      )
      .first();

  if (!localPayment) {
    return {
      found:
        false,
    };
  }

  const mpOrder =
    await fetchMercadoPagoOrder(
      env,
      providerOrderId,
    );

  if (
    String(
      mpOrder
        ?.external_reference
      || '',
    )
    !== String(
      localPayment
        .order_code,
    )
  ) {
    throw new Error(
      'Referência externa do pagamento não corresponde ao pedido.',
    );
  }

  const providerAmount = Number(mpOrder?.total_amount);
  if (!Number.isFinite(providerAmount) || Math.round(providerAmount * 100) !== Number(localPayment.amount_cents)) {
    throw new Error('Valor do Mercado Pago não corresponde ao valor esperado do pedido.');
  }

  const paymentStatus =
    normalizePaymentStatus(
      mpOrder,
    );

  const transaction =
    firstTransaction(
      mpOrder,
    );

  const paidAt =
    paymentStatus
    === 'approved'
      ? (
        transaction
          ?.date_approved
        || mpOrder
          ?.last_updated_date
        || nowIso()
      )
      : null;

  const installments =
    Number.parseInt(
      transaction
        ?.payment_method
        ?.installments
      ?? transaction
        ?.installments,
      10,
    );

  const providerPaymentId =
    String(
      transaction
        ?.id
      || '',
    )
      .trim()
    || null;

  await env.DB
    .prepare(
      `
        UPDATE v2_payments
        SET
          provider_payment_id = COALESCE(?, provider_payment_id),
          status = ?,
          provider_status = ?,
          provider_status_detail = ?,
          installments = ?,
          provider_payload_json = ?,
          paid_at = COALESCE(?, paid_at),
          updated_at = ?
        WHERE id = ?
      `,
    )
    .bind(
      providerPaymentId,
      paymentStatus,
      mpOrder
        ?.status
      || null,
      mpOrder
        ?.status_detail
      || null,
      Number.isInteger(
        installments,
      )
        ? installments
        : null,
      JSON.stringify(
        safeJson(
          mpOrder,
        ),
      ),
      paidAt,
      nowIso(),
      localPayment
        .payment_id,
    )
    .run();

  if (['refunded', 'charged_back'].includes(String(mpOrder.status)) || String(mpOrder.status_detail).includes('refund')) {
    await createV2AdminNotification(env, {
      eventCode: 'PAYMENT_REVIEW', orderId: localPayment.order_id, title: 'Revisar estorno ou contestação',
      body: `${localPayment.order_code} • ${mpOrder.status}/${mpOrder.status_detail}. Confira o valor devolvido e a produção no Mercado Pago.`,
      actionUrl: `/admin-v2?order=${encodeURIComponent(localPayment.order_code)}`,
      priority: 'high', pushEligible: true, dedupeKey: `payment-review:${providerOrderId}:${mpOrder.status}:${mpOrder.status_detail}`,
    });
  }

  if (
    paymentStatus
    === 'approved'
  ) {
    await commitV2CouponUse(
      env.DB,
      {
        orderId:
          localPayment
            .order_id,

        customerId:
          localPayment
            .customer_id,

        pricingSnapshot:
          localPayment
            .pricing_snapshot_json,

        discountCents:
          localPayment
            .coupon_discount_cents,
      },
    );

    const capacity = await convertHoldToAgenda(
      env.DB,
      localPayment
        .order_id,
    );

    if (!capacity.converted && localPayment.briefing_status === 'locked') {
      await createV2AdminNotification(env, {
        eventCode: 'PAYMENT_CONFIRMED', orderId: localPayment.order_id,
        title: 'Pagamento recebido; revisar capacidade',
        body: `${localPayment.order_code} • pagamento recebido após perda da reserva. Revise a agenda antes de liberar a produção.`,
        actionUrl: `/admin-v2?order=${encodeURIComponent(localPayment.order_code)}`,
        priority: 'high', pushEligible: true, dedupeKey: `payment-capacity:${localPayment.order_id}`,
      });
      return { found: true, approved: true, capacityReview: true, paymentStatus };
    }

    const alreadyUnlocked =
      localPayment
        .briefing_status
      !== 'locked';

    await env.DB.batch([
      env.DB
        .prepare(
          `
            UPDATE v2_orders
            SET
              status = 'briefing_pending',
              next_action = 'Briefing aguardando preenchimento',
              briefing_status = 'available',
              updated_at = ?
            WHERE id = ? AND briefing_status = 'locked'
              AND status IN ('awaiting_payment', 'urgency_approved')
          `,
        )
        .bind(
          nowIso(),
          localPayment
            .order_id,
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
            SELECT
              ?,
              'payment_confirmed',
              'Pagamento confirmado pelo Mercado Pago e briefing liberado.',
              ?,
              ?
            WHERE NOT EXISTS (
              SELECT 1
              FROM v2_order_history
              WHERE
                order_id = ?
                AND action_code = 'payment_confirmed'
            )
          `,
        )
        .bind(
          localPayment
            .order_id,
          JSON.stringify({
            providerOrderId,
            paymentType:
              localPayment
                .payment_type,
            method:
              localPayment
                .method,
          }),
          nowIso(),
          localPayment
            .order_id,
        ),

      env.DB
        .prepare(
          `
            INSERT INTO v2_notifications(
              event_code,
              order_id,
              title,
              body,
              action_url,
              priority,
              push_eligible,
              created_at
            )
            SELECT
              'PAYMENT_CONFIRMED',
              ?,
              'Novo pedido confirmado',
              ?,
              ?,
              'high',
              1,
              ?
            WHERE NOT EXISTS (
              SELECT 1
              FROM v2_notifications
              WHERE
                order_id = ?
                AND event_code = 'PAYMENT_CONFIRMED'
            )
          `,
        )
        .bind(
          localPayment
            .order_id,
          `${
            localPayment.order_code
          } • pagamento confirmado • briefing aguardando preenchimento`,
          `/admin-v2?order=${
            encodeURIComponent(
              localPayment
                .order_code,
            )
          }`,
          nowIso(),
          localPayment
            .order_id,
        ),
    ]);

    return {
      found:
        true,

      approved:
        true,

      alreadyUnlocked,

      orderId:
        localPayment
          .order_id,

      orderCode:
        localPayment
          .order_code,

      paymentStatus,
    };
  }

  if (
    [
      'expired',
      'cancelled',
      'rejected',
    ].includes(
      paymentStatus,
    )
  ) {
    const newer = await env.DB.prepare(`SELECT id FROM v2_payments WHERE order_id = ?
      AND id > ? AND status IN ('pending', 'approved') LIMIT 1`)
      .bind(localPayment.order_id, localPayment.payment_id).first();
    if (newer) return { found: true, approved: false, paymentStatus, superseded: true };
    await releaseHold(
      env.DB,
      localPayment
        .order_id,
      paymentStatus
      === 'expired'
        ? 'expired'
        : 'cancelled',
    );

    await env.DB
      .prepare(
        `
          UPDATE v2_orders
          SET
            next_action = ?,
            updated_at = ?
          WHERE id = ?
            AND status = 'awaiting_payment' AND briefing_status = 'locked'
        `,
      )
      .bind(
        paymentStatus
        === 'expired'
          ? 'Pagamento expirado'
          : 'Pagamento não concluído',
        nowIso(),
        localPayment
          .order_id,
      )
      .run();
  }

  return {
    found:
      true,

    approved:
      false,

    orderId:
      localPayment
        .order_id,

    orderCode:
      localPayment
        .order_code,

    paymentStatus,
  };
}

