import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

import {
  fail,
  json,
  nowIso,
  parseJson,
  randomToken,
} from './http.js';

const SESSION_COOKIE =
  'libri_admin_v2_session';

const SESSION_SECONDS =
  7
  * 24
  * 60
  * 60;

const CHALLENGE_SECONDS =
  5
  * 60;

const SESSION_TOUCH_SECONDS =
  15
  * 60;

const PASSKEY_ALGORITHMS = [
  -7,
  -257,
];

const ADMIN_USER_ID =
  new TextEncoder()
    .encode(
      'libri-admin',
    );

function bytesToBase64Url(
  bytes,
) {
  let binary = '';

  const value =
    bytes
    instanceof Uint8Array
      ? bytes
      : new Uint8Array(
        bytes,
      );

  for (
    let index = 0;
    index < value.length;
    index += 1
  ) {
    binary +=
      String.fromCharCode(
        value[
          index
        ],
      );
  }

  return btoa(
    binary,
  )
    .replace(
      /\+/g,
      '-',
    )
    .replace(
      /\//g,
      '_',
    )
    .replace(
      /=+$/g,
      '',
    );
}

function base64UrlToBytes(
  value,
) {
  const normalized =
    String(
      value
      || '',
    )
      .replace(
        /-/g,
        '+',
      )
      .replace(
        /_/g,
        '/',
      );

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
    atob(
      padded,
    );

  const bytes =
    new Uint8Array(
      binary.length,
    );

  for (
    let index = 0;
    index < binary.length;
    index += 1
  ) {
    bytes[
      index
    ] =
      binary.charCodeAt(
        index,
      );
  }

  return bytes;
}

async function sha256Hex(
  value,
) {
  const digest =
    await crypto
      .subtle
      .digest(
        'SHA-256',
        new TextEncoder()
          .encode(
            String(
              value
              ?? '',
            ),
          ),
      );

  return Array.from(
    new Uint8Array(
      digest,
    ),
    (byte) =>
      byte
        .toString(
          16,
        )
        .padStart(
          2,
          '0',
        ),
  )
    .join('');
}

async function constantTimeTextEqual(
  left,
  right,
) {
  const [
    leftHash,
    rightHash,
  ] =
    await Promise.all([
      sha256Hex(
        left,
      ),

      sha256Hex(
        right,
      ),
    ]);

  if (
    leftHash.length
    !== rightHash.length
  ) {
    return false;
  }

  let different = 0;

  for (
    let index = 0;
    index < leftHash.length;
    index += 1
  ) {
    different |=
      leftHash.charCodeAt(
        index,
      )
      ^ rightHash.charCodeAt(
        index,
      );
  }

  return different
    === 0;
}

function readCookie(
  request,
  name,
) {
  const header =
    request.headers
      .get(
        'cookie',
      )
    || '';

  for (
    const part
    of header.split(
      ';',
    )
  ) {
    const [
      key,
      ...rest
    ] =
      part
        .trim()
        .split('=');

    if (
      key === name
    ) {
      return rest.join(
        '=',
      );
    }
  }

  return '';
}

function sessionCookie(
  token,
) {
  return [
    `${
      SESSION_COOKIE
    }=${
      token
    }`,

    'Path=/',

    'HttpOnly',

    'Secure',

    'SameSite=Strict',

    `Max-Age=${
      SESSION_SECONDS
    }`,
  ].join(
    '; ',
  );
}

function clearSessionCookie() {
  return [
    `${
      SESSION_COOKIE
    }=`,

    'Path=/',

    'HttpOnly',

    'Secure',

    'SameSite=Strict',

    'Max-Age=0',
  ].join(
    '; ',
  );
}

function cleanText(
  value,
  maxLength = 200,
) {
  return String(
    value
    ?? '',
  )
    .trim()
    .slice(
      0,
      maxLength,
    );
}

function expectedOrigin(
  request,
  env,
) {
  const configured =
    cleanText(
      env.ADMIN_PASSKEY_ORIGIN,
      500,
    );

  if (
    configured
  ) {
    return configured
      .replace(
        /\/+$/,
        '',
      );
  }

  return new URL(
    request.url,
  )
    .origin;
}

function rpID(
  request,
  env,
) {
  const configured =
    cleanText(
      env.ADMIN_PASSKEY_RP_ID,
      255,
    );

  if (
    configured
  ) {
    return configured;
  }

  return new URL(
    request.url,
  )
    .hostname;
}

function assertSameOrigin(
  request,
  env,
) {
  const supplied =
    cleanText(
      request.headers
        .get(
          'origin',
        ),
      500,
    )
      .replace(
        /\/+$/,
        '',
      );

  const expected =
    expectedOrigin(
      request,
      env,
    );

  if (
    !supplied
    || supplied
      !== expected
  ) {
    const error =
      new Error(
        'Origem inválida para autenticação administrativa.',
      );

    error.status =
      403;

    error.code =
      'invalid_origin';

    throw error;
  }
}

function recoverySecret(
  env,
) {
  return String(
    env.ADMIN_PASSKEY_RECOVERY_SECRET
    || '',
  )
    .trim();
}

function recoveryConfigured(
  env,
) {
  return Boolean(
    recoverySecret(
      env,
    ),
  );
}

async function activePasskeys(
  db,
) {
  const result =
    await db
      .prepare(
        `
          SELECT
            id,
            credential_id,
            public_key,
            counter,
            transports_json,
            device_label,
            credential_device_type,
            backed_up,
            created_at,
            last_used_at
          FROM v2_admin_passkeys
          WHERE revoked_at IS NULL
          ORDER BY
            created_at,
            id
        `,
      )
      .all();

  return result.results
    || [];
}

async function passkeyByCredentialId(
  db,
  credentialId,
) {
  return db
    .prepare(
      `
        SELECT
          id,
          credential_id,
          public_key,
          counter,
          transports_json,
          device_label,
          credential_device_type,
          backed_up,
          created_at,
          last_used_at
        FROM v2_admin_passkeys
        WHERE
          credential_id = ?
          AND revoked_at IS NULL
        LIMIT 1
      `,
    )
    .bind(
      credentialId,
    )
    .first();
}

async function createChallenge(
  db,
  {
    purpose,
    challenge,
    request,
    env,
    authorizationMode,
    deviceLabel = null,
  },
) {
  const ceremonyToken =
    randomToken(
      'cer_',
    );

  const tokenHash =
    await sha256Hex(
      ceremonyToken,
    );

  const expiresAt =
    new Date(
      Date.now()
      + CHALLENGE_SECONDS
      * 1000,
    )
      .toISOString();

  await db.batch([
    db
      .prepare(
        `
          DELETE FROM v2_admin_webauthn_challenges
          WHERE
            used_at IS NOT NULL
            OR expires_at <= ?
        `,
      )
      .bind(
        nowIso(),
      ),

    db
      .prepare(
        `
          INSERT INTO v2_admin_webauthn_challenges(
            token_hash,
            purpose,
            challenge,
            expected_origin,
            rp_id,
            authorization_mode,
            device_label,
            created_at,
            expires_at
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
          )
        `,
      )
      .bind(
        tokenHash,
        purpose,
        challenge,
        expectedOrigin(
          request,
          env,
        ),
        rpID(
          request,
          env,
        ),
        authorizationMode,
        deviceLabel,
        nowIso(),
        expiresAt,
      ),
  ]);

  return {
    ceremonyToken,
    expiresAt,
  };
}

async function consumeChallenge(
  db,
  ceremonyToken,
  purpose,
) {
  const tokenHash =
    await sha256Hex(
      ceremonyToken,
    );

  const row =
    await db
      .prepare(
        `
          SELECT
            id,
            purpose,
            challenge,
            expected_origin,
            rp_id,
            authorization_mode,
            device_label,
            expires_at
          FROM v2_admin_webauthn_challenges
          WHERE
            token_hash = ?
            AND purpose = ?
            AND used_at IS NULL
            AND expires_at > ?
          LIMIT 1
        `,
      )
      .bind(
        tokenHash,
        purpose,
        nowIso(),
      )
      .first();

  if (!row) {
    const error =
      new Error(
        'A solicitação de autenticação expirou. Tente novamente.',
      );

    error.status =
      410;

    error.code =
      'webauthn_challenge_expired';

    throw error;
  }

  return row;
}

async function markChallengeUsed(
  db,
  id,
) {
  await db
    .prepare(
      `
        UPDATE v2_admin_webauthn_challenges
        SET used_at = ?
        WHERE
          id = ?
          AND used_at IS NULL
      `,
    )
    .bind(
      nowIso(),
      id,
    )
    .run();
}

async function currentSession(
  request,
  env,
) {
  const raw =
    readCookie(
      request,
      SESSION_COOKIE,
    );

  if (!raw) {
    return null;
  }

  const hash =
    await sha256Hex(
      raw,
    );

  const row =
    await env.DB
      .prepare(
        `
          SELECT
            s.id,
            s.passkey_id,
            s.created_at,
            s.expires_at,
            s.last_seen_at,

            p.device_label,
            p.credential_id
          FROM v2_admin_sessions s
          LEFT JOIN v2_admin_passkeys p
            ON p.id = s.passkey_id
          WHERE
            s.session_token_hash = ?
            AND s.revoked_at IS NULL
            AND s.expires_at > ?
            AND (
              s.passkey_id IS NULL
              OR p.revoked_at IS NULL
            )
          LIMIT 1
        `,
      )
      .bind(
        hash,
        nowIso(),
      )
      .first();

  if (!row) {
    return null;
  }

  const touchBefore =
    new Date(
      Date.now()
      - SESSION_TOUCH_SECONDS
      * 1000,
    )
      .toISOString();

  if (
    !row.last_seen_at
    || row.last_seen_at
      < touchBefore
  ) {
    await env.DB
      .prepare(
        `
          UPDATE v2_admin_sessions
          SET last_seen_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        nowIso(),
        row.id,
      )
      .run();
  }

  return {
    ...row,

    rawToken:
      raw,
  };
}

async function createSession(
  env,
  passkeyId,
) {
  const rawToken =
    randomToken(
      'adm_',
    );

  const sessionHash =
    await sha256Hex(
      rawToken,
    );

  const expiresAt =
    new Date(
      Date.now()
      + SESSION_SECONDS
      * 1000,
    )
      .toISOString();

  const stamp =
    nowIso();

  await env.DB
    .prepare(
      `
        INSERT INTO v2_admin_sessions(
          session_token_hash,
          passkey_id,
          created_at,
          expires_at,
          last_seen_at
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?
        )
      `,
    )
    .bind(
      sessionHash,
      passkeyId,
      stamp,
      expiresAt,
      stamp,
    )
    .run();

  return {
    rawToken,
    expiresAt,
  };
}

async function authorizeRegistration(
  request,
  env,
  suppliedRecoverySecret,
) {
  const session =
    await currentSession(
      request,
      env,
    );

  if (
    session
  ) {
    return {
      mode:
        'session',

      session,
    };
  }

  if (
    !recoveryConfigured(
      env,
    )
  ) {
    const error =
      new Error(
        'A recuperação administrativa ainda não foi configurada.',
      );

    error.status =
      503;

    error.code =
      'admin_recovery_not_configured';

    throw error;
  }

  const supplied =
    String(
      suppliedRecoverySecret
      || '',
    );

  if (
    !supplied
    || !await constantTimeTextEqual(
      supplied,
      recoverySecret(
        env,
      ),
    )
  ) {
    const error =
      new Error(
        'Código de recuperação inválido.',
      );

    error.status =
      401;

    error.code =
      'invalid_recovery_secret';

    throw error;
  }

  return {
    mode:
      'recovery',

    session:
      null,
  };
}

function passkeyForBrowser(
  row,
) {
  return {
    id:
      row.credential_id,

    transports:
      parseJson(
        row.transports_json,
        [],
      ),
  };
}

export async function getAdminPasskeyStatus(
  request,
  env,
) {
  const [
    passkeys,
    session,
  ] =
    await Promise.all([
      activePasskeys(
        env.DB,
      ),

      currentSession(
        request,
        env,
      ),
    ]);

  return {
    configured:
      passkeys.length
      > 0,

    authenticated:
      Boolean(
        session,
      ),

    recoveryConfigured:
      recoveryConfigured(
        env,
      ),

    deviceCount:
      passkeys.length,

    session: session
      ? {
        deviceLabel:
          session.device_label
          || 'Passkey',

        expiresAt:
          session.expires_at,
      }
      : null,
  };
}

export async function beginAdminPasskeyAuthentication(
  request,
  env,
) {
  assertSameOrigin(
    request,
    env,
  );

  const passkeys =
    await activePasskeys(
      env.DB,
    );

  if (!passkeys.length) {
    const error =
      new Error(
        'Nenhuma passkey administrativa foi cadastrada ainda.',
      );

    error.status =
      409;

    error.code =
      'passkey_not_configured';

    throw error;
  }

  const options =
    await generateAuthenticationOptions({
      rpID:
        rpID(
          request,
          env,
        ),

      allowCredentials:
        passkeys.map(
          passkeyForBrowser,
        ),

      userVerification:
        'required',
    });

  const challenge =
    await createChallenge(
      env.DB,
      {
        purpose:
          'authentication',

        challenge:
          options.challenge,

        request,
        env,

        authorizationMode:
          'public_auth',
      },
    );

  return {
    options,

    ceremonyToken:
      challenge
        .ceremonyToken,

    expiresAt:
      challenge
        .expiresAt,
  };
}

export async function verifyAdminPasskeyAuthentication(
  request,
  env,
  body = {},
) {
  assertSameOrigin(
    request,
    env,
  );

  const ceremony =
    await consumeChallenge(
      env.DB,
      String(
        body.ceremonyToken
        || '',
      ),
      'authentication',
    );

  const response =
    body.response;

  if (
    !response
    || !response.id
  ) {
    throw new Error(
      'Resposta WebAuthn inválida.',
    );
  }

  const passkey =
    await passkeyByCredentialId(
      env.DB,
      response.id,
    );

  if (!passkey) {
    const error =
      new Error(
        'Passkey não reconhecida.',
      );

    error.status =
      401;

    error.code =
      'unknown_passkey';

    throw error;
  }

  let verification;

  try {
    verification =
      await verifyAuthenticationResponse({
        response,

        expectedChallenge:
          ceremony.challenge,

        expectedOrigin:
          ceremony.expected_origin,

        expectedRPID:
          ceremony.rp_id,

        requireUserVerification:
          true,

        credential: {
          id:
            passkey.credential_id,

          publicKey:
            base64UrlToBytes(
              passkey.public_key,
            ),

          counter:
            Number(
              passkey.counter
              || 0,
            ),

          transports:
            parseJson(
              passkey.transports_json,
              [],
            ),
        },
      });
  } finally {
    await markChallengeUsed(
      env.DB,
      ceremony.id,
    );
  }

  if (
    !verification
      ?.verified
  ) {
    const error =
      new Error(
        'Não foi possível validar a passkey.',
      );

    error.status =
      401;

    error.code =
      'passkey_verification_failed';

    throw error;
  }

  const newCounter =
    Number(
      verification
        .authenticationInfo
        ?.newCounter
      || 0,
    );

  await env.DB
    .prepare(
      `
        UPDATE v2_admin_passkeys
        SET
          counter = ?,
          last_used_at = ?
        WHERE id = ?
      `,
    )
    .bind(
      newCounter,
      nowIso(),
      passkey.id,
    )
    .run();

  const session =
    await createSession(
      env,
      passkey.id,
    );

  return json(
    {
      ok:
        true,

      authenticated:
        true,

      deviceLabel:
        passkey.device_label
        || 'Passkey',

      expiresAt:
        session.expiresAt,
    },
    200,
    {
      'set-cookie':
        sessionCookie(
          session.rawToken,
        ),
    },
  );
}

export async function beginAdminPasskeyRegistration(
  request,
  env,
  body = {},
) {
  assertSameOrigin(
    request,
    env,
  );

  const authorization =
    await authorizeRegistration(
      request,
      env,
      body.recoverySecret,
    );

  const passkeys =
    await activePasskeys(
      env.DB,
    );

  const deviceLabel =
    cleanText(
      body.deviceLabel,
      120,
    )
    || (
      authorization.mode
      === 'recovery'
        ? 'Novo aparelho'
        : 'Passkey adicional'
    );

  const options =
    await generateRegistrationOptions({
      rpName:
        'Libri Convites',

      rpID:
        rpID(
          request,
          env,
        ),

      userName:
        'admin@libriconvites',

      userDisplayName:
        'Ju • Libri Convites',

      userID:
        ADMIN_USER_ID,

      attestationType:
        'none',

      excludeCredentials:
        passkeys.map(
          passkeyForBrowser,
        ),

      authenticatorSelection: {
        residentKey:
          'required',

        userVerification:
          'required',

        authenticatorAttachment:
          'platform',
      },

      supportedAlgorithmIDs:
        PASSKEY_ALGORITHMS,
    });

  const challenge =
    await createChallenge(
      env.DB,
      {
        purpose:
          'registration',

        challenge:
          options.challenge,

        request,
        env,

        authorizationMode:
          authorization.mode,

        deviceLabel,
      },
    );

  return {
    options,

    ceremonyToken:
      challenge
        .ceremonyToken,

    expiresAt:
      challenge
        .expiresAt,

    authorizationMode:
      authorization.mode,
  };
}

export async function verifyAdminPasskeyRegistration(
  request,
  env,
  body = {},
) {
  assertSameOrigin(
    request,
    env,
  );

  const ceremony =
    await consumeChallenge(
      env.DB,
      String(
        body.ceremonyToken
        || '',
      ),
      'registration',
    );

  const response =
    body.response;

  if (
    !response
    || !response.id
  ) {
    throw new Error(
      'Resposta WebAuthn inválida.',
    );
  }

  let verification;

  try {
    verification =
      await verifyRegistrationResponse({
        response,

        expectedChallenge:
          ceremony.challenge,

        expectedOrigin:
          ceremony.expected_origin,

        expectedRPID:
          ceremony.rp_id,

        requireUserVerification:
          true,

        supportedAlgorithmIDs:
          PASSKEY_ALGORITHMS,
      });
  } finally {
    await markChallengeUsed(
      env.DB,
      ceremony.id,
    );
  }

  if (
    !verification
      ?.verified
    || !verification
      .registrationInfo
  ) {
    const error =
      new Error(
        'Não foi possível cadastrar esta passkey.',
      );

    error.status =
      401;

    error.code =
      'passkey_registration_failed';

    throw error;
  }

  const {
    credential,
    credentialDeviceType,
    credentialBackedUp,
  } =
    verification
      .registrationInfo;

  const existing =
    await env.DB
      .prepare(
        `
          SELECT id
          FROM v2_admin_passkeys
          WHERE credential_id = ?
          LIMIT 1
        `,
      )
      .bind(
        credential.id,
      )
      .first();

  if (existing) {
    const error =
      new Error(
        'Esta passkey já está cadastrada.',
      );

    error.status =
      409;

    error.code =
      'passkey_already_registered';

    throw error;
  }

  const stamp =
    nowIso();

  const result =
    await env.DB
      .prepare(
        `
          INSERT INTO v2_admin_passkeys(
            credential_id,
            public_key,
            counter,
            transports_json,
            device_label,
            credential_device_type,
            backed_up,
            created_at,
            last_used_at
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
          )
        `,
      )
      .bind(
        credential.id,

        bytesToBase64Url(
          credential.publicKey,
        ),

        Number(
          credential.counter
          || 0,
        ),

        JSON.stringify(
          credential.transports
          || response
            ?.response
            ?.transports
          || [],
        ),

        ceremony.device_label
        || 'Passkey',

        credentialDeviceType
        || null,

        credentialBackedUp
          ? 1
          : 0,

        stamp,
        stamp,
      )
      .run();

  const passkeyId =
    Number(
      result
        ?.meta
        ?.last_row_id,
    );

  await env.DB
    .prepare(
      `
        INSERT INTO v2_notifications(
          event_code,
          order_id,
          title,
          body,
          action_url,
          priority,
          push_eligible,
          created_at
        )
        VALUES (
          'ADMIN_PASSKEY_REGISTERED',
          NULL,
          'Novo acesso administrativo',
          ?,
          '/admin-v2?view=security',
          'high',
          0,
          ?
        )
      `,
    )
    .bind(
      `${
        ceremony.device_label
        || 'Novo aparelho'
      } cadastrado por ${
        ceremony.authorization_mode
        === 'recovery'
          ? 'recuperação segura'
          : 'sessão autenticada'
      }.`,
      stamp,
    )
    .run();

  const session =
    await createSession(
      env,
      passkeyId,
    );

  return json(
    {
      ok:
        true,

      registered:
        true,

      authenticated:
        true,

      device: {
        id:
          passkeyId,

        label:
          ceremony.device_label
          || 'Passkey',

        deviceType:
          credentialDeviceType
          || null,

        backedUp:
          Boolean(
            credentialBackedUp,
          ),
      },

      expiresAt:
        session.expiresAt,
    },
    201,
    {
      'set-cookie':
        sessionCookie(
          session.rawToken,
        ),
    },
  );
}

export async function listAdminPasskeyDevices(
  request,
  env,
) {
  const session =
    await currentSession(
      request,
      env,
    );

  if (!session) {
    return null;
  }

  const passkeys =
    await activePasskeys(
      env.DB,
    );

  return {
    currentPasskeyId:
      session.passkey_id,

    devices:
      passkeys.map(
        (row) => ({
          id:
            row.id,

          label:
            row.device_label
            || 'Passkey',

          deviceType:
            row.credential_device_type,

          backedUp:
            row.backed_up
            === 1,

          createdAt:
            row.created_at,

          lastUsedAt:
            row.last_used_at,

          current:
            Number(
              row.id,
            )
            === Number(
              session.passkey_id,
            ),
        }),
      ),
  };
}

export async function revokeAdminPasskeyDevice(
  request,
  env,
  passkeyId,
) {
  assertSameOrigin(
    request,
    env,
  );

  const session =
    await currentSession(
      request,
      env,
    );

  if (!session) {
    const error =
      new Error(
        'Sessão administrativa expirada.',
      );

    error.status =
      401;

    error.code =
      'admin_auth_required';

    throw error;
  }

  const passkeys =
    await activePasskeys(
      env.DB,
    );

  if (
    passkeys.length
    <= 1
  ) {
    const error =
      new Error(
        'Cadastre outra passkey antes de remover a última forma de acesso.',
      );

    error.status =
      409;

    error.code =
      'last_passkey';

    throw error;
  }

  const target =
    passkeys.find(
      (row) =>
        Number(
          row.id,
        )
        === Number(
          passkeyId,
        ),
    );

  if (!target) {
    return null;
  }

  const stamp =
    nowIso();

  await env.DB.batch([
    env.DB
      .prepare(
        `
          UPDATE v2_admin_passkeys
          SET revoked_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        stamp,
        target.id,
      ),

    env.DB
      .prepare(
        `
          UPDATE v2_admin_sessions
          SET revoked_at = ?
          WHERE
            passkey_id = ?
            AND revoked_at IS NULL
        `,
      )
      .bind(
        stamp,
        target.id,
      ),

    env.DB
      .prepare(
        `
          INSERT INTO v2_notifications(
            event_code,
            order_id,
            title,
            body,
            action_url,
            priority,
            push_eligible,
            created_at
          )
          VALUES (
            'ADMIN_PASSKEY_REVOKED',
            NULL,
            'Acesso administrativo removido',
            ?,
            '/admin-v2?view=security',
            'high',
            0,
            ?
          )
        `,
      )
      .bind(
        `${
          target.device_label
          || 'Passkey'
        } foi removida dos acessos administrativos.`,
        stamp,
      ),
  ]);

  const revokedCurrent =
    Number(
      target.id,
    )
    === Number(
      session.passkey_id,
    );

  return {
    revoked:
      true,

    id:
      target.id,

    revokedCurrent,
  };
}

export async function logoutAdminPasskeySession(
  request,
  env,
) {
  assertSameOrigin(
    request,
    env,
  );

  const raw =
    readCookie(
      request,
      SESSION_COOKIE,
    );

  if (
    raw
  ) {
    const hash =
      await sha256Hex(
        raw,
      );

    await env.DB
      .prepare(
        `
          UPDATE v2_admin_sessions
          SET revoked_at = ?
          WHERE
            session_token_hash = ?
            AND revoked_at IS NULL
        `,
      )
      .bind(
        nowIso(),
        hash,
      )
      .run();
  }

  return json(
    {
      ok:
        true,

      authenticated:
        false,
    },
    200,
    {
      'set-cookie':
        clearSessionCookie(),
    },
  );
}

export async function requireAdminPasskeyAuth(
  request,
  env,
) {
  const session =
    await currentSession(
      request,
      env,
    );

  if (
    session
  ) {
    return null;
  }

  return fail(
    'Não autorizado.',
    401,
    {
      code:
        'admin_passkey_required',
    },
  );
}

export async function isAdminPasskeyAuthenticated(
  request,
  env,
) {
  return Boolean(
    await currentSession(
      request,
      env,
    ),
  );
}
