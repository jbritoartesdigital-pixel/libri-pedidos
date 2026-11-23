import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { submitAtelieCreativeBriefing, reopenAtelieCreativeBriefing } from '../src/lib/v3-atelie-briefing-submission.js';
import { getAtelieCustomerBriefing, saveAtelieCustomerBriefing, getAtelieAdminBriefing, getAtelieUploadAccess } from '../src/lib/v3-atelie-customer-briefing.js';

const TOKEN='ord_'+('a'.repeat(36));
const UNPAID='ord_'+('b'.repeat(36));
const INVITE='ord_'+('c'.repeat(36));
function fixture() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec('CREATE TABLE v2_orders(id INTEGER PRIMARY KEY,order_code TEXT,public_token TEXT,status TEXT,event_type TEXT,event_date TEXT,honoree_display_name TEXT)');
  sqlite.exec('CREATE TABLE v2_products(id INTEGER PRIMARY KEY,code TEXT)');
  sqlite.exec('CREATE TABLE v2_product_variants(id INTEGER PRIMARY KEY,product_id INTEGER,code TEXT UNIQUE)');
  sqlite.exec('CREATE TABLE v2_order_items(id INTEGER PRIMARY KEY,order_id INTEGER,item_type TEXT,item_code TEXT,configuration_json TEXT)');
  sqlite.exec('CREATE TABLE v2_payments(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT)');
  sqlite.exec(readFileSync('migrations/0034_atelie_v3_art_production.sql','utf8'));
  sqlite.exec(readFileSync('migrations/0035_atelie_v3_briefing_draft.sql','utf8'));
  sqlite.exec(readFileSync('migrations/0036_atelie_v3_private_uploads.sql','utf8'));
  sqlite.exec(readFileSync('migrations/0037_atelie_v3_briefing_submission.sql','utf8'));
  sqlite.exec("INSERT INTO v2_products(id,code) VALUES(1,'atelie_essencia'),(2,'interactive_essential')");
  sqlite.exec("INSERT INTO v2_product_variants(id,product_id,code) VALUES(1,1,'atelie_essencia_base'),(2,2,'interactive_base')");
  for(const [id,token,code,variant,status] of [
    [1,TOKEN,'LIBRI-2201','atelie_essencia_base','briefing_pending'],
    [2,UNPAID,'LIBRI-2202','atelie_essencia_base','awaiting_payment'],
    [3,INVITE,'LIBRI-2203','interactive_base','briefing_pending']
  ]) {
    sqlite.prepare('INSERT INTO v2_orders(id,order_code,public_token,status,event_type,event_date,honoree_display_name) VALUES(?,?,?,?,?,?,?)')
      .run(id,code,token,status,'birthday','2027-02-14','Festa');
    sqlite.prepare('INSERT INTO v2_order_items(order_id,item_type,item_code,configuration_json) VALUES(?,?,?,?)')
      .run(id,'product',variant,'{"atelie":{"requiresChildPhoto":false}}');
  }
  sqlite.exec("INSERT INTO v2_payments(order_id,status) VALUES(1,'approved'),(3,'approved')");
  const db={prepare(sql) {
    const stmt=sqlite.prepare(sql),out={args:[],
      bind(...args){out.args=args;return out;},
      async first(){return stmt.get(...out.args)||null;},
      async all(){return{results:stmt.all(...out.args)};},
      async run(){const r=stmt.run(...out.args);return{success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}}
    };
    return out;
  }};
  const env={DB:db};
  return {db,env,sqlite};
}
async function completed(db) {
  let x=await saveAtelieCustomerBriefing(db,TOKEN,{
    revision:0,currentSection:'style',data:{theme:'Jardim encantado',styleFreedom:'a Libri pode decidir'}
  });
  x=await saveAtelieCustomerBriefing(db,TOKEN,{
    revision:x.revision,currentSection:'permissions',data:{exactTexts:'Luna faz 3 anos'}
  });
  return x;
}
test('Draft requires mandatory answers, but cannot change V2 order state',async()=>{
  const {db,env,sqlite}=fixture();
  await assert.rejects(submitAtelieCreativeBriefing(env,TOKEN,{revision:0}),/faltam informações/);
  const ready=await completed(db);
  assert.equal(ready.canSubmit,true);
  assert.equal(ready.missing.length,0);
  const result=await submitAtelieCreativeBriefing(env,TOKEN,{revision:ready.revision});
  assert.equal(result.alreadySubmitted,false);
  assert.equal(result.briefing.submitted,true);
  assert.equal(result.briefing.canSubmit,false);
  assert.equal(result.briefing.editable,false);
  assert.equal(sqlite.prepare('SELECT status FROM v2_orders WHERE id=1').get().status,'briefing_pending');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM v2_payments WHERE order_id=1').get().n,1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM v3_atelie_briefing_events').get().n,1);
});
test('Submission is idempotent, prevents edits and upload after submission',async()=>{
  const {db,env,sqlite}=fixture();
  const ready=await completed(db);
  await submitAtelieCreativeBriefing(env,TOKEN,{revision:ready.revision});
  const repeated=await submitAtelieCreativeBriefing(env,TOKEN,{revision:ready.revision});
  assert.equal(repeated.alreadySubmitted,true);
  await assert.rejects(saveAtelieCustomerBriefing(db,TOKEN,{revision:ready.revision,
    currentSection:'theme',data:{theme:'Outros'}}),/já foi enviado/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM v3_atelie_briefing_events').get().n,1);
  const state=await getAtelieCustomerBriefing(db,TOKEN);
  assert.equal(state.submitted,true);
  assert.equal((await getAtelieUploadAccess(db,TOKEN)).canWrite,false);
  const manager=await getAtelieAdminBriefing(db,'LIBRI-2201');
  assert.equal(manager.submitted,true);
});
test('Unpaid and invitation orders cannot submit an Ateliê briefing',async()=>{
  const {env,sqlite}=fixture();
  await assert.rejects(submitAtelieCreativeBriefing(env,UNPAID,{revision:0}),/não está disponível/);
  assert.equal(await submitAtelieCreativeBriefing(env,INVITE,{revision:0}),null);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM v3_atelie_briefing_events').get().n,0);
});
test('Admin may request complements with reason; client can re-submit exactly once',async()=>{
  const {db,env,sqlite}=fixture();
  const ready=await completed(db);
  await submitAtelieCreativeBriefing(env,TOKEN,{revision:ready.revision});
  await assert.rejects(reopenAtelieCreativeBriefing(db,'LIBRI-2201',{note:'curto'}),/10 a 500/);
  const reopened=await reopenAtelieCreativeBriefing(db,'LIBRI-2201',{
    note:'Precisamos confirmar a grafia do nome.'
  });
  assert.equal(reopened.submitted,false);
  let state=await getAtelieCustomerBriefing(db,TOKEN);
  assert.equal(state.editable,true);
  state=await saveAtelieCustomerBriefing(db,TOKEN,{
    revision:ready.revision,currentSection:'applications',data:{exactTexts:'Luna completa três aninhos'}
  });
  const done=await submitAtelieCreativeBriefing(env,TOKEN,{revision:state.revision});
  assert.equal(done.alreadySubmitted,false);
  assert.equal(done.briefing.submitted,true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM v3_atelie_briefing_events WHERE action='submitted'").get().n,2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM v3_atelie_briefing_events WHERE action='reopened'").get().n,1);
});
test('Reopen is blocked if art direction already started',async()=>{
  const {db,env}=fixture();
  const ready=await completed(db);
  await submitAtelieCreativeBriefing(env,TOKEN,{revision:ready.revision});
  await db.prepare("INSERT INTO v3_atelie_art_production(order_id,stage,version) VALUES(1,'creation',1)").run();
  await assert.rejects(reopenAtelieCreativeBriefing(db,'LIBRI-2201',{
    note:'Completar a direção artística.'
  }),/Retorne a etapa artística/);
});
