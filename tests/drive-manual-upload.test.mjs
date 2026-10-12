import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadOrderFile,verifyDriveFolder} from '../src/lib/v2-drive-manual-upload.js';
import {encryptRefreshToken} from '../src/lib/v2-google-drive-oauth.js';
test('envio manual valida pasta, cria arquivo e nunca grava pedidos',async t=>{
  const folderId='1SyntheticFolder0123456789',fileId='1SyntheticFile0123456789';
  const env={GOOGLE_DRIVE_CLIENT_ID:'test',GOOGLE_DRIVE_CLIENT_SECRET:'test',GOOGLE_DRIVE_ENCRYPTION_KEY:Buffer.alloc(32,4).toString('base64')};
  const encrypted=await encryptRefreshToken('synthetic-refresh',env);
  env.DB={prepare(sql){assert.match(sql,/^SELECT/);return{bind(){return this;},async first(){
    if(sql.includes('encrypted_refresh'))return{encrypted_refresh:encrypted};
    if(sql.includes('SELECT 1'))return{ok:1};
    return{folder_id:folderId};
  }};}};
  let allowed=true,unsafe=false,posts=0;
  t.mock.method(globalThis,'fetch',async (url,options={})=>{
    const u=new URL(url);
    if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'synthetic-token'});
    if(u.pathname.includes('/drive/v3/files/'+folderId))return allowed?Response.json({id:folderId,mimeType:'application/vnd.google-apps.folder',trashed:false}):new Response('',{status:403});
    if(options.method==='POST'){
      posts++;assert.equal(JSON.parse(options.body).parents[0],folderId);
      return new Response(null,{headers:{location:unsafe?'https://evil.example/upload':'https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic'}});
    }
    assert.equal(options.method,'PUT');assert.equal(u.searchParams.get('upload_id'),'synthetic');
    return Response.json({id:fileId});
  });
  const file=new File(['synthetic document'],'teste.pdf',{type:'application/pdf'});
  assert.equal((await uploadOrderFile(env,'LIBRI-123456',file)).fileId,fileId);
  allowed=false;await assert.rejects(()=>verifyDriveFolder(env,folderId),/não está autorizada/);
  await assert.rejects(()=>uploadOrderFile(env,'LIBRI-123456',file),/não está autorizada/);
  assert.equal(posts,1);
  allowed=true;unsafe=true;await assert.rejects(()=>uploadOrderFile(env,'LIBRI-123456',file),/não confiável/);
  await assert.rejects(()=>uploadOrderFile(env,'LIBRI-123456',new File(['x'],'x.exe',{type:'application/octet-stream'})),/Use PNG/);
});
