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
  handleAdminWorkflowV2Api,
} from './routes/admin-workflow-v2.js';

import {
  handleAdminApi,
} from './routes/admin.js';

import {
  handlePublicV2Api,
} from './routes/public-v2.js';

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

          const workflowV2Response =
            await handleAdminWorkflowV2Api(
              request,
              env,
              url,
            );

          if (
            workflowV2Response
          ) {
            return workflowV2Response;
          }

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
           API PÚBLICA V2

           As rotas novas ficam isoladas
           em /api/v2/* e não interferem
           com o checkout antigo.
        ================================================== */

        if (
          url.pathname
            .startsWith(
              '/api/v2/',
            )
        ) {
          const publicV2Response =
            await handlePublicV2Api(
              request,
              env,
              url,
            );

          return publicV2Response
            || fail(
              'Rota V2 não encontrada.',
              404,
            );
        }

        /* ==================================================
           API PÚBLICA V1
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
