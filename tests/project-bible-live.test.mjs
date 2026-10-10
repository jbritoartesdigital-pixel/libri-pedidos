import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers.mjs';
import {getApprovedProjectBible} from '../src/lib/v2-project-bible.js';
import {handleAdminDriveFolderV2Api} from '../src/routes/admin-drive-folder-v2.js';

function fixture(){
  const DB=database();
  const client=DB.sqlite.prepare(
    "INSERT INTO v2_customers(name,whatsapp) VALUES (?,?)").run('Cliente fictícia','5511999999999');
  const order=DB.sqlite.prepare(
    "INSERT INTO v2_orders(order_code,public_token,customer_id,event_type,honoree_display_name,event_date) VALUES (?,?,?,?,?,?)"
  ).run('LIBRI-991122','ord_fake_public',(Number(client.lastInsertRowid)), 'birthday','Criança fictícia','2026-11-15');
  const id=Number(order.lastInsertRowid);
  DB.sqlite.prepare(
    "INSERT INTO v2_order_drive_folders(order_code,folder_id) VALUES (?,?)"
  ).run('LIBRI-991122','1FakeDriveFolderIdABC123XYZ444');
  const insert=DB.sqlite.prepare(
    "INSERT INTO v2_previews(order_id,version_number,media_type,original_r2_key,preview_r2_key,status,expires_at) VALUES (?,?,?,?,?,?,?)");
  const a=insert.run(id,1,'image','secret/preview-original-1.png','secret/preview-watermarked-1.webp','approved','2026-11-20');
  insert.run(id,2,'video','secret/video-original-2.mp4','secret/video-watermarked-2.mp4','active','2026-11-20');
  DB.sqlite.prepare("INSERT INTO v2_preview_approvals(preview_id,order_id,evidence_json) VALUES (?,?,?)")
    .run(Number(a.lastInsertRowid),id,JSON.stringify({source:'admin_external',note:'Dados não públicos'}));
  return DB;
}
test('Project Bible inclui apenas preview aprovado e versão correta, sem mídia bruta',async()=>{
  const DB=fixture(),b=await getApprovedProjectBible(DB,'LIBRI-991122');
  assert.equal(b.schema,'libri_project_bible_v1');
  assert.equal(b.approvedPreviews.length,1);
  assert.equal(b.approvedPreviews[0].filename,'Preview_v01.png');
  assert.equal(b.approvedPreviews[0].approvalSource,'admin_external');
  assert.equal(b.drive.uploadEnabled,false);
  const json=JSON.stringify(b);
  for(const secret of ['secret/','Cliente fictícia','Dados não públicos',
    '1FakeDriveFolderIdABC123XYZ444','ord_fake_public'])
    assert.ok(!json.includes(secret),secret+' leaked');
});
test('não exporta evento inexistente; rota requer GET e retorna metadata segura',async()=>{
  const DB=fixture(),url='https://pedidos.libriconvites.com.br/api/admin/v2/orders/LIBRI-991122/project-bible';
  const get=await handleAdminDriveFolderV2Api(new Request(url),{DB},new URL(url));
  assert.equal(get.status,200);
  assert.equal((await get.json()).projectBible.approvedPreviews.length,1);
  const bad=await handleAdminDriveFolderV2Api(new Request(url,{method:'POST'}),{DB},new URL(url));
  assert.equal(bad.status,405);
  assert.equal(await getApprovedProjectBible(DB,'LIBRI-991124'),null);
});
