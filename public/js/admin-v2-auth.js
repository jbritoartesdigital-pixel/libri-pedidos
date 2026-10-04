import {
  api,
  app,
  authGate,
  esc,
  showToast,
  state,
} from './admin-v2-core.js';

function b64urlToBytes(value) {
  const padded =
    String(value)
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(
        Math.ceil(value.length / 4) * 4,
        '=',
      );

  const binary =
    atob(padded);

  return Uint8Array.from(
    binary,
    (char) =>
      char.charCodeAt(0),
  );
}

function bytesToB64url(buffer) {
  const bytes =
    new Uint8Array(buffer);

  let binary = '';

  for (const byte of bytes) {
    binary +=
      String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function registrationOptions(options) {
  return {
    ...options,
    challenge:
      b64urlToBytes(
        options.challenge,
      ),
    user: {
      ...options.user,
      id:
        b64urlToBytes(
          options.user.id,
        ),
    },
    excludeCredentials:
      (options.excludeCredentials || [])
        .map(
          (item) => ({
            ...item,
            id:
              b64urlToBytes(
                item.id,
              ),
          }),
        ),
  };
}

function authenticationOptions(options) {
  return {
    ...options,
    challenge:
      b64urlToBytes(
        options.challenge,
      ),
    allowCredentials:
      (options.allowCredentials || [])
        .map(
          (item) => ({
            ...item,
            id:
              b64urlToBytes(
                item.id,
              ),
          }),
        ),
  };
}

function credentialToJson(credential) {
  const response =
    credential.response;

  const result = {
    id:
      credential.id,
    rawId:
      bytesToB64url(
        credential.rawId,
      ),
    type:
      credential.type,
    authenticatorAttachment:
      credential.authenticatorAttachment
      || undefined,
    clientExtensionResults:
      credential.getClientExtensionResults
        ? credential.getClientExtensionResults()
        : {},
    response: {
      clientDataJSON:
        bytesToB64url(
          response.clientDataJSON,
        ),
    },
  };

  if (
    'attestationObject'
    in response
  ) {
    result.response.attestationObject =
      bytesToB64url(
        response.attestationObject,
      );

    result.response.transports =
      response.getTransports
        ? response.getTransports()
        : [];
  }

  if (
    'authenticatorData'
    in response
  ) {
    result.response.authenticatorData =
      bytesToB64url(
        response.authenticatorData,
      );

    result.response.signature =
      bytesToB64url(
        response.signature,
      );

    result.response.userHandle =
      response.userHandle
        ? bytesToB64url(
          response.userHandle,
        )
        : null;
  }

  return result;
}

function gateHtml(auth) {
  if (!window.PublicKeyCredential) {
    return `
      <section class="auth-card">
        <span class="eyebrow">Admin V2</span>
        <h1>Este aparelho não suporta Passkey</h1>
        <p>
          Abra o painel em um navegador atualizado com suporte a WebAuthn.
        </p>
      </section>
    `;
  }

  if (!auth.configured) {
    return `
      <section class="auth-card">
        <span class="eyebrow">Primeiro acesso</span>
        <h1>Cadastre sua Passkey</h1>
        <p>
          A biometria fica no seu aparelho. O servidor guarda apenas a credencial pública necessária para autenticar.
        </p>

        <div class="field" style="text-align:left">
          <label for="deviceLabel">Nome deste aparelho</label>
          <input
            id="deviceLabel"
            class="input"
            placeholder="Ex.: Celular da Ju"
          >
        </div>

        <div class="field" style="text-align:left;margin-top:10px">
          <label for="recoverySecret">Chave de recuperação</label>
          <input
            id="recoverySecret"
            class="input"
            type="password"
            autocomplete="off"
          >
        </div>

        <button
          id="registerPasskey"
          class="btn btn-primary btn-full"
          type="button"
          style="margin-top:14px"
        >
          Cadastrar Passkey
        </button>
      </section>
    `;
  }

  return `
    <section class="auth-card">
      <span class="eyebrow">Acesso protegido</span>
      <h1>Central Libri</h1>
      <p>
        Use sua Passkey para abrir o painel.
      </p>

      <button
        id="loginPasskey"
        class="btn btn-primary btn-full"
        type="button"
      >
        Entrar com Passkey
      </button>
    </section>
  `;
}

async function register() {
  const deviceLabel =
    document
      .getElementById('deviceLabel')
      .value
      .trim();

  const recoverySecret =
    document
      .getElementById('recoverySecret')
      .value;

  const begin =
    await api(
      '/api/admin/v2/auth/registration/options',
      {
        method: 'POST',
        body:
          JSON.stringify({
            deviceLabel,
            recoverySecret,
          }),
      },
    );

  const credential =
    await navigator.credentials.create({
      publicKey:
        registrationOptions(
          begin.result.options,
        ),
    });

  if (!credential) {
    throw new Error(
      'Cadastro da Passkey foi cancelado.',
    );
  }

  await api(
    '/api/admin/v2/auth/registration/verify',
    {
      method: 'POST',
      body:
        JSON.stringify({
          ceremonyToken:
            begin.result.ceremonyToken,
          response:
            credentialToJson(
              credential,
            ),
        }),
    },
  );
}

async function login() {
  const begin =
    await api(
      '/api/admin/v2/auth/authentication/options',
      {
        method: 'POST',
        body: '{}',
      },
    );

  const credential =
    await navigator.credentials.get({
      publicKey:
        authenticationOptions(
          begin.result.options,
        ),
    });

  if (!credential) {
    throw new Error(
      'Login cancelado.',
    );
  }

  await api(
    '/api/admin/v2/auth/authentication/verify',
    {
      method: 'POST',
      body:
        JSON.stringify({
          ceremonyToken:
            begin.result.ceremonyToken,
          response:
            credentialToJson(
              credential,
            ),
        }),
    },
  );
}

export async function ensureAuth(onReady) {
  const data =
    await api(
      '/api/admin/v2/auth/status',
    );

  state.auth =
    data.auth;

  if (
    data.auth.authenticated
  ) {
    authGate.classList.add('hidden');
    app.classList.remove('hidden');
    await onReady();
    return true;
  }

  app.classList.add('hidden');
  authGate.classList.remove('hidden');
  authGate.innerHTML =
    gateHtml(
      data.auth,
    );

  document
    .getElementById('registerPasskey')
    ?.addEventListener(
      'click',
      async (event) => {
        const button =
          event.currentTarget;

        button.disabled = true;

        try {
          await register();
          showToast('Passkey cadastrada ✓');
          await ensureAuth(onReady);
        } catch (error) {
          button.disabled = false;
          showToast(error.message);
        }
      },
    );

  document
    .getElementById('loginPasskey')
    ?.addEventListener(
      'click',
      async (event) => {
        const button =
          event.currentTarget;

        button.disabled = true;

        try {
          await login();
          await ensureAuth(onReady);
        } catch (error) {
          button.disabled = false;
          showToast(error.message);
        }
      },
    );

  return false;
}

export async function logout() {
  await api(
    '/api/admin/v2/auth/logout',
    {
      method: 'POST',
      body: '{}',
    },
  );

  location.reload();
}

export async function securityView() {
  const [
    status,
    devices,
  ] =
    await Promise.all([
      api('/api/admin/v2/auth/status'),
      api('/api/admin/v2/auth/devices'),
    ]);

  const list =
    devices.result?.devices
    || devices.result
    || [];

  return {
    status:
      status.auth,
    devices:
      Array.isArray(list)
        ? list
        : [],
  };
}

export async function registerAdditionalPasskey(
  deviceLabel,
) {
  const begin =
    await api(
      '/api/admin/v2/auth/registration/options',
      {
        method: 'POST',
        body:
          JSON.stringify({
            deviceLabel,
          }),
      },
    );

  const credential =
    await navigator.credentials.create({
      publicKey:
        registrationOptions(
          begin.result.options,
        ),
    });

  await api(
    '/api/admin/v2/auth/registration/verify',
    {
      method: 'POST',
      body:
        JSON.stringify({
          ceremonyToken:
            begin.result.ceremonyToken,
          response:
            credentialToJson(
              credential,
            ),
        }),
    },
  );
}
