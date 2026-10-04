import {
  fail,
  json,
  readJson,
} from '../lib/http.js';

import {
  downloadV2ContractPdfForCustomer,
  listV2ContractsForCustomer,
  signV2ContractByCustomer,
} from '../lib/v2-contracts.js';

function contractError(
  error,
  status = 422,
) {
  return fail(
    error
      ?.message
    || 'Não foi possível atualizar o contrato.',
    Number(
      error
        ?.status,
    )
    || status,
  );
}

export async function handleCustomerContractsV2Api(
  request,
  env,
  url,
) {
  const method =
    request.method
      .toUpperCase();

  const path =
    url.pathname;

  const listMatch =
    path.match(
      /^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/contracts$/,
    );

  if (
    listMatch
    && method
    === 'GET'
  ) {
    const result =
      await listV2ContractsForCustomer(
        env.DB,
        listMatch[1],
      );

    if (!result) {
      return fail(
        'Pedido não encontrado.',
        404,
      );
    }

    return json({
      ok:
        true,

      result,
    });
  }

  const signMatch =
    path.match(
      /^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/contracts\/(\d+)\/sign$/,
    );

  if (
    signMatch
    && method
    === 'POST'
  ) {
    try {
      const result =
        await signV2ContractByCustomer(
          request,
          env,
          signMatch[1],
          Number.parseInt(
            signMatch[2],
            10,
          ),
          await readJson(
            request,
          ),
        );

      if (!result) {
        return fail(
          'Contrato não encontrado.',
          404,
        );
      }

      return json({
        ok:
          true,

        result,
      });
    } catch (
      error
    ) {
      return contractError(
        error,
        409,
      );
    }
  }

  const pdfMatch =
    path.match(
      /^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/contracts\/(\d+)\/pdf$/,
    );

  if (
    pdfMatch
    && method
    === 'GET'
  ) {
    return downloadV2ContractPdfForCustomer(
      env,
      pdfMatch[1],
      Number.parseInt(
        pdfMatch[2],
        10,
      ),
    );
  }

  return null;
}
