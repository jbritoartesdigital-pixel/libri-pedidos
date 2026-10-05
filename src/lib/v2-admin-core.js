import {
  nowIso,
  parseJson,
} from './http.js';

import {
  finalizeV2OrderToCascadePool,
} from './v2-agenda-admin.js';

import {
  cancelMercadoPagoOrder,
  fetchMercadoPagoOrder,
} from './v2-mercadopago.js';

import {
  getV2FinanceSummary,
} from './v2-finance.js';

const SAO_PAULO =
  'America/Sao_Paulo';

const DELETABLE_UNPAID_STATUSES =
  new Set([
    'awaiting_urgency_decision',
    'urgency_approved',
    'awaiting_payment',
    'cancelled',
  ]);

export async function deleteUnpaidV2Order(
  env,
  orderCode,
) {
  const code =
    cleanText(
      orderCode,
      40,
    );

  const order =
    await env.DB
      .prepare(
        `
          SELECT
            id,
            order_code,
            customer_id,
            status,
            briefing_status
          FROM v2_orders
          WHERE order_code = ?
          LIMIT 1
        `,
      )
      .bind(
        code,
      )
      .first();

  if (!order) {
    return null;
  }

  const paid =
    await env.DB
      .prepare(
        `
          SELECT COUNT(*) AS n
          FROM v2_payments
          WHERE
            order_id = ?
            AND status IN (
              'approved',
              'refunded'
            )
        `,
      )
      .bind(
        order.id,
      )
      .first();

  if (
    Number(
      paid?.n
      || 0,
    ) > 0
  ) {
    throw new Error(
      'Pedido com pagamento confirmado não pode ser excluído.',
    );
  }

  if (
    !DELETABLE_UNPAID_STATUSES
      .has(
        order.status,
      )
    || order.briefing_status
      !== 'locked'
  ) {
    throw new Error(
      'Só é possível excluir pedidos sem pagamento e antes do início do atendimento.',
    );
  }

  const providerOrders =
    await env.DB
      .prepare(
        `
          SELECT provider_order_id
          FROM v2_payments
          WHERE
            order_id = ?
            AND provider = 'mercado_pago'
            AND status = 'pending'
            AND provider_order_id IS NOT NULL
          ORDER BY id DESC
        `,
      )
      .bind(
        order.id,
      )
      .all();

  for (
    const payment
    of providerOrders.results
    || []
  ) {
    const providerOrderId =
      String(
        payment.provider_order_id
        || '',
      )
        .trim();

    if (!providerOrderId) {
      continue;
    }

    const remote =
      await fetchMercadoPagoOrder(
        env,
        providerOrderId,
      );

    const remoteStatus =
      String(
        remote?.status
        || '',
      )
        .toLowerCase();

    if (
      [
        'processed',
        'refunded',
      ].includes(
        remoteStatus,
      )
    ) {
      throw new Error(
        'O Mercado Pago informa pagamento processado neste pedido. Atualize o status antes de qualquer exclusão.',
      );
    }

    if (
      ![
        'canceled',
        'cancelled',
        'failed',
        'expired',
      ].includes(
        remoteStatus,
      )
    ) {
      await cancelMercadoPagoOrder(
        env,
        providerOrderId,
      );
    }
  }

  await env.DB.batch([
    env.DB
      .prepare(
        'DELETE FROM v2_checkout_requests WHERE order_id = ?',
      )
      .bind(
        order.id,
      ),

    env.DB
      .prepare(
        'DELETE FROM v2_checkout_holds WHERE order_id = ?',
      )
      .bind(
        order.id,
      ),

    env.DB
      .prepare(
        'DELETE FROM v2_orders WHERE id = ?',
      )
      .bind(
        order.id,
      ),
  ]);

  await env.DB
    .prepare(
      `
        DELETE FROM v2_customers
        WHERE
          id = ?
          AND NOT EXISTS (
            SELECT 1
            FROM v2_orders
            WHERE customer_id = ?
          )
      `,
    )
    .bind(
      order.customer_id,
      order.customer_id,
    )
    .run();

  return {
    deleted:
      true,

    code:
      order.order_code,
  };
}

export async function cancelV2Order(
  env,
  orderCode,
  {
    reason = '',
    note = '',
  } = {},
) {
  const code =
    cleanText(
      orderCode,
      40,
    );

  const allowedReasons =
    new Set([
      'Não realizou pagamento',
      'Cliente desistiu',
      'Outro',
    ]);

  const selectedReason =
    cleanText(
      reason,
      120,
    );

  if (
    !allowedReasons
      .has(
        selectedReason,
      )
  ) {
    throw new Error(
      'Informe o motivo do cancelamento.',
    );
  }

  const detail =
    cleanText(
      note,
      1000,
    );

  if (
    selectedReason === 'Outro'
    && !detail
  ) {
    throw new Error(
      'Descreva o motivo do cancelamento.',
    );
  }

  const finalReason =
    selectedReason === 'Outro'
      ? `Outro: ${detail}`
      : selectedReason;

  const order =
    await env.DB
      .prepare(
        `
          SELECT
            id,
            order_code,
            status
          FROM v2_orders
          WHERE order_code = ?
          LIMIT 1
        `,
      )
      .bind(
        code,
      )
      .first();

  if (!order) {
    return null;
  }

  if (
    order.status
    === 'cancelled'
  ) {
    return {
      cancelled: true,
      alreadyCancelled: true,
      code:
        order.order_code,
      reason:
        finalReason,
    };
  }

  if (
    order.status
    === 'finalized'
  ) {
    throw new Error(
      'Pedido finalizado não pode ser cancelado por esta ação.',
    );
  }

  const providerPayments =
    await env.DB
      .prepare(
        `
          SELECT
            provider_order_id
          FROM v2_payments
          WHERE
            order_id = ?
            AND provider = 'mercado_pago'
            AND status = 'pending'
            AND provider_order_id IS NOT NULL
          ORDER BY id DESC
        `,
      )
      .bind(
        order.id,
      )
      .all();

  for (
    const payment
    of providerPayments.results
    || []
  ) {
    const providerOrderId =
      String(
        payment.provider_order_id
        || '',
      ).trim();

    if (!providerOrderId) {
      continue;
    }

    try {
      const remote =
        await fetchMercadoPagoOrder(
          env,
          providerOrderId,
        );

      const remoteStatus =
        String(
          remote?.status
          || '',
        )
          .toLowerCase();

      if (
        ![
          'processed',
          'approved',
          'refunded',
          'canceled',
          'cancelled',
          'failed',
          'expired',
        ].includes(
          remoteStatus,
        )
      ) {
        await cancelMercadoPagoOrder(
          env,
          providerOrderId,
        );

        await env.DB
          .prepare(
            `
              UPDATE v2_payments
              SET
                status = 'cancelled',
                updated_at = ?
              WHERE
                provider = 'mercado_pago'
                AND provider_order_id = ?
                AND status = 'pending'
            `,
          )
          .bind(
            nowIso(),
            providerOrderId,
          )
          .run();
      }
    } catch (
      error
    ) {
      console.error(
        'V2 cancel provider checkout failed',
        providerOrderId,
        error?.message
        || error,
      );
    }
  }

  const stamp =
    nowIso();

  await env.DB.batch([
    env.DB
      .prepare(
        `
          UPDATE v2_checkout_holds
          SET
            status = 'cancelled',
            updated_at = ?
          WHERE
            order_id = ?
            AND status = 'active'
        `,
      )
      .bind(
        stamp,
        order.id,
      ),

    env.DB
      .prepare(
        'DELETE FROM v2_agenda_allocations WHERE order_id = ?',
      )
      .bind(
        order.id,
      ),

    env.DB
      .prepare(
        `
          UPDATE v2_orders
          SET
            status = 'cancelled',
            next_action = ?,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        `Cancelado • ${finalReason}`,
        stamp,
        order.id,
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
            'order_cancelled',
            ?,
            ?,
            ?
          )
        `,
      )
      .bind(
        order.id,
        `Pedido cancelado: ${finalReason}.`,
        JSON.stringify({
          reason:
            finalReason,
        }),
        stamp,
      ),
  ]);

  return {
    cancelled: true,
    alreadyCancelled: false,
    code:
      order.order_code,
    reason:
      finalReason,
  };
}

export async function cleanupAbandonedUnpaidV2Orders(
  env,
) {
  const rows =
    await env.DB
      .prepare(
        `
          SELECT
            o.order_code
          FROM v2_orders o
          WHERE
            o.status = 'awaiting_payment'
            AND o.briefing_status = 'locked'
            AND datetime(o.updated_at)
              <= datetime('now', '-30 minutes')
            AND EXISTS (
              SELECT 1
              FROM v2_checkout_holds h
              WHERE h.order_id = o.id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM v2_checkout_holds active_hold
              WHERE
                active_hold.order_id = o.id
                AND active_hold.status = 'active'
                AND active_hold.expires_at > ?
            )
            AND NOT EXISTS (
              SELECT 1
              FROM v2_payments paid
              WHERE
                paid.order_id = o.id
                AND paid.status IN (
                  'approved',
                  'refunded'
                )
            )
          ORDER BY
            o.updated_at
          LIMIT 20
        `,
      )
      .bind(
        nowIso(),
      )
      .all();

  let deleted = 0;
  let skipped = 0;

  for (
    const row
    of rows.results
    || []
  ) {
    try {
      const result =
        await deleteUnpaidV2Order(
          env,
          row.order_code,
        );

      if (
        result?.deleted
      ) {
        deleted += 1;
      }
    } catch (
      error
    ) {
      skipped += 1;

      console.error(
        'V2 abandoned order cleanup skipped',
        row.order_code,
        error?.message
        || error,
      );
    }
  }

  return {
    deleted,
    skipped,
  };
}

function cleanText(
  value,
  maxLength = 4000,
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

  return `${map.year}-${map.month}-${map.day}`;
}

function addDays(
  dateKey,
  amount,
) {
  const [
    year,
    month,
    day,
  ] =
    String(
      dateKey,
    )
      .split('-')
      .map(Number);

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day + amount,
      ),
    );

  return [
    date.getUTCFullYear(),
    String(
      date.getUTCMonth() + 1,
    ).padStart(
      2,
      '0',
    ),
    String(
      date.getUTCDate(),
    ).padStart(
      2,
      '0',
    ),
  ].join('-');
}

function monthRangeSaoPaulo(
  date = new Date(),
) {
  const today =
    dateKeyInSaoPaulo(
      date,
    );

  const [
    year,
    month,
  ] =
    today
      .split('-')
      .map(Number);

  const start =
    `${year}-${String(month).padStart(2, '0')}-01`;

  const next =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, '0')}-01`;

  return {
    start,
    next,
  };
}

function whatsappUrl(
  number,
  message,
) {
  const digits =
    String(
      number
      || '',
    )
      .replace(
        /\D/g,
        '',
      );

  if (!digits) {
    return '';
  }

  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function statusLabel(
  status,
) {
  return {
    configuring:
      'Configurando',
    awaiting_urgency_decision:
      'Aguardando decisão de encaixe',
    urgency_approved:
      'Encaixe aprovado',
    awaiting_payment:
      'Aguardando pagamento',
    briefing_pending:
      'Briefing pendente',
    ready_for_production:
      'Pronto para produção',
    in_production:
      'Em produção',
    waiting_customer:
      'Aguardando cliente',
    adjustments:
      'Ajustes',
    approved:
      'Aprovado',
    balance_pending:
      'Saldo pendente',
    ready_for_delivery:
      'Pronto para entrega',
    finalized:
      'Finalizado',
    cancelled:
      'Cancelado',
  }[status]
  || status
  || 'Sem status';
}

function nextActionFromStatus(
  row,
) {
  if (
    row.next_action
  ) {
    return row.next_action;
  }

  return {
    awaiting_urgency_decision:
      'Analisar encaixe',
    awaiting_payment:
      'Aguardar pagamento',
    briefing_pending:
      'Aguardar briefing',
    ready_for_production:
      'Iniciar produção',
    in_production:
      'Continuar produção',
    waiting_customer:
      'Aguardar cliente',
    adjustments:
      'Fazer ajustes',
    balance_pending:
      'Cobrar saldo',
    ready_for_delivery:
      'Liberar entrega',
    finalized:
      'Finalizado',
    cancelled:
      'Cancelado',
  }[row.status]
  || 'Abrir pedido';
}

function allowedActions(
  row,
  paymentSummary,
) {
  const actions = [];

  if (
    row.status
    === 'ready_for_production'
    || row.status
      === 'waiting_customer'
    || row.status
      === 'adjustments'
  ) {
    actions.push(
      'start_production',
    );
  }

  if (
    row.status
    === 'in_production'
    || row.status
      === 'adjustments'
  ) {
    actions.push(
      'waiting_customer',
    );
  }

  if (
    row.status
    === 'in_production'
    || row.status
      === 'waiting_customer'
    || row.status
      === 'adjustments'
  ) {
    actions.push(
      'adjustments',
      'approve',
    );
  }

  if (
    row.status
    === 'balance_pending'
    && paymentSummary
      .remainingBalanceCents
      > 0
  ) {
    actions.push(
      'balance_received',
    );
  }

  if (
    row.status
    === 'ready_for_delivery'
  ) {
    actions.push(
      'finalize',
    );
  }

  return [
    ...new Set(
      actions,
    ),
  ];
}

async function v2SettingInt(
  db,
  key,
  fallback,
) {
  const row =
    await db
      .prepare(
        `
          SELECT value
          FROM v2_settings
          WHERE key = ?
          LIMIT 1
        `,
      )
      .bind(
        key,
      )
      .first();

  const parsed =
    Number.parseInt(
      row
        ?.value,
      10,
    );

  return Number.isInteger(
    parsed,
  )
    ? parsed
    : fallback;
}

async function orderByCode(
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
          p.currency,
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

async function paymentSummary(
  db,
  order,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            id,
            provider,
            payment_type,
            method,
            status,
            amount_cents,
            fee_cents,
            net_cents,
            installments,
            paid_at,
            created_at
          FROM v2_payments
          WHERE order_id = ?
          ORDER BY
            COALESCE(
              paid_at,
              created_at
            ) DESC,
            id DESC
        `,
      )
      .bind(
        order.id,
      )
      .all();

  const payments =
    result.results
    || [];

  const approved =
    payments
      .filter(
        (payment) =>
          payment.status
          === 'approved',
      );

  const paidCents =
    approved.reduce(
      (
        sum,
        payment,
      ) =>
        sum
        + Number(
          payment.amount_cents
          || 0,
        ),
      0,
    );

  const feeCents =
    approved.reduce(
      (
        sum,
        payment,
      ) =>
        sum
        + Number(
          payment.fee_cents
          || 0,
        ),
      0,
    );

  const remainingBalanceCents =
    Math.max(
      0,
      Number(
        order.total_cents
        || 0,
      )
      - paidCents,
    );

  return {
    payments,
    paidCents,
    feeCents,
    remainingBalanceCents,
    fullyPaid:
      remainingBalanceCents
      === 0,
  };
}

async function orderItems(
  db,
  orderId,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            item_type,
            item_code,
            name_snapshot,
            quantity,
            unit_price_cents,
            points_units,
            configuration_json
          FROM v2_order_items
          WHERE order_id = ?
          ORDER BY id
        `,
      )
      .bind(
        orderId,
      )
      .all();

  return (
    result.results
    || []
  )
    .map(
      (row) => ({
        itemType:
          row.item_type,
        itemCode:
          row.item_code,
        name:
          row.name_snapshot,
        quantity:
          row.quantity,
        unitPriceCents:
          row.unit_price_cents,
        pointsUnits:
          row.points_units,
        configuration:
          parseJson(
            row.configuration_json,
            {},
          ),
      }),
    );
}

async function orderBriefing(
  db,
  orderId,
) {
  const row =
    await db
      .prepare(
        `
          SELECT
            schema_version,
            data_json,
            current_section,
            completion_percent,
            started_at,
            completed_at,
            updated_at
          FROM v2_briefings
          WHERE order_id = ?
          LIMIT 1
        `,
      )
      .bind(
        orderId,
      )
      .first();

  if (!row) {
    return {
      schemaVersion:
        '2.0',
      data: {},
      currentSection:
        null,
      completionPercent:
        0,
      startedAt:
        null,
      completedAt:
        null,
      updatedAt:
        null,
    };
  }

  return {
    schemaVersion:
      row.schema_version,
    data:
      parseJson(
        row.data_json,
        {},
      ),
    currentSection:
      row.current_section,
    completionPercent:
      Number(
        row.completion_percent
        || 0,
      ),
    startedAt:
      row.started_at,
    completedAt:
      row.completed_at,
    updatedAt:
      row.updated_at,
  };
}

async function orderUploads(
  db,
  orderId,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            id,
            category,
            original_filename,
            stored_filename,
            mime_type,
            size_bytes,
            note,
            created_at
          FROM v2_briefing_uploads
          WHERE order_id = ?
          ORDER BY
            category,
            id
        `,
      )
      .bind(
        orderId,
      )
      .all();

  const uploads =
    result.results
    || [];

  const counts =
    uploads.reduce(
      (
        accumulator,
        upload,
      ) => {
        accumulator[
          upload.category
        ] =
          (
            accumulator[
              upload.category
            ]
            || 0
          )
          + 1;

        return accumulator;
      },
      {},
    );

  return {
    uploads:
      uploads.map(
        (row) => ({
          id:
            row.id,
          category:
            row.category,
          originalFilename:
            row.original_filename,
          storedFilename:
            row.stored_filename,
          mimeType:
            row.mime_type,
          sizeBytes:
            row.size_bytes,
          note:
            row.note
            || '',
          createdAt:
            row.created_at,
        }),
      ),
    counts,
  };
}

async function orderHistory(
  db,
  orderId,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            id,
            action_code,
            description,
            metadata_json,
            created_at
          FROM v2_order_history
          WHERE order_id = ?
          ORDER BY
            created_at DESC,
            id DESC
          LIMIT 500
        `,
      )
      .bind(
        orderId,
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
        actionCode:
          row.action_code,
        description:
          row.description,
        metadata:
          parseJson(
            row.metadata_json,
            {},
          ),
        createdAt:
          row.created_at,
      }),
    );
}

async function orderNotes(
  db,
  orderId,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            id,
            note,
            created_at
          FROM v2_internal_notes
          WHERE order_id = ?
          ORDER BY
            created_at DESC,
            id DESC
        `,
      )
      .bind(
        orderId,
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
        note:
          row.note,
        createdAt:
          row.created_at,
      }),
    );
}

async function orderPreviews(
  db,
  orderId,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            p.id,
            p.version_number,
            p.media_type,
            p.status,
            p.expires_at,
            p.created_at,
            a.approved_at
          FROM v2_previews p
          LEFT JOIN v2_preview_approvals a
            ON a.preview_id = p.id
          WHERE p.order_id = ?
          ORDER BY
            p.version_number DESC,
            p.id DESC
        `,
      )
      .bind(
        orderId,
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
        version:
          row.version_number,
        mediaType:
          row.media_type,
        status:
          row.status,
        expiresAt:
          row.expires_at,
        createdAt:
          row.created_at,
        approvedAt:
          row.approved_at
          || null,
      }),
    );
}

async function orderTerms(
  db,
  orderId,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            terms_version,
            terms_hash,
            accepted_at,
            evidence_json
          FROM v2_order_terms_acceptances
          WHERE order_id = ?
          ORDER BY
            accepted_at DESC,
            id DESC
        `,
      )
      .bind(
        orderId,
      )
      .all();

  return (
    result.results
    || []
  )
    .map(
      (row) => ({
        version:
          row.terms_version,
        hash:
          row.terms_hash,
        acceptedAt:
          row.accepted_at,
        evidence:
          parseJson(
            row.evidence_json,
            {},
          ),
      }),
    );
}

async function orderContracts(
  db,
  orderId,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            id,
            version,
            status,
            pdf_r2_key,
            document_hash,
            created_at,
            updated_at,
            signed_at
          FROM v2_contracts
          WHERE order_id = ?
          ORDER BY
            version DESC,
            id DESC
        `,
      )
      .bind(
        orderId,
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
        version:
          row.version,
        status:
          row.status,
        hasPdf:
          Boolean(
            row.pdf_r2_key,
          ),
        documentHash:
          row.document_hash,
        createdAt:
          row.created_at,
        updatedAt:
          row.updated_at,
        signedAt:
          row.signed_at,
      }),
    );
}

function labelFromKey(
  key,
) {
  return String(
    key
    || '',
  )
    .replace(
      /([a-z0-9])([A-Z])/g,
      '$1 $2',
    )
    .replace(
      /_/g,
      ' ',
    )
    .replace(
      /\b\w/g,
      (character) =>
        character
          .toUpperCase(),
    );
}

function valueForText(
  value,
) {
  if (
    value === null
    || value === undefined
    || value === ''
  ) {
    return '';
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    return value
      .join(
        ', ',
      );
  }

  if (
    typeof value
    === 'object'
  ) {
    return JSON.stringify(
      value,
    );
  }

  return String(
    value,
  );
}

function briefingLines(
  briefing,
) {
  return Object
    .entries(
      briefing.data
      || {},
    )
    .filter(
      (
        [
          ,
          value,
        ],
      ) =>
        value !== null
        && value !== undefined
        && value !== ''
        && !(
          Array.isArray(
            value,
          )
          && !value.length
        ),
    )
    .map(
      (
        [
          key,
          value,
        ],
      ) =>
        `${
          labelFromKey(
            key,
          )
        }: ${
          valueForText(
            value,
          )
        }`,
    );
}

function buildBriefingTexts(
  order,
  items,
  briefing,
  uploads,
) {
  const product =
    items.find(
      (item) =>
        item.itemType
        === 'product',
    );

  const addons =
    items
      .filter(
        (item) =>
          item.itemType
          === 'addon',
      );

  const creativeLines =
    briefingLines(
      briefing,
    );

  const uploadSummary =
    Object
      .entries(
        uploads.counts
        || {},
      )
      .map(
        (
          [
            category,
            total,
          ],
        ) =>
          `${
            category
          }: ${
            total
          }`,
      )
      .join(
        ' | ',
      )
    || 'nenhum arquivo';

  const production = [
    `PEDIDO ${order.order_code}`,
    `Homenageado/evento: ${order.honoree_display_name}`,
    `Data do evento: ${order.event_date}`,
    `Produto: ${product?.name || 'Não identificado'}`,
    `Adicionais: ${
      addons.length
        ? addons
          .map(
            (item) =>
              item.name,
          )
          .join(
            ', ',
          )
        : 'Nenhum'
    }`,
    '',
    'BRIEFING',
    ...creativeLines,
    '',
    `ARQUIVOS: ${uploadSummary}`,
  ].join(
    '\n',
  );

  const full = [
    production,
    '',
    'CONTATO',
    `Cliente: ${order.customer_name}`,
    `WhatsApp: ${order.whatsapp}`,
    `E-mail: ${order.email || ''}`,
    '',
    'COMERCIAL',
    `Total: ${Number(order.total_cents || 0)} centavos`,
    `Pagamento: ${order.payment_method || ''}`,
    `Janela prometida: ${order.delivery_start || ''} a ${order.delivery_end || ''}`,
  ].join(
    '\n',
  );

  return {
    full,
    production,
  };
}

export async function getV2AdminOrderDetail(
  db,
  orderCode,
) {
  const order =
    await orderByCode(
      db,
      orderCode,
    );

  if (!order) {
    return null;
  }

  const [
    items,
    briefing,
    uploads,
    payments,
    history,
    notes,
    previews,
    terms,
    contracts,
  ] =
    await Promise.all([
      orderItems(
        db,
        order.id,
      ),
      orderBriefing(
        db,
        order.id,
      ),
      orderUploads(
        db,
        order.id,
      ),
      paymentSummary(
        db,
        order,
      ),
      orderHistory(
        db,
        order.id,
      ),
      orderNotes(
        db,
        order.id,
      ),
      orderPreviews(
        db,
        order.id,
      ),
      orderTerms(
        db,
        order.id,
      ),
      orderContracts(
        db,
        order.id,
      ),
    ]);

  const texts =
    buildBriefingTexts(
      order,
      items,
      briefing,
      uploads,
    );

  return {
    order: {
      id:
        order.id,
      code:
        order.order_code,
      publicToken:
        order.public_token,
      customerAreaPath:
        `/meu-pedido/${order.public_token}`,
      customerName:
        order.customer_name,
      whatsapp:
        order.whatsapp,
      email:
        order.email,
      eventType:
        order.event_type,
      eventSubtype:
        order.event_subtype,
      honoreeName:
        order.honoree_display_name,
      eventDate:
        order.event_date,
      status:
        order.status,
      statusLabel:
        statusLabel(
          order.status,
        ),
      nextAction:
        nextActionFromStatus(
          order,
        ),
      deliveryWindow: {
        start:
          order.delivery_start,
        end:
          order.delivery_end,
      },
      recommendedTargetDate:
        order.recommended_target_date,
      urgency:
        Boolean(
          order.urgency_enabled,
        ),
      briefingStatus:
        order.briefing_status,
      createdAt:
        order.created_at,
      updatedAt:
        order.updated_at,
      finalizedAt:
        order.finalized_at,
    },

    items,

    pricing: {
      subtotalCents:
        Number(
          order.subtotal_cents
          || 0,
        ),
      comboDiscountCents:
        Number(
          order.combo_discount_cents
          || 0,
        ),
      couponDiscountCents:
        Number(
          order.coupon_discount_cents
          || 0,
        ),
      urgencyPercent:
        Number(
          order.urgency_percent
          || 0,
        ),
      urgencyAmountCents:
        Number(
          order.urgency_amount_cents
          || 0,
        ),
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
      originalBalanceCents:
        Number(
          order.balance_cents
          || 0,
        ),
    },

    payment:
      payments,
    briefing,
    uploads,
    previews,
    terms,
    contracts,
    history,
    notes,

    copy: {
      full:
        texts.full,
      production:
        texts.production,
    },

    allowedActions:
      allowedActions(
        order,
        payments,
      ),
  };
}

export async function listV2Production(
  db,
  {
    status = '',
    q = '',
    when = '',
  } = {},
) {
  const clauses = [
    `o.status NOT IN (
      'cancelled',
      'finalized',
      'awaiting_payment',
      'briefing_pending'
    )`,
  ];

  const binds = [];

  if (
    status
    && status !== 'all'
  ) {
    clauses.push(
      'o.status = ?',
    );

    binds.push(
      status,
    );
  } else {
    clauses.push(
      `o.status IN (
        'ready_for_production',
        'in_production',
        'waiting_customer',
        'adjustments',
        'approved',
        'balance_pending',
        'ready_for_delivery'
      )`,
    );
  }

  const today =
    dateKeyInSaoPaulo();

  if (when === 'today') {
    clauses.push(
      'o.event_date = ?',
    );

    binds.push(
      today,
    );
  } else if (when === 'week') {
    clauses.push(
      'o.event_date BETWEEN ? AND ?',
    );

    binds.push(
      today,
      addDays(
        today,
        6,
      ),
    );
  } else if (when === 'new') {
    clauses.push(
      "o.status = 'ready_for_production'",
    );
  } else if (when === 'in_production') {
    clauses.push(
      "o.status = 'in_production'",
    );
  }

  const query =
    cleanText(
      q,
      120,
    );

  if (query) {
    clauses.push(`
      (
        o.order_code LIKE ?
        OR o.honoree_display_name LIKE ?
        OR c.name LIKE ?
        OR c.whatsapp LIKE ?
        OR b.data_json LIKE ?
        OR EXISTS (
          SELECT 1
          FROM v2_order_items search_item
          WHERE
            search_item.order_id = o.id
            AND (
              search_item.name_snapshot LIKE ?
              OR search_item.configuration_json LIKE ?
            )
        )
      )
    `);

    const like =
      `%${query}%`;

    binds.push(
      like,
      like,
      like,
      like,
      like,
      like,
      like,
    );
  }

  const result =
    await db
      .prepare(
        `
          SELECT
            o.id,
            o.order_code,
            o.honoree_display_name,
            o.event_date,
            o.status,
            o.next_action,
            o.delivery_start,
            o.delivery_end,
            o.updated_at,

            c.name AS customer_name,
            c.whatsapp,

            p.total_cents,
            p.payment_method,
            p.balance_cents,

            json_extract(
              b.data_json,
              '$.theme_or_style'
            ) AS theme,

            (
              SELECT item.name_snapshot
              FROM v2_order_items item
              WHERE
                item.order_id = o.id
                AND item.item_type = 'product'
              ORDER BY item.id
              LIMIT 1
            ) AS product_name,

            (
              SELECT json_extract(
                item.configuration_json,
                '$.sceneCount'
              )
              FROM v2_order_items item
              WHERE
                item.order_id = o.id
                AND item.item_type = 'product'
              ORDER BY item.id
              LIMIT 1
            ) AS scene_count,

            COALESCE(
              (
                SELECT SUM(
                  CASE
                    WHEN
                      pay.status = 'approved'
                      AND pay.payment_type != 'refund'
                      THEN pay.amount_cents
                    WHEN
                      pay.status = 'approved'
                      AND pay.payment_type = 'refund'
                      THEN -pay.amount_cents
                    ELSE 0
                  END
                )
                FROM v2_payments pay
                WHERE pay.order_id = o.id
              ),
              0
            ) AS paid_cents
          FROM v2_orders o
          INNER JOIN v2_customers c
            ON c.id = o.customer_id
          INNER JOIN v2_order_pricing p
            ON p.order_id = o.id
          LEFT JOIN v2_briefings b
            ON b.order_id = o.id
          WHERE ${
            clauses.join(
              ' AND ',
            )
          }
          ORDER BY
            o.event_date,
            CASE o.status
              WHEN 'adjustments' THEN 0
              WHEN 'ready_for_production' THEN 1
              WHEN 'in_production' THEN 2
              WHEN 'waiting_customer' THEN 3
              WHEN 'balance_pending' THEN 4
              WHEN 'ready_for_delivery' THEN 5
              ELSE 6
            END,
            COALESCE(
              o.delivery_start,
              '9999-12-31'
            ),
            o.created_at
        `,
      )
      .bind(
        ...binds,
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
        code:
          row.order_code,
        honoreeName:
          row.honoree_display_name,
        customerName:
          row.customer_name,
        whatsapp:
          row.whatsapp,
        eventDate:
          row.event_date,
        theme:
          row.theme
          || '',
        productName:
          row.product_name
          || '',
        sceneCount:
          Number(
            row.scene_count
            || 0,
          ),
        status:
          row.status,
        statusLabel:
          statusLabel(
            row.status,
          ),
        nextAction:
          nextActionFromStatus(
            row,
          ),
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
        balanceCents:
          Number(
            row.balance_cents
            || 0,
        ),
        updatedAt:
          row.updated_at,
      }),
    );
}

async function centralAttention(
  db,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            o.order_code,
            o.honoree_display_name,
            o.event_date,
            o.status,
            o.next_action,
            o.delivery_start,
            o.delivery_end,

            c.name AS customer_name
          FROM v2_orders o
          INNER JOIN v2_customers c
            ON c.id = o.customer_id
          WHERE o.status IN (
            'awaiting_urgency_decision',
            'ready_for_production',
            'adjustments',
            'balance_pending'
          )
          ORDER BY
            CASE o.status
              WHEN 'awaiting_urgency_decision' THEN 0
              WHEN 'adjustments' THEN 1
              WHEN 'balance_pending' THEN 2
              WHEN 'ready_for_production' THEN 3
              ELSE 4
            END,
            COALESCE(
              o.delivery_start,
              '9999-12-31'
            ),
            o.created_at
          LIMIT 50
        `,
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
        customerName:
          row.customer_name,
        eventDate:
          row.event_date,
        status:
          row.status,
        statusLabel:
          statusLabel(
            row.status,
          ),
        nextAction:
          nextActionFromStatus(
            row,
          ),
        deliveryWindow: {
          start:
            row.delivery_start,
          end:
            row.delivery_end,
        },
      }),
    );
}

async function partiesForDay(
  db,
  day,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            o.id,
            o.order_code,
            o.honoree_display_name,

            c.name AS customer_name,
            c.whatsapp,

            EXISTS(
              SELECT 1
              FROM v2_order_history h
              WHERE
                h.order_id = o.id
                AND h.action_code = 'congratulations_sent'
            ) AS congratulations_sent
          FROM v2_orders o
          INNER JOIN v2_customers c
            ON c.id = o.customer_id
          WHERE
            o.event_date = ?
            AND o.status IN (
              'briefing_pending',
              'ready_for_production',
              'in_production',
              'waiting_customer',
              'adjustments',
              'approved',
              'balance_pending',
              'ready_for_delivery',
              'finalized'
            )
          ORDER BY
            o.created_at
        `,
      )
      .bind(
        day,
      )
      .all();

  return (
    result.results
    || []
  )
    .map(
      (row) => {
        const message =
          `Oi, ${row.customer_name}! 💛 Hoje é um dia muito especial, e a Libri Convites deseja uma comemoração linda para ${row.honoree_display_name}. Que seja um dia cheio de momentos felizes e inesquecíveis! ✨`;

        return {
          code:
            row.order_code,
          honoreeName:
            row.honoree_display_name,
          customerName:
            row.customer_name,
          whatsapp:
            row.whatsapp,
          congratulationsSent:
            Boolean(
              row.congratulations_sent,
            ),
          congratulationsMessage:
            message,
          congratulationsWhatsappUrl:
            whatsappUrl(
              row.whatsapp,
              message,
            ),
        };
      },
    );
}

async function upcomingParties(
  db,
  today,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            o.order_code,
            o.honoree_display_name,
            o.event_date,
            o.status,
            c.name AS customer_name
          FROM v2_orders o
          INNER JOIN v2_customers c
            ON c.id = o.customer_id
          WHERE
            o.event_date > ?
            AND o.status IN (
              'briefing_pending',
              'ready_for_production',
              'in_production',
              'waiting_customer',
              'adjustments',
              'approved',
              'balance_pending',
              'ready_for_delivery',
              'finalized'
            )
          ORDER BY
            o.event_date,
            o.created_at
          LIMIT 12
        `,
      )
      .bind(
        today,
      )
      .all();

  return (
    result.results
    || []
  ).map(
    (row) => ({
      code:
        row.order_code,
      honoreeName:
        row.honoree_display_name,
      customerName:
        row.customer_name,
      eventDate:
        row.event_date,
      status:
        row.status,
      statusLabel:
        statusLabel(
          row.status,
        ),
    }),
  );
}

async function centralPendingPayments(
  db,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            o.order_code,
            o.honoree_display_name,
            o.status,
            o.next_action,
            c.name AS customer_name,
            p.total_cents,
            p.deposit_cents,
            p.payment_method
          FROM v2_orders o
          INNER JOIN v2_customers c
            ON c.id = o.customer_id
          INNER JOIN v2_order_pricing p
            ON p.order_id = o.id
          WHERE
            o.status IN (
              'awaiting_payment',
              'urgency_approved'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM v2_payments paid
              WHERE
                paid.order_id = o.id
                AND paid.status = 'approved'
                AND paid.payment_type != 'refund'
            )
          ORDER BY
            o.created_at DESC
          LIMIT 12
        `,
      )
      .all();

  return (
    result.results
    || []
  ).map(
    (row) => ({
      code:
        row.order_code,
      honoreeName:
        row.honoree_display_name,
      customerName:
        row.customer_name,
      status:
        row.status,
      statusLabel:
        statusLabel(
          row.status,
        ),
      nextAction:
        nextActionFromStatus(
          row,
        ),
      totalCents:
        Number(
          row.total_cents
          || 0,
        ),
      dueCents:
        Number(
          row.deposit_cents
          || row.total_cents
          || 0,
        ),
      paymentMethod:
        row.payment_method,
    }),
  );
}

async function centralNewOrders(
  db,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            o.order_code,
            o.honoree_display_name,
            o.event_date,
            o.status,
            o.next_action,
            c.name AS customer_name
          FROM v2_orders o
          INNER JOIN v2_customers c
            ON c.id = o.customer_id
          WHERE
            o.status IN (
              'briefing_pending',
              'ready_for_production'
            )
          ORDER BY
            o.created_at DESC
          LIMIT 12
        `,
      )
      .all();

  return (
    result.results
    || []
  ).map(
    (row) => ({
      code:
        row.order_code,
      honoreeName:
        row.honoree_display_name,
      customerName:
        row.customer_name,
      eventDate:
        row.event_date,
      status:
        row.status,
      statusLabel:
        statusLabel(
          row.status,
        ),
      nextAction:
        nextActionFromStatus(
          row,
        ),
    }),
  );
}

async function upcomingDeliveries(
  db,
  today,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            o.order_code,
            o.honoree_display_name,
            o.status,
            o.delivery_start,
            o.delivery_end
          FROM v2_orders o
          WHERE
            o.status NOT IN (
              'cancelled',
              'finalized'
            )
            AND o.delivery_end >= ?
          ORDER BY
            o.delivery_start,
            o.delivery_end,
            o.created_at
          LIMIT 20
        `,
      )
      .bind(
        today,
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
        status:
          row.status,
        statusLabel:
          statusLabel(
            row.status,
          ),
        start:
          row.delivery_start,
        end:
          row.delivery_end,
      }),
    );
}

async function capacitySnapshot(
  db,
  today,
) {
  const days = [];

  const defaultCapacity =
    await v2SettingInt(
      db,
      'default_sellable_points_per_day_units',
      400,
    );

  for (
    let offset = 0;
    offset < 14;
    offset += 1
  ) {
    days.push(
      addDays(
        today,
        offset,
      ),
    );
  }

  const start =
    days[0];

  const end =
    days[
      days.length
      - 1
    ];

  const [
    overridesResult,
    allocationsResult,
    holdsResult,
  ] =
    await Promise.all([
      db
        .prepare(
          `
            SELECT
              day,
              sellable_capacity_units,
              blocked
            FROM v2_agenda_days
            WHERE day BETWEEN ? AND ?
          `,
        )
        .bind(
          start,
          end,
        )
        .all(),

      db
        .prepare(
          `
            SELECT
              day,
              SUM(points_units) AS used_units
            FROM v2_agenda_allocations
            WHERE day BETWEEN ? AND ?
            GROUP BY day
          `,
        )
        .bind(
          start,
          end,
        )
        .all(),

      db
        .prepare(
          `
            SELECT
              a.day,
              SUM(a.points_units) AS held_units
            FROM v2_checkout_hold_allocations a
            INNER JOIN v2_checkout_holds h
              ON h.id = a.hold_id
            WHERE
              a.day BETWEEN ? AND ?
              AND h.status = 'active'
              AND h.expires_at > ?
            GROUP BY a.day
          `,
        )
        .bind(
          start,
          end,
          nowIso(),
        )
        .all(),
    ]);

  const overrides =
    Object.fromEntries(
      (
        overridesResult
          .results
        || []
      )
        .map(
          (row) => [
            row.day,
            row,
          ],
        ),
    );

  const used =
    Object.fromEntries(
      (
        allocationsResult
          .results
        || []
      )
        .map(
          (row) => [
            row.day,
            Number(
              row.used_units
              || 0,
            ),
          ],
        ),
    );

  const held =
    Object.fromEntries(
      (
        holdsResult
          .results
        || []
      )
        .map(
          (row) => [
            row.day,
            Number(
              row.held_units
              || 0,
            ),
          ],
        ),
    );

  return days
    .map(
      (day) => {
        const override =
          overrides[
            day
          ];

        const blocked =
          override
            ?.blocked
          === 1;

        const capacity =
          blocked
            ? 0
            : Number(
              override
                ?.sellable_capacity_units
              ?? defaultCapacity,
            );

        const usedUnits =
          used[
            day
          ]
          || 0;

        const heldUnits =
          held[
            day
          ]
          || 0;

        return {
          day,
          capacityUnits:
            capacity,
          usedUnits,
          heldUnits,
          freeUnits:
            Math.max(
              0,
              capacity
              - usedUnits
              - heldUnits,
            ),
          blocked,
        };
      },
    );
}

async function financeSnapshot(
  db,
) {
  const finance =
    await getV2FinanceSummary(
      db,
      {
        preset:
          'this_month',
      },
    );

  const summary =
    finance.summary
    || {};

  return {
    period: {
      start:
        finance.range?.start
        || '',
      endExclusive:
        finance.range?.endExclusive
        || '',
    },

    salesCents:
      Number(
        summary.salesCents
        || 0,
      ),

    cashCents:
      Number(
        summary.cashInCents
        || 0,
      ),

    receivableCents:
      Number(
        summary.openReceivableAllCents
        || 0,
      ),

    mercadoPagoFeeCents:
      Number(
        summary.mercadoPagoFeeCents
        || 0,
      ),

    discountsCents:
      Number(
        summary.discountsCents
        || 0,
      ),
  };
}

export async function getV2Central(
  db,
) {
  const today =
    dateKeyInSaoPaulo();

  const tomorrow =
    addDays(
      today,
      1,
    );

  const [
    attention,
    partiesToday,
    partiesTomorrow,
    partiesUpcoming,
    pendingPayments,
    newOrders,
    deliveries,
    capacity,
    finance,
  ] =
    await Promise.all([
      centralAttention(
        db,
      ),
      partiesForDay(
        db,
        today,
      ),
      partiesForDay(
        db,
        tomorrow,
      ),
      upcomingParties(
        db,
        today,
      ),
      centralPendingPayments(
        db,
      ),
      centralNewOrders(
        db,
      ),
      upcomingDeliveries(
        db,
        today,
      ),
      capacitySnapshot(
        db,
        today,
      ),
      financeSnapshot(
        db,
      ),
    ]);

  return {
    today,
    attention,
    partiesToday,
    partiesTomorrow,
    partiesUpcoming,
    pendingPayments,
    newOrders,
    upcomingDeliveries:
      deliveries,
    capacity,
    finance,
  };
}

async function insertHistory(
  db,
  orderId,
  actionCode,
  description,
  metadata = {},
) {
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
      orderId,
      actionCode,
      description,
      JSON.stringify(
        metadata,
      ),
      nowIso(),
    )
    .run();
}

export async function addV2InternalNote(
  db,
  orderCode,
  note,
) {
  const order =
    await orderByCode(
      db,
      orderCode,
    );

  if (!order) {
    return null;
  }

  const text =
    cleanText(
      note,
      4000,
    );

  if (!text) {
    throw new Error(
      'Escreva a observação.',
    );
  }

  const result =
    await db
      .prepare(
        `
          INSERT INTO v2_internal_notes(
            order_id,
            note,
            created_at
          )
          VALUES (?, ?, ?)
        `,
      )
      .bind(
        order.id,
        text,
        nowIso(),
      )
      .run();

  return {
    id:
      Number(
        result
          ?.meta
          ?.last_row_id,
      ),
    note:
      text,
  };
}

export async function markV2CongratulationsSent(
  db,
  orderCode,
) {
  const order =
    await orderByCode(
      db,
      orderCode,
    );

  if (!order) {
    return null;
  }

  const existing =
    await db
      .prepare(
        `
          SELECT id
          FROM v2_order_history
          WHERE
            order_id = ?
            AND action_code = 'congratulations_sent'
          LIMIT 1
        `,
      )
      .bind(
        order.id,
      )
      .first();

  if (!existing) {
    await insertHistory(
      db,
      order.id,
      'congratulations_sent',
      'Parabéns do dia marcado como enviado.',
    );
  }

  return {
    ok: true,
    alreadyMarked:
      Boolean(
        existing,
      ),
  };
}

export async function applyV2AdminAction(
  db,
  orderCode,
  action,
) {
  const order =
    await orderByCode(
      db,
      orderCode,
    );

  if (!order) {
    return null;
  }

  if (
    [
      'cancelled',
      'finalized',
    ].includes(
      order.status,
    )
  ) {
    throw new Error(
      'Este pedido já está encerrado.',
    );
  }

  const payments =
    await paymentSummary(
      db,
      order,
    );

  const allowed =
    allowedActions(
      order,
      payments,
    );

  if (
    !allowed.includes(
      action,
    )
  ) {
    throw new Error(
      'Esta ação não está disponível para o estado atual do pedido.',
    );
  }

  const stamp =
    nowIso();

  if (
    action
    === 'start_production'
  ) {
    await db
      .prepare(
        `
          UPDATE v2_orders
          SET
            status = 'in_production',
            next_action = 'Continuar produção',
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        stamp,
        order.id,
      )
      .run();

    await insertHistory(
      db,
      order.id,
      'production_started',
      'Produção iniciada.',
    );

    return {
      status:
        'in_production',
      nextAction:
        'Continuar produção',
    };
  }

  if (
    action
    === 'waiting_customer'
  ) {
    await db
      .prepare(
        `
          UPDATE v2_orders
          SET
            status = 'waiting_customer',
            next_action = 'Aguardar cliente',
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        stamp,
        order.id,
      )
      .run();

    await insertHistory(
      db,
      order.id,
      'waiting_customer',
      'Pedido marcado como aguardando cliente.',
    );

    return {
      status:
        'waiting_customer',
      nextAction:
        'Aguardar cliente',
    };
  }

  if (
    action
    === 'adjustments'
  ) {
    await db
      .prepare(
        `
          UPDATE v2_orders
          SET
            status = 'adjustments',
            next_action = 'Fazer ajustes',
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        stamp,
        order.id,
      )
      .run();

    await insertHistory(
      db,
      order.id,
      'adjustments_started',
      'Pedido movido para ajustes.',
    );

    return {
      status:
        'adjustments',
      nextAction:
        'Fazer ajustes',
    };
  }

  if (
    action
    === 'approve'
  ) {
    const nextStatus =
      payments
        .fullyPaid
        ? 'ready_for_delivery'
        : 'balance_pending';

    const nextAction =
      payments
        .fullyPaid
        ? 'Liberar entrega'
        : 'Cobrar saldo';

    await db
      .prepare(
        `
          UPDATE v2_orders
          SET
            status = ?,
            next_action = ?,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        nextStatus,
        nextAction,
        stamp,
        order.id,
      )
      .run();

    await insertHistory(
      db,
      order.id,
      'order_approved',
      'Pedido aprovado.',
      {
        nextStatus,
      },
    );

    return {
      status:
        nextStatus,
      nextAction,
    };
  }

  if (
    action
    === 'balance_received'
  ) {
    const amount =
      payments
        .remainingBalanceCents;

    if (
      amount <= 0
    ) {
      throw new Error(
        'Este pedido não possui saldo pendente.',
      );
    }

    await db.batch([
      db
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
              'balance',
              'pix',
              'approved',
              ?,
              0,
              ?,
              '{}',
              ?,
              ?,
              ?
            )
          `,
        )
        .bind(
          order.id,
          amount,
          amount,
          stamp,
          stamp,
          stamp,
        ),

      db
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
        ),
    ]);

    await insertHistory(
      db,
      order.id,
      'balance_received',
      'Saldo final recebido por Pix.',
      {
        amountCents:
          amount,
      },
    );

    return {
      status:
        'ready_for_delivery',
      nextAction:
        'Liberar entrega',
    };
  }

  if (
    action
    === 'finalize'
  ) {
    return finalizeV2OrderToCascadePool(
      db,
      order,
    );
  }

  throw new Error(
    'Ação desconhecida.',
  );
}
