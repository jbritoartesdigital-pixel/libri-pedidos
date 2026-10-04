import {
  errorPage,
  loading,
  pathInfo,
} from './client-v2-core.js';

import {
  startManualOrder,
  startStore,
} from './client-v2-store.js';

import {
  startCustomerArea,
} from './client-v2-area.js';

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
      errorPage(
        'Não conseguimos abrir esta página',
        error.message
        || 'Tente novamente em alguns instantes.',
      );
    },
  );
