import {
  fail,
  json,
} from '../lib/http.js';

import {
  getV2FinanceDashboard,
  getV2FinanceSummary,
} from '../lib/v2-finance.js';

function filtersFromUrl(
  url,
) {
  return {
    preset:
      url.searchParams
        .get(
          'preset',
        )
      || 'this_month',

    start:
      url.searchParams
        .get(
          'start',
        )
      || '',

    end:
      url.searchParams
        .get(
          'end',
        )
      || '',

    q:
      url.searchParams
        .get(
          'q',
        )
      || '',

    method:
      url.searchParams
        .get(
          'method',
        )
      || '',

    provider:
      url.searchParams
        .get(
          'provider',
        )
      || '',

    limit:
      url.searchParams
        .get(
          'limit',
        )
      || 50,

    offset:
      url.searchParams
        .get(
          'offset',
        )
      || 0,
  };
}

export async function handleAdminFinanceV2Api(
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
    === '/api/admin/v2/finance'
  ) {
    try {
      return json({
        ok:
          true,

        finance:
          await getV2FinanceDashboard(
            env.DB,
            filtersFromUrl(
              url,
            ),
          ),
      });
    } catch (
      error
    ) {
      return fail(
        error
          ?.message
        || 'Não foi possível carregar o financeiro.',
        422,
      );
    }
  }

  if (
    method
    === 'GET'
    && path
    === '/api/admin/v2/finance/summary'
  ) {
    try {
      return json({
        ok:
          true,

        finance:
          await getV2FinanceSummary(
            env.DB,
            filtersFromUrl(
              url,
            ),
          ),
      });
    } catch (
      error
    ) {
      return fail(
        error
          ?.message
        || 'Não foi possível carregar o resumo financeiro.',
        422,
      );
    }
  }

  return null;
}
