import {
  fail,
  json,
  readJson,
} from '../lib/http.js';

import {
  anticipateV2Production,
  getV2AgendaRange,
  getV2CascadeSuggestions,
  releaseV2CascadeSurplus,
  setV2AgendaDay,
  setV2AgendaPeriod,
} from '../lib/v2-agenda-admin.js';

function agendaError(
  error,
  fallbackStatus = 422,
) {
  return fail(
    error
      ?.message
    || 'Não foi possível atualizar a agenda.',
    Number(
      error
        ?.status,
    )
    || fallbackStatus,
    {
      ...(
        error
          ?.code
          ? {
            code:
              error.code,
          }
          : {}
      ),

      ...(
        error
          ?.suggestion
          ? {
            suggestion:
              error.suggestion,
          }
          : {}
      ),
    },
  );
}

export async function handleAdminAgendaV2Api(
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
    method
    === 'GET'
    && path
    === '/api/admin/v2/agenda'
  ) {
    try {
      const agenda =
        await getV2AgendaRange(
          env.DB,
          {
            start:
              url.searchParams
                .get(
                  'start',
                )
              || undefined,

            end:
              url.searchParams
                .get(
                  'end',
                )
              || undefined,
          },
        );

      return json({
        ok:
          true,

        agenda,
      });
    } catch (
      error
    ) {
      return agendaError(
        error,
      );
    }
  }

  const dayMatch =
    path
      .match(
        /^\/api\/admin\/v2\/agenda\/day\/(\d{4}-\d{2}-\d{2})$/,
      );

  if (
    dayMatch
    && method
    === 'PUT'
  ) {
    try {
      const body =
        await readJson(
          request,
        );

      const day =
        await setV2AgendaDay(
          env.DB,
          dayMatch[1],
          body,
        );

      return json({
        ok:
          true,

        day,
      });
    } catch (
      error
    ) {
      return agendaError(
        error,
      );
    }
  }

  if (
    method
    === 'POST'
    && path
    === '/api/admin/v2/agenda/period'
  ) {
    try {
      const body =
        await readJson(
          request,
        );

      const result =
        await setV2AgendaPeriod(
          env.DB,
          {
            start:
              body.start,

            end:
              body.end,

            blocked:
              body.blocked
              === true,

            internalNote:
              body.internalNote
              || '',
          },
        );

      return json({
        ok:
          true,

        result,
      });
    } catch (
      error
    ) {
      return agendaError(
        error,
      );
    }
  }

  if (
    method
    === 'GET'
    && path
    === '/api/admin/v2/agenda/cascade'
  ) {
    return json({
      ok:
        true,

      cascade:
        await getV2CascadeSuggestions(
          env.DB,
        ),
    });
  }

  if (
    method
    === 'POST'
    && path
    === '/api/admin/v2/agenda/cascade/anticipate'
  ) {
    try {
      const body =
        await readJson(
          request,
        );

      const result =
        await anticipateV2Production(
          env.DB,
          {
            sourceOrderCode:
              String(
                body.sourceOrderCode
                || '',
              )
                .trim(),

            targetOrderCode:
              String(
                body.targetOrderCode
                || '',
              )
                .trim(),

            pointsUnits:
              body.pointsUnits
              ?? null,
          },
        );

      return json({
        ok:
          true,

        result,
      });
    } catch (
      error
    ) {
      return agendaError(
        error,
        409,
      );
    }
  }

  if (
    method
    === 'POST'
    && path
    === '/api/admin/v2/agenda/cascade/release'
  ) {
    try {
      const body =
        await readJson(
          request,
        );

      const result =
        await releaseV2CascadeSurplus(
          env.DB,
          {
            sourceOrderCode:
              String(
                body.sourceOrderCode
                || '',
              )
                .trim(),

            force:
              body.force
              === true,
          },
        );

      return json({
        ok:
          true,

        result,
      });
    } catch (
      error
    ) {
      return agendaError(
        error,
        409,
      );
    }
  }

  return null;
}
