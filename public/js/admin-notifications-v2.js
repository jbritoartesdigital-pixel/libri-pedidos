function base64UrlToUint8Array(
  value,
) {
  const normalized =
    String(
      value
      || '',
    )
      .replace(
        /-/g,
        '+',
      )
      .replace(
        /_/g,
        '/',
      );

  const padded =
    normalized
    + '='.repeat(
      (
        4
        - (
          normalized.length
          % 4
        )
      )
      % 4,
    );

  const binary =
    atob(
      padded,
    );

  const bytes =
    new Uint8Array(
      binary.length,
    );

  for (
    let index = 0;
    index < binary.length;
    index += 1
  ) {
    bytes[
      index
    ] =
      binary.charCodeAt(
        index,
      );
  }

  return bytes;
}

function subscriptionToJson(
  subscription,
) {
  const raw =
    subscription.toJSON();

  return {
    endpoint:
      raw.endpoint,

    keys: {
      p256dh:
        raw.keys
          ?.p256dh,

      auth:
        raw.keys
          ?.auth,
    },
  };
}

async function api(
  path,
  options = {},
) {
  const response =
    await fetch(
      path,
      {
        credentials:
          'same-origin',

        ...options,

        headers: {
          ...(
            options.body
              ? {
                'content-type':
                  'application/json',
              }
              : {}
          ),

          ...(
            options.headers
            || {}
          ),
        },
      },
    );

  const data =
    await response
      .json();

  if (
    !response.ok
  ) {
    throw new Error(
      data
        ?.error
      || 'Falha ao atualizar notificações.',
    );
  }

  return data;
}

export function isAdminPushSupported() {
  return Boolean(
    'serviceWorker'
    in navigator
    && 'PushManager'
    in window
    && 'Notification'
    in window,
  );
}

export async function getAdminPushState() {
  if (
    !isAdminPushSupported()
  ) {
    return {
      supported:
        false,

      permission:
        'unsupported',

      subscribed:
        false,
    };
  }

  const registration =
    await navigator.serviceWorker
      .getRegistration(
        '/admin-sw-v2.js',
      );

  const subscription =
    registration
      ? await registration
        .pushManager
        .getSubscription()
      : null;

  return {
    supported:
      true,

    permission:
      Notification.permission,

    subscribed:
      Boolean(
        subscription,
      ),
  };
}

export async function enableAdminPush() {
  if (
    !isAdminPushSupported()
  ) {
    return {
      supported:
        false,

      status:
        'unsupported',
    };
  }

  const config =
    await api(
      '/api/admin/v2/notifications/push/config',
    );

  if (
    !config.push
      ?.configured
    || !config.push
      ?.publicKey
  ) {
    throw new Error(
      'Web Push ainda não foi configurado no servidor.',
    );
  }

  const permission =
    await Notification
      .requestPermission();

  if (
    permission
    !== 'granted'
  ) {
    return {
      supported:
        true,

      status:
        permission,
    };
  }

  const registration =
    await navigator.serviceWorker
      .register(
        config.push
          .serviceWorkerPath
        || '/admin-sw-v2.js',
        {
          scope:
            '/',
        },
      );

  let subscription =
    await registration
      .pushManager
      .getSubscription();

  if (
    !subscription
  ) {
    subscription =
      await registration
        .pushManager
        .subscribe({
          userVisibleOnly:
            true,

          applicationServerKey:
            base64UrlToUint8Array(
              config.push
                .publicKey,
            ),
        });
  }

  await api(
    '/api/admin/v2/notifications/push/subscribe',
    {
      method:
        'POST',

      body:
        JSON.stringify(
          subscriptionToJson(
            subscription,
          ),
        ),
    },
  );

  return {
    supported:
      true,

    status:
      'subscribed',
  };
}

export async function disableAdminPush() {
  if (
    !isAdminPushSupported()
  ) {
    return {
      supported:
        false,

      status:
        'unsupported',
    };
  }

  const registration =
    await navigator.serviceWorker
      .getRegistration(
        '/admin-sw-v2.js',
      );

  const subscription =
    registration
      ? await registration
        .pushManager
        .getSubscription()
      : null;

  if (
    !subscription
  ) {
    return {
      supported:
        true,

      status:
        'not_subscribed',
    };
  }

  const endpoint =
    subscription
      .endpoint;

  await subscription
    .unsubscribe();

  await api(
    '/api/admin/v2/notifications/push/unsubscribe',
    {
      method:
        'POST',

      body:
        JSON.stringify({
          endpoint,
        }),
    },
  );

  return {
    supported:
      true,

    status:
      'unsubscribed',
  };
}

export async function loadAdminNotificationBell(
  {
    unreadOnly = false,
    limit = 50,
  } = {},
) {
  const params =
    new URLSearchParams();

  if (
    unreadOnly
  ) {
    params.set(
      'unread',
      '1',
    );
  }

  params.set(
    'limit',
    String(
      limit,
    ),
  );

  return api(
    `/api/admin/v2/notifications?${
      params.toString()
    }`,
  );
}

export async function markAdminNotificationRead(
  id,
) {
  return api(
    `/api/admin/v2/notifications/${
      id
    }/read`,
    {
      method:
        'POST',
    },
  );
}

export async function resolveAdminNotification(
  id,
) {
  return api(
    `/api/admin/v2/notifications/${
      id
    }/resolve`,
    {
      method:
        'POST',
    },
  );
}

export async function markAllAdminNotificationsRead() {
  return api(
    '/api/admin/v2/notifications/read-all',
    {
      method:
        'POST',
    },
  );
}

export async function sendAdminTestPush() {
  return api(
    '/api/admin/v2/notifications/push/test',
    {
      method:
        'POST',
    },
  );
}
