import {
  fail,
  json,
  readJson,
} from '../lib/http.js';
import { resumeV2Payment } from '../lib/v2-checkout.js';

import {
  deleteV2BriefingUpload,
  getV2CustomerArea,
  saveV2Briefing,
  streamV2BriefingUpload,
  submitV2Briefing,
  updateV2BriefingUpload,
  uploadV2BriefingFile,
} from '../lib/v2-customer-area.js';

function routeError(
  error,
  fallbackStatus = 422,
) {
  return fail(
    error?.message
      || 'Não foi possível atualizar seu pedido.',
    Number(error?.status)
      || fallbackStatus,
    {
      ...(error?.code
        ? { code: error.code }
        : {}),

      ...(error?.details
        ? { details: error.details }
        : {}),
    },
  );
}

export async function handleCustomerAreaV2Api(
  request,
  env,
  url,
) {
  const method =
    request.method.toUpperCase();

  const paymentMatch = url.pathname.match(/^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/payment$/);
  if (paymentMatch && method === 'POST') {
    try { return json(await resumeV2Payment(request, env, paymentMatch[1], await readJson(request))); }
    catch (error) { return routeError(error, 502); }
  }

  const areaMatch =
    url.pathname.match(
      /^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})$/,
    );

  if (
    areaMatch
    && method === 'GET'
  ) {
    const result =
      await getV2CustomerArea(
        env,
        areaMatch[1],
      );

    return result
      ? json({
        ok: true,
        area: result,
      })
      : fail(
        'Pedido não encontrado.',
        404,
      );
  }

  const briefingMatch =
    url.pathname.match(
      /^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/briefing$/,
    );

  if (
    briefingMatch
    && method === 'PATCH'
  ) {
    try {
      const result =
        await saveV2Briefing(
          env,
          briefingMatch[1],
          await readJson(request),
        );

      return result
        ? json({
          ok: true,
          result,
        })
        : fail(
          'Pedido não encontrado.',
          404,
        );
    } catch (error) {
      return routeError(error);
    }
  }

  const uploadCreate =
    url.pathname.match(
      /^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/briefing\/uploads$/,
    );

  if (
    uploadCreate
    && method === 'POST'
  ) {
    try {
      const result =
        await uploadV2BriefingFile(
          request,
          env,
          uploadCreate[1],
        );

      return result
        ? json(
          {
            ok: true,
            result,
          },
          201,
        )
        : fail(
          'Pedido não encontrado.',
          404,
        );
    } catch (error) {
      return routeError(error);
    }
  }

  const uploadMatch =
    url.pathname.match(
      /^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/briefing\/uploads\/(\d+)$/,
    );

  if (
    uploadMatch
    && method === 'PATCH'
  ) {
    try {
      const result =
        await updateV2BriefingUpload(
          env,
          uploadMatch[1],
          Number.parseInt(
            uploadMatch[2],
            10,
          ),
          await readJson(request),
        );

      if (result === null) {
        return fail(
          'Pedido não encontrado.',
          404,
        );
      }

      if (result === false) {
        return fail(
          'Arquivo não encontrado.',
          404,
        );
      }

      return json({
        ok: true,
        result,
      });
    } catch (error) {
      return routeError(error);
    }
  }

  if (
    uploadMatch
    && method === 'DELETE'
  ) {
    try {
      const result =
        await deleteV2BriefingUpload(
          env,
          uploadMatch[1],
          Number.parseInt(
            uploadMatch[2],
            10,
          ),
        );

      if (result === null) {
        return fail(
          'Pedido não encontrado.',
          404,
        );
      }

      if (result === false) {
        return fail(
          'Arquivo não encontrado.',
          404,
        );
      }

      return json({
        ok: true,
        result,
      });
    } catch (error) {
      return routeError(error);
    }
  }

  const contentMatch =
    url.pathname.match(
      /^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/briefing\/uploads\/(\d+)\/content$/,
    );

  if (
    contentMatch
    && method === 'GET'
  ) {
    return streamV2BriefingUpload(
      env,
      contentMatch[1],
      Number.parseInt(
        contentMatch[2],
        10,
      ),
    );
  }

  const submitMatch =
    url.pathname.match(
      /^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/briefing\/submit$/,
    );

  if (
    submitMatch
    && method === 'POST'
  ) {
    try {
      const result =
        await submitV2Briefing(
          env,
          submitMatch[1],
        );

      return result
        ? json({
          ok: true,
          result,
        })
        : fail(
          'Pedido não encontrado.',
          404,
        );
    } catch (error) {
      return routeError(error);
    }
  }

  return null;
}

