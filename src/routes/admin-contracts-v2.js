import {
  fail,
  json,
} from '../lib/http.js';

import {
  cancelV2Contract,
  downloadV2ContractPdfForAdmin,
  generateV2Contract,
  listV2ContractsForAdmin,
  signV2ContractByLibri,
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
    },
  );
}

export async function handleAdminContractsV2Api(
  request,
  env,
  url,
) {
  const method =
    request.method
      .toUpperCase();

  const path =
    url.pathname;

  const orderMatch =
    path.match(
      /^\/api\/admin\/v2\/orders\/(LIBRI-\d+)\/contracts$/,
    );

  if (
    orderMatch
    && method
    === 'GET'
  ) {
    const result =
      await listV2ContractsForAdmin(
        env.DB,
        orderMatch[1],
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

  if (
    orderMatch
    && method
    === 'POST'
  ) {
    try {
      const result =
        await generateV2Contract(
          env,
          orderMatch[1],
        );

      if (!result) {
        return fail(
          'Pedido não encontrado.',
          404,
        );
      }

      return json(
        {
          ok:
            true,

          result,
        },
        201,
      );
    } catch (
      error
    ) {
      return contractError(
        error,
        409,
      );
    }
  }

  const signMatch =
    path.match(
      /^\/api\/admin\/v2\/contracts\/(\d+)\/sign-libri$/,
    );

  if (
    signMatch
    && method
    === 'POST'
  ) {
    try {
      const result =
        await signV2ContractByLibri(
          request,
          env,
          Number.parseInt(
            signMatch[1],
            10,
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

  const cancelMatch =
    path.match(
      /^\/api\/admin\/v2\/contracts\/(\d+)\/cancel$/,
    );

  if (
    cancelMatch
    && method
    === 'POST'
  ) {
    try {
      const result =
        await cancelV2Contract(
          env,
          Number.parseInt(
            cancelMatch[1],
            10,
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
      /^\/api\/admin\/v2\/contracts\/(\d+)\/pdf$/,
    );

  if (
    pdfMatch
    && method
    === 'GET'
  ) {
    return downloadV2ContractPdfForAdmin(
      env,
      Number.parseInt(
        pdfMatch[1],
        10,
      ),
    );
  }

  return null;
}
