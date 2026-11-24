import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database } from './helpers.mjs';
import worker from '../src/index.js';
import { listAteliePackages, updateAtelieDraft } from '../src/lib/v3-atelie-catalog.js';
import { buildAtelieBriefingBlueprint } from '../src/lib/v3-atelie-briefing.js';
import {ATELIE_V41_APPROVED_CATALOG,getAtelieV41CatalogDraft} from '../src/lib/v3-atelie-v41-commercial-catalog.js';
import { loadV2Catalog } from '../src/lib/v2-catalog.js';
import { calculateCommercialV2Quote } from '../src/lib/v2-commercial-pricing.js';

test('Ateliê V4.1 registra valores antigos e 3/4/5 poses com paleta e tipografia sem abrir venda',async()=>{
  const db=database({beforeApprovedAtelie:true});
  for(const [code,price,poses] of [['essencia',15900,3],['encanto',29900,4],['universo',54900,5]]) {
    const spec=ATELIE_V41_APPROVED_CATALOG[code];
    assert.equal(spec.priceCents,price);
    assert.equal(spec.mascotPoses,poses);
    assert.ok(spec.includedItems.some(x=>/paleta/i.test(x)));
    assert.ok(spec.includedItems.some(x=>/tipogr/i.test(x)));
    assert.ok(spec.includedItems.some(x=>new RegExp(poses+' poses').test(x)));
    const patch=getAtelieV41CatalogDraft(code);
    assert.equal(patch.priceCents,price);
    assert.equal(patch.pointsUnits,spec.pointsUnits);
    await updateAtelieDraft(db,code,patch);
    await updateAtelieDraft(db,code,{scopeApproved:true});
  }
  const admin=await listAteliePackages(db,{admin:true});
  assert.deepEqual(admin.map(x=>x.priceCents),[15900,29900,54900]);
  assert.ok(admin.every(x=>x.scopeApproved && !x.saleEnabled));
  assert.deepEqual(admin.map(x=>x.pointsUnits),[300,500,800]);
  assert.ok(admin.every(x=>!x.releaseMissing.includes('Carga de produção não definida')));
  const publicRows=await listAteliePackages(db);
  assert.ok(publicRows.every(x=>x.includedItems.some(i=>/paleta/i.test(i))));
  assert.ok(publicRows.every(x=>!('priceCents' in x)&&!x.purchaseAvailable));
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_orders').get().n,0);
});

test('Ateliê starts with exactly three safe packages, no prices and no V2 sale products', async () => {
  const db=database({beforeApprovedAtelie:true});
  const admin=await listAteliePackages(db,{admin:true});
  assert.deepEqual(admin.map(p=>p.code),['essencia','encanto','universo']);
  assert.ok(admin.every(p=>p.priceCents===null&&p.pointsUnits===null&&p.revisionLimit===null));
  assert.ok(admin.every(p=>p.purchaseAvailable===false&&p.scopeApproved===false));
  const publicRows=await listAteliePackages(db);
  assert.ok(publicRows.every(p=>!('priceCents' in p)&&!('pointsUnits' in p)&&!('includedDraft' in p)));
  assert.ok(publicRows.every(p=>p.includedItems.length===0&&p.purchaseAvailable===false));
  const old=await loadV2Catalog(db);
  assert.ok(old.products.some(p=>p.code==='cinematic_video'));
  assert.ok(!old.products.some(p=>p.code.startsWith('atelie')));
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_orders").get().n,0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_payments").get().n,0);
});
test('Draft price stays private, invalid scope is rejected and public excludes hidden package', async () => {
  const db=database({beforeApprovedAtelie:true});
  const draft=await updateAtelieDraft(db,'essencia',{
    shortDescription:'Artes coordenadas para sua festa.',
    priceCents:15900,pointsUnits:250,
    includedItems:['1 brasão (apenas exemplo interno, não aprovado)']
  });
  assert.equal(draft.priceCents,15900);
  assert.equal(draft.scopeApproved,false);
  const publicRows=await listAteliePackages(db);
  const p=publicRows.find(x=>x.code==='essencia');
  assert.ok(!('priceCents' in p));
  assert.deepEqual(p.includedItems,[]);
  await assert.rejects(updateAtelieDraft(db,'essencia',{scopeApproved:true}),/Para validar o escopo/);
  await assert.rejects(updateAtelieDraft(db,'essencia',{sellingEnabled:true}),/Configuração não permitida/);
  await updateAtelieDraft(db,'universo',{showcaseVisible:false});
  assert.ok(!(await listAteliePackages(db)).some(x=>x.code==='universo'));
  assert.ok((await listAteliePackages(db,{admin:true})).some(x=>x.code==='universo'));
});
test('Changing approved package scope revokes publication until a new V4.1 review', async () => {
  const db=database({beforeApprovedAtelie:true});
  await updateAtelieDraft(db,'essencia',{
    includedItems:['Brasão (escopo ilustrativo de teste)'],
    excludedItems:['Impressão física'],revisionLimit:1,scopeReference:'V4.1'
  });
  await updateAtelieDraft(db,'essencia',{scopeApproved:true});
  assert.deepEqual((await listAteliePackages(db)).find(x=>x.code==='essencia').includedItems,
    ['Brasão (escopo ilustrativo de teste)']);
  await assert.rejects(updateAtelieDraft(db,'essencia',{
    includedItems:['Brasão','Logotipo'],scopeApproved:true
  }),/O escopo mudou/);
  await updateAtelieDraft(db,'essencia',{
    includedItems:['Brasão','Logotipo'],scopeApproved:false
  });
  assert.deepEqual((await listAteliePackages(db)).find(x=>x.code==='essencia').includedItems,[]);
});
test('Ateliê cannot go through existing V2 checkout or invoice quote', async () => {
  const db=database({beforeApprovedAtelie:true});
  await assert.rejects(calculateCommercialV2Quote(db,{
    productCode:'atelie_essencia',paymentMethod:'pix',addonCodes:['confirmation_libri']
  }),/não está liberado para compra/);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_orders").get().n,0);
});
test('Read-only public endpoint hides all draft values', async () => {
  const db=database({beforeApprovedAtelie:true});
  await updateAtelieDraft(db,'essencia',{priceCents:54900,commercialNotes:'SECRETO: DESCONTO INTERNO'});
  const response=await worker.fetch(
    new Request('https://pedidos.libriconvites.com.br/api/v2/atelie/catalog'),
    {DB:db},{waitUntil(){}}
  );
  assert.equal(response.status,200);
  const text=await response.text();
  assert.ok(!text.includes('54900'));
  assert.ok(!text.includes('SECRETO'));
  const data=JSON.parse(text);
  assert.equal(data.purchaseAvailable,false);
  assert.equal(data.packages.length,3);
  assert.ok(data.packages.every(x=>x.purchaseAvailable===false));
});
test('Ateliê private drafts and production routes require existing Admin Passkey session', async () => {
  const DB=database({beforeApprovedAtelie:true}),ctx={waitUntil(){}};
  for(const [path,method] of [
    ['/api/admin/v2/atelie/packages','GET'],
    ['/api/admin/v2/atelie/packages/essencia','PATCH'],
    ['/api/admin/v2/atelie/packages/essencia/approved-catalog','POST'],
    ['/api/admin/v2/atelie/orders/LIBRI-2001/production','GET'],
    ['/api/admin/v2/atelie/orders/LIBRI-2001/production','PATCH']
  ]) {
    const response=await worker.fetch(new Request(
      'https://pedidos.libriconvites.com.br'+path,{method}
    ),{DB},ctx);
    assert.equal(response.status,401,method+' '+path+' deve exigir Passkey');
  }
});
test('Ateliê briefing is isolated, adaptive, and private by default', () => {
  const base=buildAtelieBriefingBlueprint({
    packageCode:'essencia',event:{honoreeName:'Criança',type:'birthday',date:'2027-03-20'}
  });
  assert.equal(base.kind,'atelie');
  assert.equal(base.saleReady,false);
  assert.equal(base.portfolioConsentDefault,false);
  assert.ok(!base.sections.flatMap(x=>x.fields).some(f=>f.key==='childPhotos'));
  assert.equal(base.sections[0].fields[0].prefill,'Criança');
  const withPhoto=buildAtelieBriefingBlueprint({requiresChildPhoto:true,data:{mascotMode:'criança ilustrada',childPhotoPermission:'sim',
    guardianAuthorization:'sim',styleFreedom:'quero escolher'}});
  const fields=withPhoto.sections.flatMap(x=>x.fields);
  assert.ok(fields.some(x=>x.key==='childPhotos'&&x.privateOnly===true));
  assert.ok(fields.some(x=>x.key==='styleDetails'));
  assert.ok(!fields.some(x=>x.key==='speech_preference'));
  assert.equal(fields.find(x=>x.key==='portfolioConsent').prefill,'não autorizo');
});
test('Ateliê is in the existing Admin and store categories; older routes retained',()=>{
  const worker=readFileSync('src/index.js','utf8');
  const admin=readFileSync('public/js/admin-v2-config.js','utf8');
  const store=readFileSync('public/js/client-v3.js','utf8');
  const publicRoutes=readFileSync('src/routes/public-v2.js','utf8');
  assert.match(worker,/handleAdminAtelieV3Api/);
  assert.match(worker,/requireAdminPasskeyAuth/);
  assert.match(admin,/data-store-tab="atelie"/);
  assert.match(store,/choice\('invitation','Convite digital'/);
  assert.match(store,/choice\('identity','Identidade visual'/);
  assert.match(publicRoutes,/\/api\/v2\/atelie\/catalog/);
  assert.match(worker,/isClientV2Page/);
  assert.match(worker,/isAdminV2Page/);
});
