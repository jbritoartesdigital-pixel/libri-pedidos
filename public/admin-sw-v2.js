self.addEventListener(
  'push',
  (event) => {
    let payload = {};

    try {
      payload =
        event.data
          ? event.data.json()
          : {};
    } catch {
      payload = {
        title:
          'Libri Convites',

        body:
          'Você recebeu uma nova notificação.',
      };
    }

    const title =
      payload.title
      || 'Libri Convites';

    const options = {
      body:
        payload.body
        || '',

      tag:
        payload.tag
        || undefined,

      data: {
        url:
          payload.url
          || '/admin-v2',
      },
    };

    event.waitUntil(
      self.registration
        .showNotification(
          title,
          options,
        ),
    );
  },
);

self.addEventListener(
  'notificationclick',
  (event) => {
    event.notification
      .close();

    const path =
      event.notification
        .data
        ?.url
      || '/admin-v2';

    const target =
      new URL(
        path,
        self.location
          .origin,
      )
        .href;

    event.waitUntil(
      self.clients
        .matchAll({
          type:
            'window',

          includeUncontrolled:
            true,
        })
        .then(
          async (
            clients,
          ) => {
            const existing =
              clients.find(
                (client) => {
                  try {
                    return new URL(
                      client.url,
                    )
                      .pathname
                      === new URL(
                        target,
                      )
                        .pathname;
                  } catch {
                    return false;
                  }
                },
              );

            if (
              existing
            ) {
              await existing
                .focus();

              return existing
                .navigate(
                  target,
                );
            }

            return self.clients
              .openWindow(
                target,
              );
          },
        ),
    );
  },
);
