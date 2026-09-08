import {
  fail,
  json,
  nowIso,
  readJson,
} from '../lib/http.js';

import {
  addHistory,
} from '../lib/orders.js';

/* ==================================================
   LIBRI PEDIDOS V2
   WORKFLOW ADMINISTRATIVO SIMPLIFICADO
================================================== */

const WORKFLOW_STATUSES = Object.freeze({
  new: 'Novo',
  producing: 'Produção',
  revisions: 'Ajustes',
  finished: 'Finalizado',
  cancelled: 'Cancelado',
});

const PAYMENT_STATUSES = Object.freeze({
  pending: 'Pagamento pendente',
  paid: 'Pago',
});

const CANCEL_REASONS = new Set([
  'Não realizou pagamento',
  'Cliente desistiu',
  'Outro',
]);

/* ==================================================
   HELPERS
================================================== */

function parseOrderId(
  pathname,
  suffix,
) {
  const escapedSuffix =
    suffix.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    );

  const match =
    pathname.match(
      new RegExp(
        `^/api/admin/orders/(\\d+)/${escapedSuffix}$`,
      ),
    );

  return match
    ? Number(match[1])
    : 0;
}

function text(
  value,
  max = 3000,
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

function normalizeWorkflowStatus(
  value,
) {
  return Object.prototype
    .hasOwnProperty
    .call(
      WORKFLOW_STATUSES,
      value,
    )
    ? value
    : '';
}

function normalizePaymentStatus(
  value,
) {
  return Object.prototype
    .hasOwnProperty
    .call(
      PAYMENT_STATUSES,
      value,
    )
    ? value
    : '';
}

function workflowLabel(
  value,
) {
  return WORKFLOW_STATUSES[value]
    || value
    || 'Novo';
}

function paymentLabel(
  value,
) {
  return PAYMENT_STATUSES[value]
    || 'Pagamento pendente';
}

function saoPauloDateKey(
  date = new Date(),
) {
  const parts =
    new Intl.DateTimeFormat(
      'en-US',
      {
        timeZone:
          'America/Sao_Paulo',

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

  return (
    `${map.year}-`
    + `${map.month}-`
    + `${map.day}`
  );
}

function addDaysToDateKey(
  dateKey,
  days,
) {
  const [
    year,
    month,
    day,
  ] =
    String(dateKey)
      .split('-')
      .map(Number);

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day + days,
      ),
    );

  return [
    date
      .getUTCFullYear(),

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

function safeLike(
  value,
) {
  return `%${text(
    value,
    120,
  )}%`;
}

async function readOrder(
  db,
  id,
) {
  return db.prepare(`
    SELECT *
    FROM orders
    WHERE id = ?
    LIMIT 1
  `)
    .bind(id)
    .first();
}

function orderSummary(
  row,
) {
  return {
    id:
      row.id,

    orderCode:
      row.order_code,

    childName:
      row.display_name
      || row.honoree_name,

    honoreeName:
      row.honoree_name,

    customerName:
      row.customer_name,

    whatsapp:
      row.whatsapp,

    eventDate:
      row.event_date,

    eventTime:
      row.event_time,

    theme:
      row.theme,

    format:
      row.format,

    scenes:
      Number(
        row.scene_count
        || 0,
      ),

    sceneCount:
      Number(
        row.scene_count
        || 0,
      ),

    workflowStatus:
      row.status
      || 'new',

    workflowLabel:
      workflowLabel(
        row.status
        || 'new',
      ),

    paymentStatus:
      row.payment_status
      || 'pending',

    paymentLabel:
      paymentLabel(
        row.payment_status
        || 'pending',
      ),

    cancelReason:
      row.cancel_reason
      || '',

    cancelledAt:
      row.cancelled_at
      || null,

    totalCents:
      Number(
        row.total_cents
        || 0,
      ),

    updatedAt:
      row.updated_at,
  };
}

/* ==================================================
   DASHBOARD
================================================== */

async function dashboard(
  db,
) {
  const today =
    saoPauloDateKey();

  const nextDay =
    addDaysToDateKey(
      today,
      1,
    );

  const [
    todayRow,
    upcomingRow,
    paymentRow,
    newRow,
  ] =
    await Promise.all([
      db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(
            CASE
              WHEN status != 'finished'
              AND status != 'cancelled'
              THEN 1
              ELSE 0
            END
          ) AS attention
        FROM orders
        WHERE event_date = ?
          AND status != 'cancelled'
      `)
        .bind(
          today,
        )
        .first(),

      db.prepare(`
        SELECT
          COUNT(*) AS total
        FROM orders
        WHERE event_date >= ?
          AND status != 'cancelled'
      `)
        .bind(
          nextDay,
        )
        .first(),

      db.prepare(`
        SELECT
          COUNT(*) AS total
        FROM orders
        WHERE COALESCE(
          payment_status,
          'pending'
        ) = 'pending'
          AND status != 'cancelled'
      `)
        .first(),

      db.prepare(`
        SELECT
          COUNT(*) AS total
        FROM orders
        WHERE status IN (
          'new',
          'ready'
        )
      `)
        .first(),
    ]);

  return {
    today,

    partiesToday:
      Number(
        todayRow
          ?.total
        || 0,
      ),

    partiesTodayAttention:
      Number(
        todayRow
          ?.attention
        || 0,
      ),

    upcomingParties:
      Number(
        upcomingRow
          ?.total
        || 0,
      ),

    pendingPayments:
      Number(
        paymentRow
          ?.total
        || 0,
      ),

    newOrders:
      Number(
        newRow
          ?.total
        || 0,
      ),
  };
}

/* ==================================================
   LISTA V2
================================================== */

async function listOrders(
  db,
  url,
) {
  const today =
    saoPauloDateKey();

  const endOfWeek =
    addDaysToDateKey(
      today,
      6,
    );

  const filter =
    text(
      url.searchParams
        .get('filter'),
      40,
    );

  const query =
    text(
      url.searchParams
        .get('q'),
      120,
    );

  const clauses = [];
  const bindings = [];

  /*
   * Cancelado fica fora da fila principal.
   */
  if (
    filter === 'cancelled'
  ) {
    clauses.push(
      `status = 'cancelled'`,
    );
  } else {
    clauses.push(
      `status != 'cancelled'`,
    );
  }

  if (
    filter === 'new'
  ) {
    clauses.push(
      `status IN (
        'new',
        'ready'
      )`,
    );
  }

  if (
    filter === 'today'
  ) {
    clauses.push(
      'event_date = ?',
    );

    bindings.push(
      today,
    );
  }

  if (
    filter === 'week'
  ) {
    clauses.push(
      'event_date BETWEEN ? AND ?',
    );

    bindings.push(
      today,
      endOfWeek,
    );
  }

  if (
    filter === 'producing'
  ) {
    clauses.push(
      `status = 'producing'`,
    );
  }

  if (
    filter === 'revisions'
  ) {
    clauses.push(
      `status = 'revisions'`,
    );
  }

  if (
    filter === 'payment_pending'
  ) {
    clauses.push(
      `COALESCE(
        payment_status,
        'pending'
      ) = 'pending'`,
    );
  }

  if (
    filter === 'finished'
  ) {
    clauses.push(
      `status = 'finished'`,
    );
  }

  if (
    query
  ) {
    clauses.push(`
      (
        order_code LIKE ?
        OR customer_name LIKE ?
        OR whatsapp LIKE ?
        OR honoree_name LIKE ?
        OR display_name LIKE ?
        OR theme LIKE ?
      )
    `);

    const like =
      safeLike(
        query,
      );

    bindings.push(
      like,
      like,
      like,
      like,
      like,
      like,
    );
  }

  const where =
    clauses.length
      ? `WHERE ${clauses.join(' AND ')}`
      : '';

  const orderBy =
    filter === 'new'
      ? 'created_at DESC'
      : `
        CASE
          WHEN status IN (
            'producing',
            'revisions'
          )
          THEN COALESCE(
            event_date,
            '9999-12-31'
          )
          ELSE '9999-12-31'
        END ASC,
        CASE
          WHEN event_date = ?
          THEN 0
          ELSE 1
        END ASC,
        created_at DESC
      `;

  const rows =
    await db.prepare(`
      SELECT
        id,
        order_code,
        customer_name,
        whatsapp,
        honoree_name,
        display_name,
        event_date,
        event_time,
        theme,
        format,
        scene_count,
        status,
        payment_status,
        cancel_reason,
        cancelled_at,
        total_cents,
        updated_at
      FROM orders
      ${where}
      ORDER BY
        ${orderBy}
      LIMIT 500
    `)
      .bind(
        ...bindings,
        ...(
          filter === 'new'
            ? []
            : [today]
        ),
      )
      .all();

  return {
    filter,
    query,
    today,

    orders:
      (
        rows
          ?.results
        || []
      ).map(
        orderSummary,
      ),
  };
}

/* ==================================================
   ALTERAR WORKFLOW
================================================== */

async function changeWorkflow(
  request,
  env,
  url,
) {
  const id =
    parseOrderId(
      url.pathname,
      'workflow',
    );

  if (!id) {
    return null;
  }

  if (
    request.method
      .toUpperCase()
    !== 'PATCH'
  ) {
    return fail(
      'Método não permitido.',
      405,
    );
  }

  const current =
    await readOrder(
      env.DB,
      id,
    );

  if (!current) {
    return fail(
      'Pedido não encontrado.',
      404,
    );
  }

  if (
    current.status
    === 'cancelled'
  ) {
    return fail(
      'Pedido cancelado não pode voltar para a fila ativa.',
      409,
      {
        code:
          'cancelled_is_terminal',
      },
    );
  }

  const body =
    await readJson(
      request,
    );

  const status =
    normalizeWorkflowStatus(
      body.status,
    );

  if (!status) {
    return fail(
      'Status inválido.',
      422,
      {
        allowed:
          Object.keys(
            WORKFLOW_STATUSES,
          ),
      },
    );
  }

  if (
    status === 'cancelled'
  ) {
    return fail(
      'Use a ação de cancelamento para cancelar um pedido.',
      422,
      {
        code:
          'use_cancel_route',
      },
    );
  }

  const stamp =
    nowIso();

  await env.DB.prepare(`
    UPDATE orders
    SET
      status = ?,
      updated_at = ?
    WHERE id = ?
  `)
    .bind(
      status,
      stamp,
      id,
    )
    .run();

  await addHistory(
    env.DB,
    id,
    'workflow_status_changed',
    `Status alterado para ${workflowLabel(status)}.`,
    {
      from:
        current.status
        || 'new',

      to:
        status,
    },
  );

  return json({
    ok:
      true,

    order: {
      id,

      status,

      label:
        workflowLabel(
          status,
        ),
    },
  });
}

/* ==================================================
   ALTERAR PAGAMENTO
================================================== */

async function changePayment(
  request,
  env,
  url,
) {
  const id =
    parseOrderId(
      url.pathname,
      'payment',
    );

  if (!id) {
    return null;
  }

  if (
    request.method
      .toUpperCase()
    !== 'PATCH'
  ) {
    return fail(
      'Método não permitido.',
      405,
    );
  }

  const current =
    await readOrder(
      env.DB,
      id,
    );

  if (!current) {
    return fail(
      'Pedido não encontrado.',
      404,
    );
  }

  const body =
    await readJson(
      request,
    );

  const paymentStatus =
    normalizePaymentStatus(
      body.paymentStatus,
    );

  if (!paymentStatus) {
    return fail(
      'Status de pagamento inválido.',
      422,
      {
        allowed:
          Object.keys(
            PAYMENT_STATUSES,
          ),
      },
    );
  }

  const stamp =
    nowIso();

  await env.DB.prepare(`
    UPDATE orders
    SET
      payment_status = ?,
      updated_at = ?
    WHERE id = ?
  `)
    .bind(
      paymentStatus,
      stamp,
      id,
    )
    .run();

  await addHistory(
    env.DB,
    id,
    'payment_status_changed',
    `Pagamento alterado para ${paymentLabel(paymentStatus)}.`,
    {
      from:
        current.payment_status
        || 'pending',

      to:
        paymentStatus,
    },
  );

  return json({
    ok:
      true,

    order: {
      id,

      paymentStatus,

      label:
        paymentLabel(
          paymentStatus,
        ),
    },
  });
}

/* ==================================================
   CANCELAR
================================================== */

async function cancelOrder(
  request,
  env,
  url,
) {
  const id =
    parseOrderId(
      url.pathname,
      'cancel',
    );

  if (!id) {
    return null;
  }

  if (
    request.method
      .toUpperCase()
    !== 'PATCH'
  ) {
    return fail(
      'Método não permitido.',
      405,
    );
  }

  const current =
    await readOrder(
      env.DB,
      id,
    );

  if (!current) {
    return fail(
      'Pedido não encontrado.',
      404,
    );
  }

  if (
    current.status
    === 'cancelled'
  ) {
    return json({
      ok:
        true,

      alreadyCancelled:
        true,

      order: {
        id,

        status:
          'cancelled',

        cancelReason:
          current.cancel_reason
          || '',

        cancelledAt:
          current.cancelled_at
          || null,
      },
    });
  }

  const body =
    await readJson(
      request,
    );

  const cancelReason =
    text(
      body.cancelReason,
      500,
    );

  if (
    !CANCEL_REASONS.has(
      cancelReason,
    )
  ) {
    return fail(
      'Informe o motivo do cancelamento.',
      422,
      {
        allowed: [
          'Não realizou pagamento',
          'Cliente desistiu',
          'Outro',
        ],
      },
    );
  }

  const note =
    cancelReason === 'Outro'
      ? text(
        body.cancelNote,
        1000,
      )
      : '';

  if (
    cancelReason === 'Outro'
    && !note
  ) {
    return fail(
      'Descreva o motivo do cancelamento.',
      422,
    );
  }

  const finalReason =
    note
      ? `Outro: ${note}`
      : cancelReason;

  const stamp =
    nowIso();

  await env.DB.prepare(`
    UPDATE orders
    SET
      status = 'cancelled',
      cancel_reason = ?,
      cancelled_at = ?,
      updated_at = ?
    WHERE id = ?
  `)
    .bind(
      finalReason,
      stamp,
      stamp,
      id,
    )
    .run();

  await addHistory(
    env.DB,
    id,
    'order_cancelled',
    `Pedido cancelado: ${finalReason}.`,
    {
      previousStatus:
        current.status
        || 'new',

      reason:
        finalReason,
    },
  );

  return json({
    ok:
      true,

    order: {
      id,

      status:
        'cancelled',

      label:
        'Cancelado',

      cancelReason:
        finalReason,

      cancelledAt:
        stamp,
    },
  });
}

/* ==================================================
   HANDLER PRINCIPAL
================================================== */

export async function handleAdminWorkflowV2Api(
  request,
  env,
  url,
) {
  const method =
    request.method
      .toUpperCase();

  if (
    method === 'GET'
    && url.pathname
      === '/api/admin/dashboard-v2'
  ) {
    return json({
      ok:
        true,

      dashboard:
        await dashboard(
          env.DB,
        ),
    });
  }

  if (
    method === 'GET'
    && url.pathname
      === '/api/admin/orders-v2'
  ) {
    return json({
      ok:
        true,

      ...await listOrders(
        env.DB,
        url,
      ),
    });
  }

  const workflowResponse =
    await changeWorkflow(
      request,
      env,
      url,
    );

  if (
    workflowResponse
  ) {
    return workflowResponse;
  }

  const paymentResponse =
    await changePayment(
      request,
      env,
      url,
    );

  if (
    paymentResponse
  ) {
    return paymentResponse;
  }

  const cancelResponse =
    await cancelOrder(
      request,
      env,
      url,
    );

  if (
    cancelResponse
  ) {
    return cancelResponse;
  }

  return null;
}
