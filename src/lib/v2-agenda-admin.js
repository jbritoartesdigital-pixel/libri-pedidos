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
            '/admin-v2?view=agenda',
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

      internalB