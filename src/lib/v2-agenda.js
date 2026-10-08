import {
  loadV2Settings,
  v2IntSetting,
} from './v2-catalog.js';

const DAY_MS =
  24
  * 60
  * 60
  * 1000;

const NORMAL_DELIVERY_WINDOW_DAYS =
  3;

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/
    .test(
      String(
        value
        || '',
      ),
    );
}

function parseIsoDay(value) {
  if (!isIsoDate(value)) {
    throw new Error(
      'Informe uma data válida.',
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
      'Informe uma data válida.',
    );
  }

  return date;
}

function formatIsoDay(date) {
  return date
    .toISOString()
    .slice(0, 10);
}

function addDays(
  date,
  amount,
) {
  return new Date(
    date.getTime()
    + (
      amount
      * DAY_MS
    ),
  );
}

function diffDays(
  a,
  b,
) {
  return Math.round(
    (
      a.getTime()
      - b.getTime()
    )
    / DAY_MS,
  );
}

function currentBrazilDay() {
  const parts =
    new Intl
      .DateTimeFormat(
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

  return parseIsoDay(
    `${
      map.year
    }-${
      map.month
    }-${
      map.day
    }`,
  );
}

function listDays(
  start,
  end,
) {
  const result = [];

  for (
    let cursor =
      new Date(
        start.getTime(),
      );

    cursor <= end;

    cursor =
      addDays(
        cursor,
        1,
      )
  ) {
    result.push(
      formatIsoDay(
        cursor,
      ),
    );
  }

  return result;
}

async function loadCapacityMap(
  db,
  startDay,
  endDay,
  settings,
  { excludeOrderId = null } = {},
) {
  const defaultCapacity =
    v2IntSetting(
      settings,
      'default_sellable_points_per_day_units',
      400,
    );

  const days =
    listDays(
      startDay,
      endDay,
    );

  const [
    dayRows,
    allocations,
    holds,
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
            WHERE
              day >= ?
              AND day <= ?
          `,
        )
        .bind(
          formatIsoDay(startDay),
          formatIsoDay(endDay),
        )
        .all(),

      db
        .prepare(
          `
            SELECT
              day,
              SUM(points_units) AS used_units
            FROM v2_agenda_allocations
            WHERE
              day >= ?
              AND day <= ?
            GROUP BY day
          `,
        )
        .bind(
          formatIsoDay(startDay),
          formatIsoDay(endDay),
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
              a.day >= ?
              AND a.day <= ?
              AND h.status = 'active'
              AND h.expires_at > ?
              AND (? IS NULL OR h.order_id != ?)
            GROUP BY a.day
          `,
        )
        .bind(
          formatIsoDay(startDay),
          formatIsoDay(endDay),
          new Date().toISOString(),
          excludeOrderId,
          excludeOrderId,
        )
        .all(),
    ]);

  const dayConfig =
    Object.fromEntries(
      (dayRows.results || [])
        .map(
          (row) => [
            row.day,
            row,
          ],
        ),
    );

  const used =
    Object.fromEntries(
      (allocations.results || [])
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
      (holds.results || [])
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

  return Object.fromEntries(
    days.map(
      (day) => {
        const config =
          dayConfig[day];

        const capacity =
          config
            ? Number(
              config
                .sellable_capacity_units,
            )
            : defaultCapacity;

        const blocked =
          config
            ?.blocked
          === 1;

        const free =
          blocked
            ? 0
            : Math.max(
              0,
              capacity
              - (
                used[day]
                || 0
              )
              - (
                held[day]
                || 0
              ),
            );

        return [
          day,

          {
            capacity,
            used:
              used[day]
              || 0,

            held:
              held[day]
              || 0,

            free,
            blocked,
          },
        ];
      },
    ),
  );
}

function planAllocation(
  capacityMap,
  startDay,
  endDay,
  requiredUnits,
) {
  let remaining =
    requiredUnits;

  const allocation = [];

  for (
    const day
    of listDays(
      startDay,
      endDay,
    )
  ) {
    if (
      remaining
      <= 0
    ) {
      break;
    }

    const free =
      capacityMap[
        day
      ]?.free
      || 0;

    if (
      free
      <= 0
    ) {
      continue;
    }

    const take =
      Math.min(
        free,
        remaining,
      );

    allocation.push({
      day,
      pointsUnits:
        take,
    });

    remaining -=
      take;
  }

  return {
    fits:
      remaining
      === 0,

    allocation,

    remainingUnits:
      remaining,
  };
}

function buildCandidateWindows({
  capacityMap,
  firstPossibleDay,
  lastPossibleEnd,
  targetDay,
  requiredUnits,
}) {
  const candidates = [];

  /*
   * A cliente sempre recebe uma faixa comercial fixa de 3 dias.
   * A agenda, porém, reserva apenas os dias realmente necessários
   * dentro dessa faixa. Se toda a carga couber em um único dia,
   * somente esse dia aparece como produção interna.
   */
  const lastPossibleStart =
    addDays(
      lastPossibleEnd,
      -(
        NORMAL_DELIVERY_WINDOW_DAYS
        - 1
      ),
    );

  for (
    let start =
      new Date(
        firstPossibleDay
          .getTime(),
      );

    start <= lastPossibleStart;

    start =
      addDays(
        start,
        1,
      )
  ) {
    const end =
      addDays(
        start,
        NORMAL_DELIVERY_WINDOW_DAYS
        - 1,
      );

    const plan =
      planAllocation(
        capacityMap,
        start,
        end,
        requiredUnits,
      );

    if (
      !plan.fits
      || !plan.allocation.length
    ) {
      continue;
    }

    const midpoint =
      new Date(
        (
          start.getTime()
          + end.getTime()
        )
        / 2,
      );

    candidates.push({
      start,
      end,
      distanceToTarget:
        Math.abs(
          diffDays(
            midpoint,
            targetDay,
          ),
        ),
      plan,
    });
  }

  return candidates;
}

export async function validateV2DeliveryWindow(
  db,
  {
    eventDate,
    start,
    end,
  },
) {
  const eventDay =
    parseIsoDay(
      eventDate,
    );

  const startDay =
    parseIsoDay(
      start,
    );

  const endDay =
    parseIsoDay(
      end,
    );

  if (
    endDay
    < startDay
    || diffDays(
      endDay,
      startDay,
    )
      !== NORMAL_DELIVERY_WINDOW_DAYS
        - 1
  ) {
    throw new Error(
      'A janela normal de entrega deve ter 3 dias.',
    );
  }

  const settings =
    await loadV2Settings(
      db,
    );

  const minimumDaysBeforeEvent =
    v2IntSetting(
      settings,
      'minimum_delivery_days_before_event',
      3,
    );

  const firstPossibleDay =
    addDays(
      currentBrazilDay(),
      1,
    );

  const lastPossibleEnd =
    addDays(
      eventDay,
      -minimumDaysBeforeEvent,
    );

  if (
    startDay
    < firstPossibleDay
    || endDay
    > lastPossibleEnd
  ) {
    throw new Error(
      'Essa janela não é compatível com a data do evento.',
    );
  }

  return {
    valid:
      true,
  };
}

export async function findV2DeliveryOptions(
  db,
  {
    eventDate,
    pointsUnits,
    limit = 5,
  },
) {
  const eventDay =
    parseIsoDay(
      eventDate,
    );

  const requiredUnits =
    Number.parseInt(
      pointsUnits,
      10,
    );

  if (
    !Number.isInteger(
      requiredUnits,
    )
    || requiredUnits <= 0
  ) {
    throw new Error(
      'Carga de produção inválida.',
    );
  }

  const settings =
    await loadV2Settings(
      db,
    );

  const recommendedDaysBefore =
    v2IntSetting(
      settings,
      'recommended_delivery_days_before_event',
      40,
    );

  const minimumDaysBeforeEvent =
    v2IntSetting(
      settings,
      'minimum_delivery_days_before_event',
      3,
    );

  const today =
    currentBrazilDay();

  const firstPossibleDay =
    addDays(
      today,
      1,
    );

  const lastPossibleEnd =
    addDays(
      eventDay,
      -minimumDaysBeforeEvent,
    );

  const targetDay =
    addDays(
      eventDay,
      -recommendedDaysBefore,
    );

  if (
    lastPossibleEnd
    < firstPossibleDay
  ) {
    return {
      recommendedTargetDate:
        formatIsoDay(
          targetDay,
        ),

      options: [],

      needsUrgencyReview:
        true,
    };
  }

  const capacityMap =
    await loadCapacityMap(
      db,
      firstPossibleDay,
      lastPossibleEnd,
      settings,
    );

  const candidates =
    buildCandidateWindows({
      capacityMap,
      firstPossibleDay,
      lastPossibleEnd,
      targetDay,
      requiredUnits,
    });

  if (
    !candidates.length
  ) {
    return {
      recommendedTargetDate:
        formatIsoDay(
          targetDay,
        ),

      options: [],

      needsUrgencyReview:
        true,
    };
  }

  const viable =
    candidates
      .sort(
        (
          a,
          b,
        ) =>
          a.distanceToTarget
          - b.distanceToTarget
          || a.start
            - b.start
          || a.end
            - b.end,
      );

  const selected = [];

  const seen =
    new Set();

  for (
    const candidate
    of viable
  ) {
    const key =
      `${
        formatIsoDay(
          candidate.start,
        )
      }_${
        formatIsoDay(
          candidate.end,
        )
      }`;

    if (
      seen.has(
        key,
      )
    ) {
      continue;
    }

    seen.add(
      key,
    );

    selected.push(
      candidate,
    );

    if (
      selected.length
      >= Math.max(
        1,
        Math.min(
          10,
          Number(limit)
          || 5,
        ),
      )
    ) {
      break;
    }
  }

  if (
    !selected.length
  ) {
    return {
      recommendedTargetDate:
        formatIsoDay(
          targetDay,
        ),

      options: [],

      needsUrgencyReview:
        true,
    };
  }

  const options =
    selected
      .map(
        (
          candidate,
          index,
        ) => ({
          start:
            formatIsoDay(
              candidate.start,
            ),

          end:
            formatIsoDay(
              candidate.end,
            ),

          recommended:
            index === 0,
        }),
      );

  return {
    recommendedTargetDate:
      formatIsoDay(
        targetDay,
      ),

    options,

    needsUrgencyReview:
      false,
  };
}

// When a saved, unpaid order has reached the first day of its original
// delivery window, suggest the earliest NEW three-day window that actually
// fits its production load. Never move a window without the customer's OK.
export async function findNextV2DeliveryWindow(
  db,
  { eventDate, previousStart, pointsUnits, excludeOrderId = null },
) {
  const firstPossibleDay = addDays(currentBrazilDay(), 1);
  const previousStartDay = parseIsoDay(previousStart);
  if (previousStartDay >= firstPossibleDay) return null;

  const units = Number.parseInt(pointsUnits, 10);
  if (!Number.isInteger(units) || units <= 0) {
    throw new Error('Carga de produção inválida.');
  }

  const settings = await loadV2Settings(db);
  const lastPossibleEnd = addDays(
    parseIsoDay(eventDate),
    -v2IntSetting(settings, 'minimum_delivery_days_before_event', 3),
  );
  const lastPossibleStart = addDays(lastPossibleEnd, -(NORMAL_DELIVERY_WINDOW_DAYS - 1));
  if (firstPossibleDay > lastPossibleStart) return null;

  const capacityMap = await loadCapacityMap(db, firstPossibleDay, lastPossibleEnd, settings, { excludeOrderId });
  for (
    let start = firstPossibleDay;
    start <= lastPossibleStart;
    start = addDays(start, 1)
  ) {
    const end = addDays(start, NORMAL_DELIVERY_WINDOW_DAYS - 1);
    const plan = planAllocation(capacityMap, start, end, units);
    if (plan.fits && plan.allocation.length) {
      return { start: formatIsoDay(start), end: formatIsoDay(end) };
    }
  }
  return null;
}

export async function planV2AllocationForWindow(
  db,
  {
    start,
    end,
    pointsUnits,
  },
) {
  const startDay =
    parseIsoDay(
      start,
    );

  const endDay =
    parseIsoDay(
      end,
    );

  if (
    endDay
    < startDay
  ) {
    throw new Error(
      'Janela de entrega inválida.',
    );
  }

  const requiredUnits =
    Number.parseInt(
      pointsUnits,
      10,
    );

  if (
    !Number.isInteger(
      requiredUnits,
    )
    || requiredUnits <= 0
  ) {
    throw new Error(
      'Carga de produção inválida.',
    );
  }

  const settings =
    await loadV2Settings(
      db,
    );

  const capacityMap =
    await loadCapacityMap(
      db,
      startDay,
      endDay,
      settings,
    );

  return planAllocation(
    capacityMap,
    startDay,
    endDay,
    requiredUnits,
  );
}

export function validateV2UrgencyWindow(start, end, eventDate) {
  const startDay = parseIsoDay(start);
  const endDay = parseIsoDay(end);
  if (formatIsoDay(startDay) !== start || formatIsoDay(endDay) !== end || start > end
    || start < formatIsoDay(currentBrazilDay()) || end > eventDate) {
    throw new Error('Informe uma janela válida, de hoje até a data do evento.');
  }
}

