import {
  fail,
  json,
  readJson,
} from '../lib/http.js';

import {
  getV2ManualOrderForCustomer,
  startV2ManualOrderPayment,
} from '../lib/v2-orders-manual.js';
import {
  getManualClientAddonOffer,
  quoteManualClientAddons,
} from '../lib/v2-manual-client-addons.js';
import { statusManualBlackLibri, revealManualBlackLibri, previewManualBlackLibri } from '../lib/v2-black-libri-manual.js';

function routeError(
  error,
  status = 422,
) {
  return fail(
    error
      ?.message
    || 'Não foi possível continuar este pedido.',
    status,
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

export async function handlePublicManualOrderV2Api(
  request,
  env,
  url,
) {
  const method =
    request.method
      .toUpperCase();

  const summaryMatch =
    url.pathname
      .match(
        /^\/api\/v2\/manual-order\/(ord_[a-f0-9]{36})$/,
      );

  if (
    summaryMatch
    && method
    === 'GET'
  ) {
    const order =
      await getV2ManualOrderForCustomer(
        env.DB,
        summaryMatch[1],
      );

    if (!order) {
      return fail(
        'Pedido não encontrado.',
        404,
      );
    }

    return json({
      ok:
        true,

      order,
      addonOffer: await getManualClientAddonOffer(env.DB, order),
    });
  }

  // Pedido manual: o token privado encontra o WhatsApp salvo no servidor.
  // A cliente não precisa repetir telefone nem criar outro pedido.
  const blackMatch=url.pathname.match(
    /^\/api\/v2\/manual-order\/(ord_[a-f0-9]{36})\/black-libri\/(status|reveal|preview)$/
  );
  if(blackMatch && method==='POST') {
    try {
      const [,token,action]=blackMatch;
      if(action==='status') return json(await statusManualBlackLibri(env,token));
      if(action==='reveal') return json(await revealManualBlackLibri(env,token));
      return json(await previewManualBlackLibri(env,token,await readJson(request)));
    } catch(error) {
      return routeError(error,error?.status||422);
    }
  }

  const addonQuoteMatch = url.pathname.match(
    /^\/api\/v2\/manual-order\/(ord_[a-f0-9]{36})\/addons\/quote$/,
  );
  if (addonQuoteMatch && method === 'POST') {
    try {
      const order = await getV2ManualOrderForCustomer(env.DB, addonQuoteMatch[1]);
      if (!order) return fail('Pedido não encontrado.', 404);
      const body = await readJson(request);
      const quote = await quoteManualClientAddons(env.DB, order, body.addonCodes, {
        productCode: body.productCode, variantCode: body.variantCode,
      });
      const { _additions, ...result } = quote;
      return json({ ok: true, result });
    } catch (error) {
      return routeError(error, error.status || 422);
    }
  }

  const payMatch =
    url.pathname
      .match(
        /^\/api\/v2\/manual-order\/(ord_[a-f0-9]{36})\/start-payment$/,
      );

  if (
    payMatch
    && method
    === 'POST'
  ) {
    try {
      const body =
        await readJson(
          request,
        );

      const result =
        await startV2ManualOrderPayment(
          request,
          env,
          payMatch[1],
          body,
        );

      return json({
        ok:
          true,

        result,
      });
    } catch (
      error
    ) {
      return routeError(
        error,
        error?.status || (error?.code === 'delivery_window_unavailable' ? 409 : 422),
      );
    }
  }

  return null;
}
