import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { File } from 'node:buffer';
import {
  listAtelieCustomerUploads,uploadAtelieCustomerImage,
  streamAtelieCustomerImage,deleteAtelieCustomerImage,streamAtelieAdminImage
} from '../src/lib/v3-atelie-uploads.js';
import { saveAtelieCustomerBriefing } from '../src/lib/v3-atelie-customer-briefing.js';

const TOKENS=['a','b','c','d'].map(c=>'ord_'+c.repeat(36));
function fixture() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec('CREATE TABLE v2_orders(id INTEGER PRIMARY KEY,order_code TEXT,public_token TEXT,status TEXT,event_type TEXT,event_date TEXT,honoree_display_name TEXT)');
  sqlite.exec('CREATE TABLE v2_products(id INTEGER PRIMARY KEY,code TEXT)');
  sqlite.exec('CREATE TABLE v2_product_variants(id INTEGER PRIMARY KEY,product_id INTEGER,code TEXT UNIQUE)');
  sqlite.exec('CREATE TABLE v2_order_items(id INTEGER PRIMARY KEY,order_id INTEGER,item_type TEXT,item_code TEXT,configuration_json TEXT)');
  sqlite.exec('CREATE TABLE v2_payments(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT)');
  sqlite.exec(readFileSync('migrations/0035_atelie_v3_briefing_draft.sql','utf8'));
  sqlite.exec(readFileSync('migrations/0036_atelie_v3_private_uploads.sql','utf8'));
  sqlite.exec(readFileSync('migrations/0037_atelie_v3_briefing_submission.sql','utf8'));
  sqlite.exec("INSERT INTO v2_products(id,code) VALUES(1,'atelie_essencia'),(2,'interactive_essential')");
  sqlite.exec("INSERT INTO v2_product_variants(id,product_id,code) VALUES(1,1,'atelie_essencia_default'),(2,2,'essential_base')");
  for(const [id,code,tok,variant,status,requiresPhoto] of [
    [1,'LIBRI-2001',TOKENS[0],'atelie_essencia_default','briefing_pending',true],
    [2,'LIBRI-2002',TOKENS[1],'atelie_essencia_default','briefing_pending',false],
    [3,'LIBRI-2003',TOKENS[2],'atelie_essencia_default','awaiting_payment',true],
    [4,'LIBRI-2004',TOKENS[3],'essential_base','briefing_pending',false]
  ]){
    sqlite.prepare('INSERT INTO v2_orders(id,order_code,public_token,status,event_type,event_date,honoree_display_name) VALUES(?,?,?,?,?,?,?)')
      .run(id,code,tok,status,'birthday','2027-04-20','Festa');
    sqlite.prepare('INSERT INTO v2_order_items(order_id,item_type,item_code,configuration_json) VALUES(?,?,?,?)')
      .run(id,'product',variant,JSON.stringify({atelie:{requiresChildPhoto:requiresPhoto}}));
  }
  sqlite.exec("INSERT INTO v2_payments(order_id,status) VALUES(1,'approved'),(2,'approved'),(4,'approved')");
  const db={prepare(sql){
    const stmt=sqlite.prepare(sql),q={params:[],
      bind(...args){q.params=args;return q;},
      async first(){return stmt.get(...q.params)||null;},
      async all(){return {results:stmt.all(...q.params)};},
      async run(){const r=stmt.run(...q.params);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}}
    };return q;
  }};
  const objects=new Map();
  const env={DB:db,FILES:{
    async put(k,stream,metadata){objects.set(k,{bytes:new Uint8Array(await new Response(stream).arrayBuffer()),metadata})},
    async get(k){const obj=objects.get(k);return obj?{body:new Blob([obj.bytes]).stream()}:null},
    async delete(k){objects.delete(k)}
  }};
  return {sqlite,db,env,objects};
}
const jpg=new Uint8Array([255,216,255,224,0,16,74,70,73,70,0,1,2,3,4,5]);
function formRequest(fieldKey='referenceFiles',file=new File([jpg],'teste.jpg',{type:'image/jpeg'})){
  const form=new FormData();
  form.append('fieldKey',fieldKey);form.append('file',file);
  return new Request('https://libriconvites.test/upload',{method:'POST',body:form});
}
test('Ateliê private R2 upload, private reads and delete do not change V2 payments or status',async()=>{
  const {env,db,sqlite,objects}=fixture();
  const result=await uploadAtelieCustomerImage(formRequest(),env,TOKENS[0]);
  assert.ok(Number.isInteger(result.upload.id));
  assert.equal(objects.size,1);
  const item=(await listAtelieCustomerUploads(env,TOKENS[0]))[0];
  assert.equal(item.fieldKey,'referenceFiles');
  assert.ok(item.contentPath.includes(TOKENS[0]));
  assert.ok(!JSON.stringify(item).includes('r2_key'));
  const fileResponse=await streamAtelieCustomerImage(env,TOKENS[0],item.id);
  assert.equal(fileResponse.status,200);
  assert.equal(fileResponse.headers.get('cache-control'),'private, no-store, max-age=0');
  assert.equal(fileResponse.headers.get('x-content-type-options'),'nosniff');
  assert.equal((await streamAtelieCustomerImage(env,TOKENS[1],item.id)).status,404);
  assert.equal((await streamAtelieAdminImage(env,'LIBRI-2001',item.id)).status,200);
  assert.equal((await streamAtelieAdminImage(env,'LIBRI-2002',item.id)).status,404);
  await deleteAtelieCustomerImage(env,TOKENS[0],item.id);
  assert.equal(objects.size,0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM v3_atelie_uploads').get().n,0);
  assert.equal(sqlite.prepare('SELECT status FROM v2_orders WHERE id=1').get().status,'briefing_pending');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments WHERE id=1').get().n,1);
});
test('Unpaid orders and invitation products cannot receive images',async()=>{
  const {env,objects}=fixture();
  await assert.rejects(uploadAtelieCustomerImage(formRequest(),env,TOKENS[2]),/após pagamento/);
  assert.equal(await uploadAtelieCustomerImage(formRequest(),env,TOKENS[3]),null);
  assert.equal(await listAtelieCustomerUploads(env,TOKENS[3]),null);
  assert.equal(objects.size,0);
});
test('Child photos require contract scope and private-use permission, not portfolio consent',async()=>{
  const {env,db}=fixture();
  await assert.rejects(uploadAtelieCustomerImage(formRequest('childPhotos'),env,TOKENS[0]),/autorização/);
  await assert.rejects(uploadAtelieCustomerImage(formRequest('childPhotos'),env,TOKENS[1]),/autorização/);
  await saveAtelieCustomerBriefing(db,TOKENS[0],{
    revision:0,currentSection:'theme',data:{mascotMode:'criança ilustrada'}
  });
  await assert.rejects(uploadAtelieCustomerImage(formRequest('childPhotos'),env,TOKENS[0]),/autorização/);
  await saveAtelieCustomerBriefing(db,TOKENS[0],{
    revision:1,currentSection:'references',data:{childPhotoPermission:'sim'}
  });
  await saveAtelieCustomerBriefing(db,TOKENS[0],{
    revision:2,currentSection:'references',data:{guardianAuthorization:'sim'}
  });
  const photo=await uploadAtelieCustomerImage(formRequest('childPhotos'),env,TOKENS[0]);
  assert.equal(photo.upload.fieldKey,'childPhotos');
  await assert.rejects(saveAtelieCustomerBriefing(db,TOKENS[0],{
    revision:3,currentSection:'references',data:{childPhotoPermission:'não'}
  }),/exclua primeiro/);
  await deleteAtelieCustomerImage(env,TOKENS[0],photo.upload.id);
  const after=await saveAtelieCustomerBriefing(db,TOKENS[0],{
    revision:3,currentSection:'references',data:{childPhotoPermission:'não'}
  });
  assert.equal(after.data.childPhotoPermission,'não');
  assert.equal(after.schema.portfolioConsentDefault,false);
});
test('Disguised file signature, unknown field and excessive file count are rejected',async()=>{
  const {env,objects}=fixture();
  const fake=new File([new TextEncoder().encode('<svg onload=alert(1)>')],'fake.jpg',{type:'image/jpeg'});
  await assert.rejects(uploadAtelieCustomerImage(formRequest('referenceFiles',fake),env,TOKENS[0]),/não corresponde/);
  await assert.rejects(uploadAtelieCustomerImage(formRequest('outfit',new File([jpg],'x.jpg',{type:'image/jpeg'})),env,TOKENS[0]),/não permitido/);
  for(let i=0;i<6;i++)await uploadAtelieCustomerImage(formRequest(),env,TOKENS[0]);
  await assert.rejects(uploadAtelieCustomerImage(formRequest(),env,TOKENS[0]),/Limite de 6/);
  assert.equal(objects.size,6);
});
test('Child photo cannot be fetched using unapproved order token',async()=>{
  const {env,db}=fixture();
  await saveAtelieCustomerBriefing(db,TOKENS[0],{
    revision:0,currentSection:'theme',data:{mascotMode:'criança ilustrada'}
  });
  await assert.rejects(uploadAtelieCustomerImage(formRequest('childPhotos'),env,TOKENS[0]),/autorização/);
  await saveAtelieCustomerBriefing(db,TOKENS[0],{
    revision:1,currentSection:'references',data:{childPhotoPermission:'sim'}
  });
  await saveAtelieCustomerBriefing(db,TOKENS[0],{
    revision:2,currentSection:'references',data:{guardianAuthorization:'sim'}
  });
  const photo=await uploadAtelieCustomerImage(formRequest('childPhotos'),env,TOKENS[0]);
  assert.equal((await streamAtelieCustomerImage(env,TOKENS[1],photo.upload.id)).status,404);
  await assert.rejects(uploadAtelieCustomerImage(formRequest('childPhotos'),env,TOKENS[1]),/autorização/);
});
