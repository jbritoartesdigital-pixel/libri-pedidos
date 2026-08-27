import {
  fail,
  json,
  nowIso,
  parseJson,
  readJson,
} from '../lib/http.js';

import {
  addBusinessDays,
  addHistory,
  getOrderDetail,
  nextActionFor,
} from '../lib/orders.js';

import {
  catalogFromSettings,
  loadSettings,
  saveSettings,
} from '../lib/settings.js';

/* ==================================================
   HELPERS
================================================== */

function legacyCommercialIssue(
  row,
) {
  if (!row) {
    return false;
  }

  const addons =
    row.addons
    || parseJson(
      row.addons_json,
      {},
    );

  return (
    row.format === 'video'
    && addons
      ?.confirmation === true
  );
}

function adminOrderSummary(
  row,
) {
  const addons =
    row.addons
    || parseJson(
      row.addons_json,
      {},
    );

  const pricing =
    row.pricing
    || parseJson(
      row.pricing_json,
      {},
    );

  const briefing =
    row.briefing
    || parseJson(
      row.briefing_json,
      {},
    );

  return {
    id:
      row.id,

    orderCode:
      row.order_code,

    customerName:
      row.customer_name,

    whatsapp:
      row.whatsapp,

    honoreeName:
      row.honoree_name,

    displayName:
      row.display_name,

    age:
      row.age,

    eventDate:
      row.event_date,

    eventTime:
      row.event_time,

    theme:
      row.theme,

    experience:
      row.experience,

    format:
      row.format,

    status:
      row.status,

    photosStatus:
      row.photos_status,

    entryStatus:
      row.entry_status,

    balanceStatus:
      row.balance_status,

    urgencyEnabled:
      Boolean(
        row.urgency_enabled,
      ),

    productionStartedAt:
      row.production_started_at,

    productionDeadlineAt:
      row.deadline_override_at
      || row.production_deadline_at,

    subtotalCents:
      Number(
        row.subtotal_cents
        || 0,
      ),

    totalCents:
      Number(
        row.total_cents
        || 0,
      ),

    addons,

    photoAlbumPlan:
      addons
        ?.photoAlbumPlan
      || '',

    photoAlbumExtra100:
      Number(
        addons
          ?.photoAlbumExtra100
        || 0,
      ),

    photoAlbum:
      pricing
        ?.photoAlbum
      || null,

    giftPage:
      briefing
        ?.giftPage
      || 'unsure',

    giftDetails:
      briefing
        ?.giftDetails
      || '',

    updatedAt:
      row.updated_at,

    legacyCommercialIssue:
      legacyCommercialIssue(
        row,
      ),

    nextAction:
      nextActionFor(
        row,
      ),
  };
}

function descriptionForStatus(
  field,
  value,
) {
  const labels = {
    photos_status: {
      waiting:
        'Fotos aguardando',

      received:
        'Fotos recebidas',

      approved:
        'Fotos aprovadas',

      needs_new:
        'Novas fotos solicitadas',
    },

    entry_status: {
      waiting:
        'Entrada aguardando',

      confirmed:
        'Entrada confirmada',
    },

    balance_status: {
      waiting:
        'Saldo aguardando',

      confirmed:
        'Saldo confirmado',
    },

    mascot_status: {
      waiting:
        'Mascote aguardando',

      sent:
        'Mascote enviado',

      approved:
        'Mascote aprovado',
    },

    speech_status: {
      not_required:
        'Falas sem aprovação necessária',

      waiting:
        'Falas aguardando',

      sent:
        'Falas enviadas',

      approved:
        'Falas aprovadas',
    },

    invitation_status: {
      waiting:
        'Convite aguardando',

      producing:
        'Convite em produção',

      sent:
        'Convite enviado',

      approved:
        'Convite aprovado',
    },

    status: {
      new:
        'Pedido novo',

      ready:
        'Pronto para produção',

      producing:
        'Em produção',

      waiting_client:
        'Aguardando cliente',

      revisions:
        'Em ajustes',

      waiting_balance:
        'Aguardando saldo',

      finished:
        'Finalizado',

      cancelled:
        'Cancelado',
    },
  };

  return (
    labels[field]?.[value]
    || `${field} alterado para ${value}`
  );
}

async function readOrder(
  db,
  id,
) {
  return db
    .prepare(
      `
        SELECT *
        FROM orders
        WHERE id = ?
      `,
    )
    .bind(id)
    .first();
}

function updatePricingForUrgency(
  existing,
  urgencyEnabled,
  urgencyPercent,
) {
  /*
   * HARD LOCK FINANCEIRO
   *
   * A urgência incide sobre
   * o subtotal JÁ CONTRATADO.
   *
   * Nunca recalculamos o produto
   * usando a tabela de preços atual.
   */

  const subtotalCents =
    Math.max(
      0,
      Number(
        existing.subtotal_cents
        || 0,
      ),
    );

  const depositPercent =
    Math.max(
      0,
      Number(
        existing.deposit_percent
        || 0,
      ),
    );

  const appliedPercent =
    urgencyEnabled
      ? urgencyPercent
      : 0;

  const urgencyAmountCents =
    urgencyEnabled
      ? Math.round(
        subtotalCents
        * appliedPercent
        / 100,
      )
      : 0;

  const totalCents =
    subtotalCents
    + urgencyAmountCents;

  const depositCents =
    Math.round(
      totalCents
      * depositPercent
      / 100,
    );

  const balanceCents =
    totalCents
    - depositCents;

  const previousPricing =
    parseJson(
      existing.pricing_json,
      {},
    );

  const pricing = {
    ...previousPricing,

    experience:
      existing.experience,

    format:
      existing.format,

    addons:
      parseJson(
        existing.addons_json,
        {},
      ),

    subtotalCents,

    urgencyEnabled,

    urgencyPercent:
      appliedPercent,

    urgencyAmountCents,

    totalCents,

    depositPercent,

    depositCents,

    balanceCents,
  };

  return {
    subtotalCents,

    urgencyEnabled,

    urgencyPercent:
      appliedPercent,

    urgencyAmountCents,

    totalCents,

    depositPercent,

    depositCents,

    balanceCents,

    pricing,
  };
}

/* ==================================================
   API ADMIN
================================================== */

export async function handleAdminApi(
  request,
  env,
  url,
) {
  const method =
    request.method
      .toUpperCase();

  const path =
    url.pathname;

  /* ==================================================
     LISTA DE PEDIDOS
  ================================================== */

  if (
    method === 'GET'
    && path === '/api/admin/orders'
  ) {
    const status =
      url.searchParams
        .get('status')
      || '';

    const search =
      (
        url.searchParams
          .get('search')
        || ''
      ).trim();

    const params = [];
    const where = [];

    if (status) {
      where.push(
        'status = ?',
      );

      params.push(
        status,
      );
    }

    if (search) {
      where.push(
        `
          (
            order_code LIKE ?
            OR customer_name LIKE ?
            OR honoree_name LIKE ?
            OR theme LIKE ?
          )
        `,
      );

      const q =
        `%${search}%`;

      params.push(
        q,
        q,
        q,
        q,
      );
    }

    /*
     * ORDEM:
     *
     * 1. festas de hoje/futuras
     * 2. pedidos sem data
     * 3. festas passadas
     *
     * Dentro do futuro:
     * mais próxima primeiro.
     *
     * Dentro do passado:
     * mais recente primeiro.
     */
    const sql = `
      SELECT *
      FROM orders

      ${
        where.length
          ? `WHERE ${where.join(' AND ')}`
          : ''
      }

      ORDER BY
        CASE
          WHEN event_date IS NULL
            OR event_date = ''
          THEN 1

          WHEN event_date < date('now')
          THEN 2

          ELSE 0
        END ASC,

        CASE
          WHEN event_date >= date('now')
          THEN event_date
        END ASC,

        CASE
          WHEN event_date < date('now')
          THEN event_date
        END DESC,

        created_at DESC

      LIMIT 500
    `;

    const result =
      await env.DB
        .prepare(sql)
        .bind(
          ...params,
        )
        .all();

    return json({
      ok: true,

      orders:
        (
          result.results
          || []
        ).map(
          adminOrderSummary,
        ),
    });
  }

  /* ==================================================
     DETALHE
  ================================================== */

  const orderMatch =
    path.match(
      /^\/api\/admin\/orders\/(\d+)$/,
    );

  if (
    orderMatch
    && method === 'GET'
  ) {
    const detail =
      await getOrderDetail(
        env.DB,
        Number(
          orderMatch[1],
        ),
      );

    if (!detail) {
      return fail(
        'Pedido não encontrado.',
        404,
      );
    }

    return json({
      ok: true,

      order: {
        ...detail,

        legacyCommercialIssue:
          legacyCommercialIssue(
            detail,
          ),

        nextAction:
          nextActionFor(
            detail,
          ),
      },
    });
  }

  /* ==================================================
     EXCLUIR
  ================================================== */

  if (
    orderMatch
    && method === 'DELETE'
  ) {
    const id =
      Number(
        orderMatch[1],
      );

    const order =
      await env.DB
        .prepare(
          `
            SELECT
              id,
              order_code,
              honoree_name
            FROM orders
            WHERE id = ?
          `,
        )
        .bind(id)
        .first();

    if (!order) {
      return fail(
        'Pedido não encontrado.',
        404,
      );
    }

    await env.DB.batch([
      env.DB
        .prepare(
          `
            DELETE FROM internal_notes
            WHERE order_id = ?
          `,
        )
        .bind(id),

      env.DB
        .prepare(
          `
            DELETE FROM order_history
            WHERE order_id = ?
          `,
        )
        .bind(id),

      env.DB
        .prepare(
          `
            DELETE FROM orders
            WHERE id = ?
          `,
        )
        .bind(id),
    ]);

    return json({
      ok: true,

      deleted: {
        id,

        orderCode:
          order.order_code,

        honoreeName:
          order.honoree_name,
      },
    });
  }

  /* ==================================================
     ALTERAR PEDIDO
  ================================================== */

  if (
    orderMatch
    && method === 'PATCH'
  ) {
    const id =
      Number(
        orderMatch[1],
      );

    const existing =
      await readOrder(
        env.DB,
        id,
      );

    if (!existing) {
      return fail(
        'Pedido não encontrado.',
        404,
      );
    }

    const body =
      await readJson(
        request,
      );

    const allowed =
      new Set([
        'status',
        'photos_status',
        'photos_note',
        'entry_status',
        'balance_status',
        'mascot_status',
        'speech_status',
        'invitation_status',
        'deadline_override_at',
      ]);

    const changes = [];
    const values = [];

    for (
      const [key, value]
      of Object.entries(
        body || {},
      )
    ) {
      if (
        !allowed.has(key)
      ) {
        continue;
      }

      changes.push(
        `${key} = ?`,
      );

      values.push(
        value === ''
          ? null
          : value,
      );
    }

    let urgencyChanged =
      false;

    let urgencyPricing =
      null;

    if (
      typeof body
        .urgency_enabled
        === 'boolean'

      && Number(
        existing
          .urgency_enabled,
      )
        !== Number(
          body
            .urgency_enabled,
        )
    ) {
      const settings =
        catalogFromSettings(
          await loadSettings(
            env.DB,
          ),
        );

      const approvedUrgencyPercent =
        settings.rules
          .urgencyPercent;

      urgencyPricing =
        updatePricingForUrgency(
          existing,
          body.urgency_enabled,
          approvedUrgencyPercent,
        );

      changes.push(
        'urgency_enabled = ?',
        'urgency_percent = ?',
        'urgency_amount_cents = ?',
        'subtotal_cents = ?',
        'total_cents = ?',
        'deposit_percent = ?',
        'deposit_cents = ?',
        'balance_cents = ?',
        'pricing_json = ?',
      );

      values.push(
        body.urgency_enabled
          ? 1
          : 0,

        urgencyPricing
          .urgencyPercent,

        urgencyPricing
          .urgencyAmountCents,

        urgencyPricing
          .subtotalCents,

        urgencyPricing
          .totalCents,

        urgencyPricing
          .depositPercent,

        urgencyPricing
          .depositCents,

        urgencyPricing
          .balanceCents,

        JSON.stringify(
          urgencyPricing
            .pricing,
        ),
      );

      urgencyChanged =
        true;
    }

    if (
      !changes.length
    ) {
      return fail(
        'Nenhuma alteração válida recebida.',
        422,
      );
    }

    changes.push(
      'updated_at = ?',
    );

    values.push(
      nowIso(),
      id,
    );

    await env.DB
      .prepare(
        `
          UPDATE orders
          SET ${changes.join(', ')}
          WHERE id = ?
        `,
      )
      .bind(
        ...values,
      )
      .run();

    for (
      const [key, value]
      of Object.entries(
        body || {},
      )
    ) {
      if (
        allowed.has(key)
        && key
          !== 'photos_note'
      ) {
        await addHistory(
          env.DB,
          id,
          `update_${key}`,
          descriptionForStatus(
            key,
            value,
          ),
        );
      }
    }

    if (
      urgencyChanged
    ) {
      await addHistory(
        env.DB,
        id,
        'urgency_changed',

        body.urgency_enabled
          ? `Urgência aprovada (+${urgencyPricing.urgencyPercent}%)`
          : 'Urgência removida',

        {
          subtotalPreservado:
            urgencyPricing
              .subtotalCents,

          total:
            urgencyPricing
              .totalCents,
        },
      );
    }

    const detail =
      await getOrderDetail(
        env.DB,
        id,
      );

    return json({
      ok: true,

      order: {
        ...detail,

        legacyCommercialIssue:
          legacyCommercialIssue(
            detail,
          ),

        nextAction:
          nextActionFor(
            detail,
          ),
      },
    });
  }

  /* ==================================================
     OBSERVAÇÕES
  ================================================== */

  const noteMatch =
    path.match(
      /^\/api\/admin\/orders\/(\d+)\/notes$/,
    );

  if (
    noteMatch
    && method === 'POST'
  ) {
    const id =
      Number(
        noteMatch[1],
      );

    const body =
      await readJson(
        request,
      );

    const note =
      String(
        body.note
        || '',
      ).trim();

    if (!note) {
      return fail(
        'Escreva uma observação.',
        422,
      );
    }

    const order =
      await env.DB
        .prepare(
          `
            SELECT id
            FROM orders
            WHERE id = ?
          `,
        )
        .bind(id)
        .first();

    if (!order) {
      return fail(
        'Pedido não encontrado.',
        404,
      );
    }

    const stamp =
      nowIso();

    await env.DB
      .prepare(
        `
          INSERT INTO internal_notes(
            order_id,
            note,
            created_at
          )
          VALUES (?, ?, ?)
        `,
      )
      .bind(
        id,
        note,
        stamp,
      )
      .run();

    await addHistory(
      env.DB,
      id,
      'internal_note',
      'Observação interna adicionada',
    );

    return json(
      {
        ok: true,
      },
      201,
    );
  }

  /* ==================================================
     INICIAR PRODUÇÃO
  ================================================== */

  const startMatch =
    path.match(
      /^\/api\/admin\/orders\/(\d+)\/start-production$/,
    );

  if (
    startMatch
    && method === 'POST'
  ) {
    const id =
      Number(
        startMatch[1],
      );

    const order =
      await readOrder(
        env.DB,
        id,
      );

    if (!order) {
      return fail(
        'Pedido não encontrado.',
        404,
      );
    }

    if (
      order.status
        === 'cancelled'
      || order.status
        === 'finished'
    ) {
      return fail(
        'Este pedido já está encerrado.',
        409,
      );
    }

    /*
     * Evita um segundo clique
     * resetar o prazo.
     */
    if (
      order
        .production_started_at
    ) {
      return fail(
        'A produção deste pedido já foi iniciada.',
        409,
      );
    }

    const blockers = [];

    if (
      order.photos_status
      !== 'approved'
    ) {
      blockers.push(
        'Fotos ainda não estão aprovadas',
      );
    }

    if (
      order.entry_status
      !== 'confirmed'
    ) {
      blockers.push(
        'Entrada ainda não está confirmada',
      );
    }

    if (
      !order
        .terms_accepted_at
    ) {
      blockers.push(
        'Termos não registrados',
      );
    }

    if (
      blockers.length
    ) {
      return fail(
        'Ainda não é possível iniciar a produção.',
        409,
        {
          blockers,
        },
      );
    }

    const settings =
      catalogFromSettings(
        await loadSettings(
          env.DB,
        ),
      );

    const start =
      nowIso();

    const deadline =
      addBusinessDays(
        start,
        settings
          .rules
          .deadlineBusinessDays,
      );

    await env.DB
      .prepare(
        `
          UPDATE orders
          SET
            status = 'producing',

            invitation_status =
              CASE
                WHEN invitation_status = 'waiting'
                THEN 'producing'
                ELSE invitation_status
              END,

            production_started_at = ?,
            production_deadline_at = ?,
            production_paused_at = NULL,
            updated_at = ?

          WHERE id = ?
        `,
      )
      .bind(
        start,
        deadline,
        start,
        id,
      )
      .run();

    await addHistory(
      env.DB,
      id,
      'production_started',
      'Produção iniciada',
    );

    return json({
      ok: true,

      productionStartedAt:
        start,

      productionDeadlineAt:
        deadline,
    });
  }

  /* ==================================================
     PAUSAR PRODUÇÃO
  ================================================== */

  const pauseMatch =
    path.match(
      /^\/api\/admin\/orders\/(\d+)\/pause$/,
    );

  if (
    pauseMatch
    && method === 'POST'
  ) {
    const id =
      Number(
        pauseMatch[1],
      );

    const order =
      await readOrder(
        env.DB,
        id,
      );

    if (!order) {
      return fail(
        'Pedido não encontrado.',
        404,
      );
    }

    if (
      !order
        .production_started_at
    ) {
      return fail(
        'A produção ainda não começou.',
        409,
      );
    }

    if (
      order
        .production_paused_at
    ) {
      return fail(
        'O prazo já está pausado.',
        409,
      );
    }

    if (
      order.status
        === 'cancelled'
      || order.status
        === 'finished'
    ) {
      return fail(
        'Este pedido já está encerrado.',
        409,
      );
    }

    const body =
      await readJson(
        request,
      ).catch(
        () => ({}),
      );

    const stamp =
      nowIso();

    await env.DB
      .prepare(
        `
          UPDATE orders
          SET
            status = 'waiting_client',
            production_paused_at = ?,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        stamp,
        stamp,
        id,
      )
      .run();

    await addHistory(
      env.DB,
      id,
      'production_paused',

      body.reason
        ? `Produção pausada: ${body.reason}`
        : 'Produção pausada aguardando cliente',
    );

    return json({
      ok: true,
    });
  }

  /* ==================================================
     RETOMAR PRODUÇÃO
  ================================================== */

  const resumeMatch =
    path.match(
      /^\/api\/admin\/orders\/(\d+)\/resume$/,
    );

  if (
    resumeMatch
    && method === 'POST'
  ) {
    const id =
      Number(
        resumeMatch[1],
      );

    const order =
      await readOrder(
        env.DB,
        id,
      );

    if (!order) {
      return fail(
        'Pedido não encontrado.',
        404,
      );
    }

    if (
      !order
        .production_paused_at
    ) {
      return fail(
        'O prazo não está pausado.',
        409,
      );
    }

    if (
      order.status
        === 'cancelled'
      || order.status
        === 'finished'
    ) {
      return fail(
        'Este pedido já está encerrado.',
        409,
      );
    }

    const now =
      new Date();

    const pausedAt =
      new Date(
        order
          .production_paused_at,
      );

    const seconds =
      Math.max(
        0,

        Math.round(
          (
            now.getTime()
            - pausedAt.getTime()
          )
          / 1000,
        ),
      );

    const hasManualDeadline =
      Boolean(
        order
          .deadline_override_at,
      );

    const currentDeadline =
      hasManualDeadline
        ? order.deadline_override_at
        : order.production_deadline_at;

    const shifted =
      currentDeadline
        ? new Date(
          new Date(
            currentDeadline,
          ).getTime()
          + (
            seconds
            * 1000
          ),
        ).toISOString()

        : null;

    const stamp =
      now.toISOString();

    if (
      hasManualDeadline
    ) {
      await env.DB
        .prepare(
          `
            UPDATE orders
            SET
              status = 'producing',
              production_paused_at = NULL,

              paused_total_seconds =
                paused_total_seconds + ?,

              deadline_override_at = ?,
              updated_at = ?

            WHERE id = ?
          `,
        )
        .bind(
          seconds,
          shifted,
          stamp,
          id,
        )
        .run();
    } else {
      await env.DB
        .prepare(
          `
            UPDATE orders
            SET
              status = 'producing',
              production_paused_at = NULL,

              paused_total_seconds =
                paused_total_seconds + ?,

              production_deadline_at = ?,
              updated_at = ?

            WHERE id = ?
          `,
        )
        .bind(
          seconds,
          shifted,
          stamp,
          id,
        )
        .run();
    }

    await addHistory(
      env.DB,
      id,
      'production_resumed',
      'Produção retomada',
    );

    return json({
      ok: true,

      productionDeadlineAt:
        shifted,
    });
  }

  /* ==================================================
     RODADA DE AJUSTE
  ================================================== */

  const revisionMatch =
    path.match(
      /^\/api\/admin\/orders\/(\d+)\/revision$/,
    );

  if (
    revisionMatch
    && method === 'POST'
  ) {
    const id =
      Number(
        revisionMatch[1],
      );

    const body =
      await readJson(
        request,
      );

    const stage =
      body.stage;

    const config = {
      mascot: {
        column:
          'mascot_revisions',

        max:
          2,

        label:
          'Mascote',
      },

      speech: {
        column:
          'speech_revisions',

        max:
          1,

        label:
          'Falas',
      },

      invitation: {
        column:
          'invitation_revisions',

        max:
          2,

        label:
          'Convite',
      },
    }[stage];

    if (!config) {
      return fail(
        'Etapa inválida.',
        422,
      );
    }

    const order =
      await env.DB
        .prepare(
          `
            SELECT
              ${config.column}
              AS current,

              status

            FROM orders
            WHERE id = ?
          `,
        )
        .bind(id)
        .first();

    if (!order) {
      return fail(
        'Pedido não encontrado.',
        404,
      );
    }

    if (
      order.status
        === 'cancelled'
      || order.status
        === 'finished'
    ) {
      return fail(
        'Este pedido já está encerrado.',
        409,
      );
    }

    const next =
      Number(
        order.current
        || 0,
      ) + 1;

    if (
      next > config.max
      && body.force
        !== true
    ) {
      return fail(
        `As ${config.max} rodadas incluídas para ${config.label.toLowerCase()} já foram utilizadas.`,
        409,
        {
          current:
            order.current,

          max:
            config.max,
        },
      );
    }

    await env.DB
      .prepare(
        `
          UPDATE orders
          SET
            ${config.column} = ?,
            status = 'revisions',
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        next,
        nowIso(),
        id,
      )
      .run();

    await addHistory(
      env.DB,
      id,
      'revision_registered',
      `${config.label}: rodada de ajuste ${next} registrada`,
      {
        stage,

        revision:
          next,
      },
    );

    return json({
      ok: true,

      revisions:
        next,

      includedMax:
        config.max,
    });
  }

  /* ==================================================
     APROVAÇÃO
  ================================================== */

  const approveMatch =
    path.match(
      /^\/api\/admin\/orders\/(\d+)\/approve$/,
    );

  if (
    approveMatch
    && method === 'POST'
  ) {
    const id =
      Number(
        approveMatch[1],
      );

    const body =
      await readJson(
        request,
      );

    const stage =
      body.stage;

    const config = {
      mascot: {
        column:
          'mascot_status',

        label:
          'Mascote aprovado',
      },

      speech: {
        column:
          'speech_status',

        label:
          'Falas aprovadas',
      },

      invitation: {
        column:
          'invitation_status',

        label:
          'Convite aprovado',
      },
    }[stage];

    if (!config) {
      return fail(
        'Etapa inválida.',
        422,
      );
    }

    const order =
      await env.DB
        .prepare(
          `
            SELECT
              id,
              status
            FROM orders
            WHERE id = ?
          `,
        )
        .bind(id)
        .first();

    if (!order) {
      return fail(
        'Pedido não encontrado.',
        404,
      );
    }

    if (
      order.status
        === 'cancelled'
      || order.status
        === 'finished'
    ) {
      return fail(
        'Este pedido já está encerrado.',
        409,
      );
    }

    const status =
      stage
        === 'invitation'
        ? 'waiting_balance'
        : 'producing';

    await env.DB
      .prepare(
        `
          UPDATE orders
          SET
            ${config.column} = 'approved',
            status = ?,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        status,
        nowIso(),
        id,
      )
      .run();

    await addHistory(
      env.DB,
      id,
      `${stage}_approved`,
      config.label,
    );

    return json({
      ok: true,
    });
  }

  /* ==================================================
     FINALIZAR PEDIDO
  ================================================== */

  const finishMatch =
    path.match(
      /^\/api\/admin\/orders\/(\d+)\/finish$/,
    );

  if (
    finishMatch
    && method === 'POST'
  ) {
    const id =
      Number(
        finishMatch[1],
      );

    const order =
      await readOrder(
        env.DB,
        id,
      );

    if (!order) {
      return fail(
        'Pedido não encontrado.',
        404,
      );
    }

    if (
      order.status
      === 'cancelled'
    ) {
      return fail(
        'Este pedido está cancelado.',
        409,
      );
    }

    if (
      order.status
      === 'finished'
    ) {
      return fail(
        'Este pedido já está finalizado.',
        409,
      );
    }

    if (
      order
        .invitation_status
      !== 'approved'
    ) {
      return fail(
        'O convite ainda não está aprovado.',
        409,
      );
    }

    if (
      order
        .balance_status
      !== 'confirmed'
    ) {
      return fail(
        'O saldo final ainda não está confirmado.',
        409,
      );
    }

    await env.DB
      .prepare(
        `
          UPDATE orders
          SET
            status = 'finished',
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        nowIso(),
        id,
      )
      .run();

    await addHistory(
      env.DB,
      id,
      'order_finished',
      'Pedido finalizado',
    );

    return json({
      ok: true,
    });
  }

  /* ==================================================
     CONFIGURAÇÕES
  ================================================== */

  if (
    method === 'GET'
    && path
      === '/api/admin/settings'
  ) {
    const settings =
      await loadSettings(
        env.DB,
      );

    return json({
      ok: true,

      settings,

      catalog:
        catalogFromSettings(
          settings,
        ),
    });
  }

  if (
    method === 'PUT'
    && path
      === '/api/admin/settings'
  ) {
    const body =
      await readJson(
        request,
      );

    try {
      await saveSettings(
        env.DB,
        body.settings
        || body,
      );
    } catch (error) {
      return fail(
        error?.message
        || 'Confira as configurações informadas.',
        422,
        {
          code:
            'invalid_settings',
        },
      );
    }

    const settings =
      await loadSettings(
        env.DB,
      );

    return json({
      ok: true,

      settings,

      catalog:
        catalogFromSettings(
          settings,
        ),
    });
  }

  /* ==================================================
     TERMOS
  ================================================== */

  if (
    method === 'GET'
    && path
      === '/api/admin/terms'
  ) {
    const result =
      await env.DB
        .prepare(
          `
            SELECT
              version,
              body,
              active,
              created_at
            FROM terms_versions
            ORDER BY created_at DESC
          `,
        )
        .all();

    return json({
      ok: true,

      terms:
        result.results
        || [],
    });
  }

  if (
    method === 'POST'
    && path
      === '/api/admin/terms'
  ) {
    const body =
      await readJson(
        request,
      );

    const version =
      String(
        body.version
        || '',
      ).trim();

    const termsBody =
      String(
        body.body
        || '',
      ).trim();

    if (
      !version
      || !termsBody
    ) {
      return fail(
        'Informe versão e texto dos termos.',
        422,
      );
    }

    const existingVersion =
      await env.DB
        .prepare(
          `
            SELECT version
            FROM terms_versions
            WHERE version = ?
            LIMIT 1
          `,
        )
        .bind(
          version,
        )
        .first();

    if (
      existingVersion
    ) {
      return fail(
        `A versão ${version} dos termos já existe.`,
        409,
      );
    }

    const stamp =
      nowIso();

    await env.DB.batch([
      env.DB
        .prepare(
          `
            UPDATE terms_versions
            SET active = 0
            WHERE active = 1
          `,
        ),

      env.DB
        .prepare(
          `
            INSERT INTO terms_versions(
              version,
              body,
              active,
              created_at
            )
            VALUES (?, ?, 1, ?)
          `,
        )
        .bind(
          version,
          termsBody,
          stamp,
        ),
    ]);

    return json(
      {
        ok: true,
      },
      201,
    );
  }

  return null;
}
