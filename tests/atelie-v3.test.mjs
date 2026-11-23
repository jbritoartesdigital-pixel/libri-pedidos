import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database } from './helpers.mjs';
import worker from '../src/index.js';
import { listAteliePackages, updateAtelieDraft } from '../src/lib/v3-atelie-catalog.js';
import { buildAtelieBriefingBlueprint } from '../src/lib/v3-atelie-briefing.js';
import { loadV2Catalog } from '../src/lib/v2-catalog.js';
import { calculateCommercialV2Quote } from '../src/lib/v2-commercial-pricing.js';

test('Ateliê starts with exactly three safe packages, no prices and no V2 sale products', async () => {
  const db=database();
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
  const db=database();
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
test('Ateliê cannot go through existing V2 checkout or invoice quote', async () => {
  const db=database();
  await assert.rejects(calculateCommercialV2Quote(db,{
    productCode:'atelie_essencia',paymentMethod:'pix',addonCodes:['confirmation_libri']
  }),/Produto não encontrado/);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_orders").get().n,0);
});
test('Read-only public endpoint hides all draft values', async () => {
  const db=database();
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
test('Ateliê briefing is isolated, adaptive, and private by default', () => {
  const base=buildAtelieBriefingBlueprint({
    packageCode:'essencia',event:{honoreeName:'Criança',type:'birthday',date:'2027-03-20'}
  });
  assert.equal(base.kind,'atelie');
  assert.equal(base.saleReady,false);
  assert.equal(base.portfolioConsentDefault,false);
  assert.ok(!base.sections.flatMap(x=>x.fields).some(f=>f.key==='childPhotos'));
  assert.equal(base.sections[0].fields[0].prefill,'Criança');
  const withPhoto=buildAtelieBriefingBlueprint({requiresChildPhoto:true,data:{childPhotoPermission:'sim',
    styleFreedom:'quero escolher'}});
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
  assert.match(store,/Convites Digitais/);
  assert.match(store,/Identidade Visual para Festas \| Libri Ateliê/);
  assert.match(publicRoutes,/\/api\/v2\/atelie\/catalog/);
  assert.match(worker,/isClientV2Page/);
  assert.match(worker,/isAdminV2Page/);
});
