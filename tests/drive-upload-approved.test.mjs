import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers.mjs';
import {encryptRefreshToken} from '../src/lib/v2-google-drive-oauth.js';
import {createOrderDriveFolder,uploadApprovedPreview}
  from '../src/lib/v2-google-drive-upload.js';

async function scenario(){
  const DB=database();
  const secret=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const env={
    DB,GOOGLE_DRIVE_CLIENT_ID:'fake.apps.googleusercontent.com',
    GOOGLE_DRIVE_CLIENT_SECRET:'test-secret-not-real',
    GOOGLE_DRIVE_ENCRYPTION_KEY:secret,
    FILES:{async get(){return {size:12,
      httpMetadata:{contentType:'image/png'},
      body:new Blob([new Uint8Array(12)]).stream()};}}
  };
  const client=DB.sqlite.prepare("INSERT INTO v2_customers(name,whatsapp) VALUES (?,?)")
    .run('Cliente de Teste','5511999999999');
  const order=DB.sqlite.prepare(
    "INSERT INTO v2_orders(order_code,public_token,customer_id,event_type,honoree_display_name,event_date) VALUES (?,?,?,?,?,?)"
  ).run('LIBRI-992211','token_for_tests',Number(client.lastInsertRowid),'birthday',
    'Criança de Teste','2026-11-15');
  const orderId=Number(order.lastInsertRowid);
  const insert=DB.sqlite.prepare(
    "INSERT INTO v2_previews(order_id,version_number,media_type,original_r2_key,preview_r2_key,status,expires_at) VALUES (?,?,?,?,?,?,?)"
  );
  const approved=insert.run(orderId,1,'image','fake/approved.png','fake/watermarked.webp','approved','2026-11-17');
  const unapproved=insert.run(orderId,2,'image','fake/new.png','fake/new-watermarked.webp','active','2026-11-17');
  DB.sqlite.prepare("INSERT INTO v2_preview_approvals(preview_id,order_id) VALUES (?,?)")
    .run(Number(approved.lastInsertRowid),orderId);
  const ciphertext=await encryptRefreshToken('mock-refresh-token-12345',env);
  await DB.prepare("INSERT INTO v2_drive_oauth_connection(account_key,encrypted_refresh) VALUES ('primary',?)")
    .bind(ciphertext).run();
  return {env,previewId:Number(approved.lastInsertRowid),
    unapprovedId:Number(unapproved.lastInsertRowid)};
}
test('Drive só cria pasta após autorização e só envia arquivo aprovado',async t=>{
  const {env,previewId,unapprovedId}=await scenario();
  const urls=[],ids={
    folder:'1FakeFolderABCDEF0123456789012',
    file:'1FakeMediaABCD0123456789'
  };
  t.mock.method(globalThis,'fetch',async (url,opts={})=>{
    const uri=new URL(String(url));urls.push(uri.href);
    if(uri.hostname==='oauth2.googleapis.com')
      return Response.json({access_token:'TEST_GOOGLE_ACCESS_TOKEN'});
    if(!(uri.pathname.includes('/upload/drive/v3/files')&&opts.method==='PUT'))
      assert.equal(opts.headers?.authorization,'Bearer TEST_GOOGLE_ACCESS_TOKEN');
    if(uri.pathname.includes('/upload/drive/v3/files')&&opts.method==='POST')
      return new Response(null,{status:200,headers:{
        location:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=fake'
      }});
    if(uri.pathname.includes('/upload/drive/v3/files')&&opts.method==='PUT')
      return Response.json({id:ids.file,name:'Preview_v01.png'});
    if(uri.pathname.endsWith('/drive/v3/files')&&opts.method==='POST')
      return Response.json({id:ids.folder,mimeType:'application/vnd.google-apps.folder'});
    if(uri.pathname.endsWith('/drive/v3/files')&&(!opts.method||opts.method==='GET'))
      return Response.json({files:[]});
    if(uri.pathname.includes('/drive/v3/files/'+ids.folder))
      return Response.json({id:ids.folder,mimeType:'application/vnd.google-apps.folder',trashed:false});

    throw Error('API inesperada: '+uri.href);
  });
  await assert.rejects(()=>uploadApprovedPreview(env,'LIBRI-992211',unapprovedId),/não foi aprovada/);
  await assert.rejects(()=>uploadApprovedPreview(env,'LIBRI-992212',previewId),/não foi aprovada/);
  const folder=await createOrderDriveFolder(env,'LIBRI-992211');
  assert.equal(folder.folderId,ids.folder);
  const done=await uploadApprovedPreview(env,'LIBRI-992211',previewId);
  assert.equal(done.folderId,ids.folder);
  assert.equal(done.fileId,ids.file);
  assert.equal(done.alreadyUploaded,false);
  const urlCount=urls.length;
  const duplicate=await uploadApprovedPreview(env,'LIBRI-992211',previewId);
  assert.equal(duplicate.alreadyUploaded,true);
  assert.equal(urls.length,urlCount);
  const receipt=await env.DB.prepare(
    'SELECT folder_id,drive_file_id FROM v2_drive_uploaded_previews WHERE preview_id=?'
  ).bind(previewId).first();
  assert.equal(receipt.drive_file_id,ids.file);
});
test('sem Drive OAuth conectado, nenhuma pasta ou upload pode ocorrer',async()=>{
  const {env}=await scenario();
  await env.DB.prepare("DELETE FROM v2_drive_oauth_connection WHERE account_key='primary'").run();
  await assert.rejects(()=>createOrderDriveFolder(env,'LIBRI-992211'),/autorizado/);
});
