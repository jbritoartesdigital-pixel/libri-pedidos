import {
  fail,
  json,
  readJson,
} from '../lib/http.js';

import {
  createV2GalleryItem,
  deleteV2GalleryItem,
  getV2GalleryContent,
  getV2StoreConfig,
  publishV2ContractTemplate,
  publishV2Terms,
  saveV2Combo,
  saveV2Coupon,
  updateV2Addon,
  updateV2GalleryItem,
  updateV2Product,
  updateV2Settings,
  updateV2Variant,
} from '../lib/v2-store-config.js';

function routeError(
  error,
  status = 422,
) {
  return fail(
    error
      ?.message
    || 'Não foi possível salvar esta configuração.',
    status,
  );
}

export async function handleAdminStoreConfigV2Api(
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
    === '/api/admin/v2/store-config'
  ) {
    return json({
      ok:
        true,

      config:
        await getV2StoreConfig(
          env,
        ),
    });
  }

  const productMatch =
    path.match(
      /^\/api\/admin\/v2\/store-config\/products\/([a-z0-9_-]+)$/i,
    );

  if (
    productMatch
    && method
    === 'PATCH'
  ) {
    try {
      const result =
        await updateV2Product(
          env.DB,
          productMatch[1],
          await readJson(
            request,
          ),
        );

      if (!result) {
        return fail(
          'Produto não encontrado.',
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
      return routeError(
        error,
      );
    }
  }

  const variantMatch =
    path.match(
      /^\/api\/admin\/v2\/store-config\/variants\/([a-z0-9_-]+)$/i,
    );

  if (
    variantMatch
    && method
    === 'PATCH'
  ) {
    try {
      const result =
        await updateV2Variant(
          env.DB,
          variantMatch[1],
          await readJson(
            request,
          ),
        );

      if (!result) {
        return fail(
          'Configuração do produto não encontrada.',
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
      return routeError(
        error,
      );
    }
  }

  const addonMatch =
    path.match(
      /^\/api\/admin\/v2\/store-config\/addons\/([a-z0-9_-]+)$/i,
    );

  if (
    addonMatch
    && method
    === 'PATCH'
  ) {
    try {
      const result =
        await updateV2Addon(
          env.DB,
          addonMatch[1],
          await readJson(
            request,
          ),
        );

      if (!result) {
        return fail(
          'Adicional não encontrado.',
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
      return routeError(
        error,
      );
    }
  }

  const comboMatch =
    path.match(
      /^\/api\/admin\/v2\/store-config\/combos\/([a-z0-9_-]+)$/i,
    );

  if (
    comboMatch
    && method
    === 'PUT'
  ) {
    try {
      return json({
        ok:
          true,

        result:
          await saveV2Combo(
            env.DB,
            comboMatch[1],
            await readJson(
              request,
            ),
          ),
      });
    } catch (
      error
    ) {
      return routeError(
        error,
      );
    }
  }

  const couponMatch =
    path.match(
      /^\/api\/admin\/v2\/store-config\/coupons\/([a-z0-9_-]+)$/i,
    );

  if (
    couponMatch
    && method
    === 'PUT'
  ) {
    try {
      return json({
        ok:
          true,

        result:
          await saveV2Coupon(
            env.DB,
            couponMatch[1],
            await readJson(
              request,
            ),
          ),
      });
    } catch (
      error
    ) {
      return routeError(
        error,
      );
    }
  }

  if (
    method
    === 'PATCH'
    && path
    === '/api/admin/v2/store-config/settings'
  ) {
    try {
      const body =
        await readJson(
          request,
        );

      return json({
        ok:
          true,

        result:
          await updateV2Settings(
            env.DB,
            body.values
            || body,
          ),
      });
    } catch (
      error
    ) {
      return routeError(
        error,
      );
    }
  }

  if (
    method
    === 'POST'
    && path
    === '/api/admin/v2/store-config/gallery'
  ) {
    try {
      return json(
        {
          ok:
            true,

          result:
            await createV2GalleryItem(
              request,
              env,
            ),
        },
        201,
      );
    } catch (
      error
    ) {
      return routeError(
        error,
      );
    }
  }

  const galleryMatch =
    path.match(
      /^\/api\/admin\/v2\/store-config\/gallery\/(\d+)$/,
    );

  if (
    galleryMatch
    && method
    === 'PATCH'
  ) {
    try {
      const result =
        await updateV2GalleryItem(
          env.DB,
          galleryMatch[1],
          await readJson(
            request,
          ),
        );

      if (!result) {
        return fail(
          'Item da galeria não encontrado.',
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
      return routeError(
        error,
      );
    }
  }

  if (
    galleryMatch
    && method
    === 'DELETE'
  ) {
    try {
      const result =
        await deleteV2GalleryItem(
          env,
          galleryMatch[1],
        );

      if (!result) {
        return fail(
          'Item da galeria não encontrado.',
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
      return routeError(
        error,
      );
    }
  }

  const galleryContentMatch =
    path.match(
      /^\/api\/admin\/v2\/store-config\/gallery\/(\d+)\/(media|preview)$/,
    );

  if (
    galleryContentMatch
    && method
    === 'GET'
  ) {
    const response =
      await getV2GalleryContent(
        env,
        galleryContentMatch[1],
        galleryContentMatch[2],
      );

    if (!response) {
      return fail(
        'Mídia não encontrada.',
        404,
      );
    }

    return response;
  }

  if (
    method
    === 'POST'
    && path
    === '/api/admin/v2/store-config/terms/publish'
  ) {
    try {
      const body =
        await readJson(
          request,
        );

      return json(
        {
          ok:
            true,

          result:
            await publishV2Terms(
              env.DB,
              body,
            ),
        },
        201,
      );
    } catch (
      error
    ) {
      return routeError(
        error,
        409,
      );
    }
  }

  if (
    method
    === 'POST'
    && path
    === '/api/admin/v2/store-config/contract-templates/publish'
  ) {
    try {
      const body =
        await readJson(
          request,
        );

      return json(
        {
          ok:
            true,

          result:
            await publishV2ContractTemplate(
              env.DB,
              body,
            ),
        },
        201,
      );
    } catch (
      error
    ) {
      return routeError(
        error,
        409,
      );
    }
  }

  return null;
}
