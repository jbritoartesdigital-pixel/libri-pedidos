import {
  fail,
  json,
  readJson,
} from '../lib/http.js';

/* ==================================================
   CONFIGURAÇÃO
================================================== */

const COOKIE_NAME =
  'libri_admin_session';

const SESSION_HOURS =
  12;

const SESSION_SECONDS =
  SESSION_HOURS
  * 60
  * 60;

/* ==================================================
   ENCODING
================================================== */

function bytesToBase64Url(
  bytes,
) {
  let binary = '';

  for (
    let i = 0;
    i < bytes.length;
    i += 1
  ) {
    binary +=
      String.fromCharCode(
        bytes[i],
      );
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBytes(
  value,
) {
  const normalized =
    String(value || '')
      .replace(/-/g, '+')
      .replace(/_/g, '/');

  const padded =
    normalized
    + '='.repeat(
      (
        4
        - (
          normalized.length
          % 4
        )
      )
      % 4,
    );

  const binary =
    atob(padded);

  const bytes =
    new Uint8Array(
      binary.length,
    );

  for (
    let i = 0;
    i < binary.length;
    i += 1
  ) {
    bytes[i] =
      binary.charCodeAt(i);
  }

  return bytes;
}

function textToBase64Url(
  value,
) {
  return bytesToBase64Url(
    new TextEncoder()
      .encode(
        String(value),
      ),
  );
}

function base64UrlToText(
  value,
) {
  return new TextDecoder()
    .decode(
      base64UrlToBytes(
        value,
      ),
    );
}

/* ==================================================
   CRYPTO
================================================== */

async function sha256(
  value,
) {
  return new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',

      new TextEncoder()
        .encode(
          String(value),
        ),
    ),
  );
}

function constantTimeEqualBytes(
  a,
  b,
) {
  if (
    !(a instanceof Uint8Array)
    || !(b instanceof Uint8Array)
  ) {
    return false;
  }

  if (
    a.length
    !== b.length
  ) {
    return false;
  }

  let result = 0;

  for (
    let i = 0;
    i < a.length;
    i += 1
  ) {
    result |=
      a[i]
      ^ b[i];
  }

  return result === 0;
}

async function constantTimeEqualText(
  a,
  b,
) {
  const [
    hashA,
    hashB,
  ] = await Promise.all([
    sha256(a),
    sha256(b),
  ]);

  return constantTimeEqualBytes(
    hashA,
    hashB,
  );
}

async function hmacKey(
  secret,
) {
  return crypto.subtle.importKey(
    'raw',

    new TextEncoder()
      .encode(
        String(secret),
      ),

    {
      name:
        'HMAC',

      hash:
        'SHA-256',
    },

    false,

    [
      'sign',
      'verify',
    ],
  );
}

async function sign(
  value,
  secret,
) {
  const key =
    await hmacKey(
      secret,
    );

  const signature =
    await crypto.subtle.sign(
      'HMAC',

      key,

      new TextEncoder()
        .encode(
          String(value),
        ),
    );

  return bytesToBase64Url(
    new Uint8Array(
      signature,
    ),
  );
}

async function verifySignature(
  value,
  signature,
  secret,
) {
  try {
    const key =
      await hmacKey(
        secret,
      );

    return crypto.subtle.verify(
      'HMAC',

      key,

      base64UrlToBytes(
        signature,
      ),

      new TextEncoder()
        .encode(
          String(value),
        ),
    );
  } catch {
    return false;
  }
}

/* ==================================================
   RANDOM
================================================== */

function randomToken(
  length = 18,
) {
  const bytes =
    new Uint8Array(
      length,
    );

  crypto.getRandomValues(
    bytes,
  );

  return bytesToBase64Url(
    bytes,
  );
}

/* ==================================================
   SECRETS
================================================== */

function authConfigured(
  env,
) {
  return Boolean(
    String(
      env.ADMIN_PASSWORD
      || '',
    ).trim()

    && String(
      env.ADMIN_SESSION_SECRET
      || '',
    ).trim(),
  );
}

function passwordSecret(
  env,
) {
  return String(
    env.ADMIN_PASSWORD
    || '',
  );
}

function sessionSecret(
  env,
) {
  return String(
    env.ADMIN_SESSION_SECRET
    || '',
  );
}

/* ==================================================
   COOKIE
================================================== */

function cookieHeader(
  token,
) {
  return [
    `${COOKIE_NAME}=${token}`,

    'Path=/',

    'HttpOnly',

    'Secure',

    'SameSite=Strict',

    `Max-Age=${SESSION_SECONDS}`,
  ].join('; ');
}

function clearCookieHeader() {
  return [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Max-Age=0',
  ].join('; ');
}

function readCookie(
  request,
  name,
) {
  const header =
    request.headers.get(
      'cookie',
    )
    || '';

  const cookies =
    header.split(';');

  for (
    const part of cookies
  ) {
    const [
      key,
      ...rest
    ] =
      part.trim()
        .split('=');

    if (
      key === name
    ) {
      return rest.join('=');
    }
  }

  return '';
}

/* ==================================================
   SESSION
================================================== */

async function createSessionToken(
  env,
) {
  const now =
    Math.floor(
      Date.now()
      / 1000,
    );

  const payload = {
    v: 1,

    iat:
      now,

    exp:
      now
      + SESSION_SECONDS,

    nonce:
      randomToken(),
  };

  const encodedPayload =
    textToBase64Url(
      JSON.stringify(
        payload,
      ),
    );

  const signature =
    await sign(
      encodedPayload,
      sessionSecret(env),
    );

  return `${encodedPayload}.${signature}`;
}

async function validateSessionToken(
  token,
  env,
) {
  if (
    !authConfigured(env)
  ) {
    return false;
  }

  const parts =
    String(token || '')
      .split('.');

  if (
    parts.length !== 2
  ) {
    return false;
  }

  const [
    encodedPayload,
    signature,
  ] =
    parts;

  const validSignature =
    await verifySignature(
      encodedPayload,
      signature,
      sessionSecret(env),
    );

  if (
    !validSignature
  ) {
    return false;
  }

  let payload;

  try {
    payload =
      JSON.parse(
        base64UrlToText(
          encodedPayload,
        ),
      );
  } catch {
    return false;
  }

  if (
    !payload
    || payload.v !== 1
  ) {
    return false;
  }

  const now =
    Math.floor(
      Date.now()
      / 1000,
    );

  const exp =
    Number(
      payload.exp,
    );

  const iat =
    Number(
      payload.iat,
    );

  if (
    !Number.isFinite(exp)
    || !Number.isFinite(iat)
  ) {
    return false;
  }

  if (
    exp <= now
  ) {
    return false;
  }

  /*
   * Evita aceitar sessão
   * absurdamente longa caso
   * o payload seja adulterado.
   */
  if (
    exp - iat
    > SESSION_SECONDS + 60
  ) {
    return false;
  }

  return true;
}

/* ==================================================
   VERIFICAÇÃO PÚBLICA
================================================== */

export async function isAdminAuthenticated(
  request,
  env,
) {
  const token =
    readCookie(
      request,
      COOKIE_NAME,
    );

  if (!token) {
    return false;
  }

  return validateSessionToken(
    token,
    env,
  );
}

/* ==================================================
   GUARD
================================================== */

export async function requireAdminAuth(
  request,
  env,
) {
  const authenticated =
    await isAdminAuthenticated(
      request,
      env,
    );

  if (
    authenticated
  ) {
    return null;
  }

  return fail(
    'Não autorizado.',
    401,
    {
      code:
        'admin_auth_required',
    },
  );
}

/* ==================================================
   LOGIN
================================================== */

async function login(
  request,
  env,
) {
  if (
    !authConfigured(env)
  ) {
    return fail(
      'A senha administrativa ainda não foi configurada.',
      503,
      {
        code:
          'admin_auth_not_configured',
      },
    );
  }

  const body =
    await readJson(
      request,
    );

  const supplied =
    String(
      body.password
      || '',
    );

  if (
    !supplied
  ) {
    return fail(
      'Digite a senha.',
      422,
    );
  }

  const valid =
    await constantTimeEqualText(
      supplied,
      passwordSecret(env),
    );

  if (
    !valid
  ) {
    return fail(
      'Senha incorreta.',
      401,
      {
        code:
          'invalid_admin_password',
      },
    );
  }

  const token =
    await createSessionToken(
      env,
    );

  return new Response(
    JSON.stringify({
      ok:
        true,

      authenticated:
        true,

      expiresInSeconds:
        SESSION_SECONDS,
    }),

    {
      status:
        200,

      headers: {
        'content-type':
          'application/json; charset=utf-8',

        'cache-control':
          'no-store',

        'set-cookie':
          cookieHeader(
            token,
          ),
      },
    },
  );
}

/* ==================================================
   LOGOUT
================================================== */

function logout() {
  return new Response(
    JSON.stringify({
      ok:
        true,

      authenticated:
        false,
    }),

    {
      status:
        200,

      headers: {
        'content-type':
          'application/json; charset=utf-8',

        'cache-control':
          'no-store',

        'set-cookie':
          clearCookieHeader(),
      },
    },
  );
}

/* ==================================================
   STATUS
================================================== */

async function status(
  request,
  env,
) {
  const authenticated =
    await isAdminAuthenticated(
      request,
      env,
    );

  return json({
    authenticated,

    configured:
      authConfigured(env),
  });
}

/* ==================================================
   ROTEADOR
================================================== */

export async function handleAdminAuthApi(
  request,
  env,
  url,
) {
  const method =
    request.method
      .toUpperCase();

  if (
    url.pathname
    === '/api/admin/auth/login'
  ) {
    if (
      method !== 'POST'
    ) {
      return fail(
        'Método não permitido.',
        405,
      );
    }

    return login(
      request,
      env,
    );
  }

  if (
    url.pathname
    === '/api/admin/auth/logout'
  ) {
    if (
      method !== 'POST'
    ) {
      return fail(
        'Método não permitido.',
        405,
      );
    }

    return logout();
  }

  if (
    url.pathname
    === '/api/admin/auth/status'
  ) {
    if (
      method !== 'GET'
    ) {
      return fail(
        'Método não permitido.',
        405,
      );
    }

    return status(
      request,
      env,
    );
  }

  return null;
}
