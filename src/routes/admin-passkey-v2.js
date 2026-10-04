import {
  fail,
  json,
  readJson,
} from '../lib/http.js';

import {
  beginAdminPasskeyAuthentication,
  beginAdminPasskeyRegistration,
  getAdminPasskeyStatus,
  listAdminPasskeyDevices,
  logoutAdminPasskeySession,
  revokeAdminPasskeyDevice,
  verifyAdminPasskeyAuthentication,
  verifyAdminPasskeyRegistration,
} from '../lib/v2-admin-passkey.js';

function authError(
  error,
  fallbackStatus = 422,
) {
  return fail(
    error
      ?.message
    || 'Não foi possível concluir a autenticação.',
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
    },
  );
}

export async function handleAdminPasskeyV2Api(
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
    path
    === '/api/admin/v2/auth/status'
    && method
    === 'GET'
  ) {
    return json({
      ok:
        true,

      auth:
        await getAdminPasskeyStatus(
          request,
          env,
        ),
    });
  }

  if (
    path
    === '/api/admin/v2/auth/authentication/options'
    && method
    === 'POST'
  ) {
    try {
      return json({
        ok:
          true,

        result:
          await beginAdminPasskeyAuthentication(
            request,
            env,
          ),
      });
    } catch (
      error
    ) {
      return authError(
        error,
      );
    }
  }

  if (
    path
    === '/api/admin/v2/auth/authentication/verify'
    && method
    === 'POST'
  ) {
    try {
      return verifyAdminPasskeyAuthentication(
        request,
        env,
        await readJson(
          request,
        ),
      );
    } catch (
      error
    ) {
      return authError(
        error,
        401,
      );
    }
  }

  if (
    path
    === '/api/admin/v2/auth/registration/options'
    && method
    === 'POST'
  ) {
    try {
      return json({
        ok:
          true,

        result:
          await beginAdminPasskeyRegistration(
            request,
            env,
            await readJson(
              request,
            ),
          ),
      });
    } catch (
      error
    ) {
      return authError(
        error,
      );
    }
  }

  if (
    path
    === '/api/admin/v2/auth/registration/verify'
    && method
    === 'POST'
  ) {
    try {
      return verifyAdminPasskeyRegistration(
        request,
        env,
        await readJson(
          request,
        ),
      );
    } catch (
      error
    ) {
      return authError(
        error,
        401,
      );
    }
  }

  if (
    path
    === '/api/admin/v2/auth/devices'
    && method
    === 'GET'
  ) {
    const result =
      await listAdminPasskeyDevices(
        request,
        env,
      );

    if (!result) {
      return fail(
        'Não autorizado.',
        401,
        {
          code:
            'admin_passkey_required',
        },
      );
    }

    return json({
      ok:
        true,

      result,
    });
  }

  const revokeMatch =
    path
      .match(
        /^\/api\/admin\/v2\/auth\/devices\/(\d+)\/revoke$/,
      );

  if (
    revokeMatch
    && method
    === 'POST'
  ) {
    try {
      const result =
        await revokeAdminPasskeyDevice(
          request,
          env,
          Number.parseInt(
            revokeMatch[1],
            10,
          ),
        );

      if (!result) {
        return fail(
          'Passkey não encontrada.',
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
      return authError(
        error,
        409,
      );
    }
  }

  if (
    path
    === '/api/admin/v2/auth/logout'
    && method
    === 'POST'
  ) {
    try {
      return logoutAdminPasskeySession(
        request,
        env,
      );
    } catch (
      error
    ) {
      return authError(
        error,
      );
    }
  }

  return null;
}
