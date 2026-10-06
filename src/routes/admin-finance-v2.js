import {
  fail,
  json,
  readJson,
} from '../lib/http.js';

import {
  createV2FinancePayment,
  getV2FinanceDashboard,
  getV2FinanceSummary,
  updateV2FinancePayment,
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
    === 'POST'
    && path
    === '/api/admin/v2/finance/payments'
  ) {
    try {
      return json(
        {
          ok:
            true,
          result:
            await createV2FinancePayment(
              env.DB,
              await readJson(
                request,
              ),
            ),
        },
        201,
      );
    } catch (
      error
    ) {
      return fail(
        error
          ?.message
        || 'Não foi possível adicionar o lançamento.',
        422,
      );
    }
  }

  const paymentMatch =
    path.match(
      /^\/api\/admin\/v2\/finance\/payments\/(\d+)$/,
    );

  if (
    paymentMatch
    && method
    === 'PATCH'
  ) {
    try {
      return json({
        ok:
          true,

        result:
          await updateV2FinancePayment(
            env.DB,
            paymentMatch[1],
            await readJson(
              request,
            ),
          ),
      });
    } catch (
      error
    ) {
      return fail(
        error
          ?.message
        || 'Não foi possível corrigir este lançamento.',
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
