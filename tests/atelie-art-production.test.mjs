import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { getAtelieArtProgress, updateAtelieArtProgress } from '../src/lib/v3-atelie-art-production.js';

// Banco mínimo com estrutura V2 essencial. Não modifica dados de produção.
function fixture() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec("CREATE TABLE v2_orders(id INTEGER PRIMARY KEY,order_code TEXT UNIQUE,status TEXT)");
  sqlite.exec("CREATE TABLE v2_products(id INTEGER PRIMARY KEY,code TEXT)");
  sqlite.exec("CREATE TABLE v2_product_variants(id INTEGER PRIMARY KEY,product_id INTEGER,code TEXT UNIQUE)");
  sqlite.exec("CREATE TABLE v2_order_items(id INTEGER PRIMARY KEY,order_id INTEGER,item_type TEXT,item_code TEXT,configuration_json TEXT)");
  sqlite.exec("CREATE TABLE v2_payments(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT)");
  sqlite.exec("CREATE TABLE v2_agenda_allocations(id INTEGER PRIMARY KEY,order_id INTEGER,allocation_type TEXT)");
  sqlite.exec("CREATE TABLE v2_previews(id INTEGER PRIMARY KEY,order_id INTEGER,version_number INTEGER,status TEXT)");
  sqlite.exec("CREATE TABLE v2_preview_approvals(id INTEGER PRIMARY KEY,preview_id INTEGER,approved_at TEXT)");
  sqlite.exec(readFileSync('migrations/0037_atelie_v3_briefing_submission.sql','utf8'));
  sqlite.exec(readFileSync('migrations/0034_atelie_v3_art_production.sql','utf8'));
  sqlite.exec("INSERT INTO v2_products(id,code) VALUES(1,'interactive_essential'),(2,'atelie_essencia')");
  sqlite.exec("INSERT INTO v2_product_variants(id,product_id,code) VALUES(1,1,'interactive_essential_base'),(2,2,'atelie_essencia_base')");
  for (const [id,code,product,paid] of [
    [1,'LIBRI-1001',1,true],[2,'LIBRI-2001',2,true],[3,'LIBRI-2002',2,false]
  ]) {
    sqlite.prepare('INSERT INTO v2_orders(id,order_code,status) VALUES(?,?,?)')
      .run(id,code,paid?'in_production':'awaiting_payment');
    sqlite.prepare('INSERT INTO v2_order_items(order_id,item_type,item_code,configuration_json) VALUES(?,?,?,?)')
      .run(id,'product',product===1?'interactive_essential_base':'atelie_essencia_base',
        JSON.stringify({productCode:product===1?'interactive_essential':'atelie_essencia',
          atelie:{revisionLimit:1}}));
    if(paid)sqlite.prepare("INSERT INTO v2_payments(order_id,status) VALUES(?,'approved')").run(id);
    if(product===2&&paid) {
      sqlite.prepare("INSERT INTO v2_agenda_allocations(order_id,allocation_type) VALUES(?,'confirmed')").run(id);
      sqlite.prepare("INSERT INTO v3_atelie_briefing_submissions(order_id,status,submitted_revision) VALUES(?,'submitted',0)").run(id);
    }
  }
  const db={
    prepare(sql){
      const st=sqlite.prepare(sql),o={
        values:[],
        bind(...values){o.values=values;return o;},
        async first(){return st.get(...o.values)||null;},
        async all(){return {results:st.all(...o.values)};},
        async run(){const v=st.run(...o.values);return {success:true,meta:{changes:Number(v.changes)}};},
        execute(){const v=st.run(...o.values);return {success:true,meta:{changes:Number(v.changes)}};}
      };
      return o;
    },
    async batch(items){
      sqlite.exec('BEGIN');
      try{
        const out=items.map(x=>x.execute());
        sqlite.exec('COMMIT');
        return out;
      }catch(e){sqlite.exec('ROLLBACK');throw e;}
    }
  };
  return {sqlite,db};
}
test('V2 invitation orders cannot open or mutate Ateliê production',async()=>{
  const {db}=fixture();
  assert.equal(await getAtelieArtProgress(db,'LIBRI-1001'),null);
  await assert.rejects(updateAtelieArtProgress(db,'LIBRI-1001',{
    action:'stage',nextStage:'art_direction',version:0
  }),/não encontrado/);
});
test('Unpaid Ateliê orders remain read-only, no history created',async()=>{
  const {db,sqlite}=fixture();
  const item=await getAtelieArtProgress(db,'LIBRI-2002');
  assert.equal(item.canEdit,false);
  await assert.rejects(updateAtelieArtProgress(db,'LIBRI-2002',{
    action:'stage',nextStage:'art_direction',version:0
  }),/ainda não está liberado/);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM v3_atelie_art_history').get().n,0);
});
test('Ateliê art stages, versions and revisions are logged without touching V2 status or money',async()=>{
  const {db,sqlite}=fixture();
  const initial=await getAtelieArtProgress(db,'LIBRI-2001');
  assert.equal(initial.stage,'briefing');
  assert.equal(initial.version,0);
  assert.equal(initial.revisionsIncluded,1);
  const direction=await updateAtelieArtProgress(db,'LIBRI-2001',{
    action:'stage',nextStage:'art_direction',version:0,note:'Direção definida'
  });
  assert.equal(direction.stage,'art_direction');
  assert.equal(direction.version,1);
  await assert.rejects(updateAtelieArtProgress(db,'LIBRI-2001',{
    action:'stage',nextStage:'creation',version:0
  }),/atualize/i);
  const creation=await updateAtelieArtProgress(db,'LIBRI-2001',{
    action:'stage',nextStage:'creation',version:1
  });
  assert.equal(creation.stage,'creation');
  const review=await updateAtelieArtProgress(db,'LIBRI-2001',{
    action:'revision',version:2,note:'Ajustar paleta da arte'
  });
  assert.equal(review.revisionsUsed,1);
  await assert.rejects(updateAtelieArtProgress(db,'LIBRI-2001',{
    action:'revision',version:3,note:'Outro ajuste'
  }),/esgotadas/);
  const extra=await updateAtelieArtProgress(db,'LIBRI-2001',{
    action:'extra_quote',version:3,note:'Orçar personagem autoral adicional'
  });
  assert.equal(extra.history.length,4);
  assert.equal(sqlite.prepare("SELECT status FROM v2_orders WHERE order_code='LIBRI-2001'").get().status,'in_production');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM v2_payments WHERE order_id=2").get().n,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM v3_atelie_art_history WHERE action='revision_used'").get().n,1);
});
test('Art direction requires a submitted briefing and confirmed agenda',async()=>{
  const {db,sqlite}=fixture();
  sqlite.exec('DELETE FROM v3_atelie_briefing_submissions WHERE order_id=2');
  let art=await getAtelieArtProgress(db,'LIBRI-2001');
  assert.equal(art.briefingSubmitted,false);
  assert.ok(!art.nextStages.includes('art_direction'));
  await assert.rejects(updateAtelieArtProgress(db,'LIBRI-2001',{
    action:'stage',nextStage:'art_direction',version:0
  }),/briefing e a reserva/);
  sqlite.exec("INSERT INTO v3_atelie_briefing_submissions(order_id,status,submitted_revision) VALUES(2,'submitted',0)");
  sqlite.exec('DELETE FROM v2_agenda_allocations WHERE order_id=2');
  art=await getAtelieArtProgress(db,'LIBRI-2001');
  assert.equal(art.agendaConfirmed,false);
  await assert.rejects(updateAtelieArtProgress(db,'LIBRI-2001',{
    action:'stage',nextStage:'art_direction',version:0
  }),/briefing e a reserva/);
});
test('Only latest customer-approved preview permits delivery',async()=>{
  const {db,sqlite}=fixture();
  sqlite.exec("INSERT INTO v3_atelie_art_production(order_id,stage,version) VALUES(2,'approval',0)");
  let art=await getAtelieArtProgress(db,'LIBRI-2001');
  assert.equal(art.previewApproved,false);
  await assert.rejects(updateAtelieArtProgress(db,'LIBRI-2001',{
    action:'stage',nextStage:'delivery',version:0
  }),/versão mais recente/);
  sqlite.exec("INSERT INTO v2_previews(id,order_id,version_number,status) VALUES(11,2,1,'approved')");
  sqlite.exec("INSERT INTO v2_preview_approvals(preview_id,approved_at) VALUES(11,datetime('now'))");
  art=await getAtelieArtProgress(db,'LIBRI-2001');
  assert.equal(art.previewApproved,true);
  assert.ok(art.nextStages.includes('delivery'));
  sqlite.exec("INSERT INTO v2_previews(id,order_id,version_number,status) VALUES(12,2,2,'active')");
  art=await getAtelieArtProgress(db,'LIBRI-2001');
  assert.equal(art.previewApproved,false);
  assert.ok(!art.nextStages.includes('delivery'));
});
test('Invalid stage transition and missing extra detail are rejected',async()=>{
  const {db}=fixture();
  await assert.rejects(updateAtelieArtProgress(db,'LIBRI-2001',{
    action:'stage',nextStage:'delivery',version:0
  }),/Etapa seguinte inválida/);
  await assert.rejects(updateAtelieArtProgress(db,'LIBRI-2001',{
    action:'extra_quote',note:'curto',version:0
  }),/Descreva o item extra/);
});
