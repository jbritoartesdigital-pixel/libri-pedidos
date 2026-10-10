import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers.mjs';
import {parseDriveFolderId,readOrderDriveFolder,saveOrderDriveFolder}
  from '../src/lib/v2-drive-folder.js';
import {handleAdminDriveFolderV2Api} from '../src/routes/admin-drive-folder-v2.js';
import {readFileSync} from 'node:fs';

function fixture(){
  const DB=database();
  DB.sqlite.prepare("INSERT INTO v2_customers(name,whatsapp) VALUES (?,?)")
    .run('Cliente fictícia','5511999999999');
  const owner=DB.sqlite.prepare('SELECT id FROM v2_customers LIMIT 1').get().id;
  const insert=DB.sqlite.prepare(
    'INSERT INTO v2_orders(order_code,public_token,customer_id,event_type, honoree_display_name,event_date) VALUES (?,?,?,?,?,?)');
  insert.run('LIBRI-123456','token-ficticio-1',owner,'birthday','Evento Teste 1','2026-11-12');
  insert.run('LIBRI-123457','token-ficticio-2',owner,'birthday','Evento Teste 2','2026-11-13');
  return DB;
}
const id1='1FakeDriveFolderIdABC123XYZ444';
const id2='1FakeDriveFolderIdABC123XYZ555';
test('aceitar apenas link/ID confiável de pasta Google Drive',()=>{
  assert.equal(parseDriveFolderId(id1),id1);
  assert.equal(parseDriveFolderId('https://drive.google.com/drive/folders/'+id1),id1);
  assert.equal(parseDriveFolderId('https://drive.google.com/drive/u/0/folders/'+id1+'?usp=sharing'),id1);
  for(const url of ['https://drive.google.com/drive/folders/notlong',
    'https://evil.com/drive/folders/'+id1,
    'http://drive.google.com/drive/folders/'+id1,
    'https://drive.google.com/file/d/'+id1,
    'https://drive.google.com/drive/folders/'+id1+'#token',
    'javascript:alert(1)','Aurora'])
    assert.throws(()=>parseDriveFolderId(url));
});
test('cada pedido tem somente uma pasta exclusiva, não sincroniza sozinho',async()=>{
  const DB=fixture();
  const empty=await readOrderDriveFolder(DB,'LIBRI-123456');
  assert.equal(empty.folderId,null);
  assert.equal(empty.uploadEnabled,false);
  const first=await saveOrderDriveFolder(DB,'LIBRI-123456',id1);
  assert.equal(first.folderId,id1);
  assert.equal(first.syncStatus,'pending_connection');
  assert.equal(first.changed,true);
  const repeated=await saveOrderDriveFolder(DB,'LIBRI-123456',id1);
  assert.equal(repeated.changed,false);
  await assert.rejects(()=>saveOrderDriveFolder(DB,'LIBRI-123457',id1),/outra pedido|outro pedido/);
  assert.equal((await readOrderDriveFolder(DB,'LIBRI-123457')).folderId,null);
  const updated=await saveOrderDriveFolder(DB,'LIBRI-123456',id2);
  assert.equal(updated.changed,true);
  assert.equal(updated.syncStatus,'pending_connection');
  assert.equal((await readOrderDriveFolder(DB,'LIBRI-123456')).folderId,id2);
  assert.equal(await readOrderDriveFolder(DB,'LIBRI-123459'),null);
});
test('rota admin valida conteúdo sem guardar credenciais',async()=>{
  const DB=fixture();
  const base='https://pedidos.libriconvites.com.br/api/admin/v2/orders/LIBRI-123456/drive-folder';
  const call=async(method,body)=>handleAdminDriveFolderV2Api(
    new Request(base,{method,headers:body===undefined?{}:{'content-type':'application/json'},
      ...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB},new URL(base));
  let res=await call('GET');
  assert.equal(res.status,200);assert.equal((await res.json()).drive.uploadEnabled,false);
  res=await call('PUT',{folderId:'https://drive.google.com/drive/folders/'+id1});
  assert.equal(res.status,200);
  assert.equal((await res.json()).drive.folderId,id1);
  res=await call('PUT',{folderId:id1,accessToken:'segredo'});
  assert.equal(res.status,422);
  res=await call('POST',{folderId:id1});
  assert.equal(res.status,405);
  const source=readFileSync('src/index.js','utf8');
  assert.ok(source.indexOf('await requireAdminPasskeyAuth(')<source.indexOf('handleAdminDriveFolderV2Api,'));
  assert.ok(!JSON.stringify(await DB.prepare('SELECT * FROM v2_order_drive_folders').all()).includes('segredo'));
});
