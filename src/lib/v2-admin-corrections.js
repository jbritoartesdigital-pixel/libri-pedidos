import {
  nowIso,
  parseJson,
} from './http.js';

import {
  planV2AllocationForWindow,
} from './v2-agenda.js';

const ORDER_STATUSES = new Set([
  'configuring',
  'awaiting_urgency_decision',
  'urgency_approved',
  'awaiting_payment',
  'briefing_pending',
  'ready_for_production',
  'in_production',
  'waiting_customer',
  'adjustments',
  'approved',
  'balance_pending',
  'ready_for_delivery',
  'finalized',
  'cancelled',
]);

const BRIEFING_STATUSES = new Set([
  'locked',
  'available',
  'in_progress',
  'completed',
]);

const EVENT_TYPES = new Set([
  'birthday',
  '15_years',
  'wedding',
  'celebration',
  'other',
]);

const PAYMENT_STATUSES = new Set([
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'refunded',
  'expired',
]);

const PAYMENT_TYPES = new Set([
  'deposit',
  'full_payment',
  'balance',
  'refund',
]);

const PAYMENT_METHODS = new Set([
  'pix',
  'card',
]);

function text(
  value,
  max = 4000,
) {
  return String(
    value ?? '',
  )
    .trim()
    .slice(
      0,
      max,
    );
}

function nullableText(
  value,
  max = 4000,
) {
  const result =
    text(
      value,
      max,
    );

  return result
    || null;
}

function dateValue(
  value,
  {
    nullable = false,
    label = 'Data',
  } = {},
) {
  const cleaned =
    text(
      value,
      10,
    );

  if (
    !cleaned
    && nullable
  ) {
    return null;
  }

  if (
    !/^\d{4}-\d{2}-\d{2}$/
      .test(
        cleaned,
      )
  ) {
    throw new Error(
      `${label} inválida.`,
    );
  }

  return cleaned;
}

function dateTimeValue(
  value,
  {
    nullable = true,
    label = 'Data/hora',
  } = {},
) {
  const cleaned =
    text(
      value,
      40,
    );

  if (
    !cleaned
    && nullable
  ) {
    return null;
  }

  const timestamp =
    Date.parse(
      cleaned,
    );

  if (
    !Number.isFinite(
      timestamp,
    )
  ) {
    throw new Error(
      `${label} inválida.`,
    );
  }

  return new Date(
    timestamp,
  )
    .toISOString();
}

function cents(
  value,
  label,
  {
    nullable = false,
  } = {},
) {
  if (
    (
      value === null
      || value === undefined
      || value === ''
    )
    && nullable
  ) {
    return null;
  }

  const number =
    Number.parseInt(
      value,
      10,
    );

  if (
    !Number.isInteger(
      number,
    )
    || number < 0
  ) {
    throw new Error(
      `${label} inválido.`,
    );
  }

  return number;
}

function integer(
  value,
  label,
  {
    min = 0,
    max = 100,
    nullable = false,
  } = {},
) {
  if (
    (
      value === null
      || value === undefined
      || value === ''
    )
    && nullable
  ) {
    return null;
  }

  const number =
    Number.parseInt(
      value,
      10,
    );

  if (
    !Number.isInteger(
      number,
    )
    || number < min
    || number > max
  ) {
    throw new Error(
      `${label} inválido.`,
    );
  }

  return number;
}

async function orderContext(
  db,
  orderCode,
) {
  return db
    .prepare(
      `
        SELECT
          o.*,
          c.name AS customer_name,
          c.whatsapp,
          c.email,
          p.subtotal_cents,
          p.combo_discount_cents,
          p.coupon_discount_cents,
          p.urgency_percent,
          p.urgency_amount_cents,
          p.total_cents,
          p.payment_method,
          p.deposit_percent,
          p.deposit_cents,
          p.balance_cents,
          p.pricing_snapshot_json
        FROM v2_orders o
        INNER JOIN v2_customers c
          ON c.id = o.customer_id
        INNER JOIN v2_order_pricing p
          ON p.order_id = o.id
        WHERE o.order_code = ?
        LIMIT 1
      `,
    )
    .bind(
      orderCode,
    )
    .first();
}

async function orderPointsUnits(
  db,
  orderId,
) {
  const row =
    await db
      .prepare(
        `
          SELECT
            COALESCE(
              SUM(
                points_units
                * quantity
              ),
              0
            ) AS total
          FROM v2_order_items
          WHERE order_id = ?
        `,
      )
      .bind(
        orderId,
      )
      .first();

  return Number(
    row?.total
    || 0,
  );
}

function historyInsert(
  db,
  orderId,
  actionCode,
  description,
  metadata,
  stamp,
) {
  return db
    .prepare(
      `
        INSERT INTO v2_order_history(
          order_id,
          action_code,
          description,
          metadata_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?)
      `,
    )
    .bind(
      orderId,
      actionCode,
      description,
      JSON.stringify(
        metadata
        || {},
      ),
      stamp,
    );
}

export async function correctV2Order(
  db,
  orderCode,
  body = {},
) {
  const current =
    await orderContext(
      db,
      orderCode,
    );

  if (!current) {
    return null;
  }

  const orderInput =
    body.order
    && typeof body.order
    === 'object'
      ? body.order
      : {};

  const pricingInput =
    body.pricing
    && typeof body.pricing
    === 'object'
      ? body.pricing
      : {};

  const nextStatus =
    orderInput.status !== undefined
      ? text(
        orderInput.status,
        80,
      )
      : current.status;

  if (
    !ORDER_STATUSES.has(
      nextStatus,
    )
  ) {
    throw new Error(
      'Status do pedido inválido.',
    );
  }

  const nextBriefingStatus =
    orderInput.briefingStatus !== undefined
      ? text(
        orderInput.briefingStatus,
        80,
      )
      : current.briefing_status;

  if (
    !BRIEFING_STATUSES.has(
      nextBriefingStatus,
    )
  ) {
    throw new Error(
      'Status do briefing inválido.',
    );
  }

  const nextEventType =
    orderInput.eventType !== undefined
      ? text(
        orderInput.eventType,
        80,
      )
      : current.event_type;

  if (
    !EVENT_TYPES.has(
      nextEventType,
    )
  ) {
    throw new Error(
      'Tipo de evento inválido.',
    );
  }

  const nextEventDate =
    orderInput.eventDate !== undefined
      ? dateValue(
        orderInput.eventDate,
        {
          label:
            'Data da festa',
        },
      )
      : current.event_date;

  const nextDeliveryStart =
    orderInput.deliveryStart !== undefined
      ? dateValue(
        orderInput.deliveryStart,
        {
          nullable:
            true,
          label:
            'Início da entrega',
        },
      )
      : current.delivery_start;

  const nextDeliveryEnd =
    orderInput.deliveryEnd !== undefined
      ? dateValue(
        orderInput.deliveryEnd,
        {
          nullable:
            true,
          label:
            'Fim da entrega',
        },
      )
      : current.delivery_end;

  if (
    Boolean(
      nextDeliveryStart,
    )
    !== Boolean(
      nextDeliveryEnd,
    )
  ) {
    throw new Error(
      'Informe início e fim da entrega, ou deixe os dois vazios.',
    );
  }

  if (
    nextDeliveryStart
    && nextDeliveryEnd
    && nextDeliveryEnd
      < nextDeliveryStart
  ) {
    throw new Error(
      'A data final da entrega não pode ser anterior à inicial.',
    );
  }

  const nextPaymentMethod =
    pricingInput.paymentMethod !== undefined
      ? text(
        pricingInput.paymentMethod,
        20,
      )
      : current.payment_method;

  if (
    !PAYMENT_METHODS.has(
      nextPaymentMethod,
    )
  ) {
    throw new Error(
      'Forma de pagamento inválida.',
    );
  }

  const nextTotal =
    pricingInput.totalCents !== undefined
      ? cents(
        pricingInput.totalCents,
        'Total',
      )
      : Number(
        current.total_cents
        || 0,
      );

  const nextDepositPercent =
    pricingInput.depositPercent !== undefined
      ? integer(
        pricingInput.depositPercent,
        'Percentual de entrada',
        {
          min:
            0,
          max:
            100,
        },
      )
      : (
        pricingInput.paymentMethod !== undefined
          ? (
            nextPaymentMethod
            === 'card'
              ? 100
              : 50
          )
          : Number(
            current.deposit_percent
            || 0,
          )
      );

  const nextDeposit =
    pricingInput.depositCents !== undefined
      ? cents(
        pricingInput.depositCents,
        'Entrada',
      )
      : (
        pricingInput.totalCents !== undefined
        || pricingInput.depositPercent !== undefined
        || pricingInput.paymentMethod !== undefined
          ? Math.round(
            nextTotal
            * nextDepositPercent
            / 100,
          )
          : Number(
            current.deposit_cents
            || 0,
          )
      );

  const nextBalance =
    pricingInput.balanceCents !== undefined
      ? cents(
        pricingInput.balanceCents,
        'Saldo',
      )
      : (
        pricingInput.totalCents !== undefined
        || pricingInput.depositCents !== undefined
        || pricingInput.depositPercent !== undefined
        || pricingInput.paymentMethod !== undefined
          ? Math.max(
            0,
            nextTotal
            - nextDeposit,
          )
          : Number(
            current.balance_cents
            || 0,
          )
      );

  const nextSubtotal =
    pricingInput.subtotalCents !== undefined
      ? cents(
        pricingInput.subtotalCents,
        'Subtotal',
      )
      : Number(
        current.subtotal_cents
        || 0,
      );

  const nextComboDiscount =
    pricingInput.comboDiscountCents !== undefined
      ? cents(
        pricingInput.comboDiscountCents,
        'Desconto do combo',
      )
      : Number(
        current.combo_discount_cents
        || 0,
      );

  const nextCouponDiscount =
    pricingInput.couponDiscountCents !== undefined
      ? cents(
        pricingInput.couponDiscountCents,
        'Desconto do cupom',
      )
      : Number(
        current.coupon_discount_cents
        || 0,
      );

  const nextUrgencyPercent =
    pricingInput.urgencyPercent !== undefined
      ? integer(
        pricingInput.urgencyPercent,
        'Urgência',
        {
          min:
            0,
          max:
            100,
        },
      )
      : Number(
        current.urgency_percent
        || 0,
      );

  const nextUrgencyAmount =
    pricingInput.urgencyAmountCents !== undefined
      ? cents(
        pricingInput.urgencyAmountCents,
        'Valor da urgência',
      )
      : Number(
        current.urgency_amount_cents
        || 0,
      );

  const activeForAgenda =
    ![
      'cancelled',
      'finalized',
    ].includes(
      nextStatus,
    );

  let allocation =
    [];

  if (
    activeForAgenda
    && nextDeliveryStart
    && nextDeliveryEnd
  ) {
    const pointsUnits =
      await orderPointsUnits(
        db,
        current.id,
      );

    if (
      pointsUnits > 0
    ) {
      const plan =
        await planV2AllocationForWindow(
          db,
          {
            start:
              nextDeliveryStart,
            end:
              nextDeliveryEnd,
            pointsUnits,
            excludeOrderId:
              current.id,
          },
        );

      if (!plan.fits) {
        throw new Error(
          'A janela informada não comporta a carga deste pedido na agenda.',
        );
      }

      allocation =
        plan.allocation;
    }
  }

  const stamp =
    nowIso();

  const before = {
    customerName:
      current.customer_name,
    whatsapp:
      current.whatsapp,
    email:
      current.email,
    honoreeName:
      current.honoree_display_name,
    eventType:
      current.event_type,
    eventSubtype:
      current.event_subtype,
    eventDate:
      current.event_date,
    deliveryStart:
      current.delivery_start,
    deliveryEnd:
      current.delivery_end,
    status:
      current.status,
    nextAction:
      current.next_action,
    briefingStatus:
      current.briefing_status,
    pricing: {
      subtotalCents:
        current.subtotal_cents,
      comboDiscountCents:
        current.combo_discount_cents,
      couponDiscountCents:
        current.coupon_discount_cents,
      urgencyPercent:
        current.urgency_percent,
      urgencyAmountCents:
        current.urgency_amount_cents,
      totalCents:
        current.total_cents,
      paymentMethod:
        current.payment_method,
      depositPercent:
        current.deposit_percent,
      depositCents:
        current.deposit_cents,
      balanceCents:
        current.balance_cents,
    },
  };

  const snapshot =
    parseJson(
      current.pricing_snapshot_json,
      {},
    );

  const after = {
    customerName:
      orderInput.customerName !== undefined
        ? text(
          orderInput.customerName,
          240,
        )
        : current.customer_name,
    whatsapp:
      orderInput.whatsapp !== undefined
        ? text(
          orderInput.whatsapp,
          80,
        )
        : current.whatsapp,
    email:
      orderInput.email !== undefined
        ? nullableText(
          orderInput.email,
          320,
        )
        : current.email,
    honoreeName:
      orderInput.honoreeName !== undefined
        ? text(
          orderInput.honoreeName,
          240,
        )
        : current.honoree_display_name,
    eventType:
      nextEventType,
    eventSubtype:
      orderInput.eventSubtype !== undefined
        ? nullableText(
          orderInput.eventSubtype,
          240,
        )
        : current.event_subtype,
    eventDate:
      nextEventDate,
    deliveryStart:
      nextDeliveryStart,
    deliveryEnd:
      nextDeliveryEnd,
    status:
      nextStatus,
    nextAction:
      orderInput.nextAction !== undefined
        ? nullableText(
          orderInput.nextAction,
          500,
        )
        : current.next_action,
    briefingStatus:
      nextBriefingStatus,
    pricing: {
      subtotalCents:
        nextSubtotal,
      comboDiscountCents:
        nextComboDiscount,
      couponDiscountCents:
        nextCouponDiscount,
      urgencyPercent:
        nextUrgencyPercent,
      urgencyAmountCents:
        nextUrgencyAmount,
      totalCents:
        nextTotal,
      paymentMethod:
        nextPaymentMethod,
      depositPercent:
        nextDepositPercent,
      depositCents:
        nextDeposit,
      balanceCents:
        nextBalance,
    },
  };

  if (
    !after.customerName
    || !after.whatsapp
    || !after.honoreeName
  ) {
    throw new Error(
      'Cliente, WhatsApp e pessoa/evento não podem ficar vazios.',
    );
  }

  const batch = [
    db
      .prepare(
        `
          UPDATE v2_customers
          SET
            name = ?,
            whatsapp = ?,
            email = ?,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        after.customerName,
        after.whatsapp,
        after.email,
        stamp,
        current.customer_id,
      ),

    db
      .prepare(
        `
          UPDATE v2_orders
          SET
            event_type = ?,
            event_subtype = ?,
            honoree_display_name = ?,
            event_date = ?,
            status = ?,
            next_action = ?,
            delivery_start = ?,
            delivery_end = ?,
            briefing_status = ?,
            finalized_at = CASE
              WHEN ? = 'finalized'
                THEN COALESCE(
                  finalized_at,
                  ?
                )
              WHEN ? != 'finalized'
                THEN NULL
              ELSE finalized_at
            END,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        after.eventType,
        after.eventSubtype,
        after.honoreeName,
        after.eventDate,
        after.status,
        after.nextAction,
        after.deliveryStart,
        after.deliveryEnd,
        after.briefingStatus,
        after.status,
        stamp,
        after.status,
        stamp,
        current.id,
      ),

    db
      .prepare(
        `
          UPDATE v2_order_pricing
          SET
            subtotal_cents = ?,
            combo_discount_cents = ?,
            coupon_discount_cents = ?,
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
        after.pricing.subtotalCents,
        after.pricing.comboDiscountCents,
        after.pricing.couponDiscountCents,
        after.pricing.urgencyPercent,
        after.pricing.urgencyAmountCents,
        after.pricing.totalCents,
        after.pricing.paymentMethod,
        after.pricing.depositPercent,
        after.pricing.depositCents,
        after.pricing.balanceCents,
        JSON.stringify({
          ...snapshot,
          adminCorrection: {
            correctedAt:
              stamp,
            previousTotalCents:
              Number(
                current.total_cents
                || 0,
              ),
          },
        }),
        stamp,
        current.id,
      ),

    db
      .prepare(
        'DELETE FROM v2_agenda_allocations WHERE order_id = ?',
      )
      .bind(
        current.id,
      ),
  ];

  for (
    const row
    of allocation
  ) {
    batch.push(
      db
        .prepare(
          `
            INSERT OR IGNORE INTO v2_agenda_days(
              day
            )
            VALUES (?)
          `,
        )
        .bind(
          row.day,
        ),

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
            VALUES (?, ?, ?, 'confirmed', ?)
          `,
        )
        .bind(
          current.id,
          row.day,
          row.pointsUnits,
          stamp,
        ),
    );
  }

  batch.push(
    historyInsert(
      db,
      current.id,
      'admin_order_corrected',
      'Dados do pedido corrigidos manualmente no Admin.',
      {
        before,
        after,
        note:
          text(
            body.note,
            1000,
          ),
      },
      stamp,
    ),
  );

  await db.batch(
    batch,
  );

  return {
    corrected:
      true,
    code:
      current.order_code,
  };
}

export async function correctV2Payment(
  db,
  orderCode,
  paymentId,
  body = {},
) {
  const payment =
    await db
      .prepare(
        `
          SELECT
            p.*,
            o.order_code
          FROM v2_payments p
          INNER JOIN v2_orders o
            ON o.id = p.order_id
          WHERE
            p.id = ?
            AND o.order_code = ?
          LIMIT 1
        `,
      )
      .bind(
        paymentId,
        orderCode,
      )
      .first();

  if (!payment) {
    return null;
  }

  const status =
    body.status !== undefined
      ? text(
        body.status,
        40,
      )
      : payment.status;

  const paymentType =
    body.paymentType !== undefined
      ? text(
        body.paymentType,
        40,
      )
      : payment.payment_type;

  const method =
    body.method !== undefined
      ? text(
        body.method,
        20,
      )
      : payment.method;

  if (
    !PAYMENT_STATUSES.has(
      status,
    )
  ) {
    throw new Error(
      'Status do pagamento inválido.',
    );
  }

  if (
    !PAYMENT_TYPES.has(
      paymentType,
    )
  ) {
    throw new Error(
      'Tipo de pagamento inválido.',
    );
  }

  if (
    !PAYMENT_METHODS.has(
      method,
    )
  ) {
    throw new Error(
      'Método de pagamento inválido.',
    );
  }

  const amountCents =
    body.amountCents !== undefined
      ? cents(
        body.amountCents,
        'Valor',
      )
      : Number(
        payment.amount_cents
        || 0,
      );

  const feeCents =
    body.feeCents !== undefined
      ? cents(
        body.feeCents,
        'Taxa',
      )
      : Number(
        payment.fee_cents
        || 0,
      );

  const netCents =
    body.netCents !== undefined
      ? cents(
        body.netCents,
        'Líquido',
        {
          nullable:
            true,
        },
      )
      : (
        payment.net_cents === null
          ? null
          : Number(
            payment.net_cents,
          )
      );

  const installments =
    body.installments !== undefined
      ? integer(
        body.installments,
        'Parcelas',
        {
          min:
            1,
          max:
            48,
          nullable:
            true,
        },
      )
      : payment.installments;

  let paidAt =
    body.paidAt !== undefined
      ? dateTimeValue(
        body.paidAt,
        {
          nullable:
            true,
          label:
            'Data do pagamento',
        },
      )
      : payment.paid_at;

  if (
    status === 'approved'
    && !paidAt
  ) {
    paidAt =
      nowIso();
  }

  const stamp =
    nowIso();

  const payload =
    parseJson(
      payment.provider_payload_json,
      {},
    );

  const before = {
    status:
      payment.status,
    paymentType:
      payment.payment_type,
    method:
      payment.method,
    amountCents:
      payment.amount_cents,
    feeCents:
      payment.fee_cents,
    netCents:
      payment.net_cents,
    installments:
      payment.installments,
    paidAt:
      payment.paid_at,
  };

  const after = {
    status,
    paymentType,
    method,
    amountCents,
    feeCents,
    netCents,
    installments,
    paidAt,
  };

  await db.batch([
    db
      .prepare(
        `
          UPDATE v2_payments
          SET
            payment_type = ?,
            method = ?,
            status = ?,
            amount_cents = ?,
            fee_cents = ?,
            net_cents = ?,
            installments = ?,
            paid_at = ?,
            provider_payload_json = ?,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        paymentType,
        method,
        status,
        amountCents,
        feeCents,
        netCents,
        installments,
        paidAt,
        JSON.stringify({
          ...payload,
          adminCorrection: {
            correctedAt:
              stamp,
            note:
              text(
                body.note,
                1000,
              ),
          },
        }),
        stamp,
        payment.id,
      ),

    historyInsert(
      db,
      payment.order_id,
      'admin_payment_corrected',
      'Pagamento corrigido manualmente no Admin.',
      {
        paymentId:
          payment.id,
        provider:
          payment.provider,
        before,
        after,
        note:
          text(
            body.note,
            1000,
          ),
      },
      stamp,
    ),
  ]);

  return {
    corrected:
      true,
    paymentId:
      payment.id,
    provider:
      payment.provider,
  };
}

export async function createV2ManualPaymentCorrection(
  db,
  orderCode,
  body = {},
) {
  const order =
    await orderContext(
      db,
      orderCode,
    );

  if (!order) {
    return null;
  }

  const paymentType =
    text(
      body.paymentType,
      40,
    )
    || 'balance';

  if (
    !PAYMENT_TYPES.has(
      paymentType,
    )
  ) {
    throw new Error(
      'Tipo de pagamento inválido.',
    );
  }

  const amountCents =
    cents(
      body.amountCents,
      'Valor',
    );

  if (
    amountCents <= 0
  ) {
    throw new Error(
      'Informe um valor maior que zero.',
    );
  }

  const paidAt =
    dateTimeValue(
      body.paidAt,
      {
        nullable:
          true,
        label:
          'Data do pagamento',
      },
    )
    || nowIso();

  const stamp =
    nowIso();

  const result =
    await db
      .prepare(
        `
          INSERT INTO v2_payments(
            order_id,
            provider,
            payment_type,
            method,
            status,
            amount_cents,
            fee_cents,
            net_cents,
            provider_payload_json,
            paid_at,
            created_at,
            updated_at
          )
          VALUES (
            ?,
            'direct_pix',
            ?,
            'pix',
            'approved',
            ?,
            0,
            ?,
            ?,
            ?,
            ?,
            ?
          )
        `,
      )
      .bind(
        order.id,
        paymentType,
        amountCents,
        amountCents,
        JSON.stringify({
          source:
            'admin_manual_correction',
          note:
            text(
              body.note,
              1000,
            ),
        }),
        paidAt,
        stamp,
        stamp,
      )
      .run();

  const paymentId =
    Number(
      result?.meta
        ?.last_row_id,
    );

  await historyInsert(
    db,
    order.id,
    'admin_payment_added',
    'Pagamento Pix inserido manualmente no Admin.',
    {
      paymentId,
      paymentType,
      amountCents,
      paidAt,
      note:
        text(
          body.note,
          1000,
        ),
    },
    stamp,
  )
    .run();

  return {
    created:
      true,
    paymentId,
  };
}
