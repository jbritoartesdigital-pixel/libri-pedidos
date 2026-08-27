import {
  fail,
  json,
} from './lib/http.js';

import {
  handleAdminAuthApi,
  requireAdminAuth,
} from './routes/admin-auth.js';

import {
  handleAdminEditApi,
} from './routes/admin-edit.js';

import {
  handleAdminManualApi,
} from './routes/admin-manual.js';

import {
  handleAdminApi,
} from './routes/admin.js';

import {
  handlePublicApi,
} from './routes/public.js';

/* ==================================================
   LIBRI CONVITES
   PORTAL DE PEDIDOS
   WORKER PRINCIPAL
================================================== */

export default {
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
           AUTENTICAÇÃO ADMIN

           Login, logout e status precisam
           funcionar antes do bloqueio geral
           das rotas administrativas.
        ================================================== */

        if (
          url.pathname
            .startsWith(
              '/api/admin/auth/',
            )
        ) {
          const authResponse =
            await handleAdminAuthApi(
              request,
              env,
              url,
            );

          return authResponse
            || fail(
              'Rota de autenticação não encontrada.',
              404,
            );
        }

        /* ==================================================
           ÁREA ADMINISTRATIVA
        ================================================== */

        if (
          url.pathname
            .startsWith(
              '/api/admin/',
            )
        ) {
          /*
           * Todas as APIs administrativas,
           * exceto login/logout/status,
           * exigem sessão válida.
           */
          const authFailure =
            await requireAdminAuth(
              request,
              env,
            );

          if (
            authFailure
          ) {
            return authFailure;
          }

          /* ==================================================
             EDITAR PEDIDO
          ================================================== */

          const editResponse =
            await handleAdminEditApi(
              request,
              env,
              url,
            );

          if (
            editResponse
          ) {
            return editResponse;
          }

          /* ==================================================
             PEDIDO MANUAL VIA WHATSAPP
          ================================================== */

          const manualResponse =
            await handleAdminManualApi(
              request,
              env,
              url,
            );

          if (
            manualResponse
          ) {
            return manualResponse;
          }

          /* ==================================================
             ADMIN EXISTENTE
          ================================================== */

          const adminResponse =
            await handleAdminApi(
              request,
              env,
              url,
            );

          return adminResponse
            || fail(
              'Rota administrativa não encontrada.',
              404,
            );
        }

        /* ==================================================
           API PÚBLICA
        ================================================== */

        const publicResponse =
          await handlePublicApi(
            request,
            env,
            url,
          );

        return publicResponse
          || fail(
            'Rota não encontrada.',
            404,
          );
      } catch (
        error
      ) {
        console.error(
          'API error',
          error,
        );

        return json(
          {
            ok:
              false,

            error:
              'Não foi possível concluir esta ação agora.',

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
        );
      }
    }

    /* ==================================================
       ARQUIVOS ESTÁTICOS
    ================================================== */

    return env.ASSETS.fetch(
      request,
    );
  },
};
