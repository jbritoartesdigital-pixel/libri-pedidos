import {
  nowIso,
  randomToken,
} from './http.js';

import {
  loadV2Settings,
  v2IntSetting,
} from './v2-catalog.js';

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

  const idempotencyKey =
    randomToken(
      'mp_',
    )
      .slice(
        0,
        120,
      );

  const paymentType =
    paymentMethod
    === 'pix'
      ? 'deposit'
      : 'full_payment';

  const amount =
    centsToAmount(
      amountDueNowCents,
    );

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
        VALUES (
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
        )
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
    v1,
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
            status
          FROM v2_checkout_holds
          WHERE
            order_id = ?
            AND status = 'active'
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

  await db.batch([
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
              VALUES (
                ?,
                ?,
                ?,
                'confirmed',
                ?
              )
            `,
          )
          .bind(
            orderId,
            row.day,
            row.points_units,
            nowIso(),
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
        `,
      )
      .bind(
        nowIso(),
        hold.id,
      ),
  ]);

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

export async function syncMercadoPagoOrder(
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
            o.status AS local_order_status,
            o.briefing_status
          FROM v2_payments p
          INNER JOIN v2_orders o
            ON o.id = p.order_id
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

  if (
    paymentStatus
    === 'approved'
  ) {
    await convertHoldToAgenda(
      env.DB,
      localPayment
        .order_id,
    );

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
            WHERE id = ?
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
          `/admin/pedidos/${
            localPayment
              .order_code
          }`