import {
  fail,
  json,
  readJson,
} from '../lib/http.js';

import {
  dispatchPendingV2Push,
  getV2NotificationPreferences,
  getV2PushConfig,
  listV2AdminNotifications,
  markAllV2NotificationsRead,
  markV2NotificationRead,
  resolveV2Notification,
  revokeV2PushSubscription,
  saveV2PushSubscription,
  sendV2TestPush,
  updateV2NotificationPreference,
} from '../lib/v2-notifications.js';

function notificationError(
  error,
  status = 422,
) {
  return fail(
    error
      ?.message
    || 'Não foi possível atualizar as notificações.',
    status,
  );
}

export async function handleAdminNotificationsV2Api(
  request,
  env,
  url,
) {
  const method =
    request.method
      .toUpperCase();

  const path =
    url.pathname;

  if (
    path
    === '/api/admin/v2/notifications'
    && method
    === 'GET'
  ) {
    return json({
      ok:
        true,

      result:
        await listV2AdminNotifications(
          env.DB,
          {
            unreadOnly:
              url.searchParams
                .get(
                  'unread',
                )
              === '1',

            unresolvedOnly:
              url.searchParams
                .get(
                  'unresolved',
                )
              === '1',

            limit:
              url.searchParams
                .get(
                  'limit',
                )
              || 50,
          },
        ),
    });
  }

  if (
    path
    === '/api/admin/v2/notifications/read-all'
    && method
    === 'POST'
  ) {
    return json({
      ok:
        true,

      result:
        await markAllV2NotificationsRead(
          env.DB,
        ),
    });
  }

  const readMatch =
    path.match(
      /^\/api\/admin\/v2\/notifications\/(\d+)\/read$/,
    );

  if (
    readMatch
    && method
    === 'POST'
  ) {
    const changed =
      await markV2NotificationRead(
        env.DB,
        Number.parseInt(
          readMatch[1],
          10,
        ),
      );

    if (!changed) {
      return fail(
        'Notificação não encontrada.',
        404,
      );
    }

    return json({
      ok:
        true,
    });
  }

  const resolveMatch =
    path.match(
      /^\/api\/admin\/v2\/notifications\/(\d+)\/resolve$/,
    );

  if (
    resolveMatch
    && method
    === 'POST'
  ) {
    const changed =
      await resolveV2Notification(
        env.DB,
        Number.parseInt(
          resolveMatch[1],
          10,
        ),
      );

    if (!changed) {
      return fail(
        'Notificação não encontrada.',
        404,
      );
    }

    return json({
      ok:
        true,
    });
  }

  if (
    path
    === '/api/admin/v2/notifications/preferences'
    && method
    === 'GET'
  ) {
    return json({
      ok:
        true,

      preferences:
        await getV2NotificationPreferences(
          env.DB,
        ),
    });
  }

  const preferenceMatch =
    path.match(
      /^\/api\/admin\/v2\/notifications\/preferences\/([A-Z0-9_]+)$/,
    );

  if (
    preferenceMatch
    && method
    === 'PATCH'
  ) {
    try {
      return json({
        ok:
          true,

        result:
          await updateV2NotificationPreference(
            env.DB,
            preferenceMatch[1],
            await readJson(
              request,
            ),
          ),
      });
    } catch (
      error
    ) {
      return notificationError(
        error,
      );
    }
  }

  if (
    path
    === '/api/admin/v2/notifications/push/config'
    && method
    === 'GET'
  ) {
    return json({
      ok:
        true,

      push:
        await getV2PushConfig(
          env,
        ),
    });
  }

  if (
    path
    === '/api/admin/v2/notifications/push/subscribe'
    && method
    === 'POST'
  ) {
    try {
      return json({
        ok:
          true,

        result:
          await saveV2PushSubscription(
            request,
            env,
            await readJson(
              request,
            ),
          ),
      });
    } catch (
      error
    ) {
      return notificationError(
        error,
      );
    }
  }

  if (
    path
    === '/api/admin/v2/notifications/push/unsubscribe'
    && method
    === 'POST'
  ) {
    try {
      const body =
        await readJson(
          request,
        );

      return json({
        ok:
          true,

        result:
          await revokeV2PushSubscription(
            env,
            body.endpoint,
          ),
      });
    } catch (
      error
    ) {
      return notificationError(
        error,
      );
    }
  }

  if (
    path
    === '/api/admin/v2/notifications/push/test'
    && method
    === 'POST'
  ) {
    try {
      return json({
        ok:
          true,

        result:
          await sendV2TestPush(
            env,
          ),
      });
    } catch (
      error
    ) {
      return notificationError(
        error,
      );
    }
  }

  if (
    path
    === '/api/admin/v2/notifications/push/dispatch'
    && method
    === 'POST'
  ) {
    try {
      return json({
        ok:
          true,

        result:
          await dispatchPendingV2Push(
            env,
          ),
      });
    } catch (
      error
    ) {
      return notificationError(
        error,
      );
    }
  }

  return null;
}
