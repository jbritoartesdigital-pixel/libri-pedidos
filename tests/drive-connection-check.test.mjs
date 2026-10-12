import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkDriveConnection} from '../src/lib/v2-drive-connection-check.js';
import {encryptRefreshToken} from '../src/lib/v2-google-drive-oauth.js';

test('teste real cria apenas arquivos sintéticos e reutiliza sem substituir',async t=>{
  const env={GOOGLE_DRIVE_CLIENT_ID:'test',GOOGLE_DRIVE_CLIENT_SECRET:'test',
    GOOGLE_DRIVE_ENCRYPTION_KEY:Buffer.alloc(32,3).toString('base64')};
  const encrypted=await encryptRefreshToken('synthetic-refresh',env);
  env.DB={prepare(sql){assert.match(sql,/SELECT encrypted_refresh FROM v2_drive_oauth_connection/);return{async first(){return{encrypted_refresh:encrypted};}};}};
  const folderId='1SyntheticFolder0123456789',fileId='1SyntheticFile0123456789';
  let folderExists=false,fileExists=false,creates=0;
  t.mock.method(globalThis,'fetch',async (url,options={})=>{
    const u=new URL(url);
    if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'synthetic-token'});
    assert.equal(options.headers.authorization,'Bearer synthetic-token');
    assert.ok(!['DELETE','PATCH','PUT'].includes(options.method));
    if(u.pathname.endsWith('/files')&&options.method==='POST'){
      creates++;
      if(u.pathname.startsWith('/upload/')){
        assert.ok(options.body.includes('Este arquivo não contém dados de clientes'));
        fileExists=true;return Response.json({id:fileId});
      }
      assert.equal(JSON.parse(options.body).name,'Libri Pedidos · teste de conexão');
      folderExists=true;return Response.json({id:folderId});
    }
    if(u.pathname.endsWith('/files/'+fileId))return Response.json({id:fileId,parents:[folderId],trashed:false});
    const isFolder=u.searchParams.get('q').includes('mimeType');
    return Response.json({files:isFolder?(folderExists?[{id:folderId}]:[]):(fileExists?[{id:fileId}]:[])});
  });
  assert.equal((await checkDriveConnection(env)).fileId,fileId);
  assert.equal((await checkDriveConnection(env)).fileId,fileId);
  assert.equal(creates,2);
});
test('rota de teste fica protegida pela autenticação administrativa',()=>{
  const index=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  assert.ok(index.indexOf('await requireAdminPasskeyAuth')<index.indexOf('    handleAdminDriveFolderV2Api,'));
});
