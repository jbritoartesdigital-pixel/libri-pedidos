import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers.mjs';
import {getDriveSyncSetting,setDriveSyncSetting,runV2DriveSync}
  from '../src/lib/v2-drive-auto-sync.js';
import {encryptRefreshToken} from '../src/lib/v2-google-drive-oauth.js';

async function testEnv(){
  const DB=database();
  const env={DB,
    GOOGLE_DRIVE_CLIENT_ID:'fake.apps.googleusercontent.com',
    GOOGLE_DRIVE_CLIENT_SECRET:'fake-client-secret',
    GOOGLE_DRIVE_ENCRYPTION_KEY:Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
  };
  return env;
}
async function auth(env){
  const ciphertext=await encryptRefreshToken('test-refresh-token-1111',env);
  await env.DB.prepare(
    "INSERT INTO v2_drive_oauth_connection(account_key,encrypted_refresh) VALUES ('primary',?)"
  ).bind(ciphertext).run();
}
function approved(DB){
  const person=DB.sqlite.prepare("INSERT INTO v2_customers(name,whatsapp) VALUES (?,?)")
    .run('Pessoa Fictícia','5511999999999');
  const order=DB.sqlite.prepare(
    "INSERT INTO v2_orders(order_code,public_token,customer_id,event_type,honoree_display_name,event_date) VALUES (?,?,?,?,?,?)"
  ).run('LIBRI-991122','token-test',Number(person.lastInsertRowid),'birthday','Criança Fictícia','2026-11-14');
  const orderId=Number(order.lastInsertRowid);
  DB.sqlite.prepare("INSERT INTO v2_order_drive_folders(order_code,folder_id) VALUES (?,?)")
    .run('LIBRI-991122','1FakeDriveFolderABC012345678');
  const pv=DB.sqlite.prepare(
    "INSERT INTO v2_previews(order_id,version_number,media_type,original_r2_key,preview_r2_key,status,expires_at) VALUES (?,?,?,?,?,?,?)"
  ).run(orderId,1,'image','fake/r2/approved.png','fake/r2/watermark.webp','approved','2026-11-19');
  const id=Number(pv.lastInsertRowid);
  DB.sqlite.prepare('INSERT INTO v2_preview_approvals(preview_id,order_id,approved_at) VALUES (?,?,?)')
    .run(id,orderId,new Date(Date.now()+120_000).toISOString());
  return id;
}
test('autorização opt-in começa desligada e exige Google conectado',async()=>{
  const env=await testEnv();
  assert.equal((await getDriveSyncSetting(env.DB)).enabled,false);
  await assert.rejects(()=>setDriveSyncSetting(env,true),/Conecte sua conta/);
  assert.deepEqual(await runV2DriveSync(env),{enabled:false,attempted:0,sent:0,failed:0});
  await auth(env);
  assert.equal((await setDriveSyncSetting(env,true)).enabled,true);
  assert.equal((await setDriveSyncSetting(env,false)).enabled,false);
});
test('cron envia apenas mídia aprovada após opt-in, grava recibo e não duplica',async t=>{
  const env=await testEnv();
  await auth(env);
  const id=approved(env.DB);
  // SQL julianday compares approval timestamp to opt-in; opt-in must precede approval.
  await setDriveSyncSetting(env,true);
  let getCalls=0;
  const folder='1FakeDriveFolderABC012345678';
  const driveFile='1FakeDriveMediaABC12345678';
  t.mock.method(globalThis,'fetch',async (url,opts={})=>{
    const u=new URL(String(url));
    if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'mock-access'});
    if(u.pathname.includes('/drive/v3/files/'+folder))
      return Response.json({id:folder,mimeType:'application/vnd.google-apps.folder',trashed:false});
    if(u.pathname.endsWith('/drive/v3/files')&&(!opts.method||opts.method==='GET')){
      getCalls++;
      return Response.json({files:[{id:driveFile,name:'Preview_v01.png',parents:[folder]}]});
    }
    throw Error('Chamada externa não esperada: '+u.href);
  });
  let first=await runV2DriveSync(env);
  assert.equal(first.sent,1);
  assert.equal(first.failed,0);
  const second=await runV2DriveSync(env);
  assert.equal(second.attempted,0);
  assert.equal(getCalls,1);
  assert.equal((await env.DB.prepare('SELECT drive_file_id FROM v2_drive_uploaded_previews WHERE preview_id=?')
    .bind(id).first()).drive_file_id,driveFile);
});
test('cron falha de modo seguro e agenda retry, sem expor dados de cliente',async t=>{
  const env=await testEnv();await auth(env);
  const id=approved(env.DB);
  await setDriveSyncSetting(env,true);
  t.mock.method(globalThis,'fetch',async (url)=>{
    if(String(url).includes('oauth2.googleapis.com'))
      return Response.json({access_token:'mock-access'});
    return new Response(null,{status:403});
  });
  const first=await runV2DriveSync(env);
  assert.equal(first.failed,1);
  const attempts=await env.DB.prepare(
    'SELECT failures,next_attempt_at FROM v2_drive_sync_attempts WHERE preview_id=?'
  ).bind(id).first();
  assert.equal(attempts.failures,1);
  assert.ok(attempts.next_attempt_at);
  const second=await runV2DriveSync(env);
  assert.equal(second.attempted,0);
});
