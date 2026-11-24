import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAtelieBriefingBlueprint} from '../src/lib/v3-atelie-briefing.js';
import {buildV2BriefingSimulationSchema} from '../src/lib/v2-customer-area.js';
import {database} from './helpers.mjs';
import {updateAtelieDraft} from '../src/lib/v3-atelie-catalog.js';
import {setAtelieSaleStatus} from '../src/lib/v3-atelie-release.js';

const keys=schema=>schema.sections.flatMap(section=>section.fields.map(field=>field.key));
test('Ateliê offers 1/2/3 mascot poses and separates main illustration from extras',()=>{
  for(const [code,n] of [['essencia',1],['encanto',2],['universo',3]]){
    const schema=buildAtelieBriefingBlueprint({packageCode:code,requiresChildPhoto:true,data:{}});
    assert.ok(keys(schema).includes('mascotMode'));
    assert.ok(keys(schema).includes('additionalSubjects'));
    assert.equal(schema.sections.flatMap(x=>x.fields).find(x=>x.key==='includedPosesInfo').label.includes(String(n)),true);
    assert.ok(!keys(schema).includes('childPhotos'));
  }
  const child=buildAtelieBriefingBlueprint({packageCode:'encanto',requiresChildPhoto:true,
    data:{mascotMode:'criança ilustrada',childPhotoPermission:'sim',guardianAuthorization:'sim',
      additionalSubjects:'quero solicitar orçamento',multipleHonorees:'sim'}});
  assert.ok(keys(child).includes('childPhotos'));
  assert.ok(keys(child).includes('additionalSubjectsDetails'));
  assert.ok(keys(child).includes('honoreesNamesAges'));
  const alt=buildAtelieBriefingBlueprint({requiresChildPhoto:true,data:{mascotMode:'ilustração temática'}});
  assert.ok(!keys(alt).includes('childPhotos'));
  assert.ok(!keys(alt).includes('childPhotoPermission'));
});
test('Convite de irmãos permite vários nomes sem multiplicar personagens cobrados',()=>{
  const base={product:{code:'cinematic_interactive',name:'Convite interativo'},eventType:'birthday',addons:[]};
  const s0=buildV2BriefingSimulationSchema({...base,data:{}});
  assert.ok(keys(s0).includes('joint_celebration'));
  assert.ok(keys(s0).includes('age'));
  const one=buildV2BriefingSimulationSchema({...base,data:{joint_celebration:'yes',appearance_choice:'yes'}});
  assert.ok(keys(one).includes('joint_honorees'));
  assert.ok(!keys(one).includes('age'));
  assert.ok(keys(one).includes('additional_illustrated_subjects'));
  const extras=buildV2BriefingSimulationSchema({...base,data:{
    joint_celebration:'yes',appearance_choice:'yes',additional_illustrated_subjects:'yes'}});
  assert.ok(keys(extras).includes('additional_illustrated_subjects_details'));
  assert.ok(!keys(extras).includes('age'));
  const no=buildV2BriefingSimulationSchema({...base,data:{appearance_choice:'no'}});
  assert.ok(keys(no).includes('additional_illustrated_subjects'));
});
test('Ateliê release records one principal illustrated subject and poses by package',async()=>{
  const db=database();
  for(const [code,n] of [['essencia',1],['encanto',2],['universo',3]]){
    await updateAtelieDraft(db,code,{
      includedItems:['Marca',n+' poses do mascote'],excludedItems:['Produção física'],
      priceCents:15900,pointsUnits:100,revisionLimit:1,scopeReference:'Ateliê V4.1',
      specificTerms:'O pacote inclui apenas a ilustração principal e suas poses contratadas. '+
       'Crianças ou animais ilustrados adicionais precisam de orçamento e aceite separado. '+
       'Nenhuma foto é divulgada sem consentimento.'
    });
    await updateAtelieDraft(db,code,{scopeApproved:true});
    const status=await setAtelieSaleStatus(db,code,true);
    assert.equal(status.enabled,true);
    const raw=db.sqlite.prepare("SELECT config_json FROM v2_product_variants WHERE code=?").get('atelie_'+code+'_default');
    const contract=JSON.parse(raw.config_json).atelie;
    assert.equal(contract.includedIllustratedSubjects,1);
    assert.equal(contract.includedMascotPoses,n);
    assert.equal(contract.requiresChildPhoto,true);
    assert.equal(contract.additionalSubjectsNeedQuote,true);
  }
});
