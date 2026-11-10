import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  blackLibriOperational, revealBlackLibri, findBlackLibriClaim,
  reservedBlackLibriForCheckout, expireBlackLibriClaims,
} from '../src/lib/v2-black-libri.js';
import {
  getBlackLibriAdmin, saveBlackLibriPrize, saveBlackLibriCampaign
} from '../src/lib/v2-black-libri-admin.js';

function fixture() {
  const sqlite=new DatabaseSync(':memory:');
  for(const name of ['0003_v2_core.sql','0029_black_libri.sql','0030_black_libri_admin.sql']) {
    sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  }
  const db={
    prepare(sql) {
      const statement=(...args)=>({
        async first() { return sqlite.prepare(sql).get(...args)||null; },
        async all() { return {results:sqlite.prepare(sql).all(...args)}; },
        async run() {
          const result=sqlite.prepare(sql).run(...args);
          return {meta:{changes:Number(result.changes||0),last_row_id:Number(result.lastInsertRowid||0)}};
        }
      });
      return { ...statement(), bind(...args){ return statement(...args); } };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const result=[];
        for(const stmt of statements) result.push(await stmt.run());
        sqlite.exec('COMMIT');
        return result;
      } catch(error) { sqlite.exec('ROLLBACK');throw error; }
    }
  };
  const env={
    DB:db,BLACK_LIBRI_ENABLED:'1',
    BLACK_LIBRI_IDENTITY_SECRET:'test-only-identity-secret-longer-than-24-chars',
    BLACK_LIBRI_START:'2020-01-01T00:00:00-03:00',
    BLACK_LIBRI_END:'2030-01-01T00:00:00-03:00'
  };
  return {env,db,sqlite,close:()=>sqlite.close()};
}
const consent={
  adminEnabled:true,complianceConfirmed:true,
  authorizationReference:'PROTOCOLO-TESTE-APENAS',
  adminNote:'Dados sintéticos para os testes automatizados'
};

test('a campanha não liga por variáveis ambientais sem habilitação no Admin',async()=>{
  const f=fixture();
  try {
    assert.equal(await blackLibriOperational(f.env),false);
    let view=await getBlackLibriAdmin(f.env);
    assert.equal(view.prizes.length,19);
    assert.equal(view.summary.totalWeight,200);
    assert.equal(view.campaign.adminEnabled,false);
    await saveBlackLibriCampaign(f.env,{...consent,adminEnabled:false});
    assert.equal(await blackLibriOperational(f.env),false);
    await saveBlackLibriCampaign(f.env,consent);
    assert.equal(await blackLibriOperational(f.env),true);
    view=await getBlackLibriAdmin(f.env);
    assert.equal(view.active,true);
  } finally {f.close();}
});

test('ativação exige referência de autorização e segredo do ambiente',async()=>{
  const f=fixture();
  try {
    await assert.rejects(()=>saveBlackLibriCampaign(f.env,{...consent,authorizationReference:''}),/autorização/i);
    await assert.rejects(()=>saveBlackLibriCampaign({
      ...f.env,BLACK_LIBRI_IDENTITY_SECRET:''
    },consent),/Configure primeiro/i);
    assert.equal(await blackLibriOperational(f.env),false);
  } finally {f.close();}
});

test('reserva única persiste por WhatsApp, navegador e reentrada',async()=>{
  const f=fixture();
  try {
    await saveBlackLibriCampaign(f.env,consent);
    const customer={whatsapp:'(61) 99999-1234'};
    const first=await revealBlackLibri(f.env,customer,'checkout_first_customer_123');
    assert.equal(first.alreadyRevealed,false);
    assert.equal(first.claim.status,'reserved');
    assert.ok(Date.parse(first.claim.expiresAt)-Date.now()>23*60*60*1000);
    const replay=await revealBlackLibri(f.env,{whatsapp:'5561999991234'},'checkout_new_browser_12345');
    assert.equal(replay.alreadyRevealed,true);
    assert.equal(replay.claim.id,first.claim.id);
    assert.equal(replay.claim.code,first.claim.code);
    const again=await reservedBlackLibriForCheckout(f.env,customer,'any_other_cart_request');
    assert.equal(again.id,first.claim.id);
    const overview=await getBlackLibriAdmin(f.env);
    assert.equal(overview.summary.totalRevealed,1);
    assert.equal(overview.summary.reserved,1);
  } finally {f.close();}
});

test('premiação expirada nunca gera segundo sorteio',async()=>{
  const f=fixture();
  try {
    await saveBlackLibriCampaign(f.env,consent);
    const customer={whatsapp:'61988887777'};
    const first=await revealBlackLibri(f.env,customer,'checkout_expiry_test_12');
    f.sqlite.prepare('UPDATE v2_black_libri_claims SET expires_at=? WHERE id=?')
      .run('2021-01-01T00:00:00Z',first.claim.id);
    await expireBlackLibriClaims(f.db);
    const claim=await findBlackLibriClaim(f.env,customer);
    assert.equal(claim.status,'expired');
    assert.equal(await reservedBlackLibriForCheckout(f.env,customer,'another_id'),null);
    const next=await revealBlackLibri(f.env,customer,'checkout_new_request_123');
    assert.equal(next.alreadyRevealed,true);
    assert.equal(next.claim.id,first.claim.id);
    assert.equal(next.claim.status,'expired');
  } finally {f.close();}
});

test('admin pausa antes de alterar peso; limite não pode excluir reserva vigente',async()=>{
  const f=fixture();
  try {
    await saveBlackLibriCampaign(f.env,consent);
    await assert.rejects(()=>saveBlackLibriPrize(f.env,'off_10',
      {weight:32,maxClaims:20,enabled:true}),/Pause a campanha/i);
    await saveBlackLibriCampaign(f.env,{...consent,adminEnabled:false});
    await saveBlackLibriPrize(f.env,'off_10',{weight:35,maxClaims:10,enabled:true});
    const overview=await getBlackLibriAdmin(f.env);
    assert.equal(overview.prizes.find(p=>p.code==='off_10').weight,35);
    assert.equal(overview.summary.totalWeight,205);
    const audit=f.sqlite.prepare('SELECT count(*) AS total FROM v2_black_libri_audit').get();
    assert.ok(audit.total>=3);
  } finally {f.close();}
});

test('prêmio já revelado permanece imutável mesmo depois de mudar pesos',async()=>{
  const f=fixture();
  try {
    await saveBlackLibriCampaign(f.env,consent);
    const customer={whatsapp:'61966668888'};
    const first=await revealBlackLibri(f.env,customer,'checkout_locked_value_123');
    await saveBlackLibriCampaign(f.env,{...consent,adminEnabled:false});
    await saveBlackLibriPrize(f.env,first.claim.code,{
      weight:12,maxClaims:50,enabled:false
    });
    const repeat=await findBlackLibriClaim(f.env,customer);
    assert.equal(repeat.prize_code,first.claim.code);
    assert.equal(repeat.value,first.claim.value);
    assert.equal(repeat.label,first.claim.label);
  } finally {f.close();}
});
