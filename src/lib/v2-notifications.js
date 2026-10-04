import {
  sendPushBatch,
  topicFromString,
} from '@mmmike/web-push/send';

import {
  nowIso,
} from './http.js';

const SAO_PAULO =
  'America/Sao_Paulo';

const PUSH_MAX_AGE_HOURS =
  24;

function cleanText(
  value,
  maxLength = 2000,
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

function dateKeyInSaoPaulo() {
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

  return `${map.year}-${map.month}-${map.day}`;
}

function pushConfigured(
  env,
) {
  return Boolean(
    String(
      env.VAPID_PUBLIC_KEY
      || '',
    ).trim()
    && String(
      env.VAPID_PRIVATE_KEY
      || '',
    ).trim()
    && String(
      env.VAPID_SUBJECT
      || '',
    ).trim(),
  );
}

function safeActionUrl(
  value,
) {
  const url =
    cleanText(
      value,
      1000,
    );

  if (
    !url
  ) {
    return '/admin/';
  }

  if (
    url.startsWith(
      '/admin',
    )
  ) {
    return url;
  }

  return '/admin/';
}

async function preferenceFor(
  db,
  eventCode,
) {
  const row =
    await db
      .prepare(
        `
          SELECT
            bell_enabled,
            push_enabled
          FROM v2_notification_preferences
          WHERE event_code = ?
          LIMIT 1
        `,
      )
      .bind(
        eventCode,
      )
      .first();

  return {
    bellEnabled:
      row
        ? row.bell_enabled === 1
        : true,

    pushEnabled:
      row
        ? row.push_enabled === 1
        : true,
  };
}

export async function createV2AdminNotification(
  env,
  {
    eventCode,
    orderId = null,
    title,
    body,
    actionUrl = '/admin/',
    priority = 'normal',
    pushEligible = true,
    dedupeKey = null,
  },
) {
  const code =
    cleanText(
      eventCode,
      80,
    );

  const preference =
    await preferenceFor(
      env.DB,
      code,
    );

  if (
    !preference
      .bellEnabled
    && !preference
      .pushEnabled
  ) {
    return {
      created:
        false,
      disabled:
        true,
    };
  }

  const result =
    await env.DB
      .prepare(
        `
          INSERT OR IGNORE INTO v2_notifications(
            event_code,
            order_id,
            title,
            body,
            action_url,
            priority,
            push_eligible,
            dedupe_key,
            created_at
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
          )
        `,
      )
      .bind(
        code,
        orderId,
        cleanText(
          title,
          180,
        ),
        cleanText(
          body,
          1200,
        ),
        safeActionUrl(
          actionUrl,
        ),
        [
          'low',
          'normal',
          'high',
        ].includes(
          priority,
        )
          ? priority
          : 'normal',

        pushEligible
        && preference
          .pushEnabled
          ? 1
          : 0,

        dedupeKey
          ? cleanText(
            dedupeKey,
            240,
          )
          : null,

        nowIso(),
      )
      .run();

  return {
    created:
      Number(
        result
          ?.meta
          ?.changes
        || 0,
      )
      > 0,
  };
}

export async function listV2AdminNotifications(
  db,
  {
    unreadOnly = false,
    unresolvedOnly = false,
    limit = 50,
  } = {},
) {
  const clauses = [];

  if (
    unreadOnly
  ) {
    clauses.push(
      'n.read_at IS NULL',
    );
  }

  if (
    unresolvedOnly
  ) {
    clauses.push(
      'n.resolved_at IS NULL',
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

  const where =
    clauses.length
      ? `WHERE ${
        clauses.join(
          ' AND ',
        )
      }`
      : '';

  const [
    listResult,
    countRow,
  ] =
    await Promise.all([
      db
        .prepare(
          `
            SELECT
              n.id,
              n.event_code,
              n.order_id,
              n.title,
              n.body,
              n.action_url,
              n.priority,
              n.push_eligible,
              n.read_at,
              n.resolved_at,
              n.push_sent_at,
              n.created_at,

              o.order_code,
              o.honoree_display_name
            FROM v2_notifications n
            LEFT JOIN v2_orders o
              ON o.id = n.order_id
            ${where}
            ORDER BY
              CASE n.priority
                WHEN 'high' THEN 0
                WHEN 'normal' THEN 1
                ELSE 2
              END,
              n.created_at DESC,
              n.id DESC
            LIMIT ?
          `,
        )
        .bind(
          safeLimit,
        )
        .all(),

      db
        .prepare(
          `
            SELECT
              COUNT(*) AS unread_count,

              SUM(
                CASE
                  WHEN resolved_at IS NULL
                    THEN 1
                  ELSE 0
                END
              ) AS unresolved_count
            FROM v2_notifications
            WHERE read_at IS NULL
          `,
        )
        .first(),
    ]);

  return {
    unreadCount:
      Number(
        countRow
          ?.unread_count
        || 0,
      ),

    unresolvedUnreadCount:
      Number(
        countRow
          ?.unresolved_count
        || 0,
      ),

    notifications:
      (
        listResult.results
        || []
      )
        .map(
          (row) => ({
            id:
              row.id,

            eventCode:
              row.event_code,

            title:
              row.title,

            body:
              row.body,

            actionUrl:
              row.action_url,

            priority:
              row.priority,

            read:
              Boolean(
                row.read_at,
              ),

            resolved:
              Boolean(
                row.resolved_at,
              ),

            pushSent:
              Boolean(
                row.push_sent_at,
              ),

            createdAt:
              row.created_at,

            order:
              row.order_id
                ? {
                  id:
                    row.order_id,

                  code:
                    row.order_code,

                  honoreeName:
                    row.honoree_display_name,
                }
                : null,
          }),
        ),
  };
}

export async function markV2NotificationRead(
  db,
  id,
) {
  const result =
    await db
      .prepare(
        `
          UPDATE v2_notifications
          SET read_at = COALESCE(
            read_at,
            ?
          )
          WHERE id = ?
        `,
      )
      .bind(
        nowIso(),
        id,
      )
      .run();

  return Number(
    result
      ?.meta
      ?.changes
    || 0,
  )
    > 0;
}

export async function markAllV2NotificationsRead(
  db,
) {
  const result =
    await db
      .prepare(
        `
          UPDATE v2_notifications
          SET read_at = ?
          WHERE read_at IS NULL
        `,
      )
      .bind(
        nowIso(),
      )
      .run();

  return {
    changed:
      Number(
        result
          ?.meta
          ?.changes
        || 0,
      ),
  };
}

export async function resolveV2Notification(
  db,
  id,
) {
  const stamp =
    nowIso();

  const result =
    await db
      .prepare(
        `
          UPDATE v2_notifications
          SET
            read_at = COALESCE(
              read_at,
              ?
            ),
            resolved_at = COALESCE(
              resolved_at,
              ?
            )
          WHERE id = ?
        `,
      )
      .bind(
        stamp,
        stamp,
        id,
      )
      .run();

  return Number(
    result
      ?.meta
      ?.changes
    || 0,
  )
    > 0;
}

function validSubscription(
  body,
) {
  const endpoint =
    cleanText(
      body
        ?.endpoint,
      3000,
    );

  const p256dh =
    cleanText(
      body
        ?.keys
        ?.p256dh,
      1000,
    );

  const auth =
    cleanText(
      body
        ?.keys
        ?.auth,
      1000,
    );

  let parsed;

  try {
    parsed =
      new URL(
        endpoint,
      );
  } catch {
    return null;
  }

  if (
    parsed.protocol
    !== 'https:'
    || !p256dh
    || !auth
  ) {
    return null;
  }

  return {
    endpoint,
    p256dh,
    auth,
  };
}

export async function saveV2PushSubscription(
  request,
  env,
  body,
) {
  const subscription =
    validSubscription(
      body,
    );

  if (
    !subscription
  ) {
    throw new Error(
      'Inscrição Web Push inválida.',
    );
  }

  const stamp =
    nowIso();

  await env.DB
    .prepare(
      `
        INSERT INTO v2_push_subscriptions(
          endpoint,
          p256dh,
          auth,
          user_agent,
          created_at,
          last_used_at,
          revoked_at
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          NULL
        )
        ON CONFLICT(endpoint)
        DO UPDATE SET
          p256dh =
            excluded.p256dh,

          auth =
            excluded.auth,

          user_agent =
            excluded.user_agent,

          last_used_at =
            excluded.last_used_at,

          revoked_at =
            NULL
      `,
    )
    .bind(
      subscription.endpoint,
      subscription.p256dh,
      subscription.auth,
      cleanText(
        request.headers
          .get(
            'user-agent',
          ),
        1000,
      ),
      stamp,
      stamp,
    )
    .run();

  return {
    subscribed:
      true,
  };
}

export async function revokeV2PushSubscription(
  env,
  endpoint,
) {
  const normalized =
    cleanText(
      endpoint,
      3000,
    );

  if (!normalized) {
    throw new Error(
      'Endpoint da inscrição é obrigatório.',
    );
  }

  const result =
    await env.DB
      .prepare(
        `
          UPDATE v2_push_subscriptions
          SET revoked_at = ?
          WHERE
            endpoint = ?
            AND revoked_at IS NULL
        `,
      )
      .bind(
        nowIso(),
        normalized,
      )
      .run();

  return {
    revoked:
      Number(
        result
          ?.meta
          ?.changes
        || 0,
      )
      > 0,
  };
}

export async function getV2PushConfig(
  env,
) {
  return {
    configured:
      pushConfigured(
        env,
      ),

    publicKey:
      pushConfigured(
        env,
      )
        ? String(
          env.VAPID_PUBLIC_KEY,
        )
        : '',

    serviceWorkerPath:
      '/admin-sw-v2.js',
  };
}

export async function getV2NotificationPreferences(
  db,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            event_code,
            bell_enabled,
            push_enabled,
            updated_at
          FROM v2_notification_preferences
          ORDER BY event_code
        `,
      )
      .all();

  return (
    result.results
    || []
  )
    .map(
      (row) => ({
        eventCode:
          row.event_code,

        bellEnabled:
          row.bell_enabled
          === 1,

        pushEnabled:
          row.push_enabled
          === 1,

        updatedAt:
          row.updated_at,
      }),
    );
}

export async function updateV2NotificationPreference(
  db,
  eventCode,
  body = {},
) {
  const code =
    cleanText(
      eventCode,
      80,
    );

  const bellEnabled =
    body.bellEnabled
    !== false;

  const pushEnabled =
    body.pushEnabled
    !== false;

  await db
    .prepare(
      `
        INSERT INTO v2_notification_preferences(
          event_code,
          bell_enabled,
          push_enabled,
          updated_at
        )
        VALUES (
          ?,
          ?,
          ?,
          ?
        )
        ON CONFLICT(event_code)
        DO UPDATE SET
          bell_enabled =
            excluded.bell_enabled,

          push_enabled =
            excluded.push_enabled,

          updated_at =
            excluded.updated_at
      `,
    )
    .bind(
      code,
      bellEnabled
        ? 1
        : 0,
      pushEnabled
        ? 1
        : 0,
      nowIso(),
    )
    .run();

  return {
    eventCode:
      code,

    bellEnabled,

    pushEnabled,
  };
}

async function subscriptionsForPush(
  db,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            id,
            endpoint,
            p256dh,
            auth
          FROM v2_push_subscriptions
          WHERE revoked_at IS NULL
          ORDER BY id
        `,
      )
      .all();

  return result.results
    || [];
}

async function markGoneSubscriptions(
  db,
  endpoints,
) {
  if (
    !endpoints.length
  ) {
    return;
  }

  const stamp =
    nowIso();

  await db.batch(
    endpoints.map(
      (endpoint) =>
        db
          .prepare(
            `
              UPDATE v2_push_subscriptions
              SET revoked_at = ?
              WHERE endpoint = ?
            `,
          )
          .bind(
            stamp,
            endpoint,
          ),
    ),
  );
}

async function pushOneNotification(
  env,
  notification,
  subscriptions,
) {
  if (
    !subscriptions.length
  ) {
    return {
      delivered:
        0,

      gone:
        [],

      failed:
        [],
    };
  }

  const vapid = {
    publicKey:
      String(
        env.VAPID_PUBLIC_KEY,
      ),

    privateKey:
      String(
        env.VAPID_PRIVATE_KEY,
      ),

    subject:
      String(
        env.VAPID_SUBJECT,
      ),
  };

  const payload = {
    title:
      notification.title,

    body:
      notification.body,

    url:
      safeActionUrl(
        notification.action_url,
      ),

    tag:
      notification.dedupe_key
      || `${
        notification.event_code
      }:${
        notification.id
      }`,
  };

  const result =
    await sendPushBatch(
      subscriptions.map(
        (row) => ({
          endpoint:
            row.endpoint,

          keys: {
            p256dh:
              row.p256dh,

            auth:
              row.auth,
          },
        }),
      ),

      payload,

      vapid,

      {
        ttl:
          24
          * 60
          * 60,

        urgency:
          notification.priority
          === 'high'
            ? 'high'
            : 'normal',

        topic:
          await topicFromString(
            payload.tag,
          ),

        concurrency:
          20,
      },
    );

  return result;
}

export async function dispatchPendingV2Push(
  env,
  {
    limit = 30,
  } = {},
) {
  if (
    !pushConfigured(
      env,
    )
  ) {
    return {
      configured:
        false,

      processed:
        0,

      delivered:
        0,
    };
  }

  const cutoff =
    new Date(
      Date.now()
      - PUSH_MAX_AGE_HOURS
      * 60
      * 60
      * 1000,
    )
      .toISOString();

  const result =
    await env.DB
      .prepare(
        `
          SELECT
            n.id,
            n.event_code,
            n.title,
            n.body,
            n.action_url,
            n.priority,
            n.dedupe_key
          FROM v2_notifications n
          LEFT JOIN v2_notification_preferences p
            ON p.event_code = n.event_code
          WHERE
            n.push_eligible = 1
            AND n.push_sent_at IS NULL
            AND n.created_at >= ?
            AND COALESCE(
              p.push_enabled,
              1
            ) = 1
          ORDER BY
            CASE n.priority
              WHEN 'high' THEN 0
              WHEN 'normal' THEN 1
              ELSE 2
            END,
            n.created_at,
            n.id
          LIMIT ?
        `,
      )
      .bind(
        cutoff,
        Math.max(
          1,
          Math.min(
            100,
            Number.parseInt(
              limit,
              10,
            )
            || 30,
          ),
        ),
      )
      .all();

  const notifications =
    result.results
    || [];

  if (
    !notifications.length
  ) {
    return {
      configured:
        true,

      processed:
        0,

      delivered:
        0,
    };
  }

  const subscriptions =
    await subscriptionsForPush(
      env.DB,
    );

  if (
    !subscriptions.length
  ) {
    return {
      configured:
        true,

      processed:
        0,

      delivered:
        0,

      noSubscriptions:
        true,
    };
  }

  let delivered = 0;

  for (
    const notification
    of notifications
  ) {
    const attemptAt =
      nowIso();

    try {
      const pushResult =
        await pushOneNotification(
          env,
          notification,
          subscriptions,
        );

      delivered +=
        Number(
          pushResult.delivered
          || 0,
        );

      const goneEndpoints =
        (
          pushResult.gone
          || []
        )
          .map(
            (entry) =>
              typeof entry
              === 'string'
                ? entry
                : entry.endpoint,
          )
          .filter(Boolean);

      await markGoneSubscriptions(
        env.DB,
        goneEndpoints,
      );

      const errorText =
        (
          pushResult.failed
          || []
        )
          .slice(
            0,
            3,
          )
          .map(
            (entry) => {
              const error =
                entry
                  ?.error;

              return error
                ?.statusCode
                ? `HTTP ${
                  error.statusCode
                }`
                : cleanText(
                  error
                    ?.message,
                  120,
                );
            },
          )
          .filter(Boolean)
          .join(
            ' | ',
          );

      await env.DB
        .prepare(
          `
            UPDATE v2_notifications
            SET
              push_attempted_at = ?,
              push_sent_at = CASE
                WHEN ? > 0
                  THEN ?
                ELSE push_sent_at
              END,
              push_error = ?
            WHERE id = ?
          `,
        )
        .bind(
          attemptAt,

          Number(
            pushResult.delivered
            || 0,
          ),

          attemptAt,

          errorText
          || null,

          notification.id,
        )
        .run();
    } catch (
      error
    ) {
      await env.DB
        .prepare(
          `
            UPDATE v2_notifications
            SET
              push_attempted_at = ?,
              push_error = ?
            WHERE id = ?
          `,
        )
        .bind(
          attemptAt,
          cleanText(
            error
              ?.message
            || 'Falha ao enviar Web Push.',
            1000,
          ),
          notification.id,
        )
        .run();
    }
  }

  return {
    configured:
      true,

    processed:
      notifications.length,

    delivered,
  };
}

export async function createTodayEventNotifications(
  env,
) {
  const today =
    dateKeyInSaoPaulo();

  const result =
    await env.DB
      .prepare(
        `
          SELECT
            o.id,
            o.order_code,
            o.honoree_display_name,

            c.name AS customer_name
          FROM v2_orders o
          INNER JOIN v2_customers c
            ON c.id = o.customer_id
          WHERE
            o.event_date = ?
            AND o.status != 'cancelled'
          ORDER BY
            o.created_at
        `,
      )
      .bind(
        today,
      )
      .all();

  let created = 0;

  for (
    const row
    of result.results
    || []
  ) {
    const notification =
      await createV2AdminNotification(
        env,
        {
          eventCode:
            'EVENT_TODAY',

          orderId:
            row.id,

          title:
            'Festa hoje 🎉',

          body:
            `${
              row.honoree_display_name
            } • ${
              row.customer_name
            }`,

          actionUrl:
            `/admin/pedidos/${
              row.order_code
            }`,

          priority:
            'high',

          pushEligible:
            true,

          dedupeKey:
            `event_today:${
              today
            }:${
              row.id
            }`,
        },
      );

    if (
      notification.created
    ) {
      created += 1;
    }
  }

  return {
    day:
      today,

    created,
  };
}

export async function runV2NotificationScheduler(
  env,
) {
  const daily =
    await createTodayEventNotifications(
      env,
    );

  const push =
    await dispatchPendingV2Push(
      env,
    );

  return {
    daily,
    push,
  };
}

export async function sendV2TestPush(
  env,
) {
  const stamp =
    Date.now();

  await createV2AdminNotification(
    env,
    {
      eventCode:
        'TEST_PUSH',

      title:
        'Libri funcionando ✨',

      body:
        'As notificações deste aparelho estão ativas.',

      actionUrl:
        '/admin/',

      priority:
        'normal',

      pushEligible:
        true,

      dedupeKey:
        `test_push:${
          stamp
        }`,
    },
  );

  return dispatchPendingV2Push(
    env,
    {
      limit:
        5,
    },
  );
}
