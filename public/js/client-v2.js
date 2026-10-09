import {
  errorPage,
  loading,
  pathInfo,
} from './client-v2-core.js';

import {
  startManualOrder,
  startStore,
} from './client-v2-store.js?v=20261009-mobile-briefing-3';

import {
  startCustomerArea,
} from './client-v2-area.js?v=20261009-mobile-briefing-3';

async function bootstrap() {
  const route =
    pathInfo();

  if (
    route.mode
    === 'manual'
  ) {
    await startManualOrder(
      route.token,
    );

    return;
  }

  if (
    route.mode
    === 'area'
  ) {
    await startCustomerArea(
      route.token,
    );

    return;
  }

  await startStore(
    route.productSlug,
  );
}

loading();

bootstrap()
  .catch(
    (error) => {
      const route =
        pathInfo();

      const isCustomerArea =
        route.mode
        === 'area';

      const expiredCustomerArea =
        isCustomerArea
        && error.status === 404;

      errorPage(
        expiredCustomerArea
          ? 'Este pedido não está mais disponível'
          : 'Não conseguimos abrir esta página',
        expiredCustomerArea
          ? 'Se o pagamento não foi concluído dentro do prazo, a reserva expira. Você pode fazer um novo pedido.'
          : (
              error.message
              || 'Tente novamente em alguns instantes.'
            ),
        isCustomerArea
          ? (
              expiredCustomerArea
                ? {
                    actionHref:
                      '/pedido',
                    actionLabel:
                      'Fazer novo pedido',
                  }
                : {
                    actionHref:
                      window.location.href,
                    actionLabel:
                      'Tentar novamente',
                  }
            )
          : undefined,
      );
    },
  );
