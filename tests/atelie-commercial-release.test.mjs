import test from 'node:test';
import assert from 'node:assert/strict';
import { database,day,providerMock } from './helpers.mjs';
import worker from '../src/index.js';
import { updateAtelieDraft } from '../src/lib/v3-atelie-catalog.js';
import { setAtelieSaleStatus } from '../src/lib/v3-atelie-release.js';
import { calculateCommercialV2Quote } from '../src/lib/v2-commercial-pricing.js';
import { startV2Checkout } from '../src/lib/v2-checkout.js';

const TERMS='O pacote inclui somente os entregáveis digitais listados no briefing e no escopo V4.1 aprovado. '+
'As revisões são limitadas às rodadas contratadas. A impressão não está incluída. '+
'A autorização para divulgar fotos de crianças ou usar imagens no portfólio precisa ser separada.';
async function activate(db,code='essencia') {
  await updateAtelieDraft(db,code,{
    includedItems:['1 brasão aprovado no catálogo', '1 logotipo decorado'],
    excludedItems:['Impressão física', 'Convite cinematográfico'],
    scopeReference:'Catálogo comercial Libri Ateliê V4.1',
    priceCents:17800,pointsUnits:100,revisionLimit:2,
    specificTerms:TERMS
  });
  await updateAtelieDraft(db,code,{scopeApproved:true});
  return setAtelieSaleStatus(db,code,true);
}
test('Nenhum pacote entra à venda sem escopo, preço, revisões e termos aprovados',async()=>{
  const db=database();
  await assert.rejects(setAtelieSaleStatus(db,'essencia',true),/Antes de liberar/);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_products").get().n,7);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM v3_atelie_packages WHERE sale_enabled=1").get().n,0);
});
test('Ateliê publicado usa produto principal V2 sem expor convites a catálogos trocados',async()=>{
  const db=database();
  const release=await activate(db);
  assert.equal(release.enabled,true);
  const product=db.sqlite.prepare("SELECT active,pricing_mode FROM v2_products WHERE code='atelie_essencia'").get();
  assert.equal(product.active,1);
  assert.equal(product.pricing_mode,'fixed');
  const variant=db.sqlite.prepare("SELECT price_cents,points_units FROM v2_product_variants WHERE code='atelie_essencia_default'").get();
  assert.deepEqual(variant,{price_cents:17800,points_units:100});
  const storefront=await worker.fetch(new Request('https://test/api/v2/catalog'),{DB:db},{waitUntil(){}});
  const publicStore=await storefront.json();
  assert.equal(publicStore.catalog.products.length,7);
  assert.ok(!publicStore.catalog.products.some(x=>x.code.startsWith('atelie_')));
  const atelie=await worker.fetch(new Request('https://test/api/v2/atelie/catalog'),{DB:db},{waitUntil(){}});
  const obj=await atelie.json();
  const essencia=obj.packages.find(x=>x.code==='essencia');
  assert.equal(essencia.priceCents,17800);
  assert.equal(essencia.purchaseAvailable,true);
  assert.ok(essencia.specificTerms.includes('revisões'));
  assert.equal(obj.packages.find(x=>x.code==='encanto').purchaseAvailable,false);
  const quote=await calculateCommercialV2Quote(db,{
    productCode:'atelie_essencia',variantCode:'atelie_essencia_default',
    addonCodes:[],paymentMethod:'pix'
  });
  assert.equal(quote.totalCents,17800);
  assert.equal(quote.payment.depositPercent,100);
  assert.equal(quote.variant.config.atelie.revisionLimit,2);
  await assert.rejects(calculateCommercialV2Quote(db,{
    productCode:'atelie_essencia',paymentMethod:'pix',couponCode:'LIBRI15'
  }),/não se aplicam/);
  await assert.rejects(calculateCommercialV2Quote(db,{
    productCode:'atelie_essencia',paymentMethod:'pix',addonCodes:['save_the_date_static']
  }),/precisam estar configurados/);
  await assert.rejects(updateAtelieDraft(db,'essencia',{priceCents:1}),/Pause as vendas/);
  await setAtelieSaleStatus(db,'essencia',false);
  assert.equal(db.sqlite.prepare("SELECT active FROM v2_products WHERE code='atelie_essencia'").get().active,0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_orders").get().n,0);
});
test('Ateliê no Mercado Pago exige termos próprios e mantém os fluxos Pix existentes',async t=>{
  const db=database(), provider=providerMock(t);
  await activate(db);
  const version=db.sqlite.prepare("SELECT version FROM v2_terms_versions WHERE active=1").get().version;
  const pkg=db.sqlite.prepare("SELECT updated_at FROM v3_atelie_packages WHERE code='essencia'").get();
  const payload=()=>({
    clientRequestId:'atelie_'+crypto.randomUUID(),
    customer:{name:'Cliente Ateliê',whatsapp:'5511999887766',email:'atelie@example.com'},
    event:{honoreeName:'Ana',date:day(65),type:'birthday',subtype:''},
    selection:{productCode:'atelie_essencia',variantCode:'atelie_essencia_default',
      addonCodes:[],paymentMethod:'pix'},
    deliveryWindow:{start:day(10),end:day(12)},
    termsAccepted:true,termsVersion:version,
    atelieTermsVersion:pkg.updated_at
  });
  await assert.rejects(startV2Checkout(new Request('https://test/api/v2/checkout/start'),{
    DB:db,MERCADO_PAGO_ACCESS_TOKEN:'TEST-token'
  },payload()),/condições específicas/);
  const valid={...payload(),atelieTermsAccepted:true};
  const checkout=await startV2Checkout(new Request('https://test/api/v2/checkout/start'),{
    DB:db,MERCADO_PAGO_ACCESS_TOKEN:'TEST-token'
  },valid);
  assert.equal(checkout.ok,true);
  assert.equal(checkout.payment.method,'pix');
  assert.equal(checkout.payment.amountDueNowCents,17800);
  assert.ok(checkout.payment.checkoutUrl);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM v2_orders").get().n,1);
  const item=db.sqlite.prepare("SELECT configuration_json FROM v2_order_items WHERE item_type='product'").get();
  const snapshot=JSON.parse(item.configuration_json);
  assert.equal(snapshot.atelie.revisionLimit,2);
  assert.equal(snapshot.atelie.scopeReference,'Catálogo comercial Libri Ateliê V4.1');
  const evidence=db.sqlite.prepare('SELECT evidence_json FROM v2_order_terms_acceptances').get();
  assert.equal(JSON.parse(evidence.evidence_json).atelie.approvedByCustomer,true);
});
