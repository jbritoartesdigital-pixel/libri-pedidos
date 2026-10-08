const SAO_PAULO =
  'America/Sao_Paulo';

const DAY_MS =
  24
  * 60
  * 60
  * 1000;

function cleanText(
  value,
  maxLength = 120,
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

function isIsoDay(
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

function dateKeyInSaoPaulo(
  date = new Date(),
) {
  const parts =
    new Intl
      .DateTimeFormat(
        'en-US',
        {
          timeZone:
            SAO_PAULO,

          year:
            'numeric',

          month:
            '2-digit',

          day:
            '2-digit',
        },
      )
      .formatToParts(
        date,
      );

  const map =
    Object.fromEntries(
      parts.map(
        (part) => [
          part.type,
          part.value,
        ],
      ),
    );

  return `${
    map.year
  }-${
    map.month
  }-${
    map.day
  }`;
}

function addDays(
  day,
  amount,
) {
  if (
    !isIsoDay(
      day,
    )
  ) {
    throw new Error(
      'Data inválida.',
    );
  }

  const date =
    new Date(
      `${
        day
      }T12:00:00Z`,
    );

  return new Date(
    date.getTime()
    + amount
    * DAY_MS,
  )
    .toISOString()
    .slice(
      0,
      10,
    );
}

function monthStart(
  day,
) {
  return `${
    day.slice(
      0,
      7,
    )
  }-01`;
}

function previousMonthStart(
  day,
) {
  const date =
    new Date(
      `${
        monthStart(
          day,
        )
      }T12:00:00Z`,
    );

  date.setUTCMonth(
    date.getUTCMonth()
    - 1,
  );

  return date
    .toISOString()
    .slice(
      0,
      10,
    );
}

function nextMonthStart(
  day,
) {
  const date =
    new Date(
      `${
        monthStart(
          day,
        )
      }T12:00:00Z`,
    );

  date.setUTCMonth(
    date.getUTCMonth()
    + 1,
  );

  return date
    .toISOString()
    .slice(
      0,
      10,
    );
}

function resolveFinanceRange(
  {
    preset =
      'this_month',

    start = '',
    end = '',
  } = {},
) {
  const today =
    dateKeyInSaoPaulo();

  if (
    preset
    === 'previous_month'
  ) {
    const rangeStart =
      previousMonthStart(
        today,
      );

    return {
      preset,

      start:
        rangeStart,

      end:
        addDays(
          monthStart(
            today,
          ),
          -1,
        ),

      endExclusive:
        monthStart(
          today,
        ),
    };
  }

  if (
    preset
    === 'year'
  ) {
    const year =
      today.slice(
        0,
        4,
      );

    return {
      preset,

      start:
        `${
          year
        }-01-01`,

      end:
        `${
          year
        }-12-31`,

      endExclusive:
        `${
          Number(
            year,
          )
          + 1
        }-01-01`,
    };
  }

  if (
    preset
    === 'custom'
  ) {
    if (
      !isIsoDay(
        start,
      )
      || !isIsoDay(
        end,
      )
      || start > end
    ) {
      throw new Error(
        'Período financeiro inválido.',
      );
    }

    return {
      preset,

      start,

      end,

      endExclusive:
        addDays(
          end,
          1,
        ),
    };
  }

  const startOfMonth =
    monthStart(
      today,
    );

  return {
    preset:
      'this_month',

    start:
      startOfMonth,

    end:
      addDays(
        nextMonthStart(
          today,
        ),
        -1,
      ),

    endExclusive:
      nextMonthStart(
        today,
      ),
  };
}

function numberValue(
  value,
) {
  return Number(
    value
    || 0,
  );
}

async function summaryForRange(
  db,
  range,
) {
  const sales =
    await db
      .prepare(
        `
          WITH first_sales AS (
            SELECT
              p.order_id,
              MIN(p.paid_at) AS sale_at
            FROM v2_payments p
            WHERE
              p.status = 'approved'
              AND p.payment_type != 'refund'
              AND p.paid_at IS NOT NULL
            GROUP BY p.order_id
          )
          SELECT
            COUNT(*) AS sales_count,

            COALESCE(
              SUM(pr.total_cents),
              0
            ) AS sales_cents,

            COALESCE(
              SUM(pr.combo_discount_cents),
              0
            ) AS combo_discount_cents,

            COALESCE(
              SUM(pr.coupon_discount_cents),
              0
            ) AS coupon_discount_cents,

            COALESCE(
              SUM(pr.urgency_amount_cents),
              0
            ) AS urgency_amount_cents,

            COALESCE(
              SUM(
                CASE
                  WHEN pr.payment_method = 'pix'
                    AND o.status NOT IN (
                      'cancelled',
                      'finalized'
                    )
                  THEN MAX(
                    0,
                    pr.total_cents
                    - COALESCE(
                      (
                        SELECT SUM(pay.amount_cents)
                        FROM v2_payments pay
                        WHERE
                          pay.order_id = o.id
                          AND pay.status = 'approved'
                          AND pay.payment_type != 'refund'
                      ),
                      0
                    )
                    + COALESCE(
                      (
                        SELECT SUM(ref.amount_cents)
                        FROM v2_payments ref
                        WHERE
                          ref.order_id = o.id
                          AND ref.status = 'approved'
                          AND ref.payment_type = 'refund'
                      ),
                      0
                    )
                  )
                  ELSE 0
                END
              ),
              0
            ) AS receivable_cents
          FROM first_sales s
          INNER JOIN v2_orders o
            ON o.id = s.order_id
          INNER JOIN v2_order_pricing pr
            ON pr.order_id = o.id
          WHERE
            s.sale_at >= ?
            AND s.sale_at < ?
        `,
      )
      .bind(
        range.start,
        range.endExclusive,
      )
      .first();

  const cash =
    await db
      .prepare(
        `
          SELECT
            COALESCE(
              SUM(
                CASE
                  WHEN payment_type != 'refund'
                    THEN amount_cents
                  ELSE 0
                END
              ),
              0
            ) AS cash_in_cents,

            COALESCE(
              SUM(
                CASE
                  WHEN payment_type = 'refund'
                    THEN amount_cents
                  ELSE 0
                END
              ),
              0
            ) AS refunds_cents,

            COALESCE(
              SUM(
                CASE
                  WHEN
                    provider = 'mercado_pago'
                    AND payment_type != 'refund'
                    AND net_cents IS NOT NULL
                    THEN amount_cents - net_cents
                  ELSE 0
                END
              ),
              0
            ) AS mercado_pago_fee_cents,

            COALESCE(
              SUM(
                CASE
                  WHEN
                    provider = 'mercado_pago'
                    AND payment_type != 'refund'
                    AND net_cents IS NULL
                    THEN 1
                  ELSE 0
                END
              ),
              0
            ) AS mercado_pago_fee_pending_count,

            COALESCE(
              SUM(
                CASE
                  WHEN
                    payment_type != 'refund'
                    AND net_cents IS NOT NULL
                    THEN net_cents
                  WHEN
                    payment_type != 'refund'
                    AND provider != 'mercado_pago'
                    THEN amount_cents - fee_cents
                  ELSE 0
                END
              ),
              0
            ) AS net_cash_before_refunds_cents
          FROM v2_payments
          WHERE
            status = 'approved'
            AND paid_at >= ?
            AND paid_at < ?
        `,
      )
      .bind(
        range.start,
        range.endExclusive,
      )
      .first();

  const globalOpen =
    await db
      .prepare(
        `
          SELECT
            COALESCE(
              SUM(
                MAX(
                  0,
                  pr.total_cents
                  - COALESCE(
                    (
                      SELECT SUM(pay.amount_cents)
                      FROM v2_payments pay
                      WHERE
                        pay.order_id = o.id
                        AND pay.status = 'approved'
                        AND pay.payment_type != 'refund'
                    ),
                    0
                  )
                  + COALESCE(
                    (
                      SELECT SUM(ref.amount_cents)
                      FROM v2_payments ref
                      WHERE
                        ref.order_id = o.id
                        AND ref.status = 'approved'
                        AND ref.payment_type = 'refund'
                    ),
                    0
                  )
                )
              ),
              0
            ) AS open_cents
          FROM v2_orders o
          INNER JOIN v2_order_pricing pr
            ON pr.order_id = o.id
          WHERE
            pr.payment_method = 'pix'
            AND o.status NOT IN (
              'cancelled',
              'finalized'
            )
            AND EXISTS (
              SELECT 1
              FROM v2_payments initial
              WHERE
                initial.order_id = o.id
                AND initial.status = 'approved'
                AND initial.payment_type != 'refund'
            )
        `,
      )
      .first();

  const cashInCents =
    numberValue(
      cash
        ?.cash_in_cents,
    );

  const refundsCents =
    numberValue(
      cash
        ?.refunds_cents,
    );

  const feesCents =
    numberValue(
      cash
        ?.mercado_pago_fee_cents,
    );

  const mercadoPagoFeePendingCount =
    numberValue(
      cash
        ?.mercado_pago_fee_pending_count,
    );

  const netBeforeRefunds =
    numberValue(
      cash
        ?.net_cash_before_refunds_cents,
    );

  return {
    salesCount:
      numberValue(
        sales
          ?.sales_count,
      ),

    salesCents:
      numberValue(
        sales
          ?.sales_cents,
      ),

    cashInCents,

    refundsCents,

    netCashMovementCents:
      netBeforeRefunds
      - refundsCents,

    receivableCents:
      numberValue(
        sales
          ?.receivable_cents,
      ),

    openReceivableAllCents:
      numberValue(
        globalOpen
          ?.open_cents,
      ),

    mercadoPagoFeeCents:
      feesCents,

    mercadoPagoFeePendingCount,

    mercadoPagoFeesComplete:
      mercadoPagoFeePendingCount
      === 0,

    netCashMovementComplete:
      mercadoPagoFeePendingCount
      === 0,

    comboDiscountCents:
      numberValue(
        sales
          ?.combo_discount_cents,
      ),

    couponDiscountCents:
      numberValue(
        sales
          ?.coupon_discount_cents,
      ),

    discountsCents:
      numberValue(
        sales
          ?.combo_discount_cents,
      )
      + numberValue(
        sales
          ?.coupon_discount_cents,
      ),

    urgencyAmountCents:
      numberValue(
        sales
          ?.urgency_amount_cents,
      ),
  };
}

async function salesByProduct(
  db,
  range,
) {
  const result =
    await db
      .prepare(
        `
          WITH first_sales AS (
            SELECT
              p.order_id,
              MIN(p.paid_at) AS sale_at
            FROM v2_payments p
            WHERE
              p.status = 'approved'
              AND p.payment_type != 'refund'
              AND p.paid_at IS NOT NULL
            GROUP BY p.order_id
          ),
          main_product AS (
            SELECT
              oi.order_id,

              COALESCE(
                json_extract(
                  oi.configuration_json,
                  '$.productCode'
                ),
                oi.item_code
              ) AS product_code
            FROM v2_order_items oi
            WHERE oi.item_type = 'product'
          )
          SELECT
            mp.product_code,

            COALESCE(
              product.name,
              mp.product_code
            ) AS product_name,

            COUNT(*) AS sales_count,

            COALESCE(
              SUM(pr.total_cents),
              0
            ) AS sales_cents
          FROM first_sales s
          INNER JOIN v2_order_pricing pr
            ON pr.order_id = s.order_id
          INNER JOIN main_product mp
            ON mp.order_id = s.order_id
          LEFT JOIN v2_products product
            ON product.code = mp.product_code
          WHERE
            s.sale_at >= ?
            AND s.sale_at < ?
          GROUP BY
            mp.product_code,
            product.name
          ORDER BY
            sales_cents DESC,
            sales_count DESC,
            product_name
        `,
      )
      .bind(
        range.start,
        range.endExclusive,
      )
      .all();

  return (
    result.results
    || []
  )
    .map(
      (row) => ({
        productCode:
          row.product_code,

        productName:
          row.product_name,

        salesCount:
          numberValue(
            row.sales_count,
          ),

        salesCents:
          numberValue(
            row.sales_cents,
          ),
      }),
    );
}

async function salesByPaymentMethod(
  db,
  range,
) {
  const result =
    await db
      .prepare(
        `
          WITH first_sales AS (
            SELECT
              p.order_id,
              MIN(p.paid_at) AS sale_at
            FROM v2_payments p
            WHERE
              p.status = 'approved'
              AND p.payment_type != 'refund'
              AND p.paid_at IS NOT NULL
            GROUP BY p.order_id
          )
          SELECT
            pr.payment_method,

            COUNT(*) AS sales_count,

            COALESCE(
              SUM(pr.total_cents),
              0
            ) AS sales_cents
          FROM first_sales s
          INNER JOIN v2_order_pricing pr
            ON pr.order_id = s.order_id
          WHERE
            s.sale_at >= ?
            AND s.sale_at < ?
          GROUP BY pr.payment_method
          ORDER BY sales_cents DESC
        `,
      )
      .bind(
        range.start,
        range.endExclusive,
      )
      .all();

  return (
    result.results
    || []
  )
    .map(
      (row) => ({
        paymentMethod:
          row.payment_method,

        salesCount:
          numberValue(
            row.sales_count,
          ),

        salesCents:
          numberValue(
            row.sales_cents,
          ),
      }),
    );
}

async function cashByProvider(
  db,
  range,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            provider,
            method,

            COUNT(*) AS movement_count,

            COALESCE(
              SUM(
                CASE
                  WHEN payment_type != 'refund'
                    THEN amount_cents
                  ELSE 0
                END
              ),
              0
            ) AS cash_in_cents,

            COALESCE(
              SUM(
                CASE
                  WHEN payment_type = 'refund'
                    THEN amount_cents
                  ELSE 0
                END
              ),
              0
            ) AS refund_cents,

            COALESCE(
              SUM(
                CASE
                  WHEN payment_type != 'refund' AND provider = 'mercado_pago' AND net_cents IS NOT NULL
                    THEN amount_cents - net_cents
                  WHEN payment_type != 'refund'
                    THEN fee_cents
                  ELSE 0
                END
              ),
              0
            ) AS fee_cents
          FROM v2_payments
          WHERE
            status = 'approved'
            AND paid_at >= ?
            AND paid_at < ?
          GROUP BY
            provider,
            method
          ORDER BY
            cash_in_cents DESC,
            provider,
            method
        `,
      )
      .bind(
        range.start,
        range.endExclusive,
      )
      .all();

  return (
    result.results
    || []
  )
    .map(
      (row) => ({
        provider:
          row.provider,

        method:
          row.method,

        movementCount:
          numberValue(
            row.movement_count,
          ),

        cashInCents:
          numberValue(
            row.cash_in_cents,
          ),

        refundCents:
          numberValue(
            row.refund_cents,
          ),

        feeCents:
          numberValue(
            row.fee_cents,
          ),
      }),
    );
}

async function movementsForRange(
  db,
  range,
  {
    q = '',
    method = '',
    provider = '',
    limit = 50,
    offset = 0,
  } = {},
) {
  const clauses = [
    `p.status = 'approved'`,
    'p.paid_at >= ?',
    'p.paid_at < ?',
  ];

  const binds = [
    range.start,
    range.endExclusive,
  ];

  const search =
    cleanText(
      q,
      120,
    );

  if (search) {
    const like =
      `%${
        search
      }%`;

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

    binds.push(
      like,
      like,
      like,
      like,
    );
  }

  if (
    [
      'pix',
      'card',
    ].includes(
      method,
    )
  ) {
    clauses.push(
      'p.method = ?',
    );

    binds.push(
      method,
    );
  }

  if (
    [
      'mercado_pago',
      'direct_pix',
    ].includes(
      provider,
    )
  ) {
    clauses.push(
      'p.provider = ?',
    );

    binds.push(
      provider,
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
            p.id,
            p.provider,
            p.provider_order_id,
            p.provider_payment_id,
            p.payment_type,
            p.method,
            p.amount_cents,
            p.fee_cents,
            p.net_cents,
            p.installments,
            p.paid_at,
            p.provider_payload_json,

            o.order_code,
            o.honoree_display_name,

            c.name AS customer_name,
            c.whatsapp
          FROM v2_payments p
          INNER JOIN v2_orders o
            ON o.id = p.order_id
          INNER JOIN v2_customers c
            ON c.id = o.customer_id
          WHERE ${
            clauses.join(
              ' AND ',
            )
          }
          ORDER BY
            p.paid_at DESC,
            p.id DESC
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
      (row) => {
        const amountCents =
          numberValue(
            row.amount_cents,
          );

        // The provider can report a partial fee_details breakdown while
        // the actual credited amount has additional deductions.
        // For reconciled payments, gross minus net is the full deduction.
        const feeCents = row.provider === 'mercado_pago'
          && row.net_cents !== null && row.net_cents !== undefined
          ? Math.max(0, amountCents - numberValue(row.net_cents))
          : numberValue(row.fee_cents);

        const isRefund =
          row.payment_type
          === 'refund';

        const feeKnown =
          isRefund
          || row.provider
            !== 'mercado_pago'
          || (
            row.net_cents
            !== null
            && row.net_cents
              !== undefined
          );

        const signedGrossCents =
          isRefund
            ? -amountCents
            : amountCents;

        const signedNetCents =
          isRefund
            ? -amountCents
            : feeKnown
              ? (
                row.net_cents
                === null
                || row.net_cents
                === undefined
                  ? amountCents
                    - feeCents
                  : numberValue(
                    row.net_cents,
                  )
              )
              : null;

        return {
          id:
            row.id,

          paidAt:
            row.paid_at,

          orderCode:
            row.order_code,

          honoreeName:
            row.honoree_display_name,

          customerName:
            row.customer_name,

          whatsapp:
            row.whatsapp,

          provider:
            row.provider,

          providerOrderId:
            row.provider_order_id,

          providerPaymentId:
            row.provider_payment_id,

          paymentType:
            row.payment_type,

          method:
            row.method,

          installments:
            row.installments,

          amountCents:
            signedGrossCents,

          feeCents:
            isRefund
              ? 0
              : feeCents,

          feeKnown,

          netCents:
            signedNetCents,

          netKnown:
            feeKnown,

          direction:
            isRefund
              ? 'out'
              : 'in',

          note:
            (() => {
              try {
                return String(
                  JSON.parse(
                    row.provider_payload_json
                    || '{}',
                  )?.note
                  || '',
                );
              } catch {
                return '';
              }
            })(),

          editable:
            row.provider
            === 'direct_pix'
            && !isRefund,
        };
      },
    );
}

async function openReceivables(
  db,
  {
    limit = 100,
  } = {},
) {
  const safeLimit =
    Math.max(
      1,
      Math.min(
        200,
        Number.parseInt(
          limit,
          10,
        )
        || 100,
      ),
    );

  const result =
    await db
      .prepare(
        `
          SELECT
            o.order_code,
            o.honoree_display_name,
            o.event_date,
            o.status,
            o.delivery_start,
            o.delivery_end,

            c.name AS customer_name,
            c.whatsapp,

            pr.total_cents,

            COALESCE(
              (
                SELECT SUM(pay.amount_cents)
                FROM v2_payments pay
                WHERE
                  pay.order_id = o.id
                  AND pay.status = 'approved'
                  AND pay.payment_type != 'refund'
              ),
              0
            ) AS paid_cents,

            COALESCE(
              (
                SELECT SUM(ref.amount_cents)
                FROM v2_payments ref
                WHERE
                  ref.order_id = o.id
                  AND ref.status = 'approved'
                  AND ref.payment_type = 'refund'
              ),
              0
            ) AS refunded_cents,

            (
              SELECT MIN(initial.paid_at)
              FROM v2_payments initial
              WHERE
                initial.order_id = o.id
                AND initial.status = 'approved'
                AND initial.payment_type != 'refund'
            ) AS sale_at
          FROM v2_orders o
          INNER JOIN v2_customers c
            ON c.id = o.customer_id
          INNER JOIN v2_order_pricing pr
            ON pr.order_id = o.id
          WHERE
            pr.payment_method = 'pix'
            AND o.status NOT IN (
              'cancelled',
              'finalized'
            )
            AND EXISTS (
              SELECT 1
              FROM v2_payments initial
              WHERE
                initial.order_id = o.id
                AND initial.status = 'approved'
                AND initial.payment_type != 'refund'
            )
          ORDER BY
            CASE o.status
              WHEN 'balance_pending'
                THEN 0
              ELSE 1
            END,
            o.delivery_start,
            o.event_date,
            o.created_at
          LIMIT ?
        `,
      )
      .bind(
        safeLimit,
      )
      .all();

  return (
    result.results
    || []
  )
    .map(
      (row) => {
        const total =
          numberValue(
            row.total_cents,
          );

        const paid =
          numberValue(
            row.paid_cents,
          );

        const refunded =
          numberValue(
            row.refunded_cents,
          );

        const remaining =
          Math.max(
            0,
            total
            - paid
            + refunded,
          );

        return {
          orderCode:
            row.order_code,

          honoreeName:
            row.honoree_display_name,

          customerName:
            row.customer_name,

          whatsapp:
            row.whatsapp,

          eventDate:
            row.event_date,

          status:
            row.status,

          deliveryWindow: {
            start:
              row.delivery_start,

            end:
              row.delivery_end,
          },

          saleAt:
            row.sale_at,

          totalCents:
            total,

          paidCents:
            paid,

          refundedCents:
            refunded,

          remainingCents:
            remaining,
        };
      },
    )
    .filter(
      (row) =>
        row.remainingCents
        > 0,
    );
}

export async function createV2FinancePayment(
  db,
  {
    orderCode,
    amountCents,
    paidDate,
    paymentType,
    note = '',
  } = {},
) {
  const code =
    cleanText(
      orderCode,
      40,
    )
      .toUpperCase();

  if (
    !/^LIBRI-\d+$/
      .test(
        code,
      )
  ) {
    throw new Error(
      'Informe um pedido válido.',
    );
  }

  const cents =
    Number.parseInt(
      amountCents,
      10,
    );

  if (
    !Number.isInteger(cents)
    || cents <= 0
    || cents > 100000000
  ) {
    throw new Error(
      'Informe um valor válido.',
    );
  }

  const day =
    cleanText(
      paidDate,
      10,
    );

  if (
    !isIsoDay(day)
    || day > dateKeyInSaoPaulo()
  ) {
    throw new Error(
      'Informe uma data válida, sem usar uma data futura.',
    );
  }

  const type =
    cleanText(
      paymentType,
      30,
    );

  if (
    ![
      'deposit',
      'balance',
      'full_payment',
      'refund',
    ].includes(
      type,
    )
  ) {
    throw new Error(
      'Tipo de lançamento inválido.',
    );
  }

  const observation =
    cleanText(
      note,
      800,
    );

  const order =
    await db
      .prepare(
        `
          SELECT
            o.id,
            o.order_code,
            o.status,
            pr.total_cents,
            pr.payment_method
          FROM v2_orders o
          INNER JOIN v2_order_pricing pr
            ON pr.order_id = o.id
          WHERE o.order_code = ?
          LIMIT 1
        `,
      )
      .bind(
        code,
      )
      .first();

  if (!order) {
    throw new Error(
      'Pedido não encontrado.',
    );
  }

  const totals =
    await db
      .prepare(
        `
          SELECT
            COALESCE(
              SUM(
                CASE
                  WHEN status = 'approved'
                    AND payment_type != 'refund'
                    THEN amount_cents
                  ELSE 0
                END
              ),
              0
            ) AS received_cents,

            COALESCE(
              SUM(
                CASE
                  WHEN status = 'approved'
                    AND payment_type = 'refund'
                    THEN amount_cents
                  ELSE 0
                END
              ),
              0
            ) AS refunded_cents
          FROM v2_payments
          WHERE order_id = ?
        `,
      )
      .bind(
        order.id,
      )
      .first();

  const netPaidBefore =
    Math.max(
      0,
      Number(
        totals?.received_cents
        || 0,
      )
      - Number(
        totals?.refunded_cents
        || 0,
      ),
    );

  const totalCents =
    Number(
      order.total_cents
      || 0,
    );

  const remainingBefore =
    Math.max(
      0,
      totalCents
      - netPaidBefore,
    );

  if (
    type
    === 'refund'
    && cents > netPaidBefore
  ) {
    throw new Error(
      'O reembolso não pode ser maior que o valor líquido já recebido.',
    );
  }

  if (
    type
    !== 'refund'
    && cents > remainingBefore
  ) {
    throw new Error(
      'O lançamento não pode ser maior que o saldo ainda aberto do pedido.',
    );
  }

  const stamp =
    new Date()
      .toISOString();

  const paidAt =
    `${day}T12:00:00.000Z`;

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
        type,
        cents,
        cents,
        JSON.stringify({
          source:
            'admin_manual',
          note:
            observation,
        }),
        paidAt,
        stamp,
        stamp,
      )
      .run();

  const netPaidAfter =
    type
    === 'refund'
      ? Math.max(
        0,
        netPaidBefore
        - cents,
      )
      : netPaidBefore
        + cents;

  const remainingAfter =
    Math.max(
      0,
      totalCents
      - netPaidAfter,
    );

  if (
    order.payment_method
    === 'pix'
    && ![
      'cancelled',
      'finalized',
    ].includes(
      order.status,
    )
  ) {
    if (
      remainingAfter === 0
      && order.status
        === 'balance_pending'
    ) {
      await db
        .prepare(
          `
            UPDATE v2_orders
            SET
              status = 'ready_for_delivery',
              next_action = 'Liberar entrega',
              updated_at = ?
            WHERE id = ?
          `,
        )
        .bind(
          stamp,
          order.id,
        )
        .run();
    }

    if (
      remainingAfter > 0
      && order.status
        === 'ready_for_delivery'
    ) {
      await db
        .prepare(
          `
            UPDATE v2_orders
            SET
              status = 'balance_pending',
              next_action = 'Aguardar saldo final',
              updated_at = ?
            WHERE id = ?
          `,
        )
        .bind(
          stamp,
          order.id,
        )
        .run();
    }
  }

  const paymentId =
    Number(
      result
        ?.meta
        ?.last_row_id,
    );

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
        VALUES (?, ?, ?, ?, ?)
      `,
    )
    .bind(
      order.id,
      'finance_payment_added',
      type === 'refund'
        ? 'Reembolso/ajuste financeiro registrado manualmente no admin.'
        : 'Recebimento registrado manualmente no admin.',
      JSON.stringify({
        paymentId,
        paymentType:
          type,
        amountCents:
          cents,
        paidAt,
        note:
          observation,
      }),
      stamp,
    )
    .run();

  return {
    id:
      paymentId,
    orderCode:
      order.order_code,
    paymentType:
      type,
    amountCents:
      cents,
    paidAt,
    remainingCents:
      remainingAfter,
  };
}

export async function updateV2FinancePayment(
  db,
  paymentId,
  {
    amountCents,
    paidDate,
    paymentType,
  } = {},
) {
  const id =
    Number.parseInt(
      paymentId,
      10,
    );

  if (
    !Number.isInteger(id)
    || id <= 0
  ) {
    throw new Error(
      'Lançamento financeiro inválido.',
    );
  }

  const row =
    await db
      .prepare(
        `
          SELECT
            p.id,
            p.order_id,
            p.provider,
            p.payment_type,
            p.status,
            p.amount_cents,
            p.paid_at,
            o.order_code,
            o.status AS order_status,
            pr.total_cents,
            pr.payment_method
          FROM v2_payments p
          INNER JOIN v2_orders o
            ON o.id = p.order_id
          INNER JOIN v2_order_pricing pr
            ON pr.order_id = o.id
          WHERE p.id = ?
          LIMIT 1
        `,
      )
      .bind(
        id,
      )
      .first();

  if (!row) {
    throw new Error(
      'Lançamento não encontrado.',
    );
  }

  if (
    row.provider
    !== 'direct_pix'
    || row.status
      !== 'approved'
    || row.payment_type
      === 'refund'
  ) {
    throw new Error(
      'Somente lançamentos Pix manuais podem ser corrigidos. Pagamentos do Mercado Pago são conciliados pelo provedor.',
    );
  }

  const cents =
    Number.parseInt(
      amountCents,
      10,
    );

  if (
    !Number.isInteger(cents)
    || cents <= 0
    || cents > 100000000
  ) {
    throw new Error(
      'Informe um valor válido.',
    );
  }

  const day =
    cleanText(
      paidDate,
      10,
    );

  if (
    !isIsoDay(day)
    || day > dateKeyInSaoPaulo()
  ) {
    throw new Error(
      'Informe uma data de recebimento válida.',
    );
  }

  const type =
    cleanText(
      paymentType,
      30,
    );

  if (
    ![
      'deposit',
      'balance',
      'full_payment',
    ].includes(type)
  ) {
    throw new Error(
      'Tipo de lançamento inválido.',
    );
  }

  const stamp =
    new Date()
      .toISOString();

  const paidAt =
    `${day}T12:00:00.000Z`;

  await db
    .prepare(
      `
        UPDATE v2_payments
        SET
          payment_type = ?,
          amount_cents = ?,
          fee_cents = 0,
          net_cents = ?,
          paid_at = ?,
          updated_at = ?
        WHERE id = ?
      `,
    )
    .bind(
      type,
      cents,
      cents,
      paidAt,
      stamp,
      id,
    )
    .run();

  const totals =
    await db
      .prepare(
        `
          SELECT
            COALESCE(
              SUM(
                CASE
                  WHEN payment_type != 'refund'
                    THEN amount_cents
                  ELSE -amount_cents
                END
              ),
              0
            ) AS paid_cents
          FROM v2_payments
          WHERE
            order_id = ?
            AND status = 'approved'
        `,
      )
      .bind(
        row.order_id,
      )
      .first();

  const remaining =
    Math.max(
      0,
      Number(
        row.total_cents
        || 0,
      )
      - Number(
        totals
          ?.paid_cents
        || 0,
      ),
    );

  if (
    row.payment_method
    === 'pix'
    && ![
      'cancelled',
      'finalized',
    ].includes(
      row.order_status,
    )
  ) {
    if (
      remaining === 0
      && row.order_status
        === 'balance_pending'
    ) {
      await db
        .prepare(
          `
            UPDATE v2_orders
            SET
              status = 'ready_for_delivery',
              next_action = 'Liberar entrega',
              updated_at = ?
            WHERE id = ?
          `,
        )
        .bind(
          stamp,
          row.order_id,
        )
        .run();
    }

    if (
      remaining > 0
      && row.order_status
        === 'ready_for_delivery'
    ) {
      await db
        .prepare(
          `
            UPDATE v2_orders
            SET
              status = 'balance_pending',
              next_action = 'Aguardar saldo final',
              updated_at = ?
            WHERE id = ?
          `,
        )
        .bind(
          stamp,
          row.order_id,
        )
        .run();
    }
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
          'finance_payment_corrected',
          'Lançamento financeiro corrigido manualmente no admin.',
          ?,
          ?
        )
      `,
    )
    .bind(
      row.order_id,
      JSON.stringify({
        paymentId:
          id,
        before: {
          amountCents:
            Number(
              row.amount_cents
              || 0,
            ),
          paidAt:
            row.paid_at,
          paymentType:
            row.payment_type,
        },
        after: {
          amountCents:
            cents,
          paidAt,
          paymentType:
            type,
        },
      }),
      stamp,
    )
    .run();

  return {
    id,
    orderCode:
      row.order_code,
    amountCents:
      cents,
    paidAt,
    paymentType:
      type,
    remainingCents:
      remaining,
  };
}

export async function getV2FinanceDashboard(
  db,
  filters = {},
) {
  const range =
    resolveFinanceRange(
      filters,
    );

  const [
    summary,
    byProduct,
    byPaymentMethod,
    byProvider,
    movements,
    receivables,
  ] =
    await Promise.all([
      summaryForRange(
        db,
        range,
      ),

      salesByProduct(
        db,
        range,
      ),

      salesByPaymentMethod(
        db,
        range,
      ),

      cashByProvider(
        db,
        range,
      ),

      movementsForRange(
        db,
        range,
        filters,
      ),

      openReceivables(
        db,
      ),
    ]);

  return {
    range,

    summary,

    breakdown: {
      byProduct,

      byPaymentMethod,

      byProvider,
    },

    movements,

    receivables,
  };
}

export async function getV2FinanceSummary(
  db,
  filters = {},
) {
  const range =
    resolveFinanceRange(
      filters,
    );

  return {
    range,

    summary:
      await summaryForRange(
        db,
        range,
      ),
  };
}
