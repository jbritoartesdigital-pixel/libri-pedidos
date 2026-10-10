import {
  fail,
  json,
} from './lib/http.js';

/* ==================================================
   ADMIN V2 | PASSKEY
================================================== */

import {
  requireAdminPasskeyAuth,
} from './lib/v2-admin-passkey.js';

import {
  handleAdminPasskeyV2Api,
} from './routes/admin-passkey-v2.js';

import {
  handleAdminV2CoreApi,
} from './routes/admin-v2-core.js';

import {
  handleAdminAgendaV2Api,
} from './routes/admin-agenda-v2.js';

import {
  handleAdminFinanceV2Api,
} from './routes/admin-finance-v2.js';

import {
  handleAdminNotificationsV2Api,
} from './routes/admin-notifications-v2.js';

import {
  handleAdminOrderZipV2Api,
} from './routes/admin-order-zip-v2.js';

import {
  handleAdminOrdersV2Api,
} from './routes/admin-orders-v2.js';

import { handleAdminDriveFolderV2Api } from './routes/admin-drive-folder-v2.js';

import {
  handleAdminStoreConfigV2Api,
} from './routes/admin-store-config-v2.js';

import {
  handleAdminContractsV2Api,
} from './routes/admin-contracts-v2.js';

/* ==================================================
   CLIENTE V2
================================================== */

import {
  handlePublicV2Api,
} from './routes/public-v2.js';

import {
  handlePublicManualOrderV2Api,
} from './routes/public-manual-order-v2.js';

import {
  handleCustomerAreaV2Api,
} from './routes/customer-area-v2.js';

import {
  handleCustomerPreviewV2Api,
} from './routes/customer-preview-v2.js';

import {
  handleCustomerContractsV2Api,
} from './routes/customer-contracts-v2.js';

import { runV2Scheduler } from './lib/v2-scheduler.js';

/* ==================================================
   LIBRI CONVITES
   PORTAL DE PEDIDOS
   WORKER PRINCIPAL
================================================== */

const V2_PRODUCT_PATHS =
  new Set([
    '/pedido/cinematografico-video',
    '/pedido/cinematografico-interativo',
    '/pedido/interativo',
    '/pedido/interativo-animado',
    '/pedido/interativo-gif',
    '/pedido/livro',
    '/pedido/infinito',
  ]);

function isClientV2Page(
  pathname,
) {
  if (
    pathname === '/pedido'
    || pathname === '/pedido/'
  ) {
    return true;
  }

  const normalized =
    pathname.endsWith('/')
      ? pathname.slice(
        0,
        -1,
      )
      : pathname;

  if (
    V2_PRODUCT_PATHS.has(
      normalized,
    )
  ) {
    return true;
  }

  if (
    /^\/pedido\/manual\/ord_[a-f0-9]{36}\/?$/
      .test(
        pathname,
      )
  ) {
    return true;
  }

  return /^\/meu-pedido\/ord_[a-f0-9]{36}\/?$/
    .test(
      pathname,
    );
}

function isAdminV2Page(
  pathname,
) {
  return pathname === '/admin-v2'
    || pathname === '/admin-v2/';
}

function redirectTo(
  request,
  pathname,
) {
  const target =
    new URL(
      request.url,
    );

  target.pathname =
    pathname;

  target.search = '';

  return Response.redirect(
    target.toString(),
    308,
  );
}

function isLegacyPublicApi(
  pathname,
) {
  return (
    pathname === '/api/catalog'
    || pathname === '/api/terms/current'
    || pathname === '/api/quote'
    || pathname === '/api/orders'
    || pathname.startsWith('/api/orders/')
    || pathname === '/api/drafts'
    || pathname.startsWith('/api/drafts/')
  );
}

async function serveStaticShell(
  request,
  env,
  assetPath,
) {
  if (
    request.method !== 'GET'
    && request.method !== 'HEAD'
  ) {
    return fail(
      'Método não permitido.',
      405,
    );
  }

  const assetUrl =
    new URL(
      request.url,
    );

  assetUrl.pathname =
    assetPath;

  assetUrl.search = '';

  const assetRequest =
    new Request(
      assetUrl.toString(),
      {
        method:
          'GET',

        headers:
          request.headers,
      },
    );

  const response =
    await env.ASSETS.fetch(
      assetRequest,
    );

  const headers =
    new Headers(
      response.headers,
    );

  headers.set(
    'cache-control',
    'no-store, max-age=0',
  );

  headers.set(
    'x-content-type-options',
    'nosniff',
  );

  if (
    request.method === 'HEAD'
  ) {
    return new Response(
      null,
      {
        status:
          response.status,

        statusText:
          response.statusText,

        headers,
      },
    );
  }

  return new Response(
    response.body,
    {
      status:
        response.status,

      statusText:
        response.statusText,

      headers,
    },
  );
}

// Encapsula apenas falhas 5xx administrativas. Não registra dados, body ou URL do pedido.
function withAdminErrorId(response) {
  if (response.status < 500 || response.headers.has('x-libri-error-id')) {
    return response;
  }
  const errorId = 'ERR-' + crypto.randomUUID()
    .replace(/-/g, '').slice(0, 12).toUpperCase();
  console.error('Admin V2 HTTP failure', errorId, 'status', response.status);
  const headers = new Headers(response.headers);
  headers.set('x-libri-error-id', errorId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleAdminV2Api(
  request,
  env,
  url,
) {
  /*
   * As rotas de autenticação precisam estar acessíveis
   * antes da proteção geral. Cada rota sensível dentro
   * de /auth valida a própria sessão quando necessário.
   */
  if (
    url.pathname
      .startsWith(
        '/api/admin/v2/auth/',
      )
  ) {
    const authResponse =
      await handleAdminPasskeyV2Api(
        request,
        env,
        url,
      );

    return authResponse
      || fail(
        'Rota de autenticação V2 não encontrada.',
        404,
      );
  }

  const authFailure =
    await requireAdminPasskeyAuth(
      request,
      env,
    );

  if (
    authFailure
  ) {
    return authFailure;
  }

  const handlers = [
    handleAdminV2CoreApi,
    handleAdminAgendaV2Api,
    handleAdminFinanceV2Api,
    handleAdminNotificationsV2Api,
    handleAdminOrderZipV2Api,
    handleAdminDriveFolderV2Api,
    handleAdminOrdersV2Api,
    handleAdminStoreConfigV2Api,
    handleAdminContractsV2Api,
  ];

  for (
    const handler
    of handlers
  ) {
    const response =
      await handler(
        request,
        env,
        url,
      );

    if (
      response
    ) {
      return response;
    }
  }

  return fail(
    'Rota administrativa V2 não encontrada.',
    404,
  );
}

async function handleCustomerV2Api(
  request,
  env,
  url,
) {
  /*
   * As rotas mais específicas vêm antes do núcleo público
   * para evitar que a área privada fique acoplada ao checkout.
   */
  const handlers = [
    handleCustomerAreaV2Api,
    handleCustomerPreviewV2Api,
    handleCustomerContractsV2Api,
    handlePublicManualOrderV2Api,
    handlePublicV2Api,
  ];

  for (
    const handler
    of handlers
  ) {
    const response =
      await handler(
        request,
        env,
        url,
      );

    if (
      response
    ) {
      return response;
    }
  }

  return fail(
    'Rota V2 não encontrada.',
    404,
  );
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runV2Scheduler(env).then(result => {
      console.log('V2 scheduler', JSON.stringify(result));
    }));
  },
  async fetch(
    request,
    env,
    ctx,
  ) {
    const url =
      new URL(
        request.url,
      );

    /* ==================================================
       API
    ================================================== */

    if (
      url.pathname
        .startsWith(
          '/api/',
        )
    ) {
      try {
        /* ==================================================
           ADMIN V2
        ================================================== */

        if (
          url.pathname
            .startsWith(
              '/api/admin/v2/',
            )
        ) {
          return withAdminErrorId(await handleAdminV2Api(
            request,
            env,
            url,
          ));
        }

        /* ==================================================
           ADMIN V1 | APOSENTADO
        ================================================== */

        if (
          url.pathname
            .startsWith(
              '/api/admin/',
            )
        ) {
          return fail(
            'O Admin antigo foi aposentado. Use /admin-v2.',
            410,
            {
              redirect:
                '/admin-v2',
            },
          );
        }

        /* ==================================================
           CLIENTE / PÚBLICO V2
        ================================================== */

        if (
          url.pathname
            .startsWith(
              '/api/v2/',
            )
        ) {
          return await handleCustomerV2Api(
            request,
            env,
            url,
          );
        }

        /* ==================================================
           PÚBLICO V1 | APOSENTADO
        ================================================== */

        if (
          isLegacyPublicApi(
            url.pathname,
          )
        ) {
          return fail(
            'O portal antigo foi aposentado. Use /pedido.',
            410,
            {
              redirect:
                '/pedido',
            },
          );
        }

        return fail(
          'Rota não encontrada.',
          404,
        );
      } catch (
        error
      ) {
        // ID não contém dados pessoais. Permite correlacionar o relatório
        // do Admin com uma falha inesperada nos logs do Cloudflare.
        const errorId = 'ERR-' + crypto.randomUUID()
          .replace(/-/g, '').slice(0, 12).toUpperCase();
        console.error('API error', errorId, error);

        return json(
          {
            ok:
              false,

            error:
              'Não foi possível concluir esta ação agora.',

            errorId,

            devMessage:
              env.ENVIRONMENT
                === 'development'
                ? String(
                  error?.stack
                  || error,
                )
                : undefined,
          },
          500,
          { 'x-libri-error-id': errorId },
        );
      }
    }

    /* ==================================================
       REDIRECIONAMENTOS DO PORTAL LEGADO
    ================================================== */

    if (
      [
        '/',
        '/index.html',
      ].includes(
        url.pathname,
      )
    ) {
      return redirectTo(
        request,
        '/pedido',
      );
    }

    if (
      [
        '/admin',
        '/admin/',
        '/admin.html',
      ].includes(
        url.pathname,
      )
    ) {
      return redirectTo(
        request,
        '/admin-v2',
      );
    }

    /* ==================================================
       SHELL VISUAL V2
    ================================================== */

    if (
      isAdminV2Page(
        url.pathname,
      )
    ) {
      return serveStaticShell(
        request,
        env,
        '/admin-v2.html',
      );
    }

    if (
      isClientV2Page(
        url.pathname,
      )
    ) {
      return serveStaticShell(
        request,
        env,
        '/client-v2.html',
      );
    }

    /* ==================================================
       ARQUIVOS ESTÁTICOS
    ================================================== */

    return env.ASSETS.fetch(
      request,
    );
  },
};

