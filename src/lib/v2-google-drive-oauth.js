/**
 * OAuth Google Drive for Libri Pedidos, opt-in and fail-closed.
 * ChatGPT-connected Google Drive does not grant any OAuth token to this Worker.
 * Scope drive.file: files created or explicitly opened with this Google OAuth app.
 */
const CALLBACK='https://pedidos.libriconvites.com.br/api/admin/v2/drive/oauth/callback';
const SCOPE='https://www.googleapis.com/auth/drive.file';
const GOOGLE_AUTH='https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN='https://oauth2.googleapis.com/token';

function b64(bytes) {
  const a=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  let text='';for(const b of a)text+=String.fromCharCode(b);
  return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function un64(value){
  const v=String(value||'').replace(/-/g,'+').replace(/_/g,'/');
  const s=atob(v+'='.repeat((4-v.length%4)%4));
  return Uint8Array.from(s,c=>c.charCodeAt(0));
}
function randomUrl(bytes=32){return b64(crypto.getRandomValues(new Uint8Array(bytes)));}
async function sha256(value){
  return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
}
function requireSecrets(env){
  if(!env.GOOGLE_DRIVE_CLIENT_ID||!env.GOOGLE_DRIVE_CLIENT_SECRET||
     !env.GOOGLE_DRIVE_ENCRYPTION_KEY)throw Error(
     'Google Drive ainda não foi conectado: credenciais OAuth não configuradas.');
}
export function driveConfigured(env){
  return Boolean(env?.GOOGLE_DRIVE_CLIENT_ID&&env?.GOOGLE_DRIVE_CLIENT_SECRET&&
    env?.GOOGLE_DRIVE_ENCRYPTION_KEY);
}
async function cryptoKey(env){
  const input=String(env?.GOOGLE_DRIVE_ENCRYPTION_KEY||'');
  const bytes=un64(input);
  if(bytes.byteLength!==32)throw Error('Chave AES-GCM precisa conter 32 bytes.');
  return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function encryptRefreshToken(value,env){
  if(typeof value!=='string'||value.length<8||value.length>8192)throw Error('Refresh token inválido.');
  const nonce=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},
    await cryptoKey(env),new TextEncoder().encode(value));
  return 'v1.'+b64(nonce)+'.'+b64(cipher);
}
export async function decryptRefreshToken(encoded,env){
  const bits=String(encoded||'').split('.');
  if(bits.length!==3||bits[0]!=='v1')throw Error('Formato de token cifrado inválido.');
  const iv=un64(bits[1]),cipher=un64(bits[2]);
  if(iv.length!==12)throw Error('IV inválido.');
  const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv},
    await cryptoKey(env),cipher);
  return new TextDecoder().decode(clear);
}
export async function driveConnectionStatus(env){
  if(!driveConfigured(env))return{configured:false,connected:false,
    message:'Configure primeiro as credenciais OAuth no Worker.'};
  const row=await env.DB.prepare(
    "SELECT updated_at FROM v2_drive_oauth_connection WHERE account_key='primary' LIMIT 1"
  ).first();
  return {configured:true,connected:Boolean(row),lastConnectedAt:row?.updated_at||null,
    scope:'drive.file',message:row?'Conta vinculada, pronta para verificar permissões de pasta.':
      'Autorize o Google Drive para habilitar envios.'};
}
export async function startDriveOAuth(env){
  requireSecrets(env);
  await cryptoKey(env);
  const state=randomUrl(),verifier=randomUrl(64);
  const stateHash=await sha256(state),challenge=await sha256(verifier);
  const now=Date.now();
  await env.DB.prepare('DELETE FROM v2_drive_oauth_state WHERE expires_at < ?').bind(now).run();
  await env.DB.prepare(
    'INSERT INTO v2_drive_oauth_state(state_hash,code_verifier,expires_at) VALUES (?,?,?)'
  ).bind(stateHash,verifier,now+10*60_000).run();
  const url=new URL(GOOGLE_AUTH);
  const params={
    client_id:env.GOOGLE_DRIVE_CLIENT_ID,redirect_uri:CALLBACK,
    response_type:'code',scope:SCOPE,access_type:'offline',
    prompt:'consent',include_granted_scopes:'false',
    code_challenge:challenge,code_challenge_method:'S256',state
  };
  for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
  return {authorizationUrl:url.toString()};
}
export async function finishDriveOAuth(env,{state,code}){
  requireSecrets(env);
  if(typeof state!=='string'||state.length<30||state.length>256||
     typeof code!=='string'||code.length<10||code.length>4096)
    throw Error('Retorno OAuth inválido.');
  const hash=await sha256(state);
  const row=await env.DB.prepare(
    'SELECT code_verifier,expires_at FROM v2_drive_oauth_state WHERE state_hash=? LIMIT 1'
  ).bind(hash).first();
  if(!row||Number(row.expires_at)<Date.now())throw Error('Autorização expirada ou já utilizada.');
  // Consume state before external request. Retries require new user consent.
  await env.DB.prepare('DELETE FROM v2_drive_oauth_state WHERE state_hash=?')
    .bind(hash).run();
  const response=await fetch(GOOGLE_TOKEN,{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      client_id:env.GOOGLE_DRIVE_CLIENT_ID,
      client_secret:env.GOOGLE_DRIVE_CLIENT_SECRET,
      code,code_verifier:row.code_verifier,
      redirect_uri:CALLBACK,grant_type:'authorization_code'
    }).toString()
  });
  if(!response.ok)throw Error('O Google não confirmou a autorização. Tente conectar novamente.');
  const data=await response.json();
  if(typeof data.refresh_token!=='string'||!data.refresh_token)
    throw Error('O Google não forneceu permissão persistente. Revogue a autorização e tente novamente.');
  const token=await encryptRefreshToken(data.refresh_token,env);
  await env.DB.prepare(
    "INSERT INTO v2_drive_oauth_connection(account_key,encrypted_refresh,updated_at)"+
    " VALUES ('primary',?,datetime('now'))"+
    " ON CONFLICT(account_key) DO UPDATE SET encrypted_refresh=excluded.encrypted_refresh,updated_at=datetime('now')"
  ).bind(token).run();
  return {ok:true};
}
export async function getDriveAccessToken(env){
  requireSecrets(env);
  const row=await env.DB.prepare(
    "SELECT encrypted_refresh FROM v2_drive_oauth_connection WHERE account_key='primary' LIMIT 1"
  ).first();
  if(!row)throw Error('Google Drive ainda não foi autorizado.');
  const refresh=await decryptRefreshToken(row.encrypted_refresh,env);
  const response=await fetch(GOOGLE_TOKEN,{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      client_id:env.GOOGLE_DRIVE_CLIENT_ID,client_secret:env.GOOGLE_DRIVE_CLIENT_SECRET,
      refresh_token:refresh,grant_type:'refresh_token'
    }).toString()
  });
  if(!response.ok)throw Error('A conexão Google Drive expirou. Reconecte sua conta.');
  const token=await response.json();
  if(typeof token.access_token!=='string'||!token.access_token)
    throw Error('Google Drive não retornou uma autorização válida.');
  return token.access_token;
}
export async function disconnectDrive(env){
  await env.DB.prepare("DELETE FROM v2_drive_oauth_connection WHERE account_key='primary'").run();
  return {ok:true,connected:false,message:'Credencial local apagada. Revogue também o acesso nas configurações Google caso deseje.'};
}
