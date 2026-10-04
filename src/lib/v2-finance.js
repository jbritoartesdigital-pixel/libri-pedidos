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
                    AND o.status != 'cancelled'
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
                    THEN fee_cents
                  ELSE 0
                END
              ),
              0
            ) AS mercado_pago_fee_cents,

            COALESCE(
              SUM(
                CASE
                  WHEN
                    payment_type != 'refund'
                    AND net_cents IS NOT NULL
                    THEN net_cents
                  WHEN payment_type != 'refund'
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
              'cancelled'
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

        const feeCents =
          numberValue(
            row.fee_cents,
          );

        const isRefund =
          row.payment_type
          === 'refund';

        const signedGrossCents =
          isRefund
            ? -amountCents
            : amountCents;

        const signedNetCents =
          isRefund
            ? -amountCents
            : (
              row.net_cents
              === null
              || row.net_cents
              === undefined
                ? amountCents
                  - feeCents
                : numberValue(
                  row.net_cents,
                )
            );

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

          netCents:
            signedNetCents,

          direction:
            isRefu