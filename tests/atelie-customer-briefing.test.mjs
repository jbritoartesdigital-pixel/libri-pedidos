import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { getAtelieCustomerBriefing, saveAtelieCustomerBriefing } from '../src/lib/v3-atelie-customer-briefing.js';

const TOKEN='ord_'+'a'.repeat(36);
const TOKEN_UNPAID='ord_'+'b'.repeat(36);
const TOKEN_INVITE='ord_'+'c'.repeat(36);
function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec("CREATE TABLE v2_orders(id INTEGER PRIMARY KEY,order_code TEXT,public_token TEXT,status TEXT,event_type TEXT,event_date TEXT,honoree_display_name TEXT)");
  sqlite.exec("CREATE TABLE v2_products(id INTEGER PRIMARY KEY,code TEXT)");
  sqlite.exec("CREATE TABLE v2_product_variants(id INTEGER PRIMARY KEY,product_id INTEGER,code TEXT UNIQUE)");
  sqlite.exec("CREATE TABLE v2_order_items(id INTEGER PRIMARY KEY,order_id INTEGER,item_type TEXT,item_code TEXT,configuration_json TEXT)");
  sqlite.exec("CREATE TABLE v2_payments(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT)");
  sqlite.exec(readFileSync('migrations/0035_atelie_v3_briefing_draft.sql','utf8'));
  sqlite.exec("INSERT INTO v2_products(id,code) VALUES(1,'interactive_essential'),(2,'atelie_essencia')");
  sqlite.exec("INSERT INTO v2_product_variants(id,product_id,code) VALUES(1,1,'essential_default'),(2,2,'essencia_default')");
  for(const [id,token,code,variant,status] of [
    [1,TOKEN,'LIBRI-2001','essencia_default','briefing_pending'],
    [2,TOKEN_UNPAID,'LIBRI-2002','essencia_default','awaiting_payment'],
    [3,TOKEN_INVITE,'LIBRI-2003','essential_default','briefing_pending']
  ]){
    sqlite.prepare(
      'INSERT INTO v2_orders(id,order_code,public_token,status,event_type,event_date,honoree_display_name) VALUES(?,?,?,?,?,?,?)'
    ).run(id,code,token,status,'birthday','2027-02-14','Luna');
    sqlite.prepare(
      'INSERT INTO v2_order_items(order_id,item_type,item_code,configuration_json) VALUES(?,?,?,?)'
    ).run(id,'product',variant,JSON.stringify({productCode:variant==='essential_default'?'interactive_essential':'atelie_essencia',
      atelie:{contractedApplications:['Tag digital'],requiresChildPhoto:false}}));
  }
  sqlite.exec("INSERT INTO v2_payments(order_id,status) VALUES(1,'approved'),(3,'approved')");
  const db={prepare(sql){
    const st=sqlite.prepare(sql);
    const q={args:[],bind(...v){q.args=v;return q},
      async first(){return st.get(...q.args)||null},
      async all(){return{results:st.all(...q.args)}},
      async run(){const r=st.run(...q.args);return{success:true,meta:{changes:Number(r.changes)}}}};
    return q;
  }};
  return {db,sqlite};
}
test('Ateliê only, paid only, cannot edit V2 invitation or unpaid order',async()=>{
  const {db,sqlite}=fixture();
  assert.equal(await getAtelieCustomerBriefing(db,TOKEN_INVITE),null);
  assert.equal((await getAtelieCustomerBriefing(db,TOKEN_UNPAID)).locked,true);
  await assert.rejects(saveAtelieCustomerBriefing(db,TOKEN_UNPAID,{
    revision:0,currentSection:'direction',data:{theme:'Jardim'}
  }),/não está liberado/);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM v3_atelie_briefings').get().n,0);
});
test('prefilled fields and private save/continue with optimistic concurrency',async()=>{
  const {db,sqlite}=fixture();
  const initial=await getAtelieCustomerBriefing(db,TOKEN);
  assert.equal(initial.locked,false);
  assert.equal(initial.revision,0);
  assert.equal(initial.schema.sections[0].fields[0].prefill,'Luna');
  assert.equal(initial.schema.sections[0].fields[3].prefill,'2027-02-14');
  const saved=await saveAtelieCustomerBriefing(db,TOKEN,{
    revision:0,currentSection:'direction',data:{theme:'Jardim Encantado',styleFreedom:'a Libri pode decidir'}
  });
  assert.equal(saved.revision,1);
  assert.equal(saved.data.theme,'Jardim Encantado');
  assert.equal(saved.currentSection,'direction');
  await assert.rejects(saveAtelieCustomerBriefing(db,TOKEN,{
    revision:0,currentSection:'direction',data:{theme:'Outro tema'}
  }),/atualizadas em outro lugar/);
  assert.equal((await getAtelieCustomerBriefing(db,TOKEN)).data.theme,'Jardim Encantado');
  assert.equal(sqlite.prepare('SELECT status FROM v2_orders WHERE id=1').get().status,'briefing_pending');
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM v2_payments WHERE order_id=1').get().n,1);
});
test('partial answers work, invalid fields, upload injection and consent are rejected',async()=>{
  const {db}=fixture();
  const p=await saveAtelieCustomerBriefing(db,TOKEN,{
    revision:0,currentSection:'direction',data:{styleFreedom:''}
  });
  assert.equal(p.data.styleFreedom,'');
  await assert.rejects(saveAtelieCustomerBriefing(db,TOKEN,{
    revision:1,currentSection:'direction',data:{speech_preference:'no_speech'}
  }),/indisponível/);
  await assert.rejects(saveAtelieCustomerBriefing(db,TOKEN,{
    revision:1,currentSection:'references',data:{childPhotos:'some_public_url'}
  }),/indisponível/);
  await assert.rejects(saveAtelieCustomerBriefing(db,TOKEN,{
    revision:1,currentSection:'permissions',data:{portfolioConsent:'sim, autorizo a publicação'}
  }),/opção válida/);
});
test('style questions are conditional, and data is never auto-published',async()=>{
  const {db}=fixture();
  let p=await saveAtelieCustomerBriefing(db,TOKEN,{
    revision:0,currentSection:'direction',data:{styleFreedom:'quero escolher'}
  });
  assert.ok(p.schema.sections.flatMap(x=>x.fields).some(x=>x.key==='styleDetails'));
  p=await saveAtelieCustomerBriefing(db,TOKEN,{
    revision:1,currentSection:'direction',data:{styleDetails:'Delicado e elegante'}
  });
  assert.equal(p.data.styleDetails,'Delicado e elegante');
  p=await saveAtelieCustomerBriefing(db,TOKEN,{
    revision:2,currentSection:'direction',data:{styleFreedom:'a Libri pode decidir'}
  });
  assert.ok(!('styleDetails' in p.data));
  assert.equal(p.schema.portfolioConsentDefault,false);
  assert.equal(p.uploadsEnabled,false);
  assert.equal(p.canSubmit,false);
});
test('HTML routes remain integrated and do not replace customer payment, previews or contracts',()=>{
  const source=readFileSync('public/js/client-v2-area.js','utf8');
  assert.match(source,/isAtelieOrder/);
  assert.match(source,/atelieBriefingHtml/);
  assert.match(source,/bindAtelieBriefing/);
  assert.match(source,/bindPreview\(\)/);
  assert.match(source,/bindContract\(\)/);
  assert.match(source,/resumePayment/);
  const routes=readFileSync('src/routes/customer-area-v2.js','utf8');
  assert.match(routes,/getAtelieCustomerBriefing/);
  assert.match(routes,/saveAtelieCustomerBriefing/);
  assert.match(routes,/saveV2Briefing/);
});
