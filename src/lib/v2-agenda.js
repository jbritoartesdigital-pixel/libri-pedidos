import {
  nowIso,
} from './http.js';

const SAO_PAULO =
  'America/Sao_Paulo';

const DAY_MS =
  24
  * 60
  * 60
  * 1000;

function cleanText(
  value,
  maxLength = 1000,
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

function parseIsoDay(
  value,
) {
  if (
    !isIsoDay(
      value,
    )
  ) {
    throw new Error(
      'Data inválida.',
    );
  }

  const date =
    new Date(
      `${value}T12:00:00Z`,
    );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new Error(
      'Data inválida.',
    );
  }

  return date;
}

function formatIsoDay(
  date,
) {
  return date
    .toISOString()
    .slice(
      0,
      10,
    );
}

function addDays(
  day,
  amount,
) {
  const date =
    typeof day
    === 'string'
      ? parseIsoDay(
        day,
      )
      : day;

  return formatIsoDay(
    new Date(
      date.getTime()
      + amount
      * DAY_MS,
    ),
  );
}

function diffDays(
  start,
  end,
) {
  return Math.round(
    (
      parseIsoDay(
        end,
      )
        .getTime()
      - parseIsoDay(
        start,
      )
        .getTime()
    )
    / DAY_MS,
  );
}

function todayInSaoPaulo() {
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
        new Date(),
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

function listDays(
  start,
  end,
) {
  const total =
    diffDays(
      start,
      end,
    );

  if (
    total < 0
  ) {
    throw new Error(
      'Período inválido.',
    );
  }

  return Array.from(
    {
      length:
        total
        + 1,
    },
    (
      ,
      index,
    ) =>
      addDays(
        start,
        index,
      ),
  );
}

function integerInRange(
  value,
  {
    min,
    max,
    label,
  },
) {
  const parsed =
    Number.parseInt(
      value,
      10,
    );

  if (
    !Number.isInteger(
      parsed,
    )
    || parsed < min
    || parsed > max
  ) {
    throw new Error(
      `${label} inválido.`,
    );
  }

  return parsed;
}

async function settingInt(
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

async function defaultCapacities(
  db,
) {
  const [
    sellable,
    buffer,
  ] =
    await Promise.all([
      settingInt(
        db,
        'default_sellable_points_per_day_units',
        400,
      ),

      settingInt(
        db,
        'default_internal_buffer_points_per_day_units',
        100,
      ),
    ]);

  return {
    sellable,
    buffer,
  };
}

async function orderByCode(
  db,
  orderCode,
) {
  return db
    .prepare(
      `
        SELECT
          id,
          order_code,
          honoree_display_name,
          event_date,
          status,
          briefing_status,
          delivery_start,
          delivery_end,
          created_at,
          finalized_at
        FROM v2_orders
        WHERE order_code = ?
        LIMIT 1
      `,
    )
    .bind(
      orderCode,
    )
    .first();
}

async function hasApprovedPayment(
  db,
  orderId,
) {
  const row =
    await db
      .prepare(
        `
          SELECT 1 AS ok
          FROM v2_payments
          WHERE
            order_id = ?
            AND status = 'approved'
          LIMIT 1
        `,
      )
      .bind(
        orderId,
      )
      .first();

  return Boolean(
    row,
  );
}

async function futureAllocations(
  db,
  orderId,
  {
    afterDay = null,
    ascending = true,
  } = {},
) {
  const today =
    todayInSaoPaulo();

  const clauses = [
    'order_id = ?',
    'day >= ?',
  ];

  const binds = [
    orderId,
    today,
  ];

  if (
    afterDay
  ) {
    clauses.push(
      'day > ?',
    );

    binds.push(
      afterDay,
    );
  }

  const direction =
    ascending
      ? 'ASC'
      : 'DESC';

  const result =
    await db
      .prepare(
        `
          SELECT
            id,
            order_id,
            day,
            points_units,
            allocation_type
          FROM v2_agenda_allocations
          WHERE ${
            clauses.join(
              ' AND ',
            )
          }
          ORDER BY
            day ${direction},
            id ${direction}
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
          Number(
            row.id,
          ),

        orderId:
          Number(
            row.order_id,
          ),

        day:
          row.day,

        pointsUnits:
          Number(
            row.points_units
            || 0,
          ),

        allocationType:
          row.allocation_type,
      }),
    );
}

function totalUnits(
  rows,
) {
  return rows.reduce(
    (
      total,
      row,
    ) =>
      total
      + Number(
        row.pointsUnits
        || 0,
      ),
    0,
  );
}

function pairCascadeMoves(
  poolRows,
  targetRows,
  requestedUnits = null,
) {
  const pools =
    poolRows.map(
      (row) => ({
        ...row,

        remaining:
          row.pointsUnits,
      }),
    );

  const targets =
    targetRows.map(
      (row) => ({
        ...row,

        remaining:
          row.pointsUnits,
      }),
    );

  const maximum =
    Math.min(
      totalUnits(
        poolRows,
      ),

      totalUnits(
        targetRows,
      ),
    );

  const limit =
    requestedUnits === null
      ? maximum
      : Math.min(
        maximum,
        requestedUnits,
      );

  let moved = 0;

  const pairs = [];

  for (
    const pool
    of pools
  ) {
    if (
      moved >= limit
    ) {
      break;
    }

    for (
      const target
      of targets
  ) {
      if (
        moved >= limit
      ) {
        break;
      }

      if (
        pool.remaining <= 0
        || target.remaining <= 0
      ) {
        continue;
      }

      /*
       * Antecipar precisa realmente mover
       * produção de uma data posterior
       * para uma data anterior.
       */
      if (
        target.day
        <= pool.day
      ) {
        continue;
      }

      const units =
        Math.min(
          pool.remaining,
          target.remaining,
          limit - moved,
        );

      if (
        units <= 0
      ) {
        continue;
      }

      pairs.push({
        poolAllocationId:
          pool.id,

        poolDay:
          pool.day,

        targetAllocationId:
          target.id,

        targetDay:
          target.day,

        units,
      });

      pool.remaining -=
        units;

      target.remaining -=
        units;

      moved +=
        units;
    }
  }

  return {
    movedUnits:
      moved,

    pairs,
  };
}

function aggregateTaken(
  pairs,
  key,
) {
  const result =
    new Map();

  for (
    const pair
    of pairs
  ) {
    const id =
      pair[
        key
      ];

    result.set(
      id,
      (
        result.get(
          id,
        )
        || 0
      )
      + pair.units,
    );
  }

  return result;
}

function aggregateInsertions(
  pairs,
  key,
) {
  const result =
    new Map();

  for (
    const pair
    of pairs
  ) {
    const day =
      pair[
        key
      ];

    result.set(
      day,
      (
        result.get(
          day,
        )
        || 0
      )
      + pair.units,
    );
  }

  return result;
}

function mutationForAllocation(
  db,
  row,
  takenUnits,
) {
  const remaining =
    row.pointsUnits
    - takenUnits;

  if (
    remaining > 0
  ) {
    return db
      .prepare(
        `
          UPDATE v2_agenda_allocations
          SET points_units = ?
          WHERE id = ?
        `,
      )
      .bind(
        remaining,
        row.id,
      );
  }

  return db
    .prepare(
      `
        DELETE FROM v2_agenda_allocations
        WHERE id = ?
      `,
    )
    .bind(
      row.id,
    );
}

async function bestCandidateForPool(
  db,
  sourceOrderId,
  earliestPoolDay,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            o.id,
            o.order_code,
            o.honoree_display_name,
            o.event_date,
            o.delivery_start,
            o.delivery_end,
            o.created_at,

            MIN(a.day) AS earliest_allocation_day,
            MAX(a.day) AS latest_allocation_day,
            SUM(
              CASE
                WHEN a.day > ?
                  THEN a.points_units
                ELSE 0
              END
            ) AS movable_units
          FROM v2_orders o
          INNER JOIN v2_agenda_allocations a
            ON a.order_id = o.id
          WHERE
            o.id != ?
            AND o.status = 'ready_for_production'
            AND o.briefing_status = 'completed'
            AND EXISTS (
              SELECT 1
              FROM v2_payments pay
              WHERE
                pay.order_id = o.id
                AND pay.status = 'approved'
            )
          GROUP BY
            o.id,
            o.order_code,
            o.honoree_display_name,
            o.event_date,
            o.delivery_start,
            o.delivery_end,
            o.created_at
          HAVING movable_units > 0
          ORDER BY
            COALESCE(
              o.delivery_start,
              '9999-12-31'
            ),
            o.event_date,
            o.created_at,
            o.id
          LIMIT 1
        `,
      )
      .bind(
        earliestPoolDay,
        sourceOrderId,
      )
      .all();

  const row =
    result.results
      ?.[0];

  if (!row) {
    return null;
  }

  return {
    id:
      Number(
        row.id,
      ),

    code:
      row.order_code,

    honoreeName:
      row.honoree_display_name,

    eventDate:
      row.event_date,

    deliveryWindow: {
      start:
        row.delivery_start,

      end:
        row.delivery_end,
    },

    earliestAllocationDay:
      row.earliest_allocation_day,

    latestAllocationDay:
      row.latest_allocation_day,

    movableUnits:
      Number(
        row.movable_units
        || 0,
      ),
  };
}

export async function finalizeV2OrderToCascadePool(
  db,
  order,
) {
  const stamp =
    nowIso();

  const rows =
    await futureAllocations(
      db,
      order.id,
    );

  const reservedUnits =
    totalUnits(
      rows,
    );

  await db.batch([
    db
      .prepare(
        `
          UPDATE v2_orders
          SET
            status = 'finalized',
            next_action = 'Finalizado',
            finalized_at = ?,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        stamp,
        stamp,
        order.id,
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
            'order_finalized',
            'Pedido finalizado.',
            ?,
            ?
          )
        `,
      )
      .bind(
        order.id,
        JSON.stringify({
          cascadeReservedUnits:
            reservedUnits,

          capacityPublished:
            reservedUnits
            === 0,
        }),
        stamp,
      ),
  ]);

  if (
    reservedUnits > 0
  ) {
    await db
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
          VALUES (
            'CAPACITY_RELEASED',
            ?,
            'Capacidade para antecipar',
            ?,
            '/admin/agenda',
            'normal',
            0,
            ?
          )
        `,
      )
      .bind(
        order.id,
        `${
          order.order_code
        } terminou antes e deixou ${
          reservedUnits / 100
        } Points Libri para redistribuir antes de abrir a agenda.`,
        stamp,
      )
      .run();
  }

  /*
   * IMPORTANTE:
   * não deletamos as alocações futuras.
   * Enquanto pertencem a um pedido finalizado,
   * elas funcionam como reserva interna da cascata
   * e continuam invisíveis ao cliente como capacidade livre.
   */
  return {
    status:
      'finalized',

    nextAction:
      'Finalizado',

    cascadeReservedUnits:
      reservedUnits,

    needsCascadeReview:
      reservedUnits > 0,
  };
}

export async function getV2AgendaRange(
  db,
  {
    start,
    end,
  } = {},
) {
  const today =
    todayInSaoPaulo();

  const rangeStart =
    start
      || today;

  const rangeEnd =
    end
      || addDays(
        rangeStart,
        60,
      );

  if (
    !isIsoDay(
      rangeStart,
    )
    || !isIsoDay(
      rangeEnd,
    )
    || diffDays(
      rangeStart,
      rangeEnd,
    ) < 0
    || diffDays(
      rangeStart,
      rangeEnd,
    ) > 180
  ) {
    throw new Error(
      'Período da agenda inválido.',
    );
  }

  const [
    defaults,
    dayRows,
    allocations,
    holds,
    allocationOrders,
  ] =
    await Promise.all([
      defaultCapacities(
        db,
      ),

      db
        .prepare(
          `
            SELECT
              day,
              sellable_capacity_units,
              internal_buffer_units,
              blocked,
              internal_note
            FROM v2_agenda_days
            WHERE day BETWEEN ? AND ?
          `,
        )
        .bind(
          rangeStart,
          rangeEnd,
        )
        .all(),

      db
        .prepare(
          `
            SELECT
              a.day,

              SUM(
                CASE
                  WHEN o.status = 'finalized'
                    THEN a.points_units
                  ELSE 0
                END
              ) AS cascade_units,

              SUM(
                CASE
                  WHEN o.status != 'finalized'
                    THEN a.points_units
                  ELSE 0
                END
              ) AS production_units
            FROM v2_agenda_allocations a
            INNER JOIN v2_orders o
              ON o.id = a.order_id
            WHERE a.day BETWEEN ? AND ?
            GROUP BY a.day
          `,
        )
        .bind(
          rangeStart,
          rangeEnd,
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
          rangeStart,
          rangeEnd,
          nowIso(),
        )
        .all(),

      db
        .prepare(
          `
            SELECT
              a.day,
              a.points_units,

              o.order_code,
              o.honoree_display_name,
              o.status,
              o.delivery_start,
              o.delivery_end
            FROM v2_agenda_allocations a
            INNER JOIN v2_orders o
              ON o.id = a.order_id
            WHERE a.day BETWEEN ? AND ?
            ORDER BY
              a.day,
              o.status = 'finalized' DESC,
              o.delivery_start,
              o.order_code
          `,
        )
        .bind(
          rangeStart,
          rangeEnd,
        )
        .all(),
    ]);

  const configs =
    Object.fromEntries(
      (
        dayRows.results
        || []
      )
        .map(
          (row) => [
            row.day,
            row,
          ],
        ),
    );

  const unitsByDay =
    Object.fromEntries(
      (
        allocations.results
        || []
      )
        .map(
          (row) => [
            row.day,
            {
              production:
                Number(
                  row.production_units
                  || 0,
                ),

              cascade:
                Number(
                  row.cascade_units
                  || 0,
                ),
            },
          ],
        ),
    );

  const holdsByDay =
    Object.fromEntries(
      (
        holds.results
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

  const ordersByDay = {};

  for (
    const row
    of allocationOrders.results
    || []
  ) {
    if (
      !ordersByDay[
        row.day
      ]
    ) {
      ordersByDay[
        row.day
      ] = [];
    }

    ordersByDay[
      row.day
    ]
      .push({
        code:
          row.order_code,

        honoreeName:
          row.honoree_display_name,

        status:
          row.status,

        pointsUnits:
          Number(
            row.points_units
            || 0,
          ),

        cascadeReserve:
          row.status
          === 'finalized',

        deliveryWindow: {
          start:
            row.delivery_start,

          end:
            row.delivery_end,
        },
      });
  }

  const days =
    listDays(
      rangeStart,
      rangeEnd,
    )
      .map(
        (day) => {
          const config =
            configs[
              day
            ];

          const blocked =
            config
              ?.blocked
            === 1;

          const sellable =
            Number(
              config
                ?.sellable_capacity_units
              ?? defaults.sellable,
            );

          const buffer =
            Number(
              config
                ?.internal_buffer_units
              ?? defaults.buffer,
            );

          const production =
            unitsByDay[
              day
            ]?.production
            || 0;

          const cascade =
            unitsByDay[
              day
            ]?.cascade
            || 0;

          const held =
            holdsByDay[
              day
            ]
            || 0;

          const free =
            blocked
              ? 0
              : Math.max(
                0,
                sellable
                - production
                - cascade
                - held,
              );

          return {
            day,

            blocked,

            sellableCapacityUnits:
              sellable,

            internalBufferUnits:
              buffer,

            physicalCapacityUnits:
              sellable
              + buffer,

            productionUnits:
              production,

            cascadeReservedUnits:
              cascade,

            checkoutHeldUnits:
              held,

            publicFreeUnits:
              free,

            internalNote:
              config
                ?.internal_note
              || '',

            orders:
              ordersByDay[
                day
              ]
              || [],
          };
        },
      );

  return {
    start:
      rangeStart,

    end:
      rangeEnd,

    defaults: {
      sellableCapacityUnits:
        defaults.sellable,

      internalBufferUnits:
        defaults.buffer,
    },

    days,
  };
}

export async function setV2AgendaDay(
  db,
  day,
  body = {},
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

  const [
    defaults,
    existing,
  ] =
    await Promise.all([
      defaultCapacities(
        db,
      ),

      db
        .prepare(
          `
            SELECT
              sellable_capacity_units,
              internal_buffer_units,
              blocked,
              internal_note
            FROM v2_agenda_days
            WHERE day = ?
            LIMIT 1
          `,
        )
        .bind(
          day,
        )
        .first(),
    ]);

  const sellable =
    body.sellableCapacityUnits
    === undefined
      ? Number(
        existing
          ?.sellable_capacity_units
        ?? defaults.sellable,
      )
      : integerInRange(
        body.sellableCapacityUnits,
        {
          min:
            0,

          max:
            5000,

          label:
            'Capacidade vendável',
        },
      );

  const buffer =
    body.internalBufferUnits
    === undefined
      ? Number(
        existing
          ?.internal_buffer_units
        ?? defaults.buffer,
      )
      : integerInRange(
        body.internalBufferUnits,
        {
          min:
            0,

          max:
            5000,

          label:
            'Reserva interna',
        },
      );

  const blocked =
    body.blocked
    === undefined
      ? (
        existing
          ?.blocked
        === 1
      )
      : body.blocked
        === true;

  const note =
    body.internalNote
    === undefined
      ? String(
        existing
          ?.internal_note
        || '',
      )
      : cleanText(
        body.internalNote,
        1000,
      );

  await db
    .prepare(
      `
        INSERT INTO v2_agenda_days(
          day,
          sellable_capacity_units,
          internal_buffer_units,
          blocked,
          internal_note,
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
          ?
        )
        ON CONFLICT(day)
        DO UPDATE SET
          sellable_capacity_units =
            excluded.sellable_capacity_units,

          internal_buffer_units =
            excluded.internal_buffer_units,

          blocked =
            excluded.blocked,

          internal_note =
            excluded.internal_note,

          updated_at =
            excluded.updated_at
      `,
    )
    .bind(
      day,
      sellable,
      buffer,
      blocked
        ? 1
        : 0,
      note,
      nowIso(),
      nowIso(),
    )
    .run();

  return {
    day,

    sellableCapacityUnits:
      sellable,

    internalBufferUnits:
      buffer,

    blocked,

    internalNote:
      note,
  };
}

export async function setV2AgendaPeriod(
  db,
  {
    start,
    end,
    blocked,
    internalNote = '',
  },
) {
  if (
    !isIsoDay(
      start,
    )
    || !isIsoDay(
      end,
    )
  ) {
    throw new Error(
      'Período inválido.',
    );
  }

  const days =
    listDays(
      start,
      end,
    );

  if (
    days.length > 120
  ) {
    throw new Error(
      'Ajuste no máximo 120 dias por vez.',
    );
  }

  const defaults =
    await defaultCapacities(
      db,
    );

  const stamp =
    nowIso();

  const note =
    cleanText(
      internalNote,
      1000,
    );

  await db.batch(
    days.map(
      (day) =>
        db
          .prepare(
            `
              INSERT INTO v2_agenda_days(
                day,
                sellable_capacity_units,
                internal_buffer_units,
                blocked,
                internal_note,
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
                ?
              )
              ON CONFLICT(day)
              DO UPDATE SET
                blocked =
                  excluded.blocked,

                internal_note =
                  CASE
                    WHEN excluded.internal_note != ''
                      THEN excluded.internal_note
                    ELSE v2_agenda_days.internal_note
                  END,

                updated_at =
                  excluded.updated_at
            `,
          )
          .bind(
            day,
            defaults.sellable,
            defaults.buffer,
            blocked
              ? 1
              : 0,
            note,
            stamp,
            stamp,
          ),
    ),
  );

  return {
    start,
    end,
    blocked:
      Boolean(
        blocked,
      ),
    affectedDays:
      days.length,
  };
}

export async function getV2CascadeSuggestions(
  db,
) {
  const today =
    todayInSaoPaulo();

  const poolsResult =
    await db
      .prepare(
        `
          SELECT
            o.id,
            o.order_code,
            o.honoree_display_name,
            o.event_date,
            o.finalized_at,

            SUM(a.points_units) AS reserved_units,
            MIN(a.day) AS earliest_day,
            MAX(a.day) AS latest_day
          FROM v2_orders o
          INNER JOIN v2_agenda_allocations a
            ON a.order_id = o.id
          WHERE
            o.status = 'finalized'
            AND a.day >= ?
          GROUP BY
            o.id,
            o.order_code,
            o.honoree_display_name,
            o.event_date,
            o.finalized_at
          HAVING reserved_units > 0
          ORDER BY
            earliest_day,
            o.finalized_at,
            o.id
        `,
      )
      .bind(
        today,
      )
      .all();

  const pools = [];

  for (
    const row
    of poolsResult.results
    || []
  ) {
    const candidate =
      await bestCandidateForPool(
        db,
        row.id,
        row.earliest_day,
      );

    const reservedUnits =
      Number(
        row.reserved_units
        || 0,
      );

    pools.push({
      source: {
        id:
          Number(
            row.id,
          ),

        code:
          row.order_code,

        honoreeName:
          row.honoree_display_name,

        eventDate:
          row.event_date,

        finalizedAt:
          row.finalized_at,
      },

      reservedUnits,

      reservedPoints:
        reservedUnits
        / 100,

      earliestDay:
        row.earliest_day,

      latestDay:
        row.latest_day,

      suggestion:
        candidate
          ? {
            targetOrder:
              candidate,

            movableUnits:
              Math.min(
                reservedUnits,
                candidate.movableUnits,
              ),

            movablePoints:
              Math.min(
                reservedUnits,
                candidate.movableUnits,
              )
              / 100,

            promisedWindowChanges:
              false,

            priorityRule:
              'janela mais próxima → evento mais próximo → pedido mais antigo',
          }
          : null,

      finalSurplus:
        !candidate,
    });
  }

  return {
    pools,
  };
}

export async function anticipateV2Production(
  db,
  {
    sourceOrderCode,
    targetOrderCode,
    pointsUnits = null,
  },
) {
  const [
    source,
    target,
  ] =
    await Promise.all([
      orderByCode(
        db,
        sourceOrderCode,
      ),

      orderByCode(
        db,
        targetOrderCode,
      ),
    ]);

  if (
    !source
    || source.status
      !== 'finalized'
  ) {
    throw new Error(
      'A capacidade de origem não está disponível para cascata.',
    );
  }

  if (
    !target
    || target.status
      !== 'ready_for_production'
    || target.briefing_status
      !== 'completed'
  ) {
    throw new Error(
      'O pedido escolhido ainda não está pronto para antecipação.',
    );
  }

  if (
    !await hasApprovedPayment(
      db,
      target.id,
    )
  ) {
    throw new Error(
      'O pedido escolhido ainda não possui pagamento confirmado.',
    );
  }

  const poolRows =
    await futureAllocations(
      db,
      source.id,
      {
        ascending:
          true,
      },
    );

  if (
    !poolRows.length
  ) {
    throw new Error(
      'Não há capacidade reservada para redistribuir.',
    );
  }

  const earliestPoolDay =
    poolRows[0]
      .day;

  const targetRows =
    await futureAllocations(
      db,
      target.id,
      {
        afterDay:
          earliestPoolDay,

        ascending:
          false,
      },
    );

  if (
    !targetRows.length
  ) {
    throw new Error(
      'Este pedido não possui produção futura que possa ser antecipada.',
    );
  }

  const requested =
    pointsUnits === null
    || pointsUnits === undefined
      ? null
      : integerInRange(
        pointsUnits,
        {
          min:
            1,

          max:
            100000,

          label:
            'Quantidade de Points Libri',
        },
      );

  const plan =
    pairCascadeMoves(
      poolRows,
      targetRows,
      requested,
    );

  if (
    plan.movedUnits <= 0
  ) {
    throw new Error(
      'Não há combinação válida para antecipar este pedido.',
    );
  }

  const poolTaken =
    aggregateTaken(
      plan.pairs,
      'poolAllocationId',
    );

  const targetTaken =
    aggregateTaken(
      plan.pairs,
      'targetAllocationId',
    );

  const targetEarlier =
    aggregateInsertions(
      plan.pairs,
      'poolDay',
    );

  const poolCarriedForward =
    aggregateInsertions(
      plan.pairs,
      'targetDay',
    );

  const poolById =
    new Map(
      poolRows.map(
        (row) => [
          row.id,
          row,
        ],
      ),
    );

  const targetById =
    new Map(
      targetRows.map(
        (row) => [
          row.id,
          row,
        ],
      ),
    );

  const stamp =
    nowIso();

  const statements = [];

  for (
    const [
      allocationId,
      units,
    ]
    of poolTaken
  ) {
    statements.push(
      mutationForAllocation(
        db,
        poolById.get(
          allocationId,
        ),
        units,
      ),
    );
  }

  for (
    const [
      allocationId,
      units,
    ]
    of targetTaken
  ) {
    statements.push(
      mutationForAllocation(
        db,
        targetById.get(
          allocationId,
        ),
        units,
      ),
    );
  }

  for (
    const [
      day,
      units,
    ]
    of targetEarlier
  ) {
    statements.push(
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
              'anticipated',
              ?
            )
          `,
        )
        .bind(
          target.id,
          day,
          units,
          stamp,
        ),
    );
  }

  /*
   * O espaço que foi liberado nas datas antigas do pedido
   * antecipado continua reservado em nome do pedido finalizado.
   * É isso que faz a cascata continuar sem abrir vaga pública cedo.
   */
  for (
    const [
      day,
      units,
    ]
    of poolCarriedForward
  ) {
    statements.push(
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
          source.id,
          day,
          units,
          stamp,
        ),
    );
  }

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
          VALUES (
            ?,
            'production_anticipated',
            'Produção antecipada usando capacidade liberada pela cascata.',
            ?,
            ?
          )
        `,
      )
      .bind(
        target.id,
        JSON.stringify({
          sourceOrderCode:
            source.order_code,

          movedUnits:
            plan.movedUnits,

          movedPoints:
            plan.movedUnits
            / 100,

          promisedWindowChanged:
            false,

          fromDays:
            [
              ...new Set(
                plan.pairs.map(
                  (pair) =>
                    pair.targetDay,
                ),
              ),
            ],

          toDays:
            [
              ...new Set(
                plan.pairs.map(
                  (pair) =>
                    pair.poolDay,
                ),
              ),
            ],
        }),
        stamp,
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
          VALUES (
            ?,
            'cascade_transferred',
            'Capacidade interna redistribuída para antecipar outro pedido.',
            ?,
            ?
          )
        `,
      )
      .bind(
        source.id,
        JSON.stringify({
          targetOrderCode:
            target.order_code,

          movedUnits:
            plan.movedUnits,
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

    sourceOrderCode:
      source.order_code,

    targetOrderCode:
      target.order_code,

    movedUnits:
      plan.movedUnits,

    movedPoints:
      plan.movedUnits
      / 100,

    promisedWindowChanged:
      false,

    recalculateCascade:
      true,
  };
}

export async function releaseV2CascadeSurplus(
  db,
  {
    sourceOrderCode,
    force = false,
  },
) {
  const source =
    await orderByCode(
      db,
      sourceOrderCode,
    );

  if (
    !source
    || source.status
      !== 'finalized'
  ) {
    throw new Error(
      'Pedido de origem inválido para liberação de capacidade.',
    );
  }

  const rows =
    await futureAllocations(
      db,
      source.id,
    );

  if (
    !rows.length
  ) {
    return {
      ok:
        true,

      releasedUnits:
        0,

      releasedPoints:
        0,
    };
  }

  const candidate =
    await bestCandidateForPool(
      db,
      source.id,
      rows[0].day,
    );

  if (
    candidate
    && force !== true
  ) {
    const error =
      new Error(
        'Ainda existe um pedido elegível para antecipação antes de abrir esta capacidade ao público.',
      );

    error.code =
      'cascade_candidate_available';

    error.suggestion = {
      targetOrder:
        candidate,

      movableUnits:
        Math.min(
          totalUnits(
            rows,
          ),
          candidate.movableUnits,
        ),
    };

    throw error;
  }

  const releasedUnits =
    totalUnits(
      rows,
    );

  const stamp =
    nowIso();

  await db.batch([
    ...rows.map(
      (row) =>
        db
          .prepare(
            `
              DELETE FROM v2_agenda_allocations
              WHERE id = ?
            `,
          )
          .bind(
            row.id,
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
            'cascade_surplus_released',
            'Saldo final da capacidade da cascata liberado para a agenda pública.',
            ?,
            ?
          )
        `,
      )
      .bind(
        source.id,
        JSON.stringify({
          releasedUnits,

          releasedPoints:
            releasedUnits
            / 100,

          forced:
            force
            === true,
        }),
        stamp,
      ),

    db
      .prepare(
        `
          UPDATE v2_notifications
          SET resolved_at = ?
          WHERE
            order_id = ?
            AND event_code = 'CAPACITY_RELEASED'
            AND resolved_at IS NULL
        `,
      )
      .bind(
        stamp,
        source.id,
      ),
  ]);

  return {
    ok:
      true,

    releasedUnits,

    releasedPoints:
      releasedUnits
      / 100,

    publicCapacityChanged:
      releasedUnits > 0,
  };
}
