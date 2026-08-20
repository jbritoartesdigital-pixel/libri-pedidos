import { fail, json } from './lib/http.js';
import { handleAdminManualApi } from './routes/admin-manual.js';
import { handleAdminApi } from './routes/admin.js';
import { handlePublicApi } from './routes/public.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        if (url.pathname.startsWith('/api/admin/')) {
          // PRODUÇÃO: proteja /api/admin/* com Cloudflare Access, junto com /admin/*.

          const manualResponse =
            await handleAdminManualApi(
              request,
              env,
              url,
            );

          if (manualResponse) {
            return manualResponse;
          }

          const response =
            await handleAdminApi(
              request,
              env,
              url,
            );

          return response
            || fail(
              'Rota administrativa não encontrada.',
              404,
            );
        }

        const response =
          await handlePublicApi(
            request,
            env,
            url,
          );

        return response
          || fail(
            'Rota não encontrada.',
            404,
          );
      } catch (error) {
        console.error(
          'API error',
          error,
        );

        return json(
          {
            ok: false,
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

    return env.ASSETS.fetch(
      request,
    );
  },
};
