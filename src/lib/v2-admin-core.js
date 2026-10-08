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

import {
  loadV2WhatsappTemplates,
  renderV2WhatsappTemplate,
} from './v2-whatsapp-templates.js';

import { getV2AdminBriefingFieldMeta } from './v2-customer-area.js';

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

  // Only ask for files that the customer's current questionnaire requires.
  // An optional set of references must never trigger a missing-photo message.
  if (isLive && !isUnpaid && Number(payments?.paidCents || 0) > 0) {
    const missing = requiredUploadRules.filter(rule =>
      Number(rule.min || 0) > 0
      && uploads.filter(file => file.fieldKey === rule.fieldKey).length < Number(rule.min),
    );
    if (missing.length) {
      const categories = missing.map(rule => rule.label.toLowerCase()).join(' e ');
      const message = `Oi, ${order.customer_name}! 💛 Para continuar o convite de ${order.honoree_display_name}, ainda precisamos de ${categories}. Você pode enviar pelo seu pedido: ${values.customerAreaUrl}?tab=briefing`;
      actions.push({
        code: 'photos',
        label: 'Pedir fotos pendentes',
        message,
        url: whatsappUrl(order.whatsapp, message),
      });
    }
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
        [
          'processed',
          'approved',
          'refunded',
        ].includes(
          remoteStatus,
        )
      ) {
        throw new Error(
          'O Mercado Pago informa pagamento processado neste pedido. Atualize o status antes de cancelar.',
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
    } catch (
      error
    ) {
      if (
        /pagamento processado/i
          .test(
            String(
              error?.message
              || '',
            ),
          )
      ) {
        throw error;
      }

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

// Unpaid orders remain recoverable. Only archive after 24h; never delete
// customers, items, terms or financial history from the scheduler.
export async function cleanupAbandonedUnpaidV2Orders(env) {
  const stamp = nowIso();
  const rows = await env.DB.prepare(`
    SELECT o.id, o.order_code
    FROM v2_orders o
    WHERE o.status = 'awaiting_payment'
      AND o.briefing_status = 'locked'
      AND o.archived_at IS NULL
      AND datetime(MAX(
        o.created_at,
        COALESCE((SELECT u.decided_at FROM v2_urgency_requests u
          WHERE u.order_id = o.id AND u.status = 'approved'), o.created_at),
        COALESCE((SELECT MAX(h.created_at) FROM v2_order_history h
          WHERE h.order_id = o.id AND h.action_code = 'order_unarchived'), o.created_at)
      )) <= datetime('now', '-24 hours')
      AND EXISTS (SELECT 1 FROM v2_checkout_holds h WHERE h.order_id = o.id)
      AND NOT EXISTS (
        SELECT 1 FROM v2_checkout_holds h
        WHERE h.order_id = o.id AND h.status = 'active' AND h.expires_at > ?
      )
      AND NOT EXISTS (
        SELECT 1 FROM v2_payments p
        WHERE p.order_id = o.id AND p.status IN ('pending', 'approved', 'refunded')
      )
    ORDER BY o.created_at
    LIMIT 20
  `).bind(stamp).all();

  let archived = 0;
  for (const order of rows.results || []) {
    const result = await env.DB.prepare(`
      UPDATE v2_orders SET
        archived_at = ?,
        next_action = 'Prazo de pagamento encerrado; pedido preservado',
        updated_at = ?
      WHERE id = ? AND archived_at IS NULL
        AND status = 'awaiting_payment' AND briefing_status = 'locked'
        AND NOT EXISTS (
          SELECT 1 FROM v2_payments
          WHERE order_id = ? AND status IN ('pending', 'approved', 'refunded')
        )
    `).bind(stamp, stamp, order.id, order.id).run();
    if (!Number(result?.meta?.changes || 0)) continue;
    archived += 1;
    await env.DB.prepare(`
      INSERT INTO v2_order_history(order_id, action_code, description, metadata_json, created_at)
      VALUES (?, 'unpaid_window_archived', 'Prazo de 24 horas encerrado; pedido preservado nos arquivados.', '{}', ?)
    `).bind(order.id, stamp).run();
  }

  return { archived, deleted: 0, skipped: 0 };
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

function moneyLabel(
  cents,
) {
  return new Intl.NumberFormat(
    'pt-BR',
    {
      style:
        'currency',
      currency:
        'BRL',
    },
  ).format(
    Number(
      cents
      || 0,
    )
    / 100,
  );
}

function deliveryRisk(
  row,
  today =
    dateKeyInSaoPaulo(),
) {
  if (
    [
      'finalized',
      'cancelled',
    ].includes(
      row.status,
    )
  ) {
    return {
      level:
        'closed',
      label:
        'Encerrado',
      reason:
        'Pedido encerrado.',
    };
  }

  if (
    !row.delivery_start
    || !row.delivery_end
  ) {
    return {
      level:
        'attention',
      label:
        'Atenção',
      reason:
        'Janela de entrega ainda não definida.',
    };
  }

  if (
    row.status
    === 'ready_for_delivery'
  ) {
    return {
      level:
        'low',
      label:
        'Tranquilo',
      reason:
        'Pedido pronto para entrega.',
    };
  }

  if (
    row.delivery_end
    < today
  ) {
    return {
      level:
        'priority',
      label:
        'Prioridade',
      reason:
        'A faixa de entrega já terminou.',
    };
  }

  if (
    row.delivery_start
    <= today
    && row.delivery_end
      >= today
  ) {
    return {
      level:
        'priority',
      label:
        'Prioridade',
      reason:
        'A faixa de entrega está em andamento e o pedido ainda não está pronto.',
    };
  }

  if (
    row.delivery_start
    <= addDays(
      today,
      2,
    )
  ) {
    return {
      level:
        'attention',
      label:
        'Atenção',
      reason:
        'A faixa de entrega começa em até 2 dias.',
    };
  }

  return {
    level:
      'low',
    label:
      'Tranquilo',
    reason:
      'Há folga antes da faixa de entrega.',
  };
}

function finalizeChecklistFrom(
  order,
  payments,
  briefing,
  previews,
  history = [],
) {
  const items = [
    {
      code:
        'briefing',
      label:
        'Dados preenchidos',
      ok:
        order.briefing_status
        === 'completed'
        || Number(
          briefing
            ?.completionPercent
          || 0,
        ) >= 100,
    },
    {
      code:
        'preview',
      label:
        'Prévia aprovada pela cliente',
      ok:
        (
          (
            previews
            || []
          )
            .some(
              (preview) =>
                Boolean(
                  preview.approvedAt,
                )
                || preview.status
                  === 'approved',
            )
          || (
            history
            || []
          )
            .some(
              (item) =>
                item.actionCode
                === 'preview_approved_external',
            )
        ),
    },
    {
      code:
        'payment',
      label:
        'Saldo totalmente resolvido',
      ok:
        Number(
          payments
            ?.remainingBalanceCents
          || 0,
        ) === 0,
    },
    {
      code:
        'delivery_window',
      label:
        'Faixa de entrega definida',
      ok:
        Boolean(
          order.delivery_start
          && order.delivery_end,
        ),
    },
  ];

  return {
    ready:
      items.every(
        (item) =>
          item.ok,
      ),
    items,
    manualConfirmationLabel:
      'Arquivo ou link final conferido e pronto para entrega',
  };
}

function orderWhatsappActions(
  order,
  briefing,
  previews,
  payments,
  templates,
  uploads = [],
  requiredUploadRules = [],
) {
  const area =
    `/meu-pedido/${order.public_token}`;

  const values = {
    customerName:
      order.customer_name,
    honoreeName:
      order.honoree_display_name,
    orderCode:
      order.order_code,
    customerAreaUrl:
      `https://pedidos.libriconvites.com.br${area}`,
    balanceLabel:
      moneyLabel(
        payments
          ?.remainingBalanceCents
        || 0,
      ),
  };

  const actions = [];

  const isUnpaid = ['awaiting_payment', 'urgency_approved'].includes(order.status)
    && Number(payments?.paidCents || 0) <= 0;
  const isLive = !['cancelled', 'finalized'].includes(order.status);

  if (isUnpaid) {
    const message = `Oi, ${order.customer_name}! 💛 Seu pedido de ${order.honoree_display_name} está salvo. Você pode concluir o pagamento por aqui: ${values.customerAreaUrl}`;
    actions.push({
      code: 'payment',
      label: 'Lembrar pagamento',
      message,
      url: whatsappUrl(order.whatsapp, message),
    });
  }

  if (
    isLive
    && !isUnpaid
    && Number(
      briefing
        ?.completionPercent
      || 0,
    ) < 100
  ) {
    const message =
      renderV2WhatsappTemplate(
        templates.briefing,
        values,
      );

    actions.push({
      code:
        'briefing',
      label:
        'Pedir dados da festa',
      message,
      url:
        whatsappUrl(
          order.whatsapp,
          message,
        ),
    });
  }

  if (
    isLive && (
      previews
      || []
    )
      .some(
        (preview) =>
          preview.status
          === 'active',
      )
  ) {
    const message =
      renderV2WhatsappTemplate(
        templates.preview,
        values,
      );

    actions.push({
      code:
        'preview',
      label:
        'Prévia disponível',
      message,
      url:
        whatsappUrl(
          order.whatsapp,
          message,
        ),
    });
  }

  if (
    isLive && !isUnpaid
    && Number(
      payments
        ?.remainingBalanceCents
      || 0,
    ) > 0
    && ['balance_pending','ready_for_delivery','approved'].includes(order.status)
  ) {
    const message =
      renderV2WhatsappTemplate(
        templates.balance,
        values,
      );

    actions.push({
      code:
        'balance',
      label:
        'Saldo pendente',
      message,
      url:
        whatsappUrl(
          order.whatsapp,
          message,
        ),
    });
  }

  if (
    order.status
    === 'finalized'
  ) {
    const message =
      renderV2WhatsappTemplate(
        templates.finalized,
        values,
      );

    actions.push({
      code:
        'finalized',
      label:
        'Pedido finalizado',
      message,
      url:
        whatsappUrl(
          order.whatsapp,
          message,
        ),
    });
  }

  return actions;
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
      'Dados pendentes',
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
    return String(row.next_action).replace(/briefing/gi, 'dados do convite');
  }

  return {
    awaiting_urgency_decision:
      'Analisar encaixe',
    awaiting_payment:
      'Aguardar pagamento',
    briefing_pending:
      'Aguardar dados da festa',
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
    row.archived_at
  ) {
    return [
      'unarchive',
    ];
  }

  if (
    [
      'finalized',
      'cancelled',
    ].includes(
      row.status,
    )
    && row.event_date
      < dateKeyInSaoPaulo()
  ) {
    actions.push(
      'archive',
    );
  }

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
        + (
          payment.provider === 'mercado_pago'
          && payment.net_cents !== null && payment.net_cents !== undefined
            ? Math.max(0, Number(payment.amount_cents || 0) - Number(payment.net_cents))
            : Number(payment.fee_cents || 0)
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
            field_key,
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
          fieldKey: row.field_key,
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

function briefingLines(briefing, fields = []) {
  const definitions = new Map(fields.map(item => [item.key, item]));
  return Object.entries(briefing.data || {})
    .filter(([, value]) => value !== null && value !== undefined
      && value !== '' && !(Array.isArray(value) && !value.length))
    .map(([key, value]) => {
      const definition = definitions.get(key);
      const options = new Map((definition?.options || [])
        .map(option => [option.value, option.label]));
      const label = definition?.label || labelFromKey(key);
      const text = Array.isArray(value)
        ? value.map(item => options.get(item) || valueForText(item)).join(', ')
        : options.get(value) || valueForText(value);
      return label + ': ' + text;
    });
}

function buildBriefingTexts(
  order,
  items,
  briefing,
  uploads,
  fields = [],
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

  const creativeLines = briefingLines(briefing, fields);

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
    'DADOS DO CONVITE',
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

function contractedSummaryFrom(
  order,
  items,
) {
  const product =
    (
      items
      || []
    )
      .find(
        (item) =>
          item.itemType
          === 'product',
      )
    || null;

  const addons =
    (
      items
      || []
    )
      .filter(
        (item) =>
          item.itemType
          === 'addon',
      );

  const snapshot =
    parseJson(
      order.pricing_snapshot_json,
      {},
    );

  return {
    product:
      product
        ? {
            name:
              product.name,
            code:
              product.itemCode,
            sceneCount:
              Number(
                product.configuration
                  ?.sceneCount
                || 0,
              )
              || null,
            variantCode:
              product.configuration
                ?.variantCode
              || product.itemCode,
            priceCents:
              Number(
                product.unitPriceCents
                || 0,
              ),
          }
        : null,

    addons:
      addons.map(
        (item) => ({
          name:
            item.name,
          code:
            item.itemCode,
          priceCents:
            Number(
              item.unitPriceCents
              || 0,
            ),
        }),
      ),

    combo:
      snapshot.combo
        ? {
            name:
              snapshot.combo.name
              || snapshot.combo.code
              || 'Combo',
            code:
              snapshot.combo.code
              || '',
          }
        : null,

    couponCode:
      snapshot.coupon
        ?.code
      || snapshot.couponCode
      || '',

    paymentMethod:
      order.payment_method,
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

  const fieldMeta = await getV2AdminBriefingFieldMeta(db, order.public_token);
  const texts = buildBriefingTexts(order, items, briefing, uploads, fieldMeta.fields);

  const whatsappTemplates =
    await loadV2WhatsappTemplates(
      db,
    );

  const finalizeChecklist =
    finalizeChecklistFrom(
      order,
      payments,
      briefing,
      previews,
      history,
    );

  const contractedSummary =
    contractedSummaryFrom(
      order,
      items,
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
      risk:
        deliveryRisk(
          order,
        ),
      briefingStatus:
        order.briefing_status,
      createdAt:
        order.created_at,
      updatedAt:
        order.updated_at,
      finalizedAt:
        order.finalized_at,
      archivedAt:
        order.archived_at
        || null,
    },

    items,

    contractedSummary,

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
    briefing: { ...briefing, fields: fieldMeta.fields },
    uploads: {
      ...uploads,
      uploads: uploads.uploads.map(upload => ({
        ...upload,
        fieldLabel: fieldMeta.uploads.find(item => item.fieldKey === upload.fieldKey)?.label || '',
      })),
    },
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

    finalizeChecklist,

    whatsappActions:
      orderWhatsappActions(
        order,
        briefing,
        previews,
        payments,
        whatsappTemplates,
        uploads.uploads,
        fieldMeta.uploads,
      ),

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
    'o.archived_at IS NULL',
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
        risk:
          deliveryRisk(
            row,
            today,
          ),
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
  templates,
) {
  const today =
    dateKeyInSaoPaulo();

  const result =
    await db
      .prepare(
        `
          SELECT
            o.order_code,
            o.public_token,
            o.honoree_display_name,
            o.event_date,
            o.status,
            o.next_action,
            o.delivery_start,
            o.delivery_end,

            c.name AS customer_name,
            c.whatsapp,

            pr.total_cents,

            COALESCE(
              (
                SELECT SUM(
                  CASE
                    WHEN pay.status = 'approved'
                      AND pay.payment_type != 'refund'
                      THEN pay.amount_cents
                    WHEN pay.status = 'approved'
                      AND pay.payment_type = 'refund'
                      THEN -pay.amount_cents
                    ELSE 0
                  END
                )
                FROM v2_payments pay
                WHERE pay.order_id = o.id
              ),
              0
            ) AS paid_cents,

            EXISTS(
              SELECT 1
              FROM v2_previews p
              WHERE
                p.order_id = o.id
                AND p.status = 'active'
            ) AS has_active_preview
          FROM v2_orders o
          INNER JOIN v2_customers c
            ON c.id = o.customer_id
          INNER JOIN v2_order_pricing pr
            ON pr.order_id = o.id
          WHERE
            o.archived_at IS NULL
            AND (
              o.status IN (
                'awaiting_urgency_decision',
                'briefing_pending',
                'ready_for_production',
                'waiting_customer',
                'adjustments',
                'balance_pending',
                'ready_for_delivery'
              )
              OR o.event_date = ?
              OR (
                o.delivery_start IS NOT NULL
                AND o.delivery_end IS NOT NULL
                AND ? BETWEEN o.delivery_start AND o.delivery_end
                AND o.status NOT IN (
                  'cancelled',
                  'finalized'
                )
              )
            )
          ORDER BY
            CASE
              WHEN o.status = 'awaiting_urgency_decision' THEN 0
              WHEN o.status = 'adjustments' THEN 1
              WHEN o.status = 'waiting_customer' THEN 2
              WHEN o.status = 'balance_pending' THEN 3
              WHEN o.status = 'briefing_pending' THEN 4
              WHEN o.delivery_start IS NOT NULL
                AND ? BETWEEN o.delivery_start AND o.delivery_end THEN 5
              WHEN o.event_date = ? THEN 6
              WHEN o.status = 'ready_for_production' THEN 7
              ELSE 8
            END,
            COALESCE(
              o.delivery_start,
              o.event_date,
              '9999-12-31'
            ),
            o.created_at
          LIMIT 80
        `,
      )
      .bind(
        today,
        today,
        today,
        today,
      )
      .all();

  return (
    result.results
    || []
  )
    .map(
      (row) => {
        let reason =
          nextActionFromStatus(
            row,
          );

        if (
          row.status
          === 'awaiting_urgency_decision'
        ) {
          reason =
            'Analisar pedido de encaixe';
        } else if (
          row.status
          === 'briefing_pending'
        ) {
          reason =
            'Aguardando dados da cliente';
        } else if (
          (
            row.status
            === 'waiting_customer'
            || row.status
              === 'adjustments'
          )
          && row.has_active_preview
        ) {
          reason =
            'Prévia aguardando retorno da cliente';
        } else if (
          row.status
          === 'balance_pending'
        ) {
          reason =
            'Saldo pendente';
        } else if (
          row.delivery_start
          && row.delivery_end
          && today
            >= row.delivery_start
          && today
            <= row.delivery_end
        ) {
          reason =
            'Dentro da faixa de entrega hoje';
        } else if (
          row.event_date
          === today
        ) {
          reason =
            'Festa hoje';
        } else if (
          row.status
          === 'ready_for_delivery'
        ) {
          reason =
            'Pedido pronto para entrega';
        }

        const remainingBalanceCents =
          Math.max(
            0,
            Number(
              row.total_cents
              || 0,
            )
            - Number(
              row.paid_cents
              || 0,
            ),
          );

        const values = {
          customerName:
            row.customer_name,
          honoreeName:
            row.honoree_display_name,
          orderCode:
            row.order_code,
          customerAreaUrl:
            `https://pedidos.libriconvites.com.br/meu-pedido/${row.public_token}`,
          balanceLabel:
            moneyLabel(
              remainingBalanceCents,
            ),
        };

        let quickTemplate =
          '';

        if (
          row.status
          === 'briefing_pending'
        ) {
          quickTemplate =
            templates.briefing;
        } else if (
          (
            row.status
            === 'waiting_customer'
            || row.status
              === 'adjustments'
          )
          && row.has_active_preview
        ) {
          quickTemplate =
            templates.preview;
        } else if (
          row.status
          === 'balance_pending'
        ) {
          quickTemplate =
            templates.balance;
        }

        const quickWhatsappMessage =
          quickTemplate
            ? renderV2WhatsappTemplate(
              quickTemplate,
              values,
            )
            : '';

        return {
          code:
            row.order_code,
          honoreeName:
            row.honoree_display_name,
          customerName:
            row.customer_name,
          whatsapp:
            row.whatsapp,
          customerAreaPath:
            `/meu-pedido/${row.public_token}`,
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
          attentionReason:
            reason,
          hasActivePreview:
            Boolean(
              row.has_active_preview,
            ),
          remainingBalanceCents,
          quickWhatsappMessage,
          quickWhatsappUrl:
            quickWhatsappMessage
              ? whatsappUrl(
                row.whatsapp,
                quickWhatsappMessage,
              )
              : '',
          deliveryWindow: {
            start:
              row.delivery_start,
            end:
              row.delivery_end,
          },
        };
      },
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
            o.archived_at IS NULL
            AND o.event_date = ?
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
            o.archived_at IS NULL
            AND o.event_date > ?
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
            o.archived_at IS NULL
            AND o.status IN (
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
            o.archived_at IS NULL
            AND o.status IN (
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
            o.archived_at IS NULL
            AND o.status NOT IN (
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

export async function listV2ArchivedOrders(
  db,
  {
    q = '',
    limit = 80,
  } = {},
) {
  const search =
    cleanText(
      q,
      120,
    );

  const safeLimit =
    Math.max(
      1,
      Math.min(
        200,
        Number.parseInt(
          limit,
          10,
        )
        || 80,
      ),
    );

  const pattern =
    `%${search}%`;

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
            o.archived_at,
            c.name AS customer_name,
            c.whatsapp
          FROM v2_orders o
          INNER JOIN v2_customers c
            ON c.id = o.customer_id
          WHERE
            o.archived_at IS NOT NULL
            AND (
              ? = ''
              OR o.order_code LIKE ?
              OR o.honoree_display_name LIKE ?
              OR c.name LIKE ?
              OR c.whatsapp LIKE ?
            )
          ORDER BY
            o.archived_at DESC,
            o.event_date DESC,
            o.id DESC
          LIMIT ?
        `,
      )
      .bind(
        search,
        pattern,
        pattern,
        pattern,
        pattern,
        safeLimit,
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
        whatsapp:
          row.whatsapp,
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
        archivedAt:
          row.archived_at,
      }),
    );
}

export async function getV2Central(
  db,
) {
  const today =
    dateKeyInSaoPaulo();

  const whatsappTemplates =
    await loadV2WhatsappTemplates(
      db,
    );

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
        whatsappTemplates,
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

export async function markV2ExternalPreviewApproval(
  db,
  orderCode,
  {
    channel = 'whatsapp',
    note = '',
  } = {},
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

  const cleanChannel =
    cleanText(
      channel,
      40,
    )
      .toLowerCase()
    || 'whatsapp';

  const cleanNote =
    cleanText(
      note,
      600,
    );

  const existing =
    await db
      .prepare(
        `
          SELECT id
          FROM v2_order_history
          WHERE
            order_id = ?
            AND action_code = 'preview_approved_external'
          ORDER BY id DESC
          LIMIT 1
        `,
      )
      .bind(
        order.id,
      )
      .first();

  if (existing) {
    return {
      ok:
        true,
      alreadyMarked:
        true,
    };
  }

  const payments =
    await paymentSummary(
      db,
      order,
    );

  const latestPreview =
    await db
      .prepare(
        `
          SELECT
            id,
            version_number,
            status
          FROM v2_previews
          WHERE order_id = ?
          ORDER BY
            version_number DESC,
            id DESC
          LIMIT 1
        `,
      )
      .bind(
        order.id,
      )
      .first();

  const stamp =
    nowIso();

  const nextStatus =
    payments
      .remainingBalanceCents
      > 0
        ? 'balance_pending'
        : 'ready_for_delivery';

  const nextAction =
    payments
      .remainingBalanceCents
      > 0
        ? 'Cobrar saldo'
        : 'Liberar entrega';

  const statements = [];

  if (
    latestPreview
    && ![
      'replaced',
      'revoked',
    ].includes(
      latestPreview.status,
    )
  ) {
    statements.push(
      db
        .prepare(
          `
            INSERT OR IGNORE INTO v2_preview_approvals(
              preview_id,
              order_id,
              approved_at,
              evidence_json
            )
            VALUES (?, ?, ?, ?)
          `,
        )
        .bind(
          latestPreview.id,
          order.id,
          stamp,
          JSON.stringify({
            source:
              'admin_external',
            channel:
              cleanChannel,
            note:
              cleanNote,
          }),
        ),
    );

    statements.push(
      db
        .prepare(
          `
            UPDATE v2_previews
            SET status = 'approved'
            WHERE id = ?
          `,
        )
        .bind(
          latestPreview.id,
        ),
    );
  }

  statements.push(
    db
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
      ),
  );

  statements.push(
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
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .bind(
        order.id,
        'preview_approved_external',
        cleanChannel
          === 'whatsapp'
            ? 'Aprovação da prévia registrada pelo Admin após confirmação no WhatsApp.'
            : 'Aprovação externa da prévia registrada pelo Admin.',
        JSON.stringify({
          channel:
            cleanChannel,
          note:
            cleanNote,
          previewId:
            latestPreview
              ?.id
            || null,
          version:
            latestPreview
              ?.version_number
            || null,
        }),
        stamp,
      ),
  );

  await db.batch(
    statements,
  );

  return {
    ok:
      true,
    approvedAt:
      stamp,
    channel:
      cleanChannel,
    order: {
      status:
        nextStatus,
      nextAction,
    },
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
  options = {},
) {
  const order =
    await orderByCode(
      db,
      orderCode,
    );

  if (!order) {
    return null;
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
    === 'archive'
  ) {
    await db
      .prepare(
        `
          UPDATE v2_orders
          SET
            archived_at = ?,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        stamp,
        stamp,
        order.id,
      )
      .run();

    await insertHistory(
      db,
      order.id,
      'order_archived',
      'Pedido arquivado no admin.',
    );

    return {
      status:
        order.status,
      archived:
        true,
    };
  }

  if (
    action
    === 'unarchive'
  ) {
    await db
      .prepare(
        `
          UPDATE v2_orders
          SET
            archived_at = NULL,
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
      'order_unarchived',
      'Pedido restaurado dos arquivados.',
    );

    return {
      status:
        order.status,
      archived:
        false,
    };
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
    const [
      briefing,
      previews,
      history,
    ] =
      await Promise.all([
        orderBriefing(
          db,
          order.id,
        ),
        orderPreviews(
          db,
          order.id,
        ),
        orderHistory(
          db,
          order.id,
        ),
      ]);

    const checklist =
      finalizeChecklistFrom(
        order,
        payments,
        briefing,
        previews,
        history,
      );

    const missing =
      checklist.items
        .filter(
          (item) =>
            !item.ok,
        );

    if (
      missing.length
    ) {
      throw new Error(
        `Antes de finalizar, resolva: ${
          missing
            .map(
              (item) =>
                item.label,
            )
            .join(', ')
        }.`,
      );
    }

    if (
      options
        ?.finalDeliveryConfirmed
      !== true
    ) {
      throw new Error(
        'Confirme que o arquivo ou link final foi conferido e está pronto para entrega.',
      );
    }

    return finalizeV2OrderToCascadePool(
      db,
      order,
    );
  }

  throw new Error(
    'Ação desconhecida.',
  );
}
