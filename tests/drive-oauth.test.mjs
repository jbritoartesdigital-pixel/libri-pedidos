import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers.mjs';
import {driveConfigured,driveConnectionStatus,startDriveOAuth,finishDriveOAuth,
  encryptRefreshToken,decryptRefreshToken,getDriveAccessToken,disconnectDrive}
  from '../src/lib/v2-google-drive-oauth.js';
import {readFileSync} from 'node:fs';

function makeEnv(DB=database()){
  const key=crypto.getRandomValues(new Uint8Array(32));
  return {DB,GOOGLE_DRIVE_CLIENT_ID:'fake-app-id.apps.googleusercontent.com',
    GOOGLE_DRIVE_CLIENT_SECRET:'fake-secret-only-tests',
    GOOGLE_DRIVE_ENCRYPTION_KEY:Buffer.from(key).toString('base64')};
}
test('OAuth fica desligado sem credenciais completas',async()=>{
  assert.equal(driveConfigured({}),false);
  assert.deepEqual((await driveConnectionStatus({})).configured,false);
  await assert.rejects(()=>startDriveOAuth({}),/credenciais OAuth/);
});
test('refresh token cifrado com AES-GCM não é legível nem adulterável',async()=>{
  const env=makeEnv();
  const cipher=await encryptRefreshToken('refresh-token-only-tests',env);
  assert.ok(!cipher.includes('refresh-token'));
  assert.equal(await decryptRefreshToken(cipher,env),'refresh-token-only-tests');
  await assert.rejects(()=>decryptRefreshToken(cipher.slice(0,-1)+'x',env));
});
test('OAuth gera PKCE, salva state hash e bloqueia replay',async t=>{
  const env=makeEnv(),flow=await startDriveOAuth(env);
  const u=new URL(flow.authorizationUrl);
  assert.equal(u.hostname,'accounts.google.com');
  assert.equal(u.searchParams.get('scope'),'https://www.googleapis.com/auth/drive.file');
  assert.equal(u.searchParams.get('code_challenge_method'),'S256');
  assert.equal(u.searchParams.get('redirect_uri'),
    'https://pedidos.libriconvites.com.br/api/admin/v2/drive/oauth/callback');
  const state=u.searchParams.get('state');
  assert.ok(state.length>=32);
  assert.equal(JSON.stringify(await env.DB.prepare('SELECT * FROM v2_drive_oauth_state').all()).includes(state),false);
  t.mock.method(globalThis,'fetch',async (url,request)=>{
    assert.equal(url,'https://oauth2.googleapis.com/token');
    const body=new URLSearchParams(request.body);
    assert.equal(body.get('grant_type'),'authorization_code');
    assert.equal(body.get('code'),'dummy-authorization-code');
    assert.ok(body.get('code_verifier').length>=40);
    return Response.json({access_token:'fake-access',refresh_token:'fake-refresh-for-tests'});
  });
  await finishDriveOAuth(env,{state,code:'dummy-authorization-code'});
  const status=await driveConnectionStatus(env);
  assert.equal(status.connected,true);
  const row=await env.DB.prepare('SELECT encrypted_refresh FROM v2_drive_oauth_connection').first();
  assert.ok(!row.encrypted_refresh.includes('fake-refresh'));
  await assert.rejects(()=>finishDriveOAuth(env,{state,code:'dummy-authorization-code'}),/expirada|utilizada/);
});
test('token de acesso é renovado somente para conexão validada',async t=>{
  const env=makeEnv();
  const encrypted=await encryptRefreshToken('refresh-test-token',env);
  await env.DB.prepare(
    "INSERT INTO v2_drive_oauth_connection(account_key,encrypted_refresh) VALUES ('primary',?)"
  ).bind(encrypted).run();
  t.mock.method(globalThis,'fetch',async (url,req)=>{
    const body=new URLSearchParams(req.body);
    assert.equal(body.get('grant_type'),'refresh_token');
    assert.equal(body.get('refresh_token'),'refresh-test-token');
    return Response.json({access_token:'only-access-token'});
  });
  assert.equal(await getDriveAccessToken(env),'only-access-token');
  assert.equal((await disconnectDrive(env)).connected,false);
  assert.equal((await driveConnectionStatus(env)).connected,false);
});
test('rota OAuth permanece atrás da autenticação Passkey existente',()=>{
  const code=readFileSync('src/index.js','utf8');
  assert.ok(code.indexOf('await requireAdminPasskeyAuth(')<code.indexOf('handleAdminDriveFolderV2Api,'));
  const route=readFileSync('src/routes/admin-drive-folder-v2.js','utf8');
  assert.match(route,/drive\/oauth\/callback/);
  assert.match(route,/drive\/oauth\/start/);
});
