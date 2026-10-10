import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProjectBible,buildSocialDraft,renderSocialDraft}
  from '../scripts/libri-project-automation.mjs';

const hash='a'.repeat(64);
const valid={
  projectId:'proj_TesteLibri0001',orderCode:'ord_123456789000',
  format:'interativo',driveFolderId:'1abcDEF0123456789012345678XY',
  decisions:[{topic:'Estilo',decision:'Fundo delicado com jardim',
    updatedAt:'2026-10-10T11:00:00Z'}],
  approvals:[
    {id:'aprov_cena001v1',type:'scene',sceneNumber:1,version:1,
      approved:true,approvedAt:'2026-10-10T11:00:00Z',sha256:hash,
      mimeType:'image/png',sourceRef:'media_001'},
    {id:'aprov_cena001v2',type:'scene',sceneNumber:1,version:2,
      approved:true,approvedAt:'2026-10-10T11:01:00Z',sha256:'b'.repeat(64),
      mimeType:'image/png',sourceRef:'media_002'},
    {id:'aprov_preview0001',type:'preview',version:1,approved:true,
      approvedAt:'2026-10-10T11:05:00Z',mimeType:'video/mp4',
      sha256:'c'.repeat(64),sourceRef:'media_003'},
    {id:'aprov_final0001',type:'final_video',version:1,approved:true,
      approvedAt:'2026-10-10T11:06:00Z',mimeType:'video/mp4',
      sha256:'d'.repeat(64),sourceRef:'media_004'}
  ]
};
test('Project Bible exige identificador exato da pasta, sem adivinhar pelo nome',()=>{
  assert.throws(()=>buildProjectBible({...valid,driveFolderId:null}),/Vínculo seguro/);
  assert.throws(()=>buildProjectBible({...valid,driveFolderId:'Aurora'}),/Vínculo seguro/);
  assert.throws(()=>buildProjectBible({...valid,orderCode:''}),/Pedido/);
});
test('cada cena aprovada vira nome simples e histórico é preservado',()=>{
  const b=buildProjectBible(valid);
  assert.equal(b.format,'interativo');
  assert.equal(b.uploadPlan.length,4);
  assert.equal(b.approvals.find(x=>x.id==='aprov_cena001v2').targetName,'Cena 1.png');
  assert.equal(b.approvals.find(x=>x.id==='aprov_cena001v1').primary,false);
  assert.match(b.approvals.find(x=>x.id==='aprov_cena001v1').targetName,/Historico\/Cena 1_v01/);
  assert.equal(b.approvals.find(x=>x.id==='aprov_preview0001').targetName,'Preview.mp4');
  assert.equal(b.approvals.find(x=>x.id==='aprov_final0001').targetName,'Video Final.mp4');
  assert.ok(b.uploadPlan.every(x=>x.driveFolderId===valid.driveFolderId));
  assert.ok(b.uploadPlan.every(x=>x.rule==='create-only-after-checking-existing-file-and-hash'));
});
test('proíbe misturar pedidos e anexos inseguros ou não aprovados',()=>{
  assert.throws(()=>buildProjectBible({...valid,approvals:[{...valid.approvals[0],approved:false}]}),/aprovações confirmadas/i);
  assert.throws(()=>buildProjectBible({...valid,approvals:[{...valid.approvals[0],sourceRef:'https://example.com/key?token=abc'}]}),/Identificador/);
  assert.throws(()=>buildProjectBible({...valid,approvals:[valid.approvals[0],valid.approvals[0]]}),/repetida/);
  assert.throws(()=>buildProjectBible({...valid,approvals:[{...valid.approvals[0],sha256:'not-a-hash'}]}),/SHA-256/);
});
test('somente vídeo final aprovado com consentimento gera pacote social',()=>{
  const bible=buildProjectBible(valid);
  const pending=buildSocialDraft(bible);
  assert.equal(pending.canRender,false);
  assert.equal(pending.needsApproval,true);
  assert.throws(()=>renderSocialDraft(pending,'video.mp4','/tmp/social'),/Autorização/);
  const ready=buildSocialDraft(bible,{hasMarketingPermission:true});
  assert.equal(ready.canRender,true);
  assert.deepEqual(ready.formats.map(x=>x.name),
    ['Reels_9x16.mp4','Stories_9x16.mp4','Capa_9x16.jpg']);
  assert.doesNotMatch(ready.caption,/Criança Exemplo|Cliente Fictícia|Rua /);
  assert.match(ready.rules.join(' '),/Nunca publicar automaticamente/);
  assert.equal(ready.selectedSourceId,'media_004');
  const noFinal=buildProjectBible({...valid,approvals:valid.approvals.filter(x=>x.type!=='final_video')});
  assert.equal(buildSocialDraft(noFinal,{hasMarketingPermission:true}).canRender,false);
});
test('outros formatos mantêm prefixos diferentes para evitar confusão',()=>{
  for(const fmt of ['video','loop','save_the_date','casamento','outro']){
    const b=buildProjectBible({...valid,format:fmt,approvals:[
      {...valid.approvals[0],type:'loop',sceneNumber:undefined}]});
    assert.equal(b.uploadPlan[0].targetName,'Loop.png');
  }
});
